import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ADBClientProps {
  onBack: () => void;
}

const COMMON_COMMANDS = [
  { label: 'host:version', description: 'ADB protocol version' },
  { label: 'host:devices', description: 'List connected devices' },
  { label: 'host:devices-l', description: 'Devices with extended info' },
  { label: 'host:track-devices', description: 'Track device changes' },
  { label: 'host:kill', description: 'Kill ADB server' },
];

export default function ADBClient({ onBack }: ADBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5037');
  const [command, setCommand] = useState('host:version');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    command: [validationRules.required('Command is required')],
  });

  const handleCommand = async () => {
    const isValid = validateAll({ host, port, command });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/adb/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          command,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        status?: string;
        payload?: string;
        decodedVersion?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `ADB Response: ${data.status}\n\n`;
        output += `Command:  ${data.command}\n`;
        if (data.decodedVersion) {
          output += `Version:  ${data.decodedVersion}\n`;
        }
        if (data.payload) {
          output += `Payload:  ${data.payload}\n`;
        }
        output += `RTT:      ${data.rtt}ms`;
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

  const handleVersion = async () => {
    const isValid = validateAll({ host, port, command: 'host:version' });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/adb/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        protocolVersion?: number;
        protocolVersionHex?: string;
        status?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `ADB Server Detected\n\n` +
          `Protocol Version: ${data.protocolVersion} (0x${data.protocolVersionHex})\n` +
          `Status:           ${data.status}\n` +
          `RTT:              ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Version check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDevices = async () => {
    const isValid = validateAll({ host, port, command: 'host:devices-l' });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/adb/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        deviceCount?: number;
        devices?: { serial: string; state: string; properties: Record<string, string> }[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `ADB Devices: ${data.deviceCount} connected\n\n`;
        if (data.devices && data.devices.length > 0) {
          for (const device of data.devices) {
            output += `Serial: ${device.serial}\n`;
            output += `State:  ${device.state}\n`;
            const props = Object.entries(device.properties);
            if (props.length > 0) {
              for (const [key, value] of props) {
                output += `  ${key}: ${value}\n`;
              }
            }
            output += '\n';
          }
        } else {
          output += 'No devices connected.\n';
        }
        output += `RTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Device listing failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port && command) {
      handleCommand();
    }
  };

  return (
    <ProtocolClientLayout title="ADB Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="adb-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="android-build-server.local"
            required
            error={errors.host}
          />

          <FormField
            id="adb-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5037 (ADB server port)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="adb-command"
              label="ADB Command"
              type="text"
              value={command}
              onChange={setCommand}
              onKeyDown={handleKeyDown}
              placeholder="host:version"
              required
              helpText="ADB host service command to send"
              error={errors.command}
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Common Commands
          </label>
          <div className="flex flex-wrap gap-2">
            {COMMON_COMMANDS.map((cmd) => (
              <button
                key={cmd.label}
                onClick={() => setCommand(cmd.label)}
                className={`text-xs px-3 py-1.5 rounded transition-colors ${
                  command === cmd.label
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
                title={cmd.description}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleCommand}
            disabled={loading || !host || !port || !command}
            loading={loading}
            ariaLabel="Send ADB command"
          >
            Send Command
          </ActionButton>

          <button
            onClick={handleVersion}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Check ADB version"
          >
            Version
          </button>

          <button
            onClick={handleDevices}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="List ADB devices"
          >
            Devices
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ADB Protocol"
          description="ADB (Android Debug Bridge) is a command-line tool for communicating with Android devices. The ADB server listens on TCP port 5037 and uses a simple text-based protocol: commands are sent as a 4-byte hex length prefix followed by the command string. The server responds with OKAY or FAIL followed by optional data."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Command Format</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`Client: [4-byte hex length][command string]
Server: OKAY[4-byte hex length][payload]
   or:  FAIL[4-byte hex length][error message]`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Example</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`Send: "000chost:version" (12 = 0x000c)
Recv: "OKAY00040020"     (version 0x0020 = 32)`}
              </pre>
            </div>
            <p className="mt-2">
              ADB servers are typically only accessible on localhost or within trusted networks.
              Remote ADB access requires explicit port forwarding or <code className="bg-slate-700 px-1 rounded">adb tcpip 5555</code> on the device.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
