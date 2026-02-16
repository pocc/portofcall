import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface GPSDClientProps {
  onBack: () => void;
}

const COMMON_COMMANDS = [
  { label: 'Version', cmd: '?VERSION' },
  { label: 'Devices', cmd: '?DEVICES' },
  { label: 'Poll', cmd: '?POLL' },
  { label: 'Watch On', cmd: '?WATCH={"enable":true,"json":true}' },
  { label: 'Watch Off', cmd: '?WATCH={"enable":false}' },
];

export default function GPSDClient({ onBack }: GPSDClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2947');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleVersion = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gpsd/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: {
          release?: string;
          rev?: string;
          proto_major?: number;
          proto_minor?: number;
        };
        raw?: string[];
        rtt?: number;
      };

      if (response.ok && data.success && data.version) {
        let output = `GPSD Server Version\n\n`;
        output += `Release:       ${data.version.release || 'unknown'}\n`;
        output += `Revision:      ${data.version.rev || 'unknown'}\n`;
        output += `Protocol:      ${data.version.proto_major ?? '?'}.${data.version.proto_minor ?? '?'}\n`;
        output += `\nRTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Version request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDevices = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gpsd/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: { release?: string; proto_major?: number; proto_minor?: number };
        devices?: Array<{
          path?: string;
          driver?: string;
          activated?: string;
          flags?: number;
          native?: number;
          bps?: number;
          parity?: string;
          stopbits?: number;
          cycle?: number;
        }>;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `GPSD Devices`;
        if (data.version) {
          output += ` (gpsd ${data.version.release})`;
        }
        output += `\n\n`;

        const devices = data.devices || [];
        if (devices.length === 0) {
          output += `No GPS devices connected.\n`;
          output += `\n(gpsd may be running but no receivers are attached)`;
        } else {
          output += `${'Device'.padEnd(25)} ${'Driver'.padEnd(16)} ${'BPS'.padEnd(8)} Status\n`;
          output += `${'─'.repeat(24)} ${'─'.repeat(15)} ${'─'.repeat(7)} ${'─'.repeat(10)}\n`;
          for (const dev of devices) {
            const path = (dev.path || 'unknown').substring(0, 24);
            const driver = (dev.driver || 'unknown').substring(0, 15);
            const bps = String(dev.bps || '-');
            const status = dev.activated ? 'Active' : 'Inactive';
            output += `${path.padEnd(25)} ${driver.padEnd(16)} ${bps.padEnd(8)} ${status}\n`;
          }
          output += `\nTotal: ${devices.length} device(s)`;
        }

        output += `\nRTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Devices request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePoll = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gpsd/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: { release?: string; proto_major?: number; proto_minor?: number };
        poll?: Record<string, unknown>;
        tpv?: Record<string, unknown>;
        sky?: Record<string, unknown>;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `GPSD Position Fix`;
        if (data.version) {
          output += ` (gpsd ${data.version.release})`;
        }
        output += `\n\n`;

        const tpv = data.tpv || (data.poll as Record<string, unknown>) || null;

        if (tpv) {
          const mode = tpv.mode as number;
          const modeStr = mode === 3 ? '3D Fix' : mode === 2 ? '2D Fix' : mode === 1 ? 'No Fix' : 'Unknown';
          output += `Fix Mode:      ${modeStr}\n`;
          if (tpv.time) output += `Time:          ${tpv.time}\n`;
          if (tpv.lat !== undefined) output += `Latitude:      ${tpv.lat}°\n`;
          if (tpv.lon !== undefined) output += `Longitude:     ${tpv.lon}°\n`;
          if (tpv.alt !== undefined) output += `Altitude:      ${tpv.alt} m\n`;
          if (tpv.speed !== undefined) output += `Speed:         ${tpv.speed} m/s\n`;
          if (tpv.track !== undefined) output += `Heading:       ${tpv.track}°\n`;
          if (tpv.climb !== undefined) output += `Climb:         ${tpv.climb} m/s\n`;
          if (tpv.epx !== undefined) output += `Lon Error:     ±${tpv.epx} m\n`;
          if (tpv.epy !== undefined) output += `Lat Error:     ±${tpv.epy} m\n`;
          if (tpv.epv !== undefined) output += `Alt Error:     ±${tpv.epv} m\n`;
          if (tpv.device) output += `Device:        ${tpv.device}\n`;
        } else {
          output += `No fix data available.\n`;
          output += `(GPS receiver may not have acquired satellites yet)\n`;
        }

        if (data.sky) {
          const sats = (data.sky as Record<string, unknown>).satellites as Array<Record<string, unknown>> | undefined;
          if (sats && sats.length > 0) {
            const used = sats.filter(s => s.used).length;
            output += `\nSatellites:    ${used} used / ${sats.length} visible\n`;
            output += `${'PRN'.padEnd(6)} ${'El'.padEnd(6)} ${'Az'.padEnd(6)} ${'SNR'.padEnd(6)} Used\n`;
            output += `${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(4)}\n`;
            for (const sat of sats.slice(0, 20)) {
              const prn = String(sat.PRN || sat.prn || '?');
              const el = String(sat.el ?? '-');
              const az = String(sat.az ?? '-');
              const ss = String(sat.ss ?? '-');
              const used = sat.used ? 'Yes' : 'No';
              output += `${prn.padEnd(6)} ${el.padEnd(6)} ${az.padEnd(6)} ${ss.padEnd(6)} ${used}\n`;
            }
            if (sats.length > 20) {
              output += `... and ${sats.length - 20} more satellites\n`;
            }
          }
        }

        output += `\nRTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Poll request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gpsd/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
          command: command.trim(),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        objects?: Record<string, unknown>[];
        errors?: string[];
        raw?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `Command: ${data.command}\n\n`;
        if (data.objects && data.objects.length > 0) {
          for (const obj of data.objects) {
            output += JSON.stringify(obj, null, 2) + '\n\n';
          }
        }
        if (data.errors && data.errors.length > 0) {
          output += `Non-JSON lines:\n`;
          for (const err of data.errors) {
            output += `  ${err}\n`;
          }
        }
        if ((!data.objects || data.objects.length === 0) && (!data.errors || data.errors.length === 0)) {
          output += '(empty response)\n';
        }
        output += `RTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleVersion();
    }
  };

  return (
    <ProtocolClientLayout title="GPSD Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="gpsd-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="gps-server.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="gpsd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2947 (gpsd)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleVersion}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Get GPSD version"
          >
            Version
          </ActionButton>

          <button
            onClick={handleDevices}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="List GPS devices"
          >
            Devices
          </button>

          <button
            onClick={handlePoll}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Poll GPS fix"
          >
            Poll Fix
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Custom Command" />

          <div className="mb-4">
            <label htmlFor="gpsd-command" className="block text-sm font-medium text-slate-300 mb-2">
              Command (must start with ?)
            </label>
            <input
              id="gpsd-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading && host && port && command.trim()) {
                  handleCommand();
                }
              }}
              placeholder='?WATCH={"enable":true,"json":true}'
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {COMMON_COMMANDS.map((c) => (
              <button
                key={c.cmd}
                onClick={() => setCommand(c.cmd)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors border border-slate-600"
              >
                {c.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleCommand}
            disabled={loading || !host || !port || !command.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Execute GPSD command"
          >
            Execute
          </button>
        </div>

        <HelpSection
          title="About GPSD"
          description="gpsd is a service daemon that monitors GPS receivers attached to a host via serial or USB. It provides a JSON-based text protocol over TCP port 2947. Clients can query the daemon for GPS version info, list connected devices, and poll for the latest position fix (latitude, longitude, altitude, speed, heading). The protocol uses newline-delimited JSON objects with a 'class' field identifying each message type."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Command Format</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`?COMMAND[=JSON_PARAMS];
Response: {"class":"CLASS",...}\\n

On connect, server sends VERSION banner automatically.`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Response Classes</p>
              <p>VERSION (server version), DEVICES (device list), TPV (time-position-velocity fix), SKY (satellite view), POLL (aggregated data), ERROR</p>
            </div>
            <p className="mt-2">
              gpsd supports GPS receivers from u-blox, SiRF, Garmin, MTK, and many others.
              It is widely used on Linux for precision timing (NTP+PPS), fleet tracking,
              and scientific applications. The JSON protocol replaced the older O/Y/P line protocol.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
