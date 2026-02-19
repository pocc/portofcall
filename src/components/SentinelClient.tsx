import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface SentinelClientProps {
  onBack: () => void;
}

export default function SentinelClient({ onBack }: SentinelClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('26379');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('');
  const [masterName, setMasterName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required'), validationRules.hostname()],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sentinel/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        version?: string;
        sentinelInfo?: Record<string, string>;
        masters?: Array<Record<string, string>>;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Redis Sentinel`,
          `${'='.repeat(60)}`,
          '',
          `Version: ${data.version || 'Unknown'}`,
          `RTT:     ${data.rtt}ms`,
        ];

        if (data.sentinelInfo && Object.keys(data.sentinelInfo).length > 0) {
          lines.push('', '--- Sentinel Info ---');
          for (const [key, value] of Object.entries(data.sentinelInfo)) {
            lines.push(`  ${key}: ${value}`);
          }
        }

        if (data.masters && data.masters.length > 0) {
          lines.push('', `--- Monitored Masters (${data.masters.length}) ---`);
          data.masters.forEach((master, idx) => {
            lines.push(`  [${idx + 1}] ${master['name'] || 'unknown'}`);
            lines.push(`      Address: ${master['ip']}:${master['port']}`);
            lines.push(`      Status:  ${master['flags'] || 'unknown'}`);
            if (master['num-slaves']) lines.push(`      Replicas: ${master['num-slaves']}`);
            if (master['num-other-sentinels']) lines.push(`      Sentinels: ${parseInt(master['num-other-sentinels']) + 1}`);
            if (master['quorum']) lines.push(`      Quorum: ${master['quorum']}`);
          });
        } else {
          lines.push('', 'No monitored masters found.');
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to probe Sentinel');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe Sentinel');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (selectedCommand?: string) => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    const cmdToRun = selectedCommand || command;
    if (!cmdToRun.trim()) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sentinel/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          command: cmdToRun.trim(),
          masterName: masterName.trim() || undefined,
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        command?: string;
        result?: unknown;
        parsed?: Record<string, string> | Array<Record<string, string>>;
        transcript?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Sentinel Query: ${data.command}`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.parsed) {
          if (Array.isArray(data.parsed)) {
            lines.push(`--- Results (${data.parsed.length}) ---`);
            data.parsed.forEach((item, idx) => {
              const name = item['name'] || item['ip'] || `Entry ${idx + 1}`;
              lines.push(`  [${idx + 1}] ${name}`);
              for (const [key, value] of Object.entries(item)) {
                if (key !== 'name') {
                  lines.push(`      ${key}: ${value}`);
                }
              }
            });
          } else {
            lines.push('--- Result ---');
            for (const [key, value] of Object.entries(data.parsed)) {
              lines.push(`  ${key}: ${value}`);
            }
          }
        } else if (data.result !== undefined) {
          lines.push(`Result: ${typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2)}`);
        }

        if (data.rtt !== undefined) {
          lines.push('', `RTT: ${data.rtt}ms`);
        }

        if (data.transcript && data.transcript.length > 0) {
          lines.push('', '--- Transcript ---');
          for (const line of data.transcript) {
            lines.push(line);
          }
        }

        setResult(lines.join('\n'));
      } else {
        const lines = [data.error || 'Query failed'];
        if (data.transcript && data.transcript.length > 0) {
          lines.push('', '--- Transcript ---');
          for (const line of data.transcript) {
            lines.push(line);
          }
        }
        setError(lines.join('\n'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sentinel query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="Redis Sentinel Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Sentinel || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Sentinel Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sentinel-host"
            label="Sentinel Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="sentinel.example.com"
            required
            helpText="Redis Sentinel node address"
            error={errors.host}
          />

          <FormField
            id="sentinel-port"
            label="Sentinel Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 26379"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="sentinel-password"
            label="Password (Optional)"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="sentinel password"
            helpText="Required if Sentinel has requirepass set"
          />
        </div>

        <SectionHeader stepNumber={2} title="Actions" color="green" />

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe Sentinel server"
        >
          Probe Sentinel
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={3} title="Query Sentinel" color="purple" />

          <div className="mb-4">
            <FormField
              id="sentinel-master"
              label="Master Name (for master-specific commands)"
              type="text"
              value={masterName}
              onChange={setMasterName}
              placeholder="mymaster"
              helpText="Name of the monitored master instance"
            />
          </div>

          <div className="flex gap-2 mb-4">
            <div className="flex-1">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && host && command.trim()) {
                    handleQuery();
                  }
                }}
                placeholder="e.g. SENTINEL masters, INFO sentinel"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={() => handleQuery()}
              disabled={loading || !host || !command.trim()}
              loading={loading}
              variant="secondary"
              ariaLabel="Run Sentinel query"
            >
              Run
            </ActionButton>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { cmd: 'PING', desc: 'Health check' },
              { cmd: 'SENTINEL masters', desc: 'List monitored masters' },
              { cmd: 'SENTINEL master', desc: 'Master details', needsMaster: true },
              { cmd: 'SENTINEL replicas', desc: 'List replicas', needsMaster: true },
              { cmd: 'SENTINEL sentinels', desc: 'Other sentinels', needsMaster: true },
              { cmd: 'SENTINEL get-master-addr-by-name', desc: 'Master address', needsMaster: true },
              { cmd: 'SENTINEL ckquorum', desc: 'Quorum check', needsMaster: true },
              { cmd: 'INFO', desc: 'Server info' },
              { cmd: 'SENTINEL myid', desc: 'Sentinel ID' },
            ].map(({ cmd, desc, needsMaster }) => (
              <button
                key={cmd}
                onClick={() => {
                  setCommand(cmd);
                  if (host) handleQuery(cmd);
                }}
                disabled={needsMaster && !masterName.trim()}
                className={`text-sm py-2 px-3 rounded text-left transition-colors ${
                  needsMaster && !masterName.trim()
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
              >
                <span className="font-mono text-red-400">{cmd}</span>
                <span className="block text-xs text-slate-400">
                  {desc}
                  {needsMaster && !masterName.trim() && ' (set master name)'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Redis Sentinel"
          description="Redis Sentinel provides high availability for Redis. It monitors master and replica instances, performs automatic failover when a master fails, and acts as a configuration provider for clients. Sentinel runs on port 26379 and uses the same RESP protocol as Redis. A typical production setup has 3+ Sentinel nodes monitoring the same Redis master for quorum-based failover decisions."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Sentinel RESP Example</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-1">
            <div><span className="text-green-400">C:</span> *1\r\n$4\r\nPING\r\n</div>
            <div><span className="text-blue-400">S:</span> +PONG</div>
            <div className="text-slate-500">{'   '}</div>
            <div><span className="text-green-400">C:</span> *2\r\n$8\r\nSENTINEL\r\n$7\r\nmasters\r\n</div>
            <div><span className="text-blue-400">S:</span> *1\r\n*30\r\n$4\r\nname\r\n$8\r\nmymaster\r\n...</div>
            <div className="text-slate-500">{'   (array of master details)'}</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> Only read-only Sentinel commands are permitted through this interface.
              Administrative commands like SENTINEL SET, SENTINEL FAILOVER, and SENTINEL RESET
              are blocked for safety. Sentinel may require a password if{' '}
              <code className="bg-slate-700 px-1 rounded">requirepass</code> is configured.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
