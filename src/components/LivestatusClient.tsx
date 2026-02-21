import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface LivestatusClientProps {
  onBack: () => void;
}

const EXAMPLE_QUERIES = [
  { label: 'Engine Status', query: 'GET status\nColumns: program_version program_start nagios_pid num_hosts num_services' },
  { label: 'List Hosts', query: 'GET hosts\nColumns: name state address plugin_output\nLimit: 20' },
  { label: 'Critical Services', query: 'GET services\nColumns: host_name description state plugin_output\nFilter: state = 2\nLimit: 20' },
  { label: 'List Tables', query: 'GET columns\nColumns: table\nStats: count = 1' },
];

export default function LivestatusClient({ onBack }: LivestatusClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6557');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleStatus = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/livestatus/status', {
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
        data?: unknown;
        statusCode?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const rows = data.data as unknown[][];
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0] as (string | number)[];
          const cols = ['program_version', 'program_start', 'nagios_pid', 'num_hosts', 'num_services', 'connections', 'requests', 'livestatus_version'];
          let output = `Livestatus Engine Status\n\n`;
          for (let i = 0; i < cols.length && i < row.length; i++) {
            const val = cols[i] === 'program_start'
              ? new Date((row[i] as number) * 1000).toISOString()
              : String(row[i]);
            output += `${cols[i].padEnd(22)} ${val}\n`;
          }
          output += `\nRTT: ${data.rtt}ms`;
          setResult(output);
        } else {
          setResult(`Status: ${data.statusCode}\n\n${JSON.stringify(data.data, null, 2)}\n\nRTT: ${data.rtt}ms`);
        }
      } else {
        setError(data.error || 'Status query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleHosts = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/livestatus/hosts', {
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
        data?: unknown;
        statusCode?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const rows = data.data as unknown[][];
        const stateNames = ['UP', 'DOWN', 'UNREACHABLE'];
        if (Array.isArray(rows) && rows.length > 0) {
          let output = `Monitored Hosts (${rows.length} results)\n\n`;
          output += `${'Name'.padEnd(25)} ${'State'.padEnd(14)} ${'Address'.padEnd(18)} Services  Output\n`;
          output += `${'─'.repeat(25)} ${'─'.repeat(13)} ${'─'.repeat(17)} ${'─'.repeat(8)} ${'─'.repeat(30)}\n`;
          for (const row of rows as (string | number)[][]) {
            const name = String(row[0]).substring(0, 24);
            const state = stateNames[row[1] as number] || String(row[1]);
            const addr = String(row[2]).substring(0, 17);
            const output_text = String(row[3]).substring(0, 40);
            const services = String(row[5] ?? '');
            output += `${name.padEnd(25)} ${state.padEnd(14)} ${addr.padEnd(18)} ${services.padEnd(9)} ${output_text}\n`;
          }
          output += `\nRTT: ${data.rtt}ms`;
          setResult(output);
        } else {
          setResult(`No hosts found.\n\nRTT: ${data.rtt}ms`);
        }
      } else {
        setError(data.error || 'Hosts query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!query.trim()) {
      setError('Query is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/livestatus/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
          query: query.trim(),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        data?: unknown;
        statusCode?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Livestatus Response (status ${data.statusCode})\n\n` +
          JSON.stringify(data.data, null, 2) +
          `\n\nRTT: ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleStatus();
    }
  };

  return (
    <ProtocolClientLayout title="Livestatus Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="livestatus-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="monitoring.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="livestatus-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6557 (Livestatus TCP port)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleStatus}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Query Livestatus engine status"
          >
            Status
          </ActionButton>

          <button
            onClick={handleHosts}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="List monitored hosts"
          >
            Hosts
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Custom LQL Query" />

          <div className="mb-4">
            <label htmlFor="livestatus-query" className="block text-sm font-medium text-slate-300 mb-2">
              LQL Query
            </label>
            <textarea
              id="livestatus-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={'GET services\nColumns: host_name description state\nFilter: state = 2\nLimit: 10'}
              rows={4}
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-slate-500 mt-1">
              OutputFormat: json and ResponseHeader: fixed16 are added automatically
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => setQuery(ex.query)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors border border-slate-600"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleQuery}
            disabled={loading || !host || !port || !query.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Execute custom LQL query"
          >
            Execute Query
          </button>
        </div>

        <HelpSection
          title="About MK Livestatus Protocol"
          description="Livestatus is a text-based monitoring query protocol developed for Nagios by Mathias Kettner. It provides real-time access to monitoring data via TCP port 6557 using LQL (Livestatus Query Language). Supported by Checkmk, Naemon, Icinga 2, Shinken, and Thruk. Queries start with 'GET <table>' followed by optional headers like Columns, Filter, and Limit, terminated by a blank line."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">LQL Query Format</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`GET <table>
Columns: col1 col2 ...
Filter: column operator value
Limit: N
OutputFormat: json
ResponseHeader: fixed16
                          <- blank line terminates`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Key Tables</p>
              <p>status (engine info), hosts, services, contacts, commands, downtimes, comments, log</p>
            </div>
            <p className="mt-2">
              The fixed16 response header is a 16-byte line: 3-digit status code + space + 12-char
              content length + newline. Status 200 = success, 400 = bad request, 404 = unknown table.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
