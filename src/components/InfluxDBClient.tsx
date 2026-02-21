import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface InfluxDBClientProps {
  onBack: () => void;
}

export default function InfluxDBClient({ onBack }: InfluxDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8086');
  const [token, setToken] = useState('');
  const [org, setOrg] = useState('');
  const [bucket, setBucket] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Write form state
  const [lineProtocol, setLineProtocol] = useState('cpu,host=server01,region=us-west usage=75.2');

  // Query form state
  const [fluxQuery, setFluxQuery] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHealthCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/influxdb/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        parsed?: {
          health?: { name?: string; status?: string; version?: string; message?: string };
          ready?: { status?: string; started?: string; up?: string };
        };
        latencyMs?: number;
      };

      if (response.ok && data.success) {
        const health = data.parsed?.health;
        const ready = data.parsed?.ready;

        let output = `InfluxDB Health Check\n`;
        output += `${'='.repeat(40)}\n\n`;
        output += `Status Code: ${data.statusCode}\n`;
        output += `Latency:     ${data.latencyMs}ms\n\n`;

        if (health) {
          output += `Server Health:\n`;
          if (health.name) output += `  Name:    ${health.name}\n`;
          if (health.status) output += `  Status:  ${health.status}\n`;
          if (health.version) output += `  Version: ${health.version}\n`;
          if (health.message) output += `  Message: ${health.message}\n`;
        }

        if (ready) {
          output += `\nReady Status:\n`;
          if (ready.status) output += `  Status:  ${ready.status}\n`;
          if (ready.started) output += `  Started: ${ready.started}\n`;
          if (ready.up) output += `  Uptime:  ${ready.up}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Health check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleWrite = async () => {
    if (!host || !org || !bucket || !lineProtocol) {
      setError('Host, organization, bucket, and line protocol data are required for writing');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/influxdb/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          org,
          bucket,
          lineProtocol,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        body?: string;
      };

      if (response.ok && data.success) {
        let output = `Write Successful\n`;
        output += `${'='.repeat(40)}\n\n`;
        output += `Status Code: ${data.statusCode}\n`;
        output += `Latency:     ${data.latencyMs}ms\n\n`;
        output += `Data Written:\n${lineProtocol}\n\n`;
        output += `Org:    ${org}\n`;
        output += `Bucket: ${bucket}\n`;
        setResult(output);
      } else {
        setError(data.error || data.body || 'Write failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Write failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!host || !org || !fluxQuery) {
      setError('Host, organization, and Flux query are required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/influxdb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          org,
          query: fluxQuery,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        body?: string;
      };

      if (response.ok && data.success) {
        let output = `Flux Query Results\n`;
        output += `${'='.repeat(40)}\n\n`;
        output += `Status Code: ${data.statusCode}\n`;
        output += `Latency:     ${data.latencyMs}ms\n\n`;
        output += `Query:\n${fluxQuery}\n\n`;
        output += `Response:\n${data.body || '(empty)'}`;
        setResult(output);
      } else {
        setError(data.error || data.body || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleHealthCheck();
    }
  };

  return (
    <ProtocolClientLayout title="InfluxDB Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="influxdb-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="influxdb.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="influxdb-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8086 (InfluxDB HTTP API)"
            error={errors.port}
          />

          <FormField
            id="influxdb-token"
            label="API Token"
            type="password"
            value={token}
            onChange={setToken}
            onKeyDown={handleKeyDown}
            placeholder="Optional authentication token"
            helpText="InfluxDB 2.x API token (leave blank for no auth)"
          />

          <FormField
            id="influxdb-org"
            label="Organization"
            type="text"
            value={org}
            onChange={setOrg}
            onKeyDown={handleKeyDown}
            placeholder="myorg"
            helpText="Required for write & query operations"
          />

          <FormField
            id="influxdb-bucket"
            label="Bucket"
            type="text"
            value={bucket}
            onChange={setBucket}
            onKeyDown={handleKeyDown}
            placeholder="mybucket"
            helpText="Required for write operations"
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Check InfluxDB health"
        >
          Health Check
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Write Data (Line Protocol)" />

        <div className="mb-4">
          <label htmlFor="influxdb-line" className="block text-sm font-medium text-slate-300 mb-1">
            Line Protocol Data
          </label>
          <textarea
            id="influxdb-line"
            value={lineProtocol}
            onChange={(e) => setLineProtocol(e.target.value)}
            rows={4}
            className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white placeholder-slate-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="measurement,tag=value field=value timestamp"
          />
          <p className="text-xs text-slate-400 mt-1">
            Format: measurement[,tag=value] field=value [timestamp_ns]
          </p>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setLineProtocol('cpu,host=server01,region=us-west usage=75.2')}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            CPU Example
          </button>
          <button
            onClick={() => setLineProtocol('temperature,sensor=basement,location=home value=22.5')}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            Temperature Example
          </button>
          <button
            onClick={() => setLineProtocol('http_requests,method=GET,status=200 count=1i,duration=0.035')}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            HTTP Metrics Example
          </button>
        </div>

        <ActionButton
          onClick={handleWrite}
          disabled={loading || !host || !org || !bucket || !lineProtocol}
          loading={loading}
          ariaLabel="Write data to InfluxDB"
        >
          Write Data
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={3} title="Query Data (Flux)" />

        <div className="mb-4">
          <label htmlFor="influxdb-query" className="block text-sm font-medium text-slate-300 mb-1">
            Flux Query
          </label>
          <textarea
            id="influxdb-query"
            value={fluxQuery}
            onChange={(e) => setFluxQuery(e.target.value)}
            rows={6}
            className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white placeholder-slate-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={'from(bucket: "mybucket")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "cpu")'}
          />
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFluxQuery(`from(bucket: "${bucket || 'mybucket'}")\n  |> range(start: -1h)\n  |> limit(n: 10)`)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            Last Hour (10 rows)
          </button>
          <button
            onClick={() => setFluxQuery(`from(bucket: "${bucket || 'mybucket'}")\n  |> range(start: -24h)\n  |> filter(fn: (r) => r._measurement == "cpu")\n  |> aggregateWindow(every: 1h, fn: mean)`)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            CPU Hourly Average
          </button>
          <button
            onClick={() => setFluxQuery(`buckets()`)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
          >
            List Buckets
          </button>
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host || !org || !fluxQuery}
          loading={loading}
          ariaLabel="Execute Flux query"
        >
          Execute Query
        </ActionButton>
      </div>

      <HelpSection
        title="About InfluxDB Protocol"
        description="InfluxDB is a purpose-built time-series database. Data is written using Line Protocol (text format) and queried using Flux (functional query language). The HTTP API on port 8086 provides health checks, data writes, and queries. InfluxDB 2.x uses token-based authentication with organizations and buckets."
        showKeyboardShortcut={true}
      />

      <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Line Protocol Reference</h3>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-2">
          <p className="text-slate-400"># Format: measurement[,tag=val] field=val [timestamp]</p>
          <p>cpu,host=server01 usage=75.2</p>
          <p>temperature,sensor=A1 value=22.5,humidity=65i</p>
          <p>stock,symbol=AAPL price=150.25 1640000000000000000</p>
          <p className="text-slate-400 mt-2"># Field types: float (default), integer (i suffix), string ("quoted"), boolean (t/f)</p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
