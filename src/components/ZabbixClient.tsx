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

interface ZabbixClientProps {
  onBack: () => void;
}

type Mode = 'server' | 'agent';

const commonAgentKeys = [
  { key: 'agent.ping', description: 'Agent availability check (returns 1 if alive)' },
  { key: 'agent.version', description: 'Agent software version string' },
  { key: 'agent.hostname', description: 'Agent configured hostname' },
  { key: 'system.uptime', description: 'System uptime in seconds' },
  { key: 'system.hostname', description: 'System hostname' },
  { key: 'system.uname', description: 'OS information (kernel, arch)' },
  { key: 'system.cpu.num', description: 'Number of CPUs/cores' },
  { key: 'vm.memory.size[total]', description: 'Total physical memory in bytes' },
  { key: 'vfs.fs.discovery', description: 'Filesystem discovery (JSON)' },
  { key: 'net.if.discovery', description: 'Network interface discovery (JSON)' },
];

export default function ZabbixClient({ onBack }: ZabbixClientProps) {
  const [mode, setMode] = useState<Mode>('server');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('10051');
  const [agentKey, setAgentKey] = useState('agent.ping');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [serverInfo, setServerInfo] = useState<{
    response?: string;
    version?: string;
    rtt?: number;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleModeSwitch = (newMode: Mode) => {
    setMode(newMode);
    setPort(newMode === 'server' ? '10051' : '10050');
    setResult('');
    setError('');
    setServerInfo(null);
  };

  const handleProbeServer = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setServerInfo(null);

    try {
      const response = await fetch('/api/zabbix/connect', {
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
        response?: string;
        version?: string;
        data?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(data.data || 'Connected successfully');
        setServerInfo({
          response: data.response,
          version: data.version,
          rtt: data.rtt,
        });
      } else {
        setError(data.error || 'Failed to connect to Zabbix server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Zabbix server');
    } finally {
      setLoading(false);
    }
  };

  const handleQueryAgent = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!agentKey.trim()) {
      setError('Item key is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');
    setServerInfo(null);

    try {
      const response = await fetch('/api/zabbix/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          key: agentKey,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        key?: string;
        value?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(`Key: ${data.key}\nValue: ${data.value}`);
        setServerInfo({ rtt: data.rtt });
      } else {
        setError(data.error || 'Failed to query Zabbix agent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query Zabbix agent');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      if (mode === 'server') {
        handleProbeServer();
      } else {
        handleQueryAgent();
      }
    }
  };

  return (
    <ProtocolClientLayout title="Zabbix Protocol Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Zabbix || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Mode Selector */}
        <div className="mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => handleModeSwitch('server')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'server'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              Server Probe (Port 10051)
            </button>
            <button
              onClick={() => handleModeSwitch('agent')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'agent'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              Agent Query (Port 10050)
            </button>
          </div>
        </div>

        <SectionHeader
          stepNumber={1}
          title={mode === 'server' ? 'Zabbix Server Configuration' : 'Zabbix Agent Configuration'}
        />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="zabbix-host"
            label="Zabbix Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="zabbix.example.com"
            required
            helpText={mode === 'server' ? 'Zabbix server/proxy address' : 'Host running Zabbix agent'}
            error={errors.host}
          />

          <FormField
            id="zabbix-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText={mode === 'server' ? 'Default: 10051 (server/proxy)' : 'Default: 10050 (agent)'}
            error={errors.port}
          />
        </div>

        {mode === 'agent' && (
          <>
            <SectionHeader stepNumber={2} title="Item Key" color="green" />
            <div className="mb-4">
              <FormField
                id="zabbix-key"
                label="Zabbix Item Key"
                type="text"
                value={agentKey}
                onChange={setAgentKey}
                onKeyDown={handleKeyDown}
                placeholder="agent.ping"
                required
                helpText="The monitoring item key to query from the agent"
              />
            </div>

            <div className="mb-6">
              <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Quick Keys</h4>
              <div className="grid grid-cols-2 gap-1">
                {commonAgentKeys.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setAgentKey(item.key)}
                    className={`text-left text-xs py-1.5 px-2 rounded transition-colors ${
                      agentKey === item.key
                        ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-mono text-blue-400">{item.key}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <ActionButton
          onClick={mode === 'server' ? handleProbeServer : handleQueryAgent}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel={mode === 'server' ? 'Probe Zabbix server' : 'Query Zabbix agent'}
        >
          {mode === 'server' ? 'Probe Server' : 'Query Agent'}
        </ActionButton>

        {serverInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Connection Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {serverInfo.response && (
                <div>
                  <div className="text-xs text-slate-400">Response</div>
                  <div className="text-lg font-bold text-blue-400">{serverInfo.response}</div>
                </div>
              )}
              {serverInfo.version && (
                <div>
                  <div className="text-xs text-slate-400">Info</div>
                  <div className="text-sm font-bold text-green-400 break-all">{serverInfo.version}</div>
                </div>
              )}
              {serverInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{serverInfo.rtt}ms</div>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Zabbix Protocol"
          description="Zabbix uses a binary protocol (ZBXD header) over TCP for monitoring communication. Server (port 10051) receives data from agents; Agent (port 10050) responds to passive check queries. The protocol uses a 13-byte header: 'ZBXD' magic (4 bytes) + flags (1 byte) + data length (8 bytes LE), followed by a JSON payload."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Header Magic:</td>
                  <td className="py-2 px-2 font-mono">ZBXD (0x5A 0x42 0x58 0x44)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol Flags:</td>
                  <td className="py-2 px-2">0x01 (standard), 0x03 (compressed)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Data Length:</td>
                  <td className="py-2 px-2">8 bytes, little-endian unsigned 64-bit integer</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Payload:</td>
                  <td className="py-2 px-2">JSON string (UTF-8)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Server Port:</td>
                  <td className="py-2 px-2">10051 (receives active check data)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Agent Port:</td>
                  <td className="py-2 px-2">10050 (responds to passive checks)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Architecture</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`┌──────────┐    Port 10050    ┌──────────┐
│  Zabbix  │ ──── Query ───> │  Zabbix  │
│  Server  │ <── Response ── │  Agent   │
│ (:10051) │                 │ (:10050) │
└──────────┘                 └──────────┘
     ▲
     │ Port 10051
     │ Active Check Data
     │
┌──────────┐
│  Zabbix  │  (Agent sends data
│  Agent   │   to server)
│ (active) │
└──────────┘`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Packet Format</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`Bytes:  0   1   2   3   4   5   6   7   8   9  10  11  12  13 ...
       ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬─────────
       │ Z │ B │ X │ D │flg│      data length (LE u64)      │ JSON...
       └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴─────────
       ├─ magic (4B) ─┤     ├───── 8 bytes little-endian ──────┤`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('localhost'); setPort('10051'); setMode('server'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:10051</span>
              <span className="ml-2 text-slate-400">- Local Zabbix server probe</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('10050'); handleModeSwitch('agent'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:10050</span>
              <span className="ml-2 text-slate-400">- Local Zabbix agent query</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
