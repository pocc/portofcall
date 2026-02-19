import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface GraphiteClientProps {
  onBack: () => void;
}

interface MetricEntry {
  name: string;
  value: string;
}

const TEMPLATES = [
  { name: 'app.requests.count', value: '1', label: 'Request Counter' },
  { name: 'app.response.time.p95', value: '123.45', label: 'Response Time (ms)' },
  { name: 'system.cpu.usage', value: '65.5', label: 'CPU Usage (%)' },
  { name: 'system.memory.used_mb', value: '8192', label: 'Memory Used (MB)' },
  { name: 'app.errors.count', value: '1', label: 'Error Counter' },
];

export default function GraphiteClient({ onBack }: GraphiteClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2003');
  const [metrics, setMetrics] = useState<MetricEntry[]>([{ name: '', value: '' }]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const updateMetric = (index: number, field: 'name' | 'value', val: string) => {
    const updated = [...metrics];
    updated[index] = { ...updated[index], [field]: val };
    setMetrics(updated);
  };

  const addMetric = () => {
    setMetrics([...metrics, { name: '', value: '' }]);
  };

  const removeMetric = (index: number) => {
    if (metrics.length > 1) {
      setMetrics(metrics.filter((_, i) => i !== index));
    }
  };

  const applyTemplate = (template: typeof TEMPLATES[0]) => {
    const lastIdx = metrics.length - 1;
    if (metrics[lastIdx].name === '' && metrics[lastIdx].value === '') {
      updateMetric(lastIdx, 'name', template.name);
      updateMetric(lastIdx, 'value', template.value);
    } else {
      setMetrics([...metrics, { name: template.name, value: template.value }]);
    }
  };

  const handleSend = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    const validMetrics = metrics.filter(m => m.name && m.value);
    if (validMetrics.length === 0) {
      setError('At least one metric with name and value is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/graphite/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          metrics: validMetrics.map(m => ({
            name: m.name,
            value: parseFloat(m.value),
          })),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        metricsCount?: number;
        payload?: string;
      };

      if (response.ok && data.success) {
        setResult(`${data.message}\n\nPayload sent:\n${data.payload}`);
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Graphite Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Carbon Receiver</h2>
        </div>

      <ApiExamples examples={apiExamples.Graphite || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="graphite-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="graphite-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="graphite.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="graphite-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="graphite-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 2003 (Carbon plaintext)</p>
          </div>
        </div>

        {/* Step 2: Metrics */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Metrics</h2>
          </div>

          {metrics.map((metric, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="text"
                value={metric.name}
                onChange={(e) => updateMetric(i, 'name', e.target.value)}
                placeholder="metric.name.path"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              />
              <input
                type="text"
                value={metric.value}
                onChange={(e) => updateMetric(i, 'value', e.target.value)}
                placeholder="value"
                className="w-32 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) handleSend();
                }}
              />
              <button
                onClick={() => removeMetric(i)}
                disabled={metrics.length <= 1}
                className="px-3 py-2 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                aria-label="Remove metric"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            onClick={addMetric}
            className="text-sm text-blue-400 hover:text-blue-300 mt-2 mb-4"
          >
            + Add Metric
          </button>

          {/* Templates */}
          <div className="mb-4">
            <p className="text-xs text-slate-400 mb-2">Quick templates:</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => applyTemplate(t)}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1 rounded-full transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSend}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Send metrics to Graphite"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Sending...
              </span>
            ) : (
              'Send Metrics'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Graphite</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Graphite is a time-series metrics system. The plaintext protocol on port 2003 uses the format:
            <code className="bg-slate-700 px-1 mx-1 rounded">metric.name value timestamp</code>.
            Metrics use dot-separated hierarchical names. Timestamp is auto-set to current time.
            This is a fire-and-forget protocol - no server response is expected.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> in value field to send
          </p>
        </div>
      </div>
    </div>
  );
}
