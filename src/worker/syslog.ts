/**
 * Syslog Protocol Implementation (RFC 5424 / RFC 3164)
 *
 * The Syslog protocol provides centralized logging for applications,
 * systems, and network devices.
 *
 * Protocol Flow:
 * 1. Client formats message with priority, timestamp, hostname, and message
 * 2. Client sends formatted message to syslog server
 * 3. No response expected (fire-and-forget)
 *
 * Use Cases:
 * - Centralized log aggregation
 * - Security information and event management (SIEM)
 * - Application monitoring
 * - Audit trails
 */

import { connect } from 'cloudflare:sockets';

interface SyslogRequest {
  host: string;
  port?: number;
  severity: number;
  facility?: number;
  message: string;
  hostname?: string;
  appName?: string;
  format?: 'rfc5424' | 'rfc3164';
  timeout?: number;
}

interface SyslogResponse {
  success: boolean;
  message?: string;
  formatted?: string;
  error?: string;
}

/**
 * Severity levels (0-7)
 */
export enum Severity {
  Emergency = 0,     // System is unusable
  Alert = 1,         // Action must be taken immediately
  Critical = 2,      // Critical conditions
  Error = 3,         // Error conditions
  Warning = 4,       // Warning conditions
  Notice = 5,        // Normal but significant condition
  Informational = 6, // Informational messages
  Debug = 7,         // Debug-level messages
}

/**
 * Facility codes (0-23)
 */
export enum Facility {
  Kernel = 0,
  User = 1,
  Mail = 2,
  Daemon = 3,
  Auth = 4,
  Syslog = 5,
  Lpr = 6,
  News = 7,
  Uucp = 8,
  Cron = 9,
  Authpriv = 10,
  Ftp = 11,
  Ntp = 12,
  Security = 13,
  Console = 14,
  Clock = 15,
  Local0 = 16,
  Local1 = 17,
  Local2 = 18,
  Local3 = 19,
  Local4 = 20,
  Local5 = 21,
  Local6 = 22,
  Local7 = 23,
}

/**
 * Calculate syslog priority
 * Priority = (Facility * 8) + Severity
 */
function calculatePriority(facility: number, severity: number): number {
  return (facility * 8) + severity;
}

/**
 * Format timestamp for RFC 5424 (ISO 8601)
 */
function formatRFC5424Timestamp(date: Date): string {
  return date.toISOString();
}

/**
 * Format timestamp for RFC 3164 (BSD syslog format)
 */
function formatRFC3164Timestamp(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const month = months[date.getMonth()];
  const day = String(date.getDate()).padStart(2, ' ');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${month} ${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format syslog message in RFC 5424 format (modern)
 * Format: <PRIORITY>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
 */
function formatRFC5424Message(
  priority: number,
  hostname: string,
  appName: string,
  message: string
): string {
  const version = 1;
  const timestamp = formatRFC5424Timestamp(new Date());
  const procId = '-';
  const msgId = '-';
  const structuredData = '-';

  return `<${priority}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${message}\n`;
}

/**
 * Format syslog message in RFC 3164 format (legacy/BSD)
 * Format: <PRIORITY>TIMESTAMP HOSTNAME TAG: MSG
 */
function formatRFC3164Message(
  priority: number,
  hostname: string,
  appName: string,
  message: string
): string {
  const timestamp = formatRFC3164Timestamp(new Date());

  return `<${priority}>${timestamp} ${hostname} ${appName}: ${message}\n`;
}

/**
 * Send syslog message to remote server
 */
export async function handleSyslogSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SyslogRequest;
    const {
      host,
      port = 514,
      severity,
      facility = Facility.Local0,
      message,
      hostname = 'portofcall',
      appName = 'webapp',
      format = 'rfc5424',
      timeout = 10000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!message) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (severity < 0 || severity > 7) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Severity must be between 0 and 7',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (facility < 0 || facility > 23) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Facility must be between 0 and 23',
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

    // Calculate priority
    const priority = calculatePriority(facility, severity);

    // Format message
    const formattedMessage = format === 'rfc5424'
      ? formatRFC5424Message(priority, hostname, appName, message)
      : formatRFC3164Message(priority, hostname, appName, message);

    // Connect to syslog server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const writer = socket.writable.getWriter();

      // Send syslog message
      const messageBytes = new TextEncoder().encode(formattedMessage);
      await writer.write(messageBytes);

      // Clean up
      writer.releaseLock();
      socket.close();

      const result: SyslogResponse = {
        success: true,
        message: 'Syslog message sent successfully',
        formatted: formattedMessage.trim(),
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or send error
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
