/**
 * DNS Protocol Support for Cloudflare Workers
 * DNS over TCP (RFC 1035) — Domain Name Resolution
 * Port: 53
 *
 * Power-user features:
 *   - EDNS0 (RFC 6891): 4096-byte UDP payload, DNSSEC OK bit
 *   - DNSSEC record parsing: DNSKEY, RRSIG, DS, NSEC, NSEC3, CDS, CDNSKEY (RFC 4034, 5155)
 *   - Zone transfer: AXFR (RFC 5936) via /api/dns/axfr
 *   - Full SOA parsing: serial, refresh, retry, expire, minimum
 *   - Additional record types: NAPTR (RFC 3403), CAA (RFC 8659), TLSA (RFC 6698)
 *   - AD (authentic data) and CD (checking disabled) flags
 *   - OPT record decoding: EDNS version, payload size, DO bit, NSID option
 */

import { connect } from "cloudflare:sockets";
import { checkIfCloudflare, getCloudflareErrorMessage } from "./cloudflare-detector";

/** DNS record type codes */
export const DNS_RECORD_TYPES: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  NAPTR: 35,
  DS: 43,
  RRSIG: 46,
  NSEC: 47,
  DNSKEY: 48,
  NSEC3: 50,
  TLSA: 52,
  CDS: 59,
  CDNSKEY: 60,
  IXFR: 251,
  AXFR: 252,
  ANY: 255,
  CAA: 257,
};

/** Reverse lookup: code -> name */
const RECORD_TYPE_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(DNS_RECORD_TYPES)) {
  RECORD_TYPE_NAMES[code] = name;
}

/** DNS response codes */
const RCODE_NAMES: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
  6: "YXDOMAIN",
  7: "YXRRSET",
  8: "NXRRSET",
  9: "NOTAUTH",
  10: "NOTZONE",
};

/** DNSSEC algorithm numbers (RFC 8624) */
const DNSSEC_ALGORITHM_NAMES: Record<number, string> = {
  1: "RSAMD5",
  3: "DSA",
  5: "RSASHA1",
  6: "DSA-NSEC3-SHA1",
  7: "RSASHA1-NSEC3-SHA1",
  8: "RSASHA256",
  10: "RSASHA512",
  12: "ECC-GOST",
  13: "ECDSAP256SHA256",
  14: "ECDSAP384SHA384",
  15: "ED25519",
  16: "ED448",
};

/** DS/CDS digest type names */
const DIGEST_TYPE_NAMES: Record<number, string> = {
  1: "SHA-1",
  2: "SHA-256",
  3: "GOST R 34.11-94",
  4: "SHA-384",
};

export interface DNSRecord {
  name: string;
  type: string;
  typeCode: number;
  class: number;
  ttl: number;
  data: string;
  parsed?: Record<string, unknown>;
}

export interface DNSFlags {
  qr: boolean;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  ad: boolean;  // Authentic Data — DNSSEC validated (RFC 4035)
  cd: boolean;  // Checking Disabled — bypass DNSSEC validation
}

export interface DNSQueryResult {
  success: boolean;
  domain: string;
  server: string;
  port: number;
  queryType: string;
  rcode: string;
  flags: DNSFlags;
  questions: number;
  answers: DNSRecord[];
  authority: DNSRecord[];
  additional: DNSRecord[];
  queryTimeMs: number;
  edns?: {
    version: number;
    udpPayloadSize: number;
    doFlag: boolean;
    extendedRcode: number;
    options?: Array<{ code: number; name: string; data: string }>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format helpers
// ─────────────────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

/** Parse the NSEC/NSEC3 type bitmap windows into an array of type names. */
function parseTypeBitmap(data: Uint8Array, offset: number, end: number): string[] {
  const types: string[] = [];
  while (offset + 2 <= end) {
    const windowNum = data[offset];
    const bitmapLen = data[offset + 1];
    offset += 2;
    if (offset + bitmapLen > end) break;
    for (let byteIdx = 0; byteIdx < bitmapLen; byteIdx++) {
      const byte = data[offset + byteIdx];
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (0x80 >> bit)) {
          const typeCode = windowNum * 256 + byteIdx * 8 + bit;
          types.push(RECORD_TYPE_NAMES[typeCode] || `TYPE${typeCode}`);
        }
      }
    }
    offset += bitmapLen;
  }
  return types;
}

/** Parse a DNS character-string: 1-byte length + data. */
function parseCharString(data: Uint8Array, offset: number): { text: string; newOffset: number } {
  const len = data[offset];
  offset++;
  let text = "";
  for (let i = 0; i < len; i++) text += String.fromCharCode(data[offset + i]);
  return { text, newOffset: offset + len };
}

/**
 * Encode a domain name into DNS wire format
 */
function encodeDomainName(domain: string): number[] {
  const result: number[] = [];
  const labels = domain.split(".");
  for (const label of labels) {
    if (label.length > 63) throw new Error(`Label "${label}" exceeds 63 characters`);
    result.push(label.length);
    for (let i = 0; i < label.length; i++) result.push(label.charCodeAt(i));
  }
  result.push(0);
  return result;
}

interface BuildQueryOptions {
  /** Include EDNS0 OPT record (enables >512-byte responses, DNSSEC) */
  edns?: boolean;
  /** Set the DNSSEC OK (DO) bit in the EDNS0 OPT record */
  dnssecOK?: boolean;
  /** Set the CD (checking disabled) bit */
  checkingDisabled?: boolean;
}

/**
 * Build a DNS query packet, optionally with EDNS0 OPT record.
 */
function buildDNSQuery(domain: string, typeCode: number, opts: BuildQueryOptions = {}): Uint8Array {
  const { edns = true, dnssecOK = false, checkingDisabled = false } = opts;
  const buffer: number[] = [];

  const id = Math.floor(Math.random() * 65536);
  buffer.push((id >> 8) & 0xff, id & 0xff);

  // Flags: RD=1, CD=opt
  const flags1 = 0x01;
  const flags2 = checkingDisabled ? 0x10 : 0x00;
  buffer.push(flags1, flags2);

  buffer.push(0x00, 0x01); // QDCOUNT = 1
  buffer.push(0x00, 0x00); // ANCOUNT = 0
  buffer.push(0x00, 0x00); // NSCOUNT = 0
  buffer.push(0x00, edns ? 0x01 : 0x00); // ARCOUNT = 1 if EDNS0

  buffer.push(...encodeDomainName(domain));
  buffer.push((typeCode >> 8) & 0xff, typeCode & 0xff);
  buffer.push(0x00, 0x01); // class IN

  // EDNS0 OPT record (RFC 6891)
  if (edns) {
    buffer.push(0x00);          // root name
    buffer.push(0x00, 0x29);   // type OPT = 41
    buffer.push(0x10, 0x00);   // class = UDP payload size = 4096
    // TTL: [ext RCODE=0][EDNS ver=0][DO bit|z]
    buffer.push(0x00, 0x00);
    buffer.push(dnssecOK ? 0x80 : 0x00, 0x00);
    buffer.push(0x00, 0x00);   // RDLENGTH = 0
  }

  return new Uint8Array(buffer);
}

/**
 * Parse a DNS name from wire format with compression pointer support
 */
function parseDNSName(data: Uint8Array, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let jumped = false;
  let jumpReturn = -1;
  let currentOffset = offset;
  let safetyCounter = 0;

  while (safetyCounter++ < 128) {
    if (currentOffset >= data.length) break;
    const length = data[currentOffset];
    if (length === 0) { currentOffset++; break; }
    if ((length & 0xc0) === 0xc0) {
      if (!jumped) jumpReturn = currentOffset + 2;
      const pointer = ((length & 0x3f) << 8) | data[currentOffset + 1];
      currentOffset = pointer;
      jumped = true;
      continue;
    }
    currentOffset++;
    if (currentOffset + length > data.length) break;
    let label = "";
    for (let i = 0; i < length; i++) label += String.fromCharCode(data[currentOffset + i]);
    labels.push(label);
    currentOffset += length;
  }

  return { name: labels.join(".") || ".", newOffset: jumped ? jumpReturn : currentOffset };
}

/**
 * Parse a DNS resource record
 */
function parseDNSRecord(data: Uint8Array, offset: number): { record: DNSRecord; newOffset: number } {
  const nameResult = parseDNSName(data, offset);
  offset = nameResult.newOffset;

  if (offset + 10 > data.length) throw new Error("Truncated DNS record");

  const typeCode  = (data[offset] << 8) | data[offset + 1];
  const cls       = (data[offset + 2] << 8) | data[offset + 3];
  const ttl       = ((data[offset + 4] << 24) >>> 0) + (data[offset + 5] << 16) + (data[offset + 6] << 8) + data[offset + 7];
  const rdlength  = (data[offset + 8] << 8) | data[offset + 9];
  offset += 10;

  if (offset + rdlength > data.length) throw new Error("Truncated DNS record data");

  const rdataStart = offset;
  let dataStr = "";
  let parsed: Record<string, unknown> | undefined;

  switch (typeCode) {
    case DNS_RECORD_TYPES.A: {
      if (rdlength >= 4) dataStr = `${data[offset]}.${data[offset+1]}.${data[offset+2]}.${data[offset+3]}`;
      break;
    }
    case DNS_RECORD_TYPES.AAAA: {
      if (rdlength >= 16) {
        const parts: string[] = [];
        for (let i = 0; i < 8; i++) parts.push(((data[offset+i*2] << 8) | data[offset+i*2+1]).toString(16));
        dataStr = parts.join(":");
      }
      break;
    }
    case DNS_RECORD_TYPES.CNAME:
    case DNS_RECORD_TYPES.NS:
    case DNS_RECORD_TYPES.PTR: {
      dataStr = parseDNSName(data, offset).name;
      break;
    }
    case DNS_RECORD_TYPES.MX: {
      if (rdlength >= 3) {
        const priority = (data[offset] << 8) | data[offset+1];
        const result = parseDNSName(data, offset+2);
        dataStr = `${priority} ${result.name}`;
        parsed = { priority, exchange: result.name };
      }
      break;
    }
    case DNS_RECORD_TYPES.TXT: {
      const texts: string[] = [];
      let txtOffset = offset;
      const txtEnd = offset + rdlength;
      while (txtOffset < txtEnd) {
        const txtLen = data[txtOffset++];
        if (txtOffset + txtLen > txtEnd) break;
        let txt = "";
        for (let i = 0; i < txtLen; i++) txt += String.fromCharCode(data[txtOffset+i]);
        texts.push(txt);
        txtOffset += txtLen;
      }
      dataStr = texts.join("");
      break;
    }
    case DNS_RECORD_TYPES.SOA: {
      const mname = parseDNSName(data, offset);
      const rname = parseDNSName(data, mname.newOffset);
      let soaOffset = rname.newOffset;
      if (soaOffset + 20 <= data.length) {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const serial  = dv.getUint32(soaOffset, false); soaOffset += 4;
        const refresh = dv.getUint32(soaOffset, false); soaOffset += 4;
        const retry   = dv.getUint32(soaOffset, false); soaOffset += 4;
        const expire  = dv.getUint32(soaOffset, false); soaOffset += 4;
        const minimum = dv.getUint32(soaOffset, false);
        dataStr = `${mname.name} ${rname.name} ${serial} ${refresh} ${retry} ${expire} ${minimum}`;
        parsed = { mname: mname.name, rname: rname.name, serial, refresh, retry, expire, minimum };
      } else {
        dataStr = `${mname.name} ${rname.name}`;
      }
      break;
    }
    case DNS_RECORD_TYPES.SRV: {
      if (rdlength >= 7) {
        const priority = (data[offset] << 8) | data[offset+1];
        const weight   = (data[offset+2] << 8) | data[offset+3];
        const srvPort  = (data[offset+4] << 8) | data[offset+5];
        const target   = parseDNSName(data, offset+6);
        dataStr = `${priority} ${weight} ${srvPort} ${target.name}`;
        parsed = { priority, weight, port: srvPort, target: target.name };
      }
      break;
    }
    case DNS_RECORD_TYPES.NAPTR: {
      if (rdlength >= 4) {
        const order = (data[offset] << 8) | data[offset+1];
        const pref  = (data[offset+2] << 8) | data[offset+3];
        let noff = offset + 4;
        const fl = parseCharString(data, noff); noff = fl.newOffset;
        const sv = parseCharString(data, noff); noff = sv.newOffset;
        const rx = parseCharString(data, noff); noff = rx.newOffset;
        const repl = parseDNSName(data, noff);
        dataStr = `${order} ${pref} "${fl.text}" "${sv.text}" "${rx.text}" ${repl.name}`;
        parsed = { order, preference: pref, flags: fl.text, services: sv.text, regexp: rx.text, replacement: repl.name };
      }
      break;
    }
    case DNS_RECORD_TYPES.DS:
    case DNS_RECORD_TYPES.CDS: {
      if (rdlength >= 4) {
        const keyTag     = (data[offset] << 8) | data[offset+1];
        const algorithm  = data[offset+2];
        const digestType = data[offset+3];
        const digest     = data.slice(offset+4, offset+rdlength);
        dataStr = `${keyTag} ${algorithm} ${digestType} ${toHex(digest)}`;
        parsed = { keyTag, algorithm: DNSSEC_ALGORITHM_NAMES[algorithm] || algorithm, digestType: DIGEST_TYPE_NAMES[digestType] || digestType, digest: toHex(digest) };
      }
      break;
    }
    case DNS_RECORD_TYPES.RRSIG: {
      if (rdlength >= 18) {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const typeCovered = (data[offset] << 8) | data[offset+1];
        const algorithm   = data[offset+2];
        const labels      = data[offset+3];
        const origTTL     = dv.getUint32(offset+4,  false);
        const sigExp      = dv.getUint32(offset+8,  false);
        const sigInc      = dv.getUint32(offset+12, false);
        const keyTag      = (data[offset+16] << 8) | data[offset+17];
        const signerR     = parseDNSName(data, offset+18);
        const sigBytes    = data.slice(signerR.newOffset, offset+rdlength);
        const typeName    = RECORD_TYPE_NAMES[typeCovered] || `TYPE${typeCovered}`;
        dataStr = `${typeName} ${algorithm} ${labels} ${origTTL} ${new Date(sigExp*1000).toISOString()} ${new Date(sigInc*1000).toISOString()} ${keyTag} ${signerR.name}`;
        parsed = { typeCovered: typeName, algorithm: DNSSEC_ALGORITHM_NAMES[algorithm] || algorithm, labels, origTTL, sigExpiration: new Date(sigExp*1000).toISOString(), sigInception: new Date(sigInc*1000).toISOString(), keyTag, signerName: signerR.name, signature: toBase64(sigBytes) };
      }
      break;
    }
    case DNS_RECORD_TYPES.DNSKEY:
    case DNS_RECORD_TYPES.CDNSKEY: {
      if (rdlength >= 4) {
        const dkFlags   = (data[offset] << 8) | data[offset+1];
        const protocol  = data[offset+2];
        const algorithm = data[offset+3];
        const pubKey    = data.slice(offset+4, offset+rdlength);
        const isZoneKey = !!(dkFlags & 0x0100);
        const isSEP     = !!(dkFlags & 0x0001);
        const isRevoked = !!(dkFlags & 0x0080);
        const keyType   = isZoneKey ? (isSEP ? "KSK" : "ZSK") : "other";
        dataStr = `${dkFlags} ${protocol} ${algorithm} ${toBase64(pubKey)}`;
        parsed = { flags: dkFlags, keyType, protocol, algorithm: DNSSEC_ALGORITHM_NAMES[algorithm] || algorithm, isZoneKey, isSEP, isRevoked, publicKey: toBase64(pubKey) };
      }
      break;
    }
    case DNS_RECORD_TYPES.NSEC: {
      const nextDomain = parseDNSName(data, offset);
      const types = parseTypeBitmap(data, nextDomain.newOffset, offset+rdlength);
      dataStr = `${nextDomain.name} ${types.join(" ")}`;
      parsed = { nextDomain: nextDomain.name, types };
      break;
    }
    case DNS_RECORD_TYPES.NSEC3: {
      if (rdlength >= 5) {
        const hashAlgo   = data[offset];
        const nsec3Flags = data[offset+1];
        const iterations = (data[offset+2] << 8) | data[offset+3];
        const saltLen    = data[offset+4];
        let noff = offset + 5;
        const salt    = data.slice(noff, noff+saltLen); noff += saltLen;
        const hashLen = data[noff]; noff++;
        const nextHash = data.slice(noff, noff+hashLen); noff += hashLen;
        const types = parseTypeBitmap(data, noff, offset+rdlength);
        dataStr = `${hashAlgo} ${nsec3Flags} ${iterations} ${saltLen>0?toHex(salt):"-"} ${toBase64(nextHash)} ${types.join(" ")}`;
        parsed = { hashAlgorithm: hashAlgo, flags: nsec3Flags, optOut: !!(nsec3Flags&0x01), iterations, salt: saltLen>0?toHex(salt):"-", nextHashedOwner: toBase64(nextHash), types };
      }
      break;
    }
    case DNS_RECORD_TYPES.TLSA: {
      if (rdlength >= 3) {
        const certUsage    = data[offset];
        const selector     = data[offset+1];
        const matchingType = data[offset+2];
        const certData     = data.slice(offset+3, offset+rdlength);
        const usageNames   = ["PKIX-TA", "PKIX-EE", "DANE-TA", "DANE-EE"];
        const selectorNames = ["Cert", "SPKI"];
        const matchNames   = ["Full", "SHA-256", "SHA-512"];
        dataStr = `${certUsage} ${selector} ${matchingType} ${toHex(certData)}`;
        parsed = { certUsage: usageNames[certUsage]||certUsage, selector: selectorNames[selector]||selector, matchingType: matchNames[matchingType]||matchingType, certAssocData: toHex(certData) };
      }
      break;
    }
    case DNS_RECORD_TYPES.CAA: {
      if (rdlength >= 2) {
        const caaFlags = data[offset];
        const tagLen   = data[offset+1];
        if (offset+2+tagLen <= offset+rdlength) {
          let tag = "";
          for (let i = 0; i < tagLen; i++) tag += String.fromCharCode(data[offset+2+i]);
          let value = "";
          for (let i = offset+2+tagLen; i < offset+rdlength; i++) value += String.fromCharCode(data[i]);
          dataStr = `${caaFlags} ${tag} "${value}"`;
          parsed = { flags: caaFlags, isCritical: !!(caaFlags&0x80), tag, value };
        }
      }
      break;
    }
    case 41: {
      // OPT pseudo-RR (EDNS0)
      const udpPayloadSize = cls;
      const extRcode = (ttl >> 24) & 0xff;
      const ednsVer  = (ttl >> 16) & 0xff;
      const doFlag   = !!(ttl & 0x8000);
      const ednsOptNames: Record<number, string> = { 3: "NSID", 5: "DAU", 6: "DHU", 7: "N3U", 8: "edns-client-subnet", 10: "COOKIE", 11: "KEEPALIVE", 12: "PADDING", 14: "CHAIN", 15: "edns-key-tag" };
      const options: Array<{code:number;name:string;data:string}> = [];
      let ooff = offset;
      while (ooff+4 <= offset+rdlength) {
        const optCode = (data[ooff]<<8)|data[ooff+1];
        const optLen  = (data[ooff+2]<<8)|data[ooff+3];
        ooff += 4;
        options.push({ code: optCode, name: ednsOptNames[optCode]||`OPT${optCode}`, data: toHex(data.slice(ooff, ooff+optLen)) });
        ooff += optLen;
      }
      dataStr = `udpSize=${udpPayloadSize} version=${ednsVer} DO=${doFlag} extRcode=${extRcode}`;
      parsed = { udpPayloadSize, ednsVersion: ednsVer, doFlag, extendedRcode: extRcode, options };
      break;
    }
    default: {
      const bytes: string[] = [];
      for (let i = 0; i < rdlength && i < 64; i++) bytes.push(data[offset+i].toString(16).padStart(2, "0"));
      dataStr = bytes.join(" ");
      if (rdlength > 64) dataStr += "...";
      break;
    }
  }

  return {
    record: {
      name: nameResult.name,
      type: RECORD_TYPE_NAMES[typeCode] || `TYPE${typeCode}`,
      typeCode,
      class: cls,
      ttl,
      data: dataStr,
      ...(parsed ? { parsed } : {}),
    },
    newOffset: rdataStart + rdlength,
  };
}

/**
 * Parse a full DNS response
 */
function parseDNSResponse(data: Uint8Array): Omit<DNSQueryResult, "success"|"domain"|"server"|"port"|"queryType"|"queryTimeMs"> {
  if (data.length < 12) throw new Error("DNS response too short");

  const headerFlags = (data[2] << 8) | data[3];
  const qdcount = (data[4] << 8) | data[5];
  const ancount = (data[6] << 8) | data[7];
  const nscount = (data[8] << 8) | data[9];
  const arcount = (data[10] << 8) | data[11];
  const rcode   = headerFlags & 0x0f;

  let offset = 12;
  for (let i = 0; i < qdcount; i++) {
    const nameResult = parseDNSName(data, offset);
    offset = nameResult.newOffset + 4;
  }

  const answers: DNSRecord[] = [];
  for (let i = 0; i < ancount; i++) {
    try { const r = parseDNSRecord(data, offset); answers.push(r.record); offset = r.newOffset; }
    catch { break; }
  }

  const authority: DNSRecord[] = [];
  for (let i = 0; i < nscount; i++) {
    try { const r = parseDNSRecord(data, offset); authority.push(r.record); offset = r.newOffset; }
    catch { break; }
  }

  const additional: DNSRecord[] = [];
  let ednsInfo: DNSQueryResult["edns"];
  for (let i = 0; i < arcount; i++) {
    try {
      const r = parseDNSRecord(data, offset);
      if (r.record.typeCode === 41) {
        const p = r.record.parsed as { udpPayloadSize: number; ednsVersion: number; doFlag: boolean; extendedRcode: number; options: Array<{code:number;name:string;data:string}> } | undefined;
        if (p) ednsInfo = { version: p.ednsVersion, udpPayloadSize: p.udpPayloadSize, doFlag: p.doFlag, extendedRcode: p.extendedRcode, options: p.options };
      } else {
        additional.push(r.record);
      }
      offset = r.newOffset;
    } catch { break; }
  }

  return {
    rcode: RCODE_NAMES[rcode] || `RCODE${rcode}`,
    flags: {
      qr: !!(headerFlags & 0x8000),
      aa: !!(headerFlags & 0x0400),
      tc: !!(headerFlags & 0x0200),
      rd: !!(headerFlags & 0x0100),
      ra: !!(headerFlags & 0x0080),
      ad: !!(headerFlags & 0x0020),
      cd: !!(headerFlags & 0x0010),
    },
    questions: qdcount,
    answers,
    authority,
    additional,
    ...(ednsInfo ? { edns: ednsInfo } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TCP framing helpers
// ─────────────────────────────────────────────────────────────────────────────

function tcpWrap(pkt: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + pkt.length);
  out[0] = (pkt.length >> 8) & 0xff;
  out[1] = pkt.length & 0xff;
  out.set(pkt, 2);
  return out;
}

async function readTCPDNSMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let expectedLen = -1;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("read timeout")), deadline - Date.now())),
      ]);
    } catch { break; }
    if (result.done || !result.value) break;
    chunks.push(result.value);
    totalRead += result.value.length;

    if (expectedLen < 0 && totalRead >= 2) {
      let off = 0;
      const combined = new Uint8Array(totalRead);
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      expectedLen = (combined[0] << 8) | combined[1];
    }

    if (expectedLen >= 0 && totalRead >= expectedLen + 2) break;
  }

  if (totalRead < 2) return null;
  const combined = new Uint8Array(totalRead);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return combined.slice(2, 2 + expectedLen);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle DNS query (HTTP POST)
 *
 * POST /api/dns/query
 * Body: { domain, type?, server?, port?, edns?, dnssecOK?, checkingDisabled? }
 *
 * type: A NS CNAME SOA PTR MX TXT AAAA SRV NAPTR DS RRSIG NSEC DNSKEY NSEC3
 *       TLSA CDS CDNSKEY CAA AXFR IXFR ANY
 *
 * edns: true (default) — send EDNS0 OPT record for 4096-byte payload support
 * dnssecOK: true — set DO bit (auto-enabled for DNSKEY/RRSIG/DS/NSEC/NSEC3 queries)
 * checkingDisabled: true — set CD bit (bypass DNSSEC validation at resolver)
 */
export async function handleDNSQuery(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await request.json()) as {
      domain?: string;
      type?: string;
      server?: string;
      port?: number;
      edns?: boolean;
      dnssecOK?: boolean;
      checkingDisabled?: boolean;
    };

    if (!body.domain) {
      return new Response(JSON.stringify({ error: "Missing required parameter: domain" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const domain = body.domain.replace(/\.$/, "");
    const queryTypeName = (body.type || "A").toUpperCase();
    const typeCode = DNS_RECORD_TYPES[queryTypeName];

    if (typeCode === undefined) {
      return new Response(JSON.stringify({
        error: `Unknown record type: ${queryTypeName}. Supported: ${Object.keys(DNS_RECORD_TYPES).join(", ")}`,
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const server = body.server || "8.8.8.8";
    const port = body.port || 53;

    const cfCheck = await checkIfCloudflare(server);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(server, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const startTime = Date.now();

    const isDNSSECType = ["DS", "DNSKEY", "RRSIG", "NSEC", "NSEC3", "CDS", "CDNSKEY"].includes(queryTypeName);
    const edns = body.edns !== false;
    const dnssecOK = body.dnssecOK ?? isDNSSECType;
    const checkingDisabled = body.checkingDisabled ?? false;

    const queryPacket = buildDNSQuery(domain, typeCode, { edns, dnssecOK, checkingDisabled });
    const tcpPacket = tcpWrap(queryPacket);

    const socket = connect(`${server}:${port}`);
    await socket.opened;

    const writer = socket.writable.getWriter();
    await writer.write(tcpPacket);
    writer.releaseLock();

    const reader = socket.readable.getReader();
    let msgPayload: Uint8Array | null;
    try {
      msgPayload = await Promise.race([
        readTCPDNSMessage(reader, 10000),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS query timeout")), 10000)),
      ]);
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { await socket.close(); } catch { /* ignore */ }
    }

    const queryTimeMs = Date.now() - startTime;

    if (!msgPayload || msgPayload.length < 12) {
      return new Response(JSON.stringify({ success: false, error: "DNS response too short or empty" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = parseDNSResponse(msgPayload);

    const result: DNSQueryResult = {
      success: true,
      domain,
      server,
      port,
      queryType: queryTypeName,
      queryTimeMs,
      ...parsed,
    };

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "DNS query failed",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

/**
 * DNS zone transfer handler.
 *
 * POST /api/dns/axfr
 * Body: { zone, server, port?, timeout? }
 *
 * Sends an AXFR (RFC 5936) query over TCP and collects all zone records.
 * Terminates when the second SOA record is received.
 * Returns records grouped by type for easy navigation.
 *
 * Note: Most authoritative servers restrict AXFR to trusted IPs via ACL.
 * A REFUSED response is normal for servers that do not allow transfers.
 */
export async function handleDNSAXFR(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = (await request.json()) as {
      zone?: string;
      server?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.zone || !body.server) {
      return new Response(JSON.stringify({ error: "zone and server are required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const zone = body.zone.replace(/\.$/, "");
    const server = body.server;
    const port = body.port ?? 53;
    const timeout = body.timeout ?? 30000;

    const cfCheck = await checkIfCloudflare(server);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(server, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const queryPacket = buildDNSQuery(zone, DNS_RECORD_TYPES.AXFR, { edns: true });
    const tcpPacket = tcpWrap(queryPacket);

    const socket = connect(`${server}:${port}`);

    let soaCount = 0;
    const allRecords: DNSRecord[] = [];
    let soaSerial: number | undefined;
    let msgCount = 0;
    let rcode = "NOERROR";
    let errorMsg: string | undefined;

    try {
      await Promise.race([
        socket.opened,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), timeout)),
      ]);

      const writer = socket.writable.getWriter();
      await writer.write(tcpPacket);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      const deadline = Date.now() + timeout;

      try {
        while (Date.now() < deadline && soaCount < 2) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;

          const msgPayload = await Promise.race([
            readTCPDNSMessage(reader, remaining),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AXFR read timeout")), remaining)),
          ]);

          if (!msgPayload || msgPayload.length < 12) break;
          msgCount++;

          const parsed = parseDNSResponse(msgPayload);
          rcode = parsed.rcode;

          if (rcode !== "NOERROR") { errorMsg = `Server returned ${rcode}`; break; }

          for (const rec of [...parsed.answers, ...parsed.authority, ...parsed.additional]) {
            if (rec.typeCode === 41) continue;
            allRecords.push(rec);
            if (rec.typeCode === DNS_RECORD_TYPES.SOA) {
              soaCount++;
              if (soaCount === 1 && rec.parsed) soaSerial = (rec.parsed as { serial?: number }).serial;
              if (soaCount >= 2) break;
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
    } finally {
      try { socket.close(); } catch { /* ignore */ }
    }

    const elapsed = Date.now() - start;

    if (errorMsg) {
      return new Response(JSON.stringify({
        success: false, zone, server, port, rcode, error: errorMsg, latencyMs: elapsed,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (soaCount === 0) {
      return new Response(JSON.stringify({
        success: false, zone, server, port,
        error: "No records received — server may have refused the zone transfer",
        recordCount: allRecords.length, msgCount, latencyMs: elapsed,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Remove trailing SOA (the terminator is duplicated per RFC 5936)
    let records = allRecords;
    if (soaCount >= 2) {
      const lastSoaIdx = [...allRecords].reverse().findIndex(r => r.typeCode === DNS_RECORD_TYPES.SOA);
      if (lastSoaIdx >= 0) records = allRecords.slice(0, allRecords.length - 1 - lastSoaIdx);
    }

    const byType: Record<string, number> = {};
    for (const r of records) byType[r.type] = (byType[r.type] ?? 0) + 1;

    return new Response(JSON.stringify({
      success: true,
      zone,
      server,
      port,
      soaSerial,
      recordCount: records.length,
      msgCount,
      byType,
      records,
      latencyMs: elapsed,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "AXFR failed",
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
