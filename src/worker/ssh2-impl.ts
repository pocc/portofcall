/**
 * Minimal SSH2 client for Cloudflare Workers
 *
 * Algorithms: curve25519-sha256 | aes128-ctr | hmac-sha2-256
 * Auth:       password, Ed25519 publickey
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { pbkdf: bcryptPbkdf } = require('bcrypt-pbkdf') as { pbkdf: (pass: Uint8Array, passlen: number, salt: Uint8Array, saltlen: number, key: Uint8Array, keylen: number, rounds: number) => number };

// ─── Constants ───────────────────────────────────────────────────────────────

const MSG_DISCONNECT = 1;
const MSG_IGNORE = 2;
const MSG_SERVICE_REQUEST = 5;
const MSG_SERVICE_ACCEPT = 6;
const MSG_KEXINIT = 20;
const MSG_NEWKEYS = 21;
const MSG_KEXECDH_INIT = 30;
const MSG_KEXECDH_REPLY = 31;
const MSG_USERAUTH_REQUEST = 50;
const MSG_USERAUTH_FAILURE = 51;
const MSG_USERAUTH_SUCCESS = 52;
const MSG_USERAUTH_BANNER = 53;
const MSG_CHANNEL_OPEN = 90;
const MSG_CHANNEL_OPEN_CONFIRMATION = 91;
const MSG_CHANNEL_OPEN_FAILURE = 92;
const MSG_CHANNEL_DATA = 94;
const MSG_CHANNEL_EXTENDED_DATA = 95;
const MSG_CHANNEL_EOF = 96;
const MSG_CHANNEL_CLOSE = 97;
const MSG_CHANNEL_REQUEST = 98;
const MSG_CHANNEL_SUCCESS = 99;
const MSG_CHANNEL_FAILURE = 100;
const MSG_GLOBAL_REQUEST = 80;
const MSG_REQUEST_FAILURE = 82;
const MSG_CHANNEL_WINDOW_ADJUST = 93;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─── Binary utilities ─────────────────────────────────────────────────────────

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function sshStr(s: string): Uint8Array {
  const b = enc.encode(s);
  return cat(u32(b.length), b);
}

function sshBytes(b: Uint8Array): Uint8Array {
  return cat(u32(b.length), b);
}

/** SSH mpint encoding: big-endian integer, prepend 0x00 if high bit set */
function mpint(b: Uint8Array): Uint8Array {
  let start = 0;
  while (start < b.length - 1 && b[start] === 0) start++;
  b = b.subarray(start);
  if (b[0] & 0x80) {
    const padded = new Uint8Array(b.length + 1);
    padded.set(b, 1);
    return cat(u32(b.length + 1), padded);
  }
  return cat(u32(b.length), b);
}

function cat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(total) as Uint8Array<ArrayBuffer>;
  let off = 0;
  for (const a of arrays) { r.set(a, off); off += a.length; }
  return r;
}

/** Cast Uint8Array<ArrayBufferLike> → Uint8Array<ArrayBuffer> for Web Crypto APIs */
function ab(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u as unknown as Uint8Array<ArrayBuffer>;
}

/** Read an SSH string (uint32 length + bytes) from buf at offset; returns [data, nextOffset] */
function readStr(b: Uint8Array, off: number): [Uint8Array, number] {
  const len = readU32(b, off);
  off += 4;
  return [b.subarray(off, off + len), off + len];
}

// ─── Packet framing ───────────────────────────────────────────────────────────

/** Build an unencrypted SSH packet (packet_length || padding_length || payload || random_padding) */
function buildPacket(payload: Uint8Array): Uint8Array {
  const blockSize = 8;
  let padding = blockSize - ((4 + 1 + payload.length) % blockSize);
  if (padding < 4) padding += blockSize;
  const pad = new Uint8Array(padding);
  crypto.getRandomValues(pad);
  const pktLen = 1 + payload.length + padding;
  return cat(u32(pktLen), new Uint8Array([padding]), payload, pad);
}

/** Build an AES-128-CTR + HMAC-SHA-256 encrypted SSH packet */
async function buildEncPacket(
  payload: Uint8Array,
  seqno: number,
  encKey: CryptoKey,
  macKey: CryptoKey,
  counter: Uint8Array, // mutated: advanced by blocks used
): Promise<Uint8Array> {
  const blockSize = 16;
  let padding = blockSize - ((4 + 1 + payload.length) % blockSize);
  if (padding < 4) padding += blockSize;
  const pad = new Uint8Array(padding);
  crypto.getRandomValues(pad);
  const pktLen = 1 + payload.length + padding;
  const plaintext = cat(u32(pktLen), new Uint8Array([padding]), payload, pad);

  // MAC over: seqno || plaintext
  const macInput = cat(u32(seqno), plaintext);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, ab(macInput)));

  // Encrypt plaintext
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CTR', counter: ab(counter.slice()), length: 128 }, encKey, ab(plaintext))
  );

  advanceCounter(counter, Math.ceil(plaintext.length / 16));
  return cat(ciphertext, mac);
}

/** Increment a 16-byte big-endian counter by `blocks` */
function advanceCounter(counter: Uint8Array, blocks: number): void {
  let carry = blocks;
  for (let i = 15; i >= 0 && carry > 0; i--) {
    carry += counter[i];
    counter[i] = carry & 0xff;
    carry >>= 8;
  }
}

// ─── Packet reader ────────────────────────────────────────────────────────────

class PacketReader {
  private buf = new Uint8Array(0);

  feed(data: Uint8Array): void {
    const r = new Uint8Array(this.buf.length + data.length);
    r.set(this.buf);
    r.set(data, this.buf.length);
    this.buf = r;
  }

  /** Returns next unencrypted packet payload, or null if not enough data yet */
  readPlain(): Uint8Array | null {
    if (this.buf.length < 4) return null;
    const pktLen = readU32(this.buf, 0);
    if (this.buf.length < 4 + pktLen) return null;
    const padding = this.buf[4];
    const payload = this.buf.slice(5, 4 + pktLen - padding);
    this.buf = this.buf.slice(4 + pktLen);
    return payload;
  }

  /** Decrypt and return next encrypted packet payload, or null if not enough data */
  async readEncrypted(
    decKey: CryptoKey,
    macKey: CryptoKey,
    counter: Uint8Array, // mutated
    seqno: number,
  ): Promise<Uint8Array | null> {
    // We need at least 16 bytes for the first block (to learn packet length)
    if (this.buf.length < 16 + 32) return null;

    // Decrypt first block to read packet_length
    const firstBlock = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CTR', counter: ab(counter.slice()), length: 128 }, decKey, ab(this.buf.slice(0, 16)))
    );
    const pktLen = readU32(firstBlock, 0);
    if (pktLen > 64 * 1024) throw new Error(`SSH: packet too large (${pktLen})`);

    const totalBytes = 4 + pktLen + 32; // ciphertext + MAC
    if (this.buf.length < totalBytes) return null;

    // Decrypt remaining packet bytes starting at counter+1
    const counterForRest = counter.slice();
    advanceCounter(counterForRest, 1);
    const remainingCT = this.buf.slice(16, 4 + pktLen);
    let plaintext: Uint8Array;
    if (remainingCT.length > 0) {
      const remainingPT = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-CTR', counter: ab(counterForRest), length: 128 }, decKey, ab(remainingCT))
      );
      plaintext = cat(firstBlock, remainingPT);
    } else {
      plaintext = firstBlock;
    }

    // Verify MAC
    const mac = this.buf.slice(4 + pktLen, totalBytes);
    const expectedMac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, ab(cat(u32(seqno), plaintext))));
    for (let i = 0; i < 32; i++) {
      if (mac[i] !== expectedMac[i]) throw new Error('SSH: MAC verification failed');
    }

    advanceCounter(counter, Math.ceil((4 + pktLen) / 16));

    const padding = plaintext[4];
    const payload = plaintext.slice(5, 4 + pktLen - padding);
    this.buf = this.buf.slice(totalBytes);
    return payload;
  }

  get buffered(): number { return this.buf.length; }
}

// ─── Key derivation ───────────────────────────────────────────────────────────

async function deriveKey(K: Uint8Array, H: Uint8Array, label: string, sessionId: Uint8Array, needed: number): Promise<Uint8Array> {
  const seed = cat(mpint(K), H, enc.encode(label), sessionId);
  const k1 = new Uint8Array(await crypto.subtle.digest('SHA-256', ab(seed)));
  if (k1.length >= needed) return k1.slice(0, needed);
  const k2 = new Uint8Array(await crypto.subtle.digest('SHA-256', ab(cat(mpint(K), H, k1))));
  return cat(k1, k2).slice(0, needed);
}

// ─── OpenSSH Ed25519 key parsing ──────────────────────────────────────────────

interface Ed25519Keys { pub: Uint8Array; priv: Uint8Array; }

async function parseOpenSshEd25519(pem: string, passphrase?: string): Promise<Ed25519Keys> {
  const b64 = pem.replace(/-----[^\n]+\n?/g, '').replace(/\s/g, '');
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  let off = 0;

  // Magic: "openssh-key-v1\0" (14 chars + null = 15 bytes)
  const magic = enc.encode('openssh-key-v1');
  for (let i = 0; i < magic.length; i++) {
    if (buf[off + i] !== magic[i]) throw new Error('Not an OpenSSH private key');
  }
  off += magic.length + 1; // 14 chars + null byte

  // ciphername
  const [ciphernameB, off1] = readStr(buf, off); off = off1;
  const ciphername = dec.decode(ciphernameB);

  // kdfname + kdfoptions
  const [kdfnameB, off2] = readStr(buf, off); off = off2;
  const kdfname = dec.decode(kdfnameB);
  const [kdfoptionsB, off3] = readStr(buf, off); off = off3;

  // num keys
  if (readU32(buf, off) !== 1) throw new Error('Only single-key OpenSSH files are supported');
  off += 4;

  // public key blob (skip)
  const [, off4] = readStr(buf, off); off = off4;

  // private key blob (may be encrypted)
  const [encPrivBlob] = readStr(buf, off);
  let privBlob: Uint8Array;

  if (ciphername === 'none') {
    privBlob = encPrivBlob;
  } else {
    // Decrypt using bcrypt-pbkdf + AES-CTR
    if (!passphrase) {
      throw new Error(
        `This key is passphrase-protected (cipher: ${ciphername}). ` +
        `Enter your passphrase in the Passphrase field, or export an unencrypted copy: ` +
        `ssh-keygen -p -N "" -f <keyfile>`
      );
    }
    if (kdfname !== 'bcrypt') {
      throw new Error(`Unsupported KDF "${kdfname}" — only bcrypt is supported`);
    }
    // Supported ciphers: aes256-ctr, aes256-cbc, aes192-ctr, aes128-ctr
    const cipherMeta: Record<string, { keyLen: number; ivLen: number; mode: string }> = {
      'aes256-ctr': { keyLen: 32, ivLen: 16, mode: 'AES-CTR' },
      'aes256-cbc': { keyLen: 32, ivLen: 16, mode: 'AES-CBC' },
      'aes192-ctr': { keyLen: 24, ivLen: 16, mode: 'AES-CTR' },
      'aes128-ctr': { keyLen: 16, ivLen: 16, mode: 'AES-CTR' },
    };
    const cm = cipherMeta[ciphername];
    if (!cm) throw new Error(`Unsupported cipher "${ciphername}"`);

    // Parse kdfoptions: [4BE salt_len][salt][4BE rounds]
    const saltLen = readU32(kdfoptionsB, 0);
    const salt = kdfoptionsB.slice(4, 4 + saltLen);
    const rounds = readU32(kdfoptionsB, 4 + saltLen);

    // Derive key + IV via bcrypt_pbkdf
    const passBytes = enc.encode(passphrase);
    const derived = new Uint8Array(cm.keyLen + cm.ivLen);
    const rc = bcryptPbkdf(passBytes, passBytes.length, salt, salt.length, derived, derived.length, rounds);
    if (rc !== 0) throw new Error('bcrypt_pbkdf failed');

    const keyBytes = derived.slice(0, cm.keyLen);
    const ivBytes = derived.slice(cm.keyLen);

    // Decrypt private blob with Web Crypto (ab() casts Uint8Array<ArrayBufferLike> → Uint8Array<ArrayBuffer>)
    let decrypted: ArrayBuffer;
    if (cm.mode === 'AES-CTR') {
      const cryptoKey = await crypto.subtle.importKey('raw', ab(keyBytes), { name: 'AES-CTR' }, false, ['decrypt']);
      decrypted = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: ab(ivBytes), length: 128 }, cryptoKey, ab(encPrivBlob));
    } else {
      const cryptoKey = await crypto.subtle.importKey('raw', ab(keyBytes), { name: 'AES-CBC' }, false, ['decrypt']);
      decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ab(ivBytes) }, cryptoKey, ab(encPrivBlob));
    }
    privBlob = new Uint8Array(decrypted);
  }

  let p = 0;
  const check1 = readU32(privBlob, p); p += 4;
  const check2 = readU32(privBlob, p); p += 4;
  if (check1 !== check2) throw new Error('Wrong passphrase — OpenSSH key integrity check failed');

  const [keyTypeB, p2] = readStr(privBlob, p); p = p2;
  if (dec.decode(keyTypeB) !== 'ssh-ed25519') {
    throw new Error(`Unsupported key type "${dec.decode(keyTypeB)}" — only Ed25519 is supported`);
  }

  const [pubKey, p3] = readStr(privBlob, p); p = p3;
  const [privFull] = readStr(privBlob, p);
  // OpenSSH stores: 32-byte seed || 32-byte public key
  return { pub: pubKey, priv: privFull.slice(0, 32) };
}

// ─── KEXINIT payload ──────────────────────────────────────────────────────────

function buildKexInit(): Uint8Array {
  const cookie = new Uint8Array(16);
  crypto.getRandomValues(cookie);
  const nl = (names: string[]) => sshStr(names.join(','));
  return cat(
    new Uint8Array([MSG_KEXINIT]),
    cookie,
    nl(['curve25519-sha256']),                                // kex
    nl(['ssh-ed25519', 'rsa-sha2-256', 'rsa-sha2-512']),     // host key
    nl(['aes128-ctr']),                                       // enc c→s
    nl(['aes128-ctr']),                                       // enc s→c
    nl(['hmac-sha2-256']),                                    // mac c→s
    nl(['hmac-sha2-256']),                                    // mac s→c
    nl(['none']),                                             // compress c→s
    nl(['none']),                                             // compress s→c
    sshStr(''), sshStr(''),                                   // languages
    new Uint8Array([0]),                                      // first_kex_follows = false
    u32(0),                                                   // reserved
  );
}

// ─── Exchange hash ────────────────────────────────────────────────────────────

async function exchangeHash(
  clientVersion: string,
  serverVersion: string,
  clientKexInit: Uint8Array,
  serverKexInit: Uint8Array,
  serverHostKey: Uint8Array,
  clientEphPub: Uint8Array,
  serverEphPub: Uint8Array,
  sharedSecret: Uint8Array,
): Promise<Uint8Array> {
  const data = cat(
    sshBytes(enc.encode(clientVersion)),
    sshBytes(enc.encode(serverVersion)),
    sshBytes(clientKexInit),
    sshBytes(serverKexInit),
    sshBytes(serverHostKey),
    sshBytes(clientEphPub),
    sshBytes(serverEphPub),
    mpint(sharedSecret),
  );
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ab(data)));
}

// ─── SSH session ──────────────────────────────────────────────────────────────

export interface SSHTerminalOptions {
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

async function runSSHSession(
  tcpSocket: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void> },
  ws: WebSocket,
  opts: SSHTerminalOptions,
): Promise<void> {
  const tcpReader = tcpSocket.readable.getReader();
  const tcpWriter = tcpSocket.writable.getWriter();
  const packetReader = new PacketReader();

  function wsInfo(msg: string) { ws.send(JSON.stringify({ type: 'info', message: msg })); }
  function wsError(msg: string) { ws.send(JSON.stringify({ type: 'error', message: msg })); }

  async function readMore(): Promise<boolean> {
    try {
      const { done, value } = await tcpReader.read();
      if (done) return false;
      if (value) packetReader.feed(value);
      return true;
    } catch { return false; }
  }

  // Encryption state
  let encrypted = false;
  let c2sKey: CryptoKey | null = null;
  let s2cKey: CryptoKey | null = null;
  let c2sMac: CryptoKey | null = null;
  let s2cMac: CryptoKey | null = null;
  const c2sCounter = new Uint8Array(16);
  const s2cCounter = new Uint8Array(16);
  let c2sSeqno = 0;
  let s2cSeqno = 0;

  async function sendPayload(payload: Uint8Array): Promise<void> {
    if (!encrypted || !c2sKey || !c2sMac) {
      await tcpWriter.write(buildPacket(payload));
    } else {
      await tcpWriter.write(await buildEncPacket(payload, c2sSeqno, c2sKey, c2sMac, c2sCounter));
    }
    c2sSeqno++;
  }

  async function readPayload(): Promise<Uint8Array> {
    if (!encrypted || !s2cKey || !s2cMac) {
      while (true) {
        const p = packetReader.readPlain();
        if (p) { s2cSeqno++; return p; }
        if (!await readMore()) throw new Error('Connection closed');
      }
    } else {
      while (true) {
        const p = await packetReader.readEncrypted(s2cKey, s2cMac, s2cCounter, s2cSeqno);
        if (p) { s2cSeqno++; return p; }
        if (!await readMore()) throw new Error('Connection closed');
      }
    }
  }

  // ── Step 1: Version string exchange ─────────────────────────────────────────

  // Read bytes until \r\n; some servers send banner lines before SSH-2.0-...
  let serverVersion = '';
  let accumBuf = new Uint8Array(0);
  while (!serverVersion) {
    const { done, value } = await tcpReader.read();
    if (done) throw new Error('Connection closed during version exchange');
    accumBuf = cat(accumBuf, value);
    // Scan for \r\n
    for (let i = 0; i < accumBuf.length - 1; i++) {
      if (accumBuf[i] === 0x0d && accumBuf[i + 1] === 0x0a) {
        const line = dec.decode(accumBuf.slice(0, i));
        accumBuf = accumBuf.slice(i + 2);
        if (line.startsWith('SSH-')) {
          serverVersion = line;
          break;
        }
        // Non-SSH banner line — skip and continue scanning from i+2
        i = -1; // reset scan
      }
    }
  }
  if (accumBuf.length > 0) packetReader.feed(accumBuf);

  const clientVersion = 'SSH-2.0-PortOfCall_1.0';
  await tcpWriter.write(enc.encode(clientVersion + '\r\n'));

  // ── Step 2: KEXINIT ──────────────────────────────────────────────────────────

  const clientKexInitPayload = buildKexInit();
  await sendPayload(clientKexInitPayload);

  const serverKexInitPayload = await readPayload();
  if (serverKexInitPayload[0] !== MSG_KEXINIT) {
    throw new Error(`Expected KEXINIT (20), got ${serverKexInitPayload[0]}`);
  }

  // ── Step 3: Key exchange (curve25519-sha256) ─────────────────────────────────

  // Generate ephemeral X25519 keypair
  const clientEphKeyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
  const clientEphPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', clientEphKeyPair.publicKey));

  // SSH_MSG_KEXECDH_INIT: string Q_C (client ephemeral public key)
  await sendPayload(cat(new Uint8Array([MSG_KEXECDH_INIT]), sshBytes(clientEphPubRaw)));

  // Receive SSH_MSG_KEXECDH_REPLY
  const kexReply = await readPayload();
  if (kexReply[0] !== MSG_KEXECDH_REPLY) {
    throw new Error(`Expected KEXECDH_REPLY (31), got ${kexReply[0]}`);
  }

  let off = 1;
  const [hostKeyBlob, off1] = readStr(kexReply, off); off = off1;
  const [serverEphPubRaw, off2] = readStr(kexReply, off); off = off2;
  // exchange hash signature (we skip host key verification in this implementation)

  // Compute shared secret via X25519
  const serverEphPubKey = await crypto.subtle.importKey('raw', ab(serverEphPubRaw), { name: 'X25519' }, false, []);
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: serverEphPubKey },
    clientEphKeyPair.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Compute exchange hash H
  const H = await exchangeHash(
    clientVersion, serverVersion,
    clientKexInitPayload, serverKexInitPayload,
    hostKeyBlob,
    clientEphPubRaw, serverEphPubRaw,
    sharedSecret,
  );

  // Session ID = H (stays constant across re-keys; we don't re-key)
  const sessionId = H;

  // ── Step 4: NEWKEYS ──────────────────────────────────────────────────────────

  await sendPayload(new Uint8Array([MSG_NEWKEYS]));

  const newkeys = await readPayload();
  if (newkeys[0] !== MSG_NEWKEYS) throw new Error('Expected NEWKEYS');

  // Derive session keys
  // A = IV c→s, B = IV s→c, C = enc c→s, D = enc s→c, E = mac c→s, F = mac s→c
  const [ivC2S, ivS2C, encC2S, encS2C, macC2S, macS2C] = await Promise.all([
    deriveKey(sharedSecret, H, 'A', sessionId, 16),
    deriveKey(sharedSecret, H, 'B', sessionId, 16),
    deriveKey(sharedSecret, H, 'C', sessionId, 16),
    deriveKey(sharedSecret, H, 'D', sessionId, 16),
    deriveKey(sharedSecret, H, 'E', sessionId, 32),
    deriveKey(sharedSecret, H, 'F', sessionId, 32),
  ]);

  // Initialise counters from IVs
  c2sCounter.set(ivC2S);
  s2cCounter.set(ivS2C);

  // Import cipher and HMAC keys
  c2sKey = await crypto.subtle.importKey('raw', ab(encC2S), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  s2cKey = await crypto.subtle.importKey('raw', ab(encS2C), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  c2sMac = await crypto.subtle.importKey('raw', ab(macC2S), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  s2cMac = await crypto.subtle.importKey('raw', ab(macS2C), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

  encrypted = true;

  // ── Step 5: Service request (ssh-userauth) ───────────────────────────────────

  await sendPayload(cat(new Uint8Array([MSG_SERVICE_REQUEST]), sshStr('ssh-userauth')));
  const svcAccept = await readPayload();
  if (svcAccept[0] !== MSG_SERVICE_ACCEPT) throw new Error('Service request rejected');

  // ── Step 6: Authentication ───────────────────────────────────────────────────

  wsInfo('Authenticating…');
  let authed = false;

  if (opts.authMethod === 'password' && opts.password) {
    // SSH_MSG_USERAUTH_REQUEST with method "password"
    await sendPayload(cat(
      new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username),
      sshStr('ssh-connection'),
      sshStr('password'),
      new Uint8Array([0]), // bool: not a password change
      sshStr(opts.password),
    ));
  } else if (opts.authMethod === 'privateKey' && opts.privateKey) {
    // Parse Ed25519 key
    const { pub, priv } = await parseOpenSshEd25519(opts.privateKey, opts.passphrase);

    // Import signing key via JWK
    function b64url(b: Uint8Array): string {
      return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
    const signingKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', d: b64url(priv), x: b64url(pub) },
      { name: 'Ed25519' },
      false,
      ['sign'],
    );

    // Build the blob that gets signed: session_id || userauth_request (no signature)
    const pubKeyBlob = cat(sshStr('ssh-ed25519'), sshBytes(pub));
    const authMsg = cat(
      sshBytes(sessionId),
      new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username),
      sshStr('ssh-connection'),
      sshStr('publickey'),
      new Uint8Array([1]),       // has_sig = true
      sshStr('ssh-ed25519'),
      sshBytes(pubKeyBlob),
    );
    const sigBytes = new Uint8Array(await crypto.subtle.sign('Ed25519', signingKey, ab(authMsg)));
    const sigBlob = cat(sshStr('ssh-ed25519'), sshBytes(sigBytes));

    await sendPayload(cat(
      new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username),
      sshStr('ssh-connection'),
      sshStr('publickey'),
      new Uint8Array([1]),
      sshStr('ssh-ed25519'),
      sshBytes(pubKeyBlob),
      sshBytes(sigBlob),
    ));
  } else {
    throw new Error('No credentials provided');
  }

  // Wait for auth result (may get BANNER first)
  while (!authed) {
    const authReply = await readPayload();
    switch (authReply[0]) {
      case MSG_USERAUTH_SUCCESS:
        authed = true;
        break;
      case MSG_USERAUTH_FAILURE:
        throw new Error('Authentication failed');
      case MSG_USERAUTH_BANNER:
        // Show banner to user
        const [bannerBytes] = readStr(authReply, 1);
        wsInfo(dec.decode(bannerBytes).trim());
        break;
      default:
        // Ignore unexpected messages during auth
    }
  }

  // ── Step 7: Open session channel ─────────────────────────────────────────────

  const localChannel = 0;
  const localWindowSize = 1 * 1024 * 1024;
  const localMaxPktSize = 32 * 1024;

  await sendPayload(cat(
    new Uint8Array([MSG_CHANNEL_OPEN]),
    sshStr('session'),
    u32(localChannel),
    u32(localWindowSize),
    u32(localMaxPktSize),
  ));

  let remoteChannel = 0;
  let remoteWindow = 0;

  while (true) {
    const p = await readPayload();
    if (p[0] === MSG_CHANNEL_OPEN_CONFIRMATION) {
      // uint32 recipient_channel, uint32 sender_channel, uint32 initial_window, uint32 max_pkt
      remoteChannel = readU32(p, 5);
      remoteWindow = readU32(p, 9);
      break;
    }
    if (p[0] === MSG_CHANNEL_OPEN_FAILURE) {
      const [reasonB] = readStr(p, 9);
      throw new Error(`Channel open failed: ${dec.decode(reasonB)}`);
    }
    // Ignore other packets during channel setup
  }

  // ── Step 8: Request PTY ───────────────────────────────────────────────────────

  await sendPayload(cat(
    new Uint8Array([MSG_CHANNEL_REQUEST]),
    u32(remoteChannel),
    sshStr('pty-req'),
    new Uint8Array([1]),       // want_reply
    sshStr('xterm-256color'),  // TERM
    u32(220), u32(50),         // cols, rows
    u32(0), u32(0),            // pixel width/height
    sshBytes(new Uint8Array(0)), // terminal modes (empty)
  ));

  // Expect CHANNEL_SUCCESS — skip interstitial messages OpenSSH sends mid-setup
  {
    let r: Uint8Array;
    while (true) {
      r = await readPayload();
      if (r[0] === MSG_GLOBAL_REQUEST) {
        // want_reply is the byte after the request-name string
        const [, nameEnd] = readStr(r, 1);
        if (r[nameEnd]) await sendPayload(new Uint8Array([MSG_REQUEST_FAILURE]));
        continue;
      }
      if (r[0] === MSG_CHANNEL_WINDOW_ADJUST) { remoteWindow += readU32(r, 5); continue; }
      break;
    }
    if (r[0] !== MSG_CHANNEL_SUCCESS) throw new Error('PTY request failed');
  }

  // ── Step 9: Request shell ─────────────────────────────────────────────────────

  await sendPayload(cat(
    new Uint8Array([MSG_CHANNEL_REQUEST]),
    u32(remoteChannel),
    sshStr('shell'),
    new Uint8Array([1]), // want_reply
  ));

  {
    let r: Uint8Array;
    while (true) {
      r = await readPayload();
      if (r[0] === MSG_GLOBAL_REQUEST) {
        const [, nameEnd] = readStr(r, 1);
        if (r[nameEnd]) await sendPayload(new Uint8Array([MSG_REQUEST_FAILURE]));
        continue;
      }
      if (r[0] === MSG_CHANNEL_WINDOW_ADJUST) { remoteWindow += readU32(r, 5); continue; }
      break;
    }
    if (r[0] !== MSG_CHANNEL_SUCCESS) throw new Error(`Shell request failed (got ${r[0]})`);
  }

  // ── Step 10: I/O forwarding ───────────────────────────────────────────────────

  let channelOpen = false; // set true only after 'connected' is sent
  let localWindowRemaining = localWindowSize;

  ws.send(JSON.stringify({ type: 'connected' }));
  channelOpen = true;

  // WebSocket → SSH: forward terminal input as channel data
  ws.addEventListener('message', async (event: MessageEvent) => {
    if (!channelOpen) return;
    const text = typeof event.data === 'string' ? event.data : dec.decode(event.data as ArrayBuffer);

    // Ignore JSON control messages from browser
    if (text.startsWith('{') && text.includes('"type"')) return;

    const data = enc.encode(text);
    if (data.length === 0) return;

    try {
      // Split data into chunks that fit the available remote window
      for (let offset = 0; offset < data.length; offset += remoteWindow) {
        const chunkSize = Math.min(data.length - offset, remoteWindow);
        if (chunkSize === 0) break;
        const chunk = data.slice(offset, offset + chunkSize);
        await sendPayload(cat(
          new Uint8Array([MSG_CHANNEL_DATA]),
          u32(remoteChannel),
          sshBytes(chunk),
        ));
        remoteWindow -= chunk.length;
      }
    } catch { /* connection may have closed */ }
  });

  // SSH → WebSocket: forward channel output to terminal
  while (channelOpen) {
    let p: Uint8Array;
    try {
      p = await readPayload();
    } catch {
      break;
    }

    switch (p[0]) {
      case MSG_CHANNEL_DATA: {
        const [data] = readStr(p, 5);
        localWindowRemaining -= data.length;
        ws.send(data);

        // Send window adjust when our window is running low
        if (localWindowRemaining < 256 * 1024) {
          const refill = 1 * 1024 * 1024;
          try {
            await sendPayload(cat(
              new Uint8Array([MSG_CHANNEL_WINDOW_ADJUST]),
              u32(remoteChannel),
              u32(refill),
            ));
            localWindowRemaining += refill;
          } catch { /* ignore */ }
        }
        break;
      }

      case MSG_CHANNEL_EXTENDED_DATA: {
        // stderr — send it anyway so it shows in the terminal
        const [data] = readStr(p, 9);
        ws.send(data);
        break;
      }

      case MSG_CHANNEL_WINDOW_ADJUST:
        remoteWindow += readU32(p, 5);
        break;

      case MSG_GLOBAL_REQUEST: {
        // e.g. hostkeys-00@openssh.com — respond with failure if want_reply
        const [, nameEnd] = readStr(p, 1);
        if (p[nameEnd]) {
          try { await sendPayload(new Uint8Array([MSG_REQUEST_FAILURE])); } catch { /* ignore */ }
        }
        break;
      }

      case MSG_CHANNEL_EOF:
        // Half-close from server; wait for CLOSE
        break;

      case MSG_CHANNEL_CLOSE:
        channelOpen = false;
        break;

      case MSG_DISCONNECT: {
        const [reason] = readStr(p, 5);
        wsError(`Disconnected: ${dec.decode(reason)}`);
        channelOpen = false;
        break;
      }

      case MSG_IGNORE:
        break;

      default:
        break;
    }
  }

  ws.send(JSON.stringify({ type: 'disconnected' }));
}

// ─── SSH Subsystem (SFTP and similar channel types) ──────────────────────────

export interface SSHSubsystemIO {
  /** Send raw bytes to the SSH subsystem channel. */
  sendChannelData(data: Uint8Array): Promise<void>;
  /** Read the next incoming channel data chunk. Returns null if channel closed. */
  readChannelData(): Promise<Uint8Array | null>;
  /** Close the SSH session cleanly. */
  close(): Promise<void>;
}

/**
 * Establish an SSH session and open a named subsystem channel (e.g. "sftp").
 * Handles: version exchange, key exchange, encryption, auth, channel open + subsystem request.
 */
export async function openSSHSubsystem(
  tcpSocket: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void> },
  opts: SSHTerminalOptions,
  subsystem: string,
  isExec = false,
): Promise<SSHSubsystemIO> {
  const tcpReader = tcpSocket.readable.getReader();
  const tcpWriter = tcpSocket.writable.getWriter();
  const packetReader2 = new PacketReader();

  let encrypted2 = false;
  let c2sKey2: CryptoKey | null = null;
  let s2cKey2: CryptoKey | null = null;
  let c2sMac2: CryptoKey | null = null;
  let s2cMac2: CryptoKey | null = null;
  const c2sCounter2 = new Uint8Array(16);
  const s2cCounter2 = new Uint8Array(16);
  let c2sSeqno2 = 0;
  let s2cSeqno2 = 0;

  async function sendPayload2(payload: Uint8Array): Promise<void> {
    if (!encrypted2 || !c2sKey2 || !c2sMac2) {
      await tcpWriter.write(buildPacket(payload));
    } else {
      await tcpWriter.write(await buildEncPacket(payload, c2sSeqno2, c2sKey2, c2sMac2, c2sCounter2));
    }
    c2sSeqno2++;
  }

  async function readPayload2(): Promise<Uint8Array> {
    if (!encrypted2 || !s2cKey2 || !s2cMac2) {
      while (true) {
        const p = packetReader2.readPlain();
        if (p) { s2cSeqno2++; return p; }
        const { done, value } = await tcpReader.read();
        if (done) throw new Error('Connection closed');
        if (value) packetReader2.feed(value);
      }
    } else {
      while (true) {
        const p = await packetReader2.readEncrypted(s2cKey2, s2cMac2, s2cCounter2, s2cSeqno2);
        if (p) { s2cSeqno2++; return p; }
        const { done, value } = await tcpReader.read();
        if (done) throw new Error('Connection closed');
        if (value) packetReader2.feed(value);
      }
    }
  }

  // Step 1: Version exchange
  let serverVersion2 = '';
  let accumBuf2 = new Uint8Array(0);
  while (!serverVersion2) {
    const { done, value } = await tcpReader.read();
    if (done) throw new Error('Connection closed during version exchange');
    accumBuf2 = cat(accumBuf2, value);
    for (let i = 0; i < accumBuf2.length - 1; i++) {
      if (accumBuf2[i] === 0x0d && accumBuf2[i + 1] === 0x0a) {
        const line = dec.decode(accumBuf2.slice(0, i));
        accumBuf2 = accumBuf2.slice(i + 2);
        if (line.startsWith('SSH-')) { serverVersion2 = line; break; }
        i = -1;
      }
    }
  }
  if (accumBuf2.length > 0) packetReader2.feed(accumBuf2);

  const clientVersion2 = 'SSH-2.0-PortOfCall_1.0';
  await tcpWriter.write(enc.encode(clientVersion2 + '\r\n'));

  // Step 2: KEXINIT
  const clientKexInitPayload2 = buildKexInit();
  await sendPayload2(clientKexInitPayload2);
  const serverKexInitPayload2 = await readPayload2();
  if (serverKexInitPayload2[0] !== MSG_KEXINIT) throw new Error(`Expected KEXINIT, got ${serverKexInitPayload2[0]}`);

  // Step 3: Key exchange (curve25519-sha256)
  const kp2 = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
  const clientPub2 = new Uint8Array(await crypto.subtle.exportKey('raw', kp2.publicKey));
  await sendPayload2(cat(new Uint8Array([MSG_KEXECDH_INIT]), sshBytes(clientPub2)));
  const kexReply2 = await readPayload2();
  if (kexReply2[0] !== MSG_KEXECDH_REPLY) throw new Error(`Expected KEXECDH_REPLY, got ${kexReply2[0]}`);

  let koff = 1;
  const [hostKeyBlob2, koff1] = readStr(kexReply2, koff); koff = koff1;
  const [serverPub2, koff2] = readStr(kexReply2, koff); koff = koff2; void koff;

  const serverPubKey2 = await crypto.subtle.importKey('raw', ab(serverPub2), { name: 'X25519' }, false, []);
  const sharedBits2 = await crypto.subtle.deriveBits({ name: 'X25519', public: serverPubKey2 }, kp2.privateKey, 256);
  const sharedSecret2 = new Uint8Array(sharedBits2);
  const H2 = await exchangeHash(clientVersion2, serverVersion2, clientKexInitPayload2, serverKexInitPayload2, hostKeyBlob2, clientPub2, serverPub2, sharedSecret2);
  const sessionId2 = H2;

  // Step 4: NEWKEYS
  await sendPayload2(new Uint8Array([MSG_NEWKEYS]));
  const nk2 = await readPayload2();
  if (nk2[0] !== MSG_NEWKEYS) throw new Error('Expected NEWKEYS');

  const [ivC2, ivS2, encC2, encS2, macC2, macS2] = await Promise.all([
    deriveKey(sharedSecret2, H2, 'A', sessionId2, 16),
    deriveKey(sharedSecret2, H2, 'B', sessionId2, 16),
    deriveKey(sharedSecret2, H2, 'C', sessionId2, 16),
    deriveKey(sharedSecret2, H2, 'D', sessionId2, 16),
    deriveKey(sharedSecret2, H2, 'E', sessionId2, 32),
    deriveKey(sharedSecret2, H2, 'F', sessionId2, 32),
  ]);
  c2sCounter2.set(ivC2);
  s2cCounter2.set(ivS2);
  c2sKey2 = await crypto.subtle.importKey('raw', ab(encC2), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  s2cKey2 = await crypto.subtle.importKey('raw', ab(encS2), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  c2sMac2 = await crypto.subtle.importKey('raw', ab(macC2), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  s2cMac2 = await crypto.subtle.importKey('raw', ab(macS2), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  encrypted2 = true;

  // Step 5: Service request
  await sendPayload2(cat(new Uint8Array([MSG_SERVICE_REQUEST]), sshStr('ssh-userauth')));
  const svc2 = await readPayload2();
  if (svc2[0] !== MSG_SERVICE_ACCEPT) throw new Error('Service request rejected');

  // Step 6: Authentication
  if (opts.authMethod === 'password' && opts.password) {
    await sendPayload2(cat(
      new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username),
      sshStr('ssh-connection'),
      sshStr('password'),
      new Uint8Array([0]),
      sshStr(opts.password),
    ));
  } else if (opts.authMethod === 'privateKey' && opts.privateKey) {
    const { pub: pub2, priv: priv2 } = await parseOpenSshEd25519(opts.privateKey, opts.passphrase);
    const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const sk2 = await crypto.subtle.importKey('jwk',
      { kty: 'OKP', crv: 'Ed25519', d: b64u(priv2), x: b64u(pub2) },
      { name: 'Ed25519' }, false, ['sign']);
    const pkBlob2 = cat(sshStr('ssh-ed25519'), sshBytes(pub2));
    const authMsg2 = cat(
      sshBytes(sessionId2), new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username), sshStr('ssh-connection'), sshStr('publickey'),
      new Uint8Array([1]), sshStr('ssh-ed25519'), sshBytes(pkBlob2),
    );
    const sig2 = new Uint8Array(await crypto.subtle.sign('Ed25519', sk2, ab(authMsg2)));
    await sendPayload2(cat(
      new Uint8Array([MSG_USERAUTH_REQUEST]),
      sshStr(opts.username), sshStr('ssh-connection'), sshStr('publickey'),
      new Uint8Array([1]), sshStr('ssh-ed25519'), sshBytes(pkBlob2), sshBytes(cat(sshStr('ssh-ed25519'), sshBytes(sig2))),
    ));
  } else {
    throw new Error('No credentials provided');
  }

  while (true) {
    const ar = await readPayload2();
    if (ar[0] === MSG_USERAUTH_SUCCESS) break;
    if (ar[0] === MSG_USERAUTH_FAILURE) throw new Error('Authentication failed');
    // Skip banners (MSG_USERAUTH_BANNER = 53) and other messages
  }

  // Step 7: Open session channel
  const localCh = 0;
  const localWin = 1 * 1024 * 1024;
  const localMax = 32 * 1024;
  await sendPayload2(cat(
    new Uint8Array([MSG_CHANNEL_OPEN]), sshStr('session'),
    u32(localCh), u32(localWin), u32(localMax),
  ));

  let remoteCh = 0;
  let remoteWin = 0;
  while (true) {
    const p = await readPayload2();
    if (p[0] === MSG_CHANNEL_OPEN_CONFIRMATION) {
      remoteCh = readU32(p, 5);
      remoteWin = readU32(p, 9);
      break;
    }
    if (p[0] === MSG_CHANNEL_OPEN_FAILURE) {
      const [rb] = readStr(p, 9);
      throw new Error(`Channel open failed: ${dec.decode(rb)}`);
    }
  }

  // Step 8: Request subsystem or exec channel
  await sendPayload2(cat(
    new Uint8Array([MSG_CHANNEL_REQUEST]), u32(remoteCh),
    sshStr(isExec ? 'exec' : 'subsystem'), new Uint8Array([1]), sshStr(subsystem),
  ));
  while (true) {
    const r = await readPayload2();
    if (r[0] === MSG_GLOBAL_REQUEST) {
      const [, ne] = readStr(r, 1);
      if (r[ne]) await sendPayload2(new Uint8Array([MSG_REQUEST_FAILURE]));
      continue;
    }
    if (r[0] === MSG_CHANNEL_WINDOW_ADJUST) { remoteWin += readU32(r, 5); continue; }
    if (r[0] === MSG_CHANNEL_SUCCESS) break;
    if (r[0] === MSG_CHANNEL_FAILURE) throw new Error(
      isExec ? `Exec '${subsystem}' failed on this server` : `Subsystem '${subsystem}' not available on this server`
    );
  }

  // ── Channel I/O ──────────────────────────────────────────────────────────────

  let localWinRemaining = localWin;
  let chClosed = false;

  async function sendChannelData(data: Uint8Array): Promise<void> {
    if (chClosed) throw new Error('Channel closed');
    for (let off2 = 0; off2 < data.length; off2 += localMax) {
      const chunk = data.slice(off2, off2 + localMax);
      // Wait for remote window to have enough space for this chunk
      while (chunk.length > remoteWin) {
        const p = await readPayload2();
        if (p[0] === MSG_CHANNEL_WINDOW_ADJUST) {
          remoteWin += readU32(p, 5);
        } else if (p[0] === MSG_CHANNEL_EOF || p[0] === MSG_CHANNEL_CLOSE) {
          chClosed = true;
          throw new Error('Channel closed while waiting for window');
        } else if (p[0] === MSG_GLOBAL_REQUEST) {
          const [, ne] = readStr(p, 1);
          if (p[ne]) await sendPayload2(new Uint8Array([MSG_REQUEST_FAILURE]));
        }
        // Ignore other message types
      }
      await sendPayload2(cat(new Uint8Array([MSG_CHANNEL_DATA]), u32(remoteCh), sshBytes(chunk)));
      remoteWin -= chunk.length;
    }
  }

  async function readChannelData(): Promise<Uint8Array | null> {
    while (true) {
      const p = await readPayload2();
      if (p[0] === MSG_CHANNEL_DATA) {
        const [data] = readStr(p, 5);
        localWinRemaining -= data.length;
        if (localWinRemaining < 256 * 1024) {
          const refill = 1 * 1024 * 1024;
          try {
            await sendPayload2(cat(new Uint8Array([MSG_CHANNEL_WINDOW_ADJUST]), u32(remoteCh), u32(refill)));
            localWinRemaining += refill;
          } catch { /* ignore */ }
        }
        return data;
      }
      if (p[0] === MSG_CHANNEL_EOF || p[0] === MSG_CHANNEL_CLOSE) { chClosed = true; return null; }
      if (p[0] === MSG_CHANNEL_WINDOW_ADJUST) { remoteWin += readU32(p, 5); continue; }
      if (p[0] === MSG_GLOBAL_REQUEST) {
        const [, ne] = readStr(p, 1);
        if (p[ne]) await sendPayload2(new Uint8Array([MSG_REQUEST_FAILURE]));
        continue;
      }
    }
  }

  async function close(): Promise<void> {
    if (!chClosed) {
      try { await sendPayload2(cat(new Uint8Array([MSG_CHANNEL_CLOSE]), u32(remoteCh))); } catch { /* ignore */ }
      chClosed = true;
    }
    try { tcpReader.releaseLock(); } catch { /* ignore */ }
    try { tcpWriter.releaseLock(); } catch { /* ignore */ }
    try { await tcpSocket.close(); } catch { /* ignore */ }
  }

  return { sendChannelData, readChannelData, close };
}

// ─── Public handler ───────────────────────────────────────────────────────────

export async function handleSSHTerminal(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') ?? '';
  const port = parseInt(url.searchParams.get('port') ?? '22');
  const username = url.searchParams.get('username') ?? '';
  const authMethod = (url.searchParams.get('authMethod') ?? 'password') as 'password' | 'privateKey';
  const password = url.searchParams.get('password') ?? undefined;
  const privateKey = url.searchParams.get('privateKey') ?? undefined;

  if (!host || !username) {
    return new Response(JSON.stringify({ error: 'host and username are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  // Check for Cloudflare proxy before attempting TCP
  (async () => {
    try {
      const cfCheck = await checkIfCloudflare(host);
      if (cfCheck.isCloudflare && cfCheck.ip) {
        server.send(JSON.stringify({ type: 'error', message: getCloudflareErrorMessage(host, cfCheck.ip) }));
        server.close(1011, 'Cloudflare proxy');
        return;
      }

      server.send(JSON.stringify({ type: 'info', message: `Connecting to ${username}@${host}:${port}…` }));

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      await runSSHSession(socket, server, { host, port, username, authMethod, password, privateKey });
    } catch (err) {
      try {
        server.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      } catch { /* ignore */ }
    } finally {
      try { server.close(1000, 'done'); } catch { /* ignore */ }
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}
