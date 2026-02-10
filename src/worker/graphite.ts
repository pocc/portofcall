/**
 * Graphite Plaintext Protocol Support for Cloudflare Workers
 * Implements the Graphite plaintext protocol (port 2003)
 *
 * Format: metric_name value timestamp\n
 * Fire-and-forget: no response from server
 *
 * Spec: https://graphite.readthedocs.io/en/latest/feeding-carbon.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();

/** Validate a metric name (alphanumeric, dots, underscores, hyphens) */
function isValidMetricName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && name.length > 0 && name.length <= 512;
}

/** Validate a metric value */
function isValidValue(value: number): boolean {
  return !isNaN(value) && isFinite(value);
}

/**
 * Handle Graphite metric sending
 * POST /api/graphite/send
 *
 * Sends one or more metrics to a Graphite Carbon receiver.
 * Graphite is fire-and-forget: the server does not send a response.
 * We confirm success by verifying the TCP connection was established
 * and the data was written without error.
 */
export async function handleGraphiteSend(request: Request): Promise<Response> {
  try {
    const { host, port = 2003, metrics, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      metrics: Array<{ name: string; value: number; timestamp?: number }>;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: metrics (array of {name, value, timestamp?})',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate all metrics
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      if (!m.name || !isValidMetricName(m.name)) {
        return new Response(JSON.stringify({
          error: `Invalid metric name at index ${i}: "${m.name}". Use alphanumeric, dots, underscores, hyphens only.`,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (m.value === undefined || !isValidValue(m.value)) {
        return new Response(JSON.stringify({
          error: `Invalid metric value at index ${i}: "${m.value}". Must be a finite number.`,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Limit batch size
    if (metrics.length > 100) {
      return new Response(JSON.stringify({
        error: 'Maximum 100 metrics per batch',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

      try {
        // Build the plaintext payload
        const now = Math.floor(Date.now() / 1000);
        const lines: string[] = [];

        for (const m of metrics) {
          const ts = m.timestamp || now;
          lines.push(`${m.name} ${m.value} ${ts}`);
        }

        const payload = lines.join('\n') + '\n';
        await writer.write(encoder.encode(payload));

        await socket.close();

        return {
          success: true,
          message: `Sent ${metrics.length} metric(s) to Graphite`,
          host,
          port,
          metricsCount: metrics.length,
          payload: payload.trimEnd(),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Send failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
