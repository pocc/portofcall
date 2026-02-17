/**
 * Shadowsocks Protocol Implementation
 *
 * Shadowsocks is an encrypted proxy protocol designed for censorship circumvention.
 * It uses AEAD ciphers (AES-256-GCM, ChaCha20-Poly1305) to encrypt traffic.
 *
 * Protocol Overview:
 * - Port: 8388 (conventional default, highly configurable)
 * - TCP-based encrypted proxy
 * - Client sends an encrypted header containing target host/port, then payload
 * - No plaintext greeting — connection opens silently and waits for data
 *
 * Detection approach:
 * Since Shadowsocks sends no banner and requires knowing the encryption key,
 * we test TCP connectivity only. A successful TCP connection (socket.opened)
 * confirms the port is open and accepting connections.
 *
 * AEAD Header format (after encryption):
 *   [salt (16-32 bytes)] [encrypted length (2 bytes + 16 byte tag)] [encrypted payload + tag]
 *
 * Use Cases:
 * - Verify Shadowsocks server is reachable
 * - Check port availability before configuring clients
 * - Infrastructure health checks
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface ShadowsocksRequest {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Handle Shadowsocks TCP connectivity probe
 *
 * Establishes a TCP connection to the Shadowsocks server port.
 * Since the protocol requires the encryption key to exchange data,
 * we measure TCP connect time and confirm the port is open.
 */
export async function handleShadowsocksProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ShadowsocksRequest;
    const { host, port = 8388, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const probePromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);

      try {
        await Promise.race([socket.opened, timeoutPromise]);
        const rtt = Date.now() - startTime;

        // Shadowsocks sends no banner — the server silently waits for encrypted data.
        // A successful TCP open is sufficient to confirm the port is reachable.
        // We wait briefly to see if the server sends anything unexpected (wrong service).
        const reader = socket.readable.getReader();
        const shortWait = new Promise<{ value: undefined; done: true }>(resolve =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        );

        const { value: bannerData } = await Promise.race([reader.read(), shortWait]);

        reader.releaseLock();
        await socket.close();

        // If the server sent data immediately, it's likely not Shadowsocks
        // (a Shadowsocks server stays silent until it receives the encrypted header)
        const unexpectedBanner = bannerData && bannerData.length > 0;
        const bannerHex = unexpectedBanner
          ? Array.from(bannerData as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('')
          : undefined;

        return {
          success: true,
          host,
          port,
          rtt,
          portOpen: true,
          silentOnConnect: !unexpectedBanner,
          isShadowsocks: !unexpectedBanner,
          bannerHex,
          note: unexpectedBanner
            ? `Port is open but server sent data (${bannerData!.length} bytes) — likely not Shadowsocks`
            : 'Port is open and server is silent — consistent with Shadowsocks behavior',
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
        portOpen: false,
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      portOpen: false,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
