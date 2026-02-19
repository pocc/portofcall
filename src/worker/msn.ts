/**
 * MSN/MSNP Protocol Implementation
 *
 * Microsoft Notification Protocol (MSNP) was the protocol used by MSN Messenger
 * (later Windows Live Messenger) for instant messaging. The service was shut down
 * in 2013, but the protocol remains of historical interest.
 *
 * Protocol Overview:
 * - Port: 1863 (TCP)
 * - Format: Text-based command/response protocol
 * - Versions: MSNP2 through MSNP21 (MSNP18 was final widely-used version)
 * - Authentication: Passport/Windows Live ID
 *
 * Connection Flow:
 * 1. TCP connection to messenger.hotmail.com:1863
 * 2. VER - Version negotiation
 * 3. CVR - Client version information
 * 4. USR - User authentication
 * 5. Presence and messaging
 *
 * Command Format:
 * - Three-letter command code
 * - Transaction ID (incrementing number)
 * - Parameters separated by spaces
 * - Terminated with \r\n
 *
 * Example Commands:
 * - VER 1 MSNP18 CVR0\r\n
 * - CVR 2 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs user@example.com\r\n
 * - USR 3 TWN I user@example.com\r\n
 *
 * Server Responses:
 * - VER 1 MSNP18\r\n (version accepted)
 * - CVR 2 8.5.1302 8.5.1302 8.5.1302 ... (client version)
 * - USR 3 TWN S ... (authentication challenge)
 * - 500 Internal Server Error
 * - 911 Authentication failed
 *
 * Use Cases:
 * - Legacy MSN server detection
 * - Historical protocol research
 * - IM protocol archaeology
 * - Network forensics
 */

import { connect } from 'cloudflare:sockets';
import { createHash } from 'node:crypto';

interface MSNRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolVersion?: string;
}

interface MSNResponse {
  success: boolean;
  host: string;
  port: number;
  supportedVersions?: string[];
  serverResponse?: string;
  protocolVersion?: string;
  rtt?: number;
  error?: string;
}

/**
 * Build MSN VER (version negotiation) command
 */
function buildMSNVersion(transactionId: number, versions: string[]): string {
  return `VER ${transactionId} ${versions.join(' ')}\r\n`;
}

/**
 * Build MSN CVR (client version) command
 *
 * CVR format: CVR TrID LocaleID OSType OSVer Arch ClientName ClientVer MSMSGS-ClientID Email
 * The LocaleID is an LCID (0x0409 = en-US). OSType is "win"/"mac"/"linux".
 */
function buildMSNClientVersion(transactionId: number, email: string = 'probe@example.com'): string {
  return `CVR ${transactionId} 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs ${email}\r\n`;
}

/**
 * Well-known MSNP error codes mapped to human-readable descriptions.
 */
const MSNP_ERRORS: Record<string, string> = {
  '200': 'Syntax error',
  '201': 'Invalid parameter',
  '205': 'Invalid principal',
  '206': 'Domain name missing',
  '207': 'Already logged in',
  '208': 'Invalid principal',
  '209': 'Nickname change illegal',
  '210': 'Principal list full',
  '215': 'Principal already on list',
  '216': 'Principal not on list',
  '217': 'Principal not online',
  '218': 'Already in mode',
  '219': 'Principal is in the opposite list',
  '223': 'Too many groups',
  '224': 'Invalid group',
  '225': 'Principal not in group',
  '229': 'Group name too long',
  '230': 'Cannot remove group zero',
  '231': 'Invalid group',
  '280': 'Switchboard failed',
  '281': 'Transfer to switchboard failed',
  '300': 'Required field missing',
  '302': 'Not logged in',
  '500': 'Internal server error',
  '501': 'DB server error',
  '502': 'Command disabled',
  '510': 'File operation failed',
  '520': 'Memory allocation failed',
  '540': 'Challenge response failed',
  '600': 'Server is busy',
  '601': 'Server is unavailable',
  '602': 'Peer NS is down',
  '603': 'DB connection failed',
  '604': 'Server is going down',
  '605': 'Server unavailable',
  '707': 'Could not create connection',
  '710': 'Bad CVR parameters sent',
  '711': 'Write is blocking',
  '712': 'Session is overloaded',
  '713': 'Calling too rapidly',
  '714': 'Too many sessions',
  '715': 'Not expected',
  '717': 'Bad friend file',
  '731': 'Not expected',
  '800': 'Changing too rapidly',
  '910': 'Server too busy',
  '911': 'Authentication failed',
  '912': 'Server too busy',
  '913': 'Not allowed when hiding',
  '914': 'Server unavailable',
  '915': 'Server unavailable',
  '916': 'Server unavailable',
  '917': 'Authentication failed',
  '918': 'Server too busy',
  '919': 'Server too busy',
  '920': 'Not accepting new principals',
  '921': 'Server too busy for kids',
  '922': 'Server too busy',
  '923': 'Kids Passport without parental consent',
  '924': 'Passport account not yet verified',
  '928': 'Bad ticket',
};

/**
 * Get a human-readable description for an MSNP error code.
 */
function getMSNPErrorDescription(code: string): string | undefined {
  return MSNP_ERRORS[code];
}

/**
 * Parse MSN server response.
 *
 * MSNP commands: `CMD TrID param1 param2 ...\r\n`
 * MSNP errors:   `ErrorCode TrID\r\n`  (3-digit numeric code)
 */
function parseMSNResponse(data: string): {
  command: string;
  transactionId?: number;
  params: string[];
  isError: boolean;
  errorDescription?: string;
} | null {
  const lines = data.split('\r\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  const parts = firstLine.split(' ');

  if (parts.length < 1) {
    return null;
  }

  const command = parts[0];
  const isError = /^\d{3}$/.test(command);
  const transactionId = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  const params = parts.slice(2);
  const errorDescription = isError ? getMSNPErrorDescription(command) : undefined;

  return {
    command,
    transactionId,
    params,
    isError,
    errorDescription,
  };
}

/**
 * Probe MSN server by initiating version negotiation.
 * Detects MSN/MSNP server and supported protocol versions.
 */
export async function handleMSNProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MSNRequest;
    const {
      host,
      port = 1863,
      timeout = 15000,
      protocolVersion = 'MSNP18',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MSNResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies MSNResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send VER command (version negotiation)
      // Try multiple versions for compatibility
      const versions = [protocolVersion, 'MSNP17', 'MSNP16', 'MSNP15', 'CVR0'];
      const verCommand = buildMSNVersion(1, versions);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(verCommand));
      writer.releaseLock();

      // Read server response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from MSN server',
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(value);
      const parsed = parseMSNResponse(responseText);

      if (!parsed) {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid MSN response format',
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      reader.releaseLock();
      socket.close();

      // Check if VER command succeeded and validate transaction ID
      if (parsed.command === 'VER') {
        if (parsed.transactionId !== 1) {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
          reader.releaseLock();
          socket.close();
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            serverResponse: responseText.trim(),
            error: `Transaction ID mismatch: expected 1, got ${parsed.transactionId}`,
          } satisfies MSNResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Filter out CVR0 — it indicates CVR command support, not a protocol version
        const protocolVersions = parsed.params.filter(v => v !== 'CVR0');
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          supportedVersions: protocolVersions,
          serverResponse: responseText.trim(),
          protocolVersion: protocolVersions[0],
          rtt,
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (parsed.isError) {
        // Server responded with numeric error code (e.g., 500, 911)
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: responseText.trim(),
          error: `Server error ${parsed.command}${parsed.errorDescription ? ': ' + parsed.errorDescription : ''}`,
          rtt,
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // Server responded with unexpected command
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: responseText.trim(),
          error: `Unexpected server response: ${parsed.command}`,
          rtt,
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 1863,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MSNResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test MSN client version command.
 * Sends CVR after successful VER to get more server info.
 */
export async function handleMSNClientVersion(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MSNRequest;
    const { host, port = 1863, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const enc = new TextEncoder();

      // 1. Send VER and wait for response (must complete before CVR per MSNP spec)
      const verCommand = buildMSNVersion(1, ['MSNP18', 'CVR0']);
      await writer.write(enc.encode(verCommand));

      const verResponse = await Promise.race([readMSNLine(reader, 5000), timeoutPromise]);

      // 2. Only send CVR after VER response received (protocol requires sequential negotiation)
      const cvrCommand = buildMSNClientVersion(2);
      await writer.write(enc.encode(cvrCommand));

      const cvrResponse = await Promise.race([readMSNLine(reader, 5000), timeoutPromise]);

      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        verResponse,
        cvrResponse,
        serverResponse: [verResponse, cvrResponse].filter(Boolean).join('\r\n'),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Read one MSNP line (\r\n terminated) from a stream with timeout.
 * Properly cleans up timers to avoid resource leaks.
 */
async function readMSNLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string | null> {
  const buf: number[] = [];
  const deadline = Date.now() + timeoutMs;
  const dec = new TextDecoder();
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutProm = new Promise<{ value: undefined; done: true }>((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), remaining);
    });

    try {
      const { value, done } = await Promise.race([
        reader.read(),
        timeoutProm,
      ]);
      clearTimeout(timer);
      if (done || !value) break;
      for (const b of value) {
        buf.push(b);
        if (buf.length >= 2 && buf[buf.length - 2] === 0x0d && buf[buf.length - 1] === 0x0a) {
          return dec.decode(new Uint8Array(buf)).trimEnd();
        }
      }
    } catch {
      clearTimeout(timer);
      break;
    }
  }
  return buf.length > 0 ? dec.decode(new Uint8Array(buf)).trimEnd() : null;
}

/**
 * Initiate MSN Messenger login: VER → CVR → USR TWN I {email}
 * Gets back USR challenge token (Tweener) for Passport auth.
 *
 * Works with revival servers (Escargot/WLM); official servers are offline since 2013.
 *
 * POST /api/msn/login
 * Body: { host, port?, email, protocolVersion?, timeout? }
 */
export async function handleMSNLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      email?: string;
      protocolVersion?: string;
      timeout?: number;
    };
    const {
      host,
      port = 1863,
      email = 'user@example.com',
      protocolVersion = 'MSNP18',
      timeout = 10000,
    } = body;

    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const tp = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const enc = new TextEncoder();

      // 1. Send VER
      const verVersions = [protocolVersion, 'MSNP17', 'MSNP16', 'CVR0'];
      await writer.write(enc.encode(`VER 1 ${verVersions.join(' ')}\r\n`));
      const verLine = await Promise.race([readMSNLine(reader, 3000), tp]);

      // 2. Send CVR
      await writer.write(enc.encode(
        `CVR 2 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs ${email}\r\n`,
      ));
      const cvrLine = await Promise.race([readMSNLine(reader, 3000), tp]);

      // 3. Send USR TWN I {email} (Tweener auth initiation)
      await writer.write(enc.encode(`USR 3 TWN I ${email}\r\n`));
      const usrLine = await Promise.race([readMSNLine(reader, 4000), tp]);

      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse VER response (VER 1 MSNP18 ...)
      const verParts = verLine?.split(' ') ?? [];
      // Server echoes highest mutually-supported version first after TrID
      const negotiatedVersion = verParts[0] === 'VER' && verParts.length > 2 ? verParts[2] : null;

      // Parse USR response: USR 3 TWN S <challenge> or XFR NS <ip:port>
      const usrParts = usrLine?.split(' ') ?? [];
      const authChallenge = usrParts[0] === 'USR' && usrParts[3] === 'S'
        ? usrParts[4]
        : undefined;
      const redirectServer = usrParts[0] === 'XFR'
        ? usrParts.slice(2).join(' ')
        : undefined;
      const errorCode = usrParts[0]?.match(/^\d{3}$/) ? usrParts[0] : undefined;

      return Response.json({
        success: !!(negotiatedVersion || authChallenge || redirectServer),
        host,
        port,
        email,
        verResponse: verLine,
        cvrResponse: cvrLine,
        usrResponse: usrLine,
        negotiatedVersion,
        authChallengeToken: authChallenge,
        redirectServer,
        errorCode,
      });
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw err;
    }
  } catch (err) {
    return Response.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

/**
 * MSN MSNP2-7 MD5 authentication flow.
 * Used by legacy MSN Messenger 1.x-4.x and supported by some revival servers.
 *
 * Flow: VER (MSNP7..MSNP2) → INF (get auth methods) → USR MD5 I {email}
 *       → USR MD5 S {challenge} → compute MD5(challenge + MD5(password))
 *       → USR MD5 S {response} → USR OK (success)
 *
 * POST /api/msn/md5-login
 * Body: { host, port?, email, password, timeout? }
 */
export async function handleMSNMD5Login(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      email?: string;
      password?: string;
      timeout?: number;
    };
    const { host, port = 1863, email = 'user@example.com', password = '', timeout = 12000 } = body;

    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const tp = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('timeout')), timeout);
    });
    const enc = new TextEncoder();

    const sendLine = async (writer: WritableStreamDefaultWriter<Uint8Array>, line: string) => {
      await writer.write(enc.encode(line + '\r\n'));
    };

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // 1. VER — request MSNP7 down to MSNP2 (MD5 auth era)
      await sendLine(writer, 'VER 1 MSNP7 MSNP6 MSNP5 MSNP4 MSNP3 MSNP2 CVR0');
      const verLine = await Promise.race([readMSNLine(reader, 3000), tp]);
      const verParts = verLine?.split(' ') ?? [];
      // Server echoes highest mutually-supported version first after TrID
      const negotiatedVersion = verParts[0] === 'VER' && verParts.length > 2 ? verParts[2] : null;

      // 2. INF — query server for supported auth methods
      await sendLine(writer, 'INF 2');
      const infLine = await Promise.race([readMSNLine(reader, 3000), tp]);
      const infParts = infLine?.split(' ') ?? [];
      const authMethods = infParts[0] === 'INF' ? infParts.slice(2).join(' ') : null;

      // 3. USR MD5 I — initiate MD5 auth with our email
      await sendLine(writer, `USR 3 MD5 I ${email}`);
      const usrChallLine = await Promise.race([readMSNLine(reader, 4000), tp]);
      const usrParts = usrChallLine?.split(' ') ?? [];

      // Parse challenge: "USR 3 MD5 S <challenge>"
      const challenge = usrParts[0] === 'USR' && usrParts[3] === 'S' ? usrParts[4] : null;

      if (!challenge) {
        // Server may have sent XFR or error
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        const errorCode = usrParts[0]?.match(/^\d{3}$/) ? usrParts[0] : null;
        const redirectServer = usrParts[0] === 'XFR' ? usrParts.slice(2).join(' ') : null;
        return Response.json({
          success: false, host, port, email,
          verResponse: verLine, infResponse: infLine, usrResponse: usrChallLine,
          negotiatedVersion, authMethods, errorCode, redirectServer,
          error: errorCode
            ? `Server returned error ${errorCode}`
            : (redirectServer ? `Server redirected to ${redirectServer}` : 'No MD5 challenge received — server may not support MSNP2-7 MD5 auth'),
        });
      }

      // 4. Compute MD5 response: MD5(challenge + MD5(password))
      // Both the challenge string and the hex password hash are ASCII,
      // so utf8 encoding is correct here (binary/latin1 would also work
      // for ASCII but is semantically wrong).
      const pwdHash = createHash('md5').update(password, 'utf8').digest('hex');
      const authResponse = createHash('md5').update(challenge + pwdHash, 'utf8').digest('hex');

      // 5. Send USR MD5 S {response}
      await sendLine(writer, `USR 4 MD5 S ${authResponse}`);
      const usrOkLine = await Promise.race([readMSNLine(reader, 5000), tp]);
      const okParts = usrOkLine?.split(' ') ?? [];

      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse result: "USR 4 OK email verified_name flag" on success
      const loginSuccess = okParts[0] === 'USR' && okParts[2] === 'OK';
      const verifiedName = loginSuccess ? okParts[3] : undefined;
      const loginErrorCode = okParts[0]?.match(/^\d{3}$/) ? okParts[0] : undefined;

      return Response.json({
        success: loginSuccess,
        host, port, email,
        negotiatedVersion,
        authMethods,
        challenge,
        authResponse,
        verifiedName,
        usrOkResponse: usrOkLine,
        errorCode: loginErrorCode,
        error: !loginSuccess && !loginErrorCode ? 'Login failed — server did not return OK' : undefined,
      });
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
