/**
 * IPMI (Intelligent Platform Management Interface) Protocol Support
 * Implements RMCP ASF Presence Ping over TCP for BMC connectivity testing
 *
 * IPMI v2.0 / RMCP+ uses UDP port 623. This worker attempts a TCP connection
 * to port 623 and sends an RMCP ASF Presence Ping. Some BMC implementations
 * also listen on TCP 623. Full RMCP/IPMI session establishment requires UDP,
 * which is not available in Cloudflare Workers.
 *
 * Port: 623 (TCP/UDP)
 * Spec: IPMI v2.0, RMCP RFC, ASF 2.0
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface IPMIConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build an RMCP ASF Presence Ping packet (8 bytes)
 *
 * RMCP Header (4 bytes):
 *   Version  = 0x06 (RMCP v1.0)
 *   Reserved = 0x00
 *   SeqNum   = 0xFF (no ACK)
 *   MsgClass = 0x06 (ASF)
 *
 * ASF Body (8 bytes):
 *   IANA = 0x00 0x00 0x11 0xBE  (ASF = 4542 decimal)
 *   Type = 0x80 (Presence Ping)
 *   Tag  = 0xFF
 *   Rsv  = 0x00
 *   Len  = 0x00
 */
function buildRMCPPresencePing(): Uint8Array {
  return new Uint8Array([
    // RMCP Header
    0x06, // Version: RMCP 1.0
    0x00, // Reserved
    0xFF, // Sequence Number (no ACK)
    0x06, // Message Class: ASF
    // ASF Presence Ping body
    0x00, 0x00, 0x11, 0xBE, // IANA Enterprise: 4542 (ASF)
    0x80, // Message Type: Presence Ping
    0xFF, // Message Tag
    0x00, // Reserved
    0x00, // Data Length: 0
  ]);
}

/**
 * Parse an RMCP ASF Presence Pong response
 *
 * Pong layout (DSP0136 §3.2.4.2):
 *   Bytes 0–3:   RMCP header (version, reserved, seq, class=0x06)
 *   Bytes 4–7:   IANA Enterprise Number (0x000011BE = ASF)
 *   Byte  8:     Message Type (0x40 = Presence Pong)
 *   Byte  9:     Message Tag (echoed from Ping)
 *   Byte  10:    Reserved
 *   Byte  11:    Data Length (0x10 = 16 bytes)
 *   Bytes 12–15: IANA Enterprise Number of managed entity (4 bytes big-endian)
 *   Byte  16:    OEM-defined
 *   Bytes 17–18: OEM-defined
 *   Byte  19:    Supported Entities (bit 7 = IPMI supported)
 *   Byte  20:    Supported Interactions
 *   Bytes 21–27: Reserved
 */
function parseRMCPResponse(data: Uint8Array): {
  isPresencePong: boolean;
  supportsIPMI: boolean;
  entityIANA: number;
  message: string;
} {
  if (data.length < 12) {
    return { isPresencePong: false, supportsIPMI: false, entityIANA: 0, message: 'Response too short for RMCP' };
  }

  // Check RMCP header
  if (data[0] !== 0x06) {
    return { isPresencePong: false, supportsIPMI: false, entityIANA: 0, message: 'Not an RMCP packet (bad version byte)' };
  }

  if (data[3] !== 0x06) {
    return { isPresencePong: false, supportsIPMI: false, entityIANA: 0, message: `Unexpected RMCP message class: 0x${data[3].toString(16)}` };
  }

  // IANA check (bytes 4–7)
  if (data[4] !== 0x00 || data[5] !== 0x00 || data[6] !== 0x11 || data[7] !== 0xBE) {
    return { isPresencePong: false, supportsIPMI: false, entityIANA: 0, message: 'Unexpected IANA in RMCP response' };
  }

  const msgType = data[8];
  if (msgType !== 0x40) {
    return {
      isPresencePong: false,
      supportsIPMI: false,
      entityIANA: 0,
      message: `Unexpected ASF message type: 0x${msgType.toString(16)} (expected 0x40 Presence Pong)`,
    };
  }

  // Presence Pong data starts at offset 12 (16 bytes of data per DSP0136 §3.2.4.2)
  // Bytes 12–15: IANA Enterprise Number of the managed entity (big-endian)
  const entityIANA = data.length >= 16
    ? (data[12] << 24) | (data[13] << 16) | (data[14] << 8) | data[15]
    : 0;

  // Byte 19: Supported Entities — bit 7 = IPMI supported
  const supportsIPMI = data.length >= 20 && (data[19] & 0x80) !== 0;

  return {
    isPresencePong: true,
    supportsIPMI,
    entityIANA,
    message: `RMCP Presence Pong received — IPMI supported: ${supportsIPMI}`,
  };
}

/**
 * Handle IPMI/RMCP connectivity probe
 */
export async function handleIPMIConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<IPMIConnectionOptions>;
    if (request.method === 'POST') {
      options = await request.json() as Partial<IPMIConnectionOptions>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '623', 10),
        timeout: parseInt(url.searchParams.get('timeout') || '10000', 10),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 623;
    const timeoutMs = options.timeout || 10000;

    // Check if behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send RMCP ASF Presence Ping
        const ping = buildRMCPPresencePing();
        await writer.write(ping);

        // Read response with a short inner timeout
        const { value } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('No response from BMC (TCP may not be supported — IPMI typically uses UDP)')), 5000),
          ),
        ]);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        if (!value) {
          throw new Error('No response from BMC');
        }

        const parsed = parseRMCPResponse(value);

        return {
          success: true,
          host,
          port,
          tcpReachable: true,
          rmcpResponse: parsed.isPresencePong,
          supportsIPMI: parsed.supportsIPMI,
          entityIANA: parsed.entityIANA,
          message: parsed.message,
          note: 'RMCP/IPMI typically uses UDP port 623. This test used TCP — full protocol interaction requires UDP.',
        };
      } catch (err) {
        // If we connected (socket.opened succeeded) but got no response, report partial success
        // Clean up locks and socket - may already be released/closed
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
        return {
          success: true,
          host,
          port,
          tcpReachable: true,
          rmcpResponse: false,
          supportsIPMI: false,
          entityIANA: 0,
          message: err instanceof Error ? err.message : 'TCP connection established but no RMCP response',
          note: 'TCP port 623 is open. RMCP/IPMI typically uses UDP — this TCP probe cannot perform full RMCP negotiation.',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        tcpReachable: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        note: 'RMCP/IPMI typically uses UDP port 623. TCP probing may not work if the BMC only listens on UDP.',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── IPMI LAN GetChannelAuthenticationCapabilities ─────────────────────────────

/**
 * Build an IPMI LAN packet (RMCP class 0x07) carrying a given IPMI message.
 *
 * Packet layout (unauthenticated session, auth type 0x00):
 *   RMCP header  (4 bytes): version=0x06, reserved=0x00, seq=0xFF, class=0x07
 *   Auth type    (1 byte):  0x00 (none)
 *   Session seq  (4 bytes): 0x00000000
 *   Session ID   (4 bytes): 0x00000000
 *   Msg length   (1 byte):  length of IPMI message below
 *   IPMI message (N bytes): RS addr + NetFn/LUN + chksum + RQ addr + seq/LUN + cmd + data + chksum
 */
function buildIPMILANPacket(
  rsAddr: number,
  netFn: number,
  cmd: number,
  data: Uint8Array,
): Uint8Array {
  // IPMI LAN msg header (6 bytes) + data + 1 data-checksum
  const ipmiMsgLen = 7 + data.length; // RS(1)+NetFn(1)+chk1(1)+RQ(1)+seq(1)+cmd(1)+data+chk2(1)

  // Header checksum = -(RS + NetFn) mod 256
  const rqAddr = 0x81; // Software ID (bit 0 set) for client
  const lun    = 0x00;
  const hdrChk = (-(rsAddr + ((netFn << 2) | lun)) & 0xFF);

  // Data checksum = -(RQ + seq/LUN + cmd + data...) mod 256
  const seqLun = 0x00; // sequence number 0, LUN 0
  let dataSum = rqAddr + seqLun + cmd;
  for (const b of data) dataSum += b;
  const dataChk = (-dataSum) & 0xFF;

  const ipmi = new Uint8Array(ipmiMsgLen);
  ipmi[0] = rsAddr;
  ipmi[1] = (netFn << 2) | lun;
  ipmi[2] = hdrChk;
  ipmi[3] = rqAddr;
  ipmi[4] = seqLun;
  ipmi[5] = cmd;
  ipmi.set(data, 6);
  ipmi[6 + data.length] = dataChk;

  const pkt = new Uint8Array(4 + 1 + 4 + 4 + 1 + ipmiMsgLen);
  let off = 0;
  // RMCP header
  pkt[off++] = 0x06; // version
  pkt[off++] = 0x00; // reserved
  pkt[off++] = 0xFF; // sequence (no ACK)
  pkt[off++] = 0x07; // class: IPMI
  // Session layer (unauthenticated)
  pkt[off++] = 0x00; // auth type: none
  pkt[off++] = 0x00; pkt[off++] = 0x00; pkt[off++] = 0x00; pkt[off++] = 0x00; // session seq
  pkt[off++] = 0x00; pkt[off++] = 0x00; pkt[off++] = 0x00; pkt[off++] = 0x00; // session ID
  pkt[off++] = ipmiMsgLen;
  pkt.set(ipmi, off);
  return pkt;
}

/**
 * Parse an IPMI GetChannelAuthenticationCapabilities response.
 *
 * IPMI 2.0 spec §22.13, Table 22-15. Response data bytes (after completion code 0x00):
 *
 *   Byte 1 (data[0]): Channel number (bits 3:0)
 *   Byte 2 (data[1]): Authentication Type Support bitmask
 *             bit 7 = IPMI v2.0+ extended data present
 *             bit 5 = OEM proprietary, bit 4 = straight password/key,
 *             bit 2 = MD5, bit 1 = MD2, bit 0 = none
 *   Byte 3 (data[2]): Authentication Status
 *             bit 5 = KG status (1 = non-default KG key set)
 *             bit 4 = per-message authentication disabled
 *             bit 3 = user level authentication disabled
 *             bit 2 = non-null usernames enabled
 *             bit 1 = null usernames enabled
 *             bit 0 = anonymous login enabled
 *   Byte 4 (data[3]): Extended Capabilities (present when data[1] bit 7 = 1)
 *             bit 1 = IPMI v2.0/RMCP+ connections supported
 *             bit 0 = IPMI v1.5 connections supported
 *   Bytes 5-7 (data[4..6]): OEM ID (IANA PEN, 3 bytes LS-first)
 *   Byte 8 (data[7]): OEM auxiliary data
 */
function parseAuthCapsResponse(buf: Uint8Array): {
  channel: number;
  authTypes: string[];
  ipmiV2ExtendedData: boolean;
  anonymousLoginEnabled: boolean;
  nullUsernamesEnabled: boolean;
  nonNullUsernamesEnabled: boolean;
  userLevelAuthDisabled: boolean;
  perMessageAuthDisabled: boolean;
  kgNonDefault: boolean;
  ipmiV15Supported: boolean;
  ipmiV20Supported: boolean;
  oemIana?: number;
  completionCode?: number;
  errorMessage?: string;
} | null {
  // Find the IPMI LAN response within the raw RMCP packet
  // Layout: RMCP(4) + authtype(1) + sess_seq(4) + sess_id(4) + msg_len(1) + IPMI_msg
  // IPMI msg: RS(1) + NetFn(1) + chk(1) + RQ(1) + seq(1) + cmd(1) + ccode(1) + data + chk
  if (buf.length < 14) return null;

  // Validate RMCP header
  if (buf[0] !== 0x06) return null; // RMCP version must be 0x06
  if (buf[3] !== 0x07) return null; // RMCP class must be 0x07 (IPMI)

  const msgOff = 14; // after RMCP(4)+authtype(1)+seq(4)+sessid(4)+msglen(1)
  if (msgOff + 7 > buf.length) return null;

  // cmd = buf[msgOff+5], ccode = buf[msgOff+6]
  const ccode = buf[msgOff + 6];
  if (ccode !== 0x00) {
    return {
      channel: 0,
      authTypes: [],
      ipmiV2ExtendedData: false,
      anonymousLoginEnabled: false,
      nullUsernamesEnabled: false,
      nonNullUsernamesEnabled: false,
      userLevelAuthDisabled: false,
      perMessageAuthDisabled: false,
      kgNonDefault: false,
      ipmiV15Supported: false,
      ipmiV20Supported: false,
      completionCode: ccode,
      errorMessage: `IPMI completion code 0x${ccode.toString(16).padStart(2, '0')}`,
    };
  }

  const data = buf.slice(msgOff + 7); // response data bytes
  if (data.length < 4) return null;

  const channel      = data[0] & 0x0F;
  const authTypeByte = data[1]; // Authentication Type Support
  const authStatus   = data[2]; // Authentication Status
  const extCaps      = data[3]; // Extended Capabilities

  // Parse auth type support bitmask (data[1])
  const authTypes: string[] = [];
  if (authTypeByte & 0x01) authTypes.push('none');
  if (authTypeByte & 0x02) authTypes.push('MD2');
  if (authTypeByte & 0x04) authTypes.push('MD5');
  if (authTypeByte & 0x10) authTypes.push('straight-password');
  if (authTypeByte & 0x20) authTypes.push('OEM');
  const ipmiV2ExtendedData = (authTypeByte & 0x80) !== 0;

  // Parse authentication status (data[2])
  const anonymousLoginEnabled    = (authStatus & 0x01) !== 0;
  const nullUsernamesEnabled     = (authStatus & 0x02) !== 0;
  const nonNullUsernamesEnabled  = (authStatus & 0x04) !== 0;
  const userLevelAuthDisabled    = (authStatus & 0x08) !== 0;
  const perMessageAuthDisabled   = (authStatus & 0x10) !== 0;
  const kgNonDefault             = (authStatus & 0x20) !== 0;

  // Parse extended capabilities (data[3]) — only meaningful when ipmiV2ExtendedData is true
  const ipmiV15Supported = (extCaps & 0x01) !== 0;
  const ipmiV20Supported = (extCaps & 0x02) !== 0;

  // OEM IANA PEN (data[4..6], 3 bytes LS-first)
  let oemIana: number | undefined;
  if (data.length >= 7) {
    oemIana = data[4] | (data[5] << 8) | (data[6] << 16);
  }

  return {
    channel,
    authTypes,
    ipmiV2ExtendedData,
    anonymousLoginEnabled,
    nullUsernamesEnabled,
    nonNullUsernamesEnabled,
    userLevelAuthDisabled,
    perMessageAuthDisabled,
    kgNonDefault,
    ipmiV15Supported,
    ipmiV20Supported,
    oemIana: oemIana !== 0 ? oemIana : undefined,
  };
}

/**
 * IPMI GetChannelAuthenticationCapabilities probe.
 *
 * Sends an RMCP IPMI LAN message (App NetFn 0x06, cmd 0x38) to request the
 * authentication capabilities of the BMC's LAN channel. Parses the response
 * to determine which auth methods the BMC supports and security configuration.
 *
 * This is the standard first step in an IPMI LAN session establishment, and
 * also the most useful unauthenticated probe for security assessments.
 *
 * Note: IPMI LAN uses UDP port 623. Some BMCs also accept these messages over
 * TCP — this endpoint uses TCP as Cloudflare Workers does not support UDP.
 *
 * POST /api/ipmi/auth-caps
 * Body: { host, port=623, channel=14, privilege=4, timeout=10000 }
 * Returns: { authSupport, authEnabled, ipmiV2Compatible, kgRequired, anonymousLoginAllowed, ... }
 */
export async function handleIPMIGetAuthCaps(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      channel?: number;
      privilege?: number;
      timeout?: number;
    };

    const { host, port = 623, channel = 0x0E, privilege = 0x04, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const probePromise = (async () => {
      const startMs = Date.now();

      // GetChannelAuthenticationCapabilities (cmd 0x38)
      // Data: channel (with bit7=1 to request IPMI v2.0+ extended data), privilege level
      const data = new Uint8Array([channel | 0x80, privilege]);
      const packet = buildIPMILANPacket(0x20, 0x06, 0x38, data);

      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      let locksReleased = false;

      try {
        await writer.write(packet);

        const { value } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('No IPMI response (BMC may not support TCP)')), 5000)),
        ]);

        writer.releaseLock();
        reader.releaseLock();
        locksReleased = true;
        socket.close();

        if (!value || value.length < 14) {
          return {
            success: false,
            host, port,
            tcpReachable: true,
            error: 'Response too short to parse as IPMI LAN',
            raw: value ? Array.from(value.slice(0, 32)) : [],
            note: 'IPMI/RMCP uses UDP port 623. TCP probing works on some BMCs.',
            latencyMs: Date.now() - startMs,
          };
        }

        const caps = parseAuthCapsResponse(value);

        return {
          success: true,
          host,
          port,
          tcpReachable: true,
          ipmiResponse: true,
          command: 'GetChannelAuthenticationCapabilities',
          ...(caps ?? { error: 'Could not parse IPMI auth caps response', raw: Array.from(value.slice(0, 32)) }),
          note: caps
            ? 'GetChannelAuthenticationCapabilities succeeded — BMC auth methods enumerated'
            : 'IPMI response received but auth-caps parse failed',
          latencyMs: Date.now() - startMs,
        };
      } catch (err) {
        if (!locksReleased) {
          try { writer.releaseLock(); } catch { /* ignore */ }
          try { reader.releaseLock(); } catch { /* ignore */ }
        }
        socket.close();
        return {
          success: true,
          host, port,
          tcpReachable: true,
          ipmiResponse: false,
          error: err instanceof Error ? err.message : 'No IPMI response',
          note: 'TCP connected but BMC did not respond to IPMI LAN packet. RMCP/IPMI typically uses UDP 623.',
          latencyMs: Date.now() - startMs,
        };
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * IPMI GetDeviceID — identify the BMC: manufacturer, product, firmware version.
 *
 * Sends an RMCP IPMI message with:
 *   netFn  = 0x06 (App)
 *   Cmd    = 0x01 (GetDeviceID)
 *
 * Response data (16+ bytes):
 *   [0]  Device ID
 *   [1]  Device Revision (bit7=SDR, bits[3:0]=revision)
 *   [2]  Firmware Rev Major (bit7=update complete, bits[5:0]=major)
 *   [3]  Firmware Rev Minor (BCD)
 *   [4]  IPMI Msg Version (BCD: 0x20 = v2.0)
 *   [5]  Additional Device Support flags
 *   [6..8]  Manufacturer ID (3-byte LSB)
 *   [9..10] Product ID (2-byte LSB)
 *   [11..14] Firmware Build Date (optional, LSB)
 *
 * NOTE: Full IPMI session auth (RAKP/RMCP+) requires UDP. This TCP probe
 * works on BMCs that accept unauthenticated IPMI over TCP (e.g. HP iLO, Dell iDRAC, Supermicro).
 *
 * POST /api/ipmi/device-id
 * Body: { host, port=623, timeout=10000 }
 */
export async function handleIPMIGetDeviceID(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 623, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // -----------------------------------------------------------------------
    // Build RMCP + IPMI Message for GetDeviceID (unauthenticated session 0)
    // RMCP Header (4 bytes): version=0x06, rsvd=0x00, seq=0xFF, class=0x07 (IPMI)
    // IPMI Session Header (10 bytes): auth=0x00, seq=0,0,0,0, id=0,0,0,0, len
    // IPMI Message (7 bytes): rsAddr=0x20, netFn/rqLun=0x18, checksum1, rqAddr=0x81,
    //                         rqSeq/rqLun=0x00, cmd=0x01, checksum2
    // -----------------------------------------------------------------------
    const rmcpHdr = new Uint8Array([0x06, 0x00, 0xFF, 0x07]);

    // IPMI v1.5 session header (no auth): AuthType=0, SeqNum=0, SessionID=0, MsgLen
    const msgLen = 7; // IPMI message body length
    const sessionHdr = new Uint8Array([
      0x00,                     // AuthType: None
      0x00, 0x00, 0x00, 0x00,   // Sequence Number
      0x00, 0x00, 0x00, 0x00,   // Session ID
      msgLen,                   // Message Length
    ]);

    // IPMI message body: request format
    const rsAddr   = 0x20;   // BMC slave address
    const netFnRq  = (0x06 << 2) | 0x00; // netFn=0x06 (App), rqLun=0
    const chk1     = (0 - rsAddr - netFnRq) & 0xFF;
    const rqAddr   = 0x81;   // Software ID
    const rqSeq    = 0x00;   // Sequence number + rqLun=0
    const cmd      = 0x01;   // GetDeviceID
    const chk2     = (0 - rqAddr - rqSeq - cmd) & 0xFF;

    const ipmiBuf = new Uint8Array([rsAddr, netFnRq, chk1, rqAddr, rqSeq, cmd, chk2]);

    // Full packet
    const pkt = new Uint8Array(rmcpHdr.length + sessionHdr.length + ipmiBuf.length);
    pkt.set(rmcpHdr, 0);
    pkt.set(sessionHdr, rmcpHdr.length);
    pkt.set(ipmiBuf, rmcpHdr.length + sessionHdr.length);

    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

    const start = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const tp = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let portOpen = false;
    let latencyMs = 0;
    let responseHex: string | undefined;
    let deviceInfo: Record<string, unknown> | undefined;
    let errorMsg: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, tp]);
      portOpen = true;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(pkt);
      latencyMs = Date.now() - start;

      try {
        // Collect all response data
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const ms = Math.max(100, deadline - Date.now());
          const result = await Promise.race([
            reader.read(),
            new Promise<{ value: undefined; done: true }>(res =>
              setTimeout(() => res({ value: undefined, done: true }), ms)),
          ]);
          if (result.done || !result.value) break;
          chunks.push(result.value);
          totalBytes += result.value.length;
          if (totalBytes >= 4 + 10 + 8 + 16) break; // enough data
        }

        if (totalBytes > 0) {
          const resp = new Uint8Array(totalBytes);
          let off = 0;
          for (const c of chunks) { resp.set(c, off); off += c.length; }
          responseHex = toHex(resp);

          // Parse: RMCP(4) + Session(9 for no-auth: AuthType+SeqNum4+SessID4) + MsgLen(1) = 14 bytes header
          // Then IPMI response body: rsAddr(1) + netFn/rsLun(1) + chk1(1) + rqAddr(1) + rqSeq(1) + cmd(1) + CompCode(1) + data...
          // Total fixed header before IPMI body: 4 (RMCP) + 1 (authtype) + 4 (seq) + 4 (sessid) + 1 (msglen) = 14
          const ipmOff = 14;
          if (resp.length >= ipmOff + 8) {
            const completionCode = resp[ipmOff + 6];
            if (completionCode === 0x00) {
              // Parse GetDeviceID response data (starts at ipmOff + 7)
              const d = resp.slice(ipmOff + 7);
              const deviceId         = d[0];
              const deviceRev        = d[1] & 0x0F;
              const sdrPresent       = !!(d[1] & 0x80);
              const fwMajor          = d[2] & 0x7F;
              const fwMinorBCD       = d[3];
              const fwMinor          = ((fwMinorBCD >> 4) * 10) + (fwMinorBCD & 0x0F);
              const ipmiVersion      = d[4];
              const ipmiVerStr       = `${(ipmiVersion >> 4)}.${ipmiVersion & 0x0F}`;
              // Manufacturer ID: bytes 7-9 of response data (d[6..8]), 3 bytes LS-first (IANA PEN)
              const mfrId            = d.length >= 9 ? d[6] | (d[7] << 8) | (d[8] << 16) : 0;
              // Product ID: bytes 10-11 of response data (d[9..10]), 2 bytes LS-first
              const productId        = d.length >= 11 ? d[9] | (d[10] << 8) : 0;

              // Map known manufacturer IDs (IANA Private Enterprise Numbers)
              const mfrNames: Record<number, string> = {
                0x00000B: 'Hewlett-Packard (HP/HPE)',
                0x000002: 'IBM',
                0x0002A2: 'Dell',
                0x002A7C: 'Supermicro',
                0x000157: 'Intel',
                0x003A98: 'Kontron',
                0x00B980: 'Supermicro (alt)',
                0x00A2B5: 'Lenovo',
                0x000BD3: 'ASUS',
                0x000763: 'American Megatrends (AMI)',
              };

              deviceInfo = {
                deviceId,
                deviceRevision: deviceRev,
                sdrPresent,
                firmwareVersion: `${fwMajor}.${String(fwMinor).padStart(2, '0')}`,
                ipmiVersion: ipmiVerStr,
                manufacturerId: `0x${mfrId.toString(16).padStart(6, '0')}`,
                manufacturerName: mfrNames[mfrId] ?? 'Unknown',
                productId: `0x${productId.toString(16).padStart(4, '0')}`,
              };
            } else {
              errorMsg = `IPMI completion code: 0x${completionCode.toString(16).padStart(2, '0')} (non-zero = error)`;
            }
          } else {
            errorMsg = `Response too short (${resp.length} bytes) for IPMI GetDeviceID parse`;
          }
        }
      } catch {
        // No response — TCP may have connected but BMC doesn't speak IPMI over TCP
      }

      try { reader.releaseLock(); } catch { /* ok */ }
      try { writer.releaseLock(); } catch { /* ok */ }
      socket.close();
    } catch (err) {
      latencyMs = Date.now() - start;
      errorMsg = err instanceof Error ? err.message : 'Connection failed';
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    return new Response(JSON.stringify({
      success: portOpen && !!deviceInfo,
      host, port,
      portOpen,
      deviceInfo,
      responseHex,
      packetHex: toHex(pkt),
      latencyMs,
      ...(errorMsg && { error: errorMsg }),
      note: 'IPMI GetDeviceID (netFn=0x06, cmd=0x01) via unauthenticated RMCP session over TCP. ' +
            'Full IPMI auth (RAKP/RMCP+) requires UDP/623 which is not available in Cloudflare Workers.',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
