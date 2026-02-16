import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface FluentdClientProps {
  onBack: () => void;
}

type Mode = 'probe' | 'send';

const commonTags = [
  { tag: 'app.access', description: 'Application access logs' },
  { tag: 'app.error', description: 'Application error logs' },
  { tag: 'system.syslog', description: 'System syslog forwarding' },
  { tag: 'docker.container', description: 'Docker container logs' },
  { tag: 'kubernetes.pods', description: 'Kubernetes pod logs' },
  { tag: 'nginx.access', description: 'Nginx access logs' },
  { tag: 'portofcall.test', description: 'Test tag for probing' },
];

export default function FluentdClient({ onBack }: FluentdClientProps) {
  const [mode, setMode] = useState<Mode>('probe');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('24224');
  const [tag, setTag] = useState('portofcall.probe');
  const [recordJson, setRecordJson] = useState('{"message": "Hello from Port of Call", "level": "info"}');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [connectionInfo, setConnectionInfo] = useState<{
    rtt?: number;
    ackReceived?: boolean;
    ackMatch?: boolean;
    messageSizeBytes?: number;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleModeSwitch = (newMode: Mode) => {
    setMode(newMode);
    setTag(newMode === 'probe' ? 'portofcall.probe' : 'portofcall.test');
    setResult('');
    setError('');
    setConnectionInfo(null);
  };

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setConnectionInfo(null);

    try {
      const response = await fetch('/api/fluentd/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          tag,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        rtt?: number;
        ackReceived?: boolean;
        ackMatch?: boolean;
        chunkId?: string;
        messageSizeBytes?: number;
        responseData?: Record<string, unknown>;
      };

      if (response.ok && data.success) {
        let resultText = data.message || 'Connected successfully';
        if (data.chunkId) {
          resultText += `\nChunk ID: ${data.chunkId}`;
        }
        if (data.ackReceived) {
          resultText += `\nAck Match: ${data.ackMatch ? 'Yes' : 'No'}`;
        }
        if (data.responseData) {
          resultText += `\nResponse: ${JSON.stringify(data.responseData, null, 2)}`;
        }
        setResult(resultText);
        setConnectionInfo({
          rtt: data.rtt,
          ackReceived: data.ackReceived,
          ackMatch: data.ackMatch,
          messageSizeBytes: data.messageSizeBytes,
        });
      } else {
        setError(data.error || 'Failed to connect to Fluentd server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Fluentd server');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    let record: Record<string, string>;
    try {
      record = JSON.parse(recordJson);
      if (typeof record !== 'object' || Array.isArray(record)) {
        setError('Record must be a JSON object');
        return;
      }
    } catch {
      setError('Invalid JSON in record field');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');
    setConnectionInfo(null);

    try {
      const response = await fetch('/api/fluentd/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          tag,
          record,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        rtt?: number;
        ackReceived?: boolean;
        chunkId?: string;
        recordKeys?: string[];
        messageSizeBytes?: number;
      };

      if (response.ok && data.success) {
        let resultText = data.message || 'Log entry sent';
        if (data.chunkId) {
          resultText += `\nChunk ID: ${data.chunkId}`;
        }
        if (data.recordKeys) {
          resultText += `\nRecord Keys: ${data.recordKeys.join(', ')}`;
        }
        setResult(resultText);
        setConnectionInfo({
          rtt: data.rtt,
          ackReceived: data.ackReceived,
          messageSizeBytes: data.messageSizeBytes,
        });
      } else {
        setError(data.error || 'Failed to send log entry');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send log entry');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      if (mode === 'probe') {
        handleProbe();
      } else {
        handleSend();
      }
    }
  };

  return (
    <ProtocolClientLayout title="Fluentd Forward Protocol Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Mode Selector */}
        <div className="mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => handleModeSwitch('probe')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'probe'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              Server Probe
            </button>
            <button
              onClick={() => handleModeSwitch('send')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'send'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              Send Log Entry
            </button>
          </div>
        </div>

        <SectionHeader
          stepNumber={1}
          title="Fluentd Server Configuration"
        />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="fluentd-host"
            label="Fluentd Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="fluentd.example.com"
            required
            helpText="Fluentd or Fluent Bit server address"
            error={errors.host}
          />

          <FormField
            id="fluentd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 24224 (forward input)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Tag Configuration" color="green" />

        <div className="mb-4">
          <FormField
            id="fluentd-tag"
            label="Log Tag"
            type="text"
            value={tag}
            onChange={setTag}
            onKeyDown={handleKeyDown}
            placeholder="app.access"
            required
            helpText="Dotted tag namespace for log routing (e.g., app.access)"
          />
        </div>

        <div className="mb-6">
          <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Common Tags</h4>
          <div className="grid grid-cols-2 gap-1">
            {commonTags.map((item) => (
              <button
                key={item.tag}
                onClick={() => setTag(item.tag)}
                className={`text-left text-xs py-1.5 px-2 rounded transition-colors ${
                  tag === item.tag
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                }`}
              >
                <span className="font-mono text-blue-400">{item.tag}</span>
              </button>
            ))}
          </div>
        </div>

        {mode === 'send' && (
          <>
            <SectionHeader stepNumber={3} title="Log Record" color="purple" />
            <div className="mb-6">
              <label htmlFor="fluentd-record" className="block text-sm font-medium text-slate-300 mb-1">
                Record (JSON)
              </label>
              <textarea
                id="fluentd-record"
                value={recordJson}
                onChange={(e) => setRecordJson(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                rows={4}
                placeholder='{"message": "Hello", "level": "info"}'
              />
              <p className="text-xs text-slate-500 mt-1">Key-value pairs to include in the log entry</p>
            </div>
          </>
        )}

        <ActionButton
          onClick={mode === 'probe' ? handleProbe : handleSend}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel={mode === 'probe' ? 'Probe Fluentd server' : 'Send log entry'}
        >
          {mode === 'probe' ? 'Probe Server' : 'Send Log Entry'}
        </ActionButton>

        {connectionInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Connection Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {connectionInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{connectionInfo.rtt}ms</div>
                </div>
              )}
              {connectionInfo.ackReceived !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Ack Received</div>
                  <div className={`text-lg font-bold ${connectionInfo.ackReceived ? 'text-green-400' : 'text-orange-400'}`}>
                    {connectionInfo.ackReceived ? 'Yes' : 'No'}
                  </div>
                </div>
              )}
              {connectionInfo.ackMatch !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Ack Match</div>
                  <div className={`text-lg font-bold ${connectionInfo.ackMatch ? 'text-green-400' : 'text-red-400'}`}>
                    {connectionInfo.ackMatch ? 'Valid' : 'Mismatch'}
                  </div>
                </div>
              )}
              {connectionInfo.messageSizeBytes !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Message Size</div>
                  <div className="text-lg font-bold text-blue-400">{connectionInfo.messageSizeBytes}B</div>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Fluentd Forward Protocol"
          description="Fluentd Forward protocol uses MessagePack encoding over TCP (port 24224) for efficient log forwarding between Fluentd/Fluent Bit instances. Messages are arrays containing a tag, timestamp, record data, and optional acknowledgment chunk ID. The protocol supports three modes: Message (single event), Forward (batch), and PackedForward (binary stream)."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encoding:</td>
                  <td className="py-2 px-2 font-mono">MessagePack (binary)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2">24224</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Message Format:</td>
                  <td className="py-2 px-2 font-mono">[tag, time, record, options]</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Ack Format:</td>
                  <td className="py-2 px-2 font-mono">{'{"ack": "<chunk-id>"}'}</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">None (standard) / Shared key (optional)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Compression:</td>
                  <td className="py-2 px-2">MessagePack (inherently compact)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Architecture</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`┌─────────────┐     Port 24224      ┌─────────────┐
│   Fluentd   │ ── Forward Msg ──> │   Fluentd   │
│   Source    │ <──── Ack ──────── │   Receiver  │
│  (client)   │                    │  (server)   │
└─────────────┘                    └─────────────┘

Message Format (MessagePack):
┌─────┬──────────┬─────────────┬──────────┐
│ Tag │ [[t,rec]] │   Options   │ (binary) │
│ str │  array    │ {"chunk":x} │ msgpack  │
└─────┴──────────┴─────────────┴──────────┘

Ack Response:
┌─────────────────┐
│ {"ack": "chunk"} │  (MessagePack map)
└─────────────────┘`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('localhost'); setPort('24224'); handleModeSwitch('probe'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:24224</span>
              <span className="ml-2 text-slate-400">- Local Fluentd server probe</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('24224'); handleModeSwitch('send'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:24224</span>
              <span className="ml-2 text-slate-400">- Send test log entry</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
