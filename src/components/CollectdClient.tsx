import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CollectdClientProps {
  onBack: () => void;
}

export default function CollectdClient({ onBack }: CollectdClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('25826');
  const [plugin, setPlugin] = useState('test');
  const [pluginInstance, setPluginInstance] = useState('');
  const [metricType, setMetricType] = useState('gauge');
  const [typeInstance, setTypeInstance] = useState('value');
  const [metricHostname, setMetricHostname] = useState('portofcall');
  const [metricValue, setMetricValue] = useState('42.0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/collectd/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        bytesReceived?: number;
        receivedParts?: Array<{ type: number; typeName: string; length: number }>;
        serverPushesData?: boolean;
        note?: string;
      };

      if (data.success) {
        const lines = [
          `collectd Probe — ${host}:${port}`,
          '='.repeat(60),
          `UDP Latency:      ${data.tcpLatency}ms`,
          `Bytes Received:   ${data.bytesReceived ?? 0}`,
          `Server Pushes:    ${data.serverPushesData ? '✓ Yes — collectd data stream detected' : '✗ No data received (server may not be broadcasting)'}`,
        ];
        if (data.receivedParts && data.receivedParts.length > 0) {
          lines.push('', '--- Received TLV Parts ---');
          for (const p of data.receivedParts) {
            lines.push(`  type=0x${p.type.toString(16).padStart(4, '0')} (${p.typeName}) length=${p.length}`);
          }
        }
        if (data.note) lines.push('', data.note);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/collectd/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          plugin: plugin || 'test',
          pluginInstance: pluginInstance || undefined,
          type: metricType || 'gauge',
          typeInstance: typeInstance || undefined,
          hostname: metricHostname || 'portofcall',
          value: parseFloat(metricValue) || 0,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        sendLatency?: number;
        bytesWritten?: number;
        metric?: {
          plugin: string;
          pluginInstance?: string;
          type: string;
          typeInstance?: string;
          hostname: string;
          value: number;
        };
        note?: string;
      };

      if (data.success) {
        const lines = [
          `collectd Send — ${host}:${port}`,
          '='.repeat(60),
          `UDP Latency:    ${data.tcpLatency}ms`,
          `Send Latency:   ${data.sendLatency}ms`,
          `Bytes Written:  ${data.bytesWritten}`,
        ];
        if (data.metric) {
          lines.push('', '--- Metric Sent ---');
          lines.push(`  Plugin:   ${data.metric.plugin}${data.metric.pluginInstance ? `[${data.metric.pluginInstance}]` : ''}`);
          lines.push(`  Type:     ${data.metric.type}${data.metric.typeInstance ? `[${data.metric.typeInstance}]` : ''}`);
          lines.push(`  Host:     ${data.metric.hostname}`);
          lines.push(`  Value:    ${data.metric.value}`);
        }
        if (data.note) lines.push('', data.note);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleProbe();
  };

  return (
    <ProtocolClientLayout title="collectd Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="collectd Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="collectd-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="metrics.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="collectd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 25826 (collectd binary protocol)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Probe (Listen)" color="green" />

        <div className="mb-6">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Probe collectd server"
          >
            Probe (Listen for data)
          </ActionButton>
          <p className="text-xs text-slate-400 mt-2">
            Opens a UDP socket and listens briefly for incoming collectd metric packets.
            collectd servers push data on a schedule — you may need to wait for the next flush interval.
          </p>
        </div>

        <SectionHeader stepNumber={3} title="Send Metric" color="blue" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="collectd-plugin"
            label="Plugin"
            type="text"
            value={plugin}
            onChange={setPlugin}
            placeholder="test"
            helpText="Plugin name (e.g. cpu, memory, df)"
          />
          <FormField
            id="collectd-plugin-instance"
            label="Plugin Instance"
            type="text"
            value={pluginInstance}
            onChange={setPluginInstance}
            placeholder="(optional)"
            optional
            helpText="Plugin instance (e.g. 0 for cpu0)"
          />
          <FormField
            id="collectd-type"
            label="Type"
            type="text"
            value={metricType}
            onChange={setMetricType}
            placeholder="gauge"
            helpText="Metric type from types.db (e.g. gauge, counter)"
          />
          <FormField
            id="collectd-type-instance"
            label="Type Instance"
            type="text"
            value={typeInstance}
            onChange={setTypeInstance}
            placeholder="value"
            optional
            helpText="Type instance (e.g. read, write, used)"
          />
          <FormField
            id="collectd-hostname"
            label="Hostname"
            type="text"
            value={metricHostname}
            onChange={setMetricHostname}
            placeholder="portofcall"
            helpText="Source hostname for the metric"
          />
          <FormField
            id="collectd-value"
            label="Value"
            type="text"
            value={metricValue}
            onChange={setMetricValue}
            placeholder="42.0"
            helpText="Numeric gauge value to send"
          />
        </div>

        <div className="mb-6">
          <button
            onClick={handleSend}
            disabled={loading || !host}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Send Metric
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About collectd (port 25826)"
          description="collectd is a Unix daemon that collects system performance metrics and writes them to various storage backends. It uses a lightweight binary protocol over UDP (port 25826) to transmit metric data between nodes. The protocol uses TLV (Type-Length-Value) encoding with big-endian byte order. Common deployments send CPU, memory, disk I/O, and network metrics every 10 seconds. collectd is widely used in infrastructure monitoring alongside Graphite, InfluxDB, and Prometheus."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">TLV Part Types</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
            <div><code className="text-slate-300">0x0000</code> — HOST string</div>
            <div><code className="text-slate-300">0x0001</code> — TIME (epoch seconds)</div>
            <div><code className="text-slate-300">0x0002</code> — PLUGIN string</div>
            <div><code className="text-slate-300">0x0003</code> — PLUGIN_INSTANCE string</div>
            <div><code className="text-slate-300">0x0004</code> — TYPE string</div>
            <div><code className="text-slate-300">0x0005</code> — TYPE_INSTANCE string</div>
            <div><code className="text-slate-300">0x0006</code> — VALUES (numeric data)</div>
            <div><code className="text-slate-300">0x0007</code> — INTERVAL (seconds)</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
