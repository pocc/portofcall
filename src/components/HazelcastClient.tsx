import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface HazelcastClientProps {
  onBack: () => void;
}

interface ProbeInfo {
  rtt?: number;
  isHazelcast?: boolean;
  version?: string;
  clusterName?: string;
  memberCount?: number;
  serverVersion?: string;
}

export default function HazelcastClient({ onBack }: HazelcastClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5701');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [probeInfo, setProbeInfo] = useState<ProbeInfo | null>(null);

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
    setProbeInfo(null);

    try {
      const response = await fetch('/api/hazelcast/probe', {
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
        rtt?: number;
        isHazelcast?: boolean;
        version?: string;
        clusterName?: string;
        memberCount?: number;
        serverVersion?: string;
      };

      if (response.ok && data.success) {
        const info: ProbeInfo = {
          rtt: data.rtt,
          isHazelcast: data.isHazelcast,
          version: data.version,
          clusterName: data.clusterName,
          memberCount: data.memberCount,
          serverVersion: data.serverVersion,
        };
        setProbeInfo(info);

        if (data.isHazelcast) {
          let msg = 'Hazelcast IMDG detected';
          if (data.clusterName) {
            msg += ` - Cluster: ${data.clusterName}`;
          }
          if (data.serverVersion) {
            msg += ` (${data.serverVersion})`;
          }
          setResult(msg);
        } else {
          setResult('Connection succeeded but Hazelcast not detected');
        }
      } else {
        setError(data.error || 'Failed to probe Hazelcast server');
        if (data.rtt) {
          setProbeInfo({
            rtt: data.rtt,
            isHazelcast: data.isHazelcast,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe Hazelcast server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="Hazelcast IMDG Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Hazelcast Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="hazelcast-host"
            label="Hazelcast Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="hazelcast.example.com"
            required
            helpText="Hazelcast member host"
            error={errors.host}
          />

          <FormField
            id="hazelcast-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5701 (members use 5701-5799)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Hazelcast server"
        >
          Probe Server
        </ActionButton>

        {probeInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Server Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {probeInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{probeInfo.rtt}ms</div>
                </div>
              )}
              {probeInfo.isHazelcast !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Hazelcast Server</div>
                  <div className={`text-lg font-bold ${probeInfo.isHazelcast ? 'text-green-400' : 'text-orange-400'}`}>
                    {probeInfo.isHazelcast ? 'Yes' : 'No'}
                  </div>
                </div>
              )}
              {probeInfo.version && (
                <div>
                  <div className="text-xs text-slate-400">Protocol Version</div>
                  <div className="text-lg font-bold text-blue-400">{probeInfo.version}</div>
                </div>
              )}
              {probeInfo.memberCount !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Cluster Members</div>
                  <div className="text-lg font-bold text-purple-400">{probeInfo.memberCount}</div>
                </div>
              )}
            </div>

            {probeInfo.clusterName && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400">Cluster Name</div>
                <div className="text-sm font-mono text-slate-300">{probeInfo.clusterName}</div>
              </div>
            )}

            {probeInfo.serverVersion && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400">Server Version</div>
                <div className="text-sm font-mono text-slate-300">{probeInfo.serverVersion}</div>
              </div>
            )}
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Hazelcast IMDG"
          description="Hazelcast is an in-memory data grid (IMDG) platform for distributed caching, computing, and messaging. It provides distributed data structures (maps, queues, locks) backed by a cluster of nodes. The client protocol is binary and supports authentication, distributed operations, and event listeners. This probe sends a minimal authentication request to detect the Hazelcast server, protocol version, and cluster information."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">Binary TCP with length-prefixed frames</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Ports:</td>
                  <td className="py-2 px-2">5701 (first member), 5702-5799 (cluster)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">Username/password, token, or anonymous</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Clustering:</td>
                  <td className="py-2 px-2">Auto-discovery via multicast or TCP/IP seed list</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Use Cases:</td>
                  <td className="py-2 px-2">Caching, session storage, distributed computing, pub/sub</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Architecture</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`┌──────────────┐       Binary        ┌──────────────┐
│   Client     │ ───  Protocol  ───> │ Member 5701  │
│ Application  │    (Auth Frame)     │  (Cluster    │
│              │ <──  Response  ───  │   Partition  │
└──────────────┘                     │   Owner)     │
                                     └──────┬───────┘
                  ┌──────────────────────┬──┴──┬────────────┐
                  │                      │     │            │
            ┌─────▼──────┐      ┌───────▼─────▼─┐   ┌─────▼──────┐
            │ Member     │      │ Member         │   │ Member     │
            │ 5702       │◄────►│ 5703           │◄─►│ 5704       │
            │ (Backup)   │      │ (Backup)       │   │ (Backup)   │
            └────────────┘      └────────────────┘   └────────────┘
                                    Cluster Bus
                              (Partition replication)`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('localhost'); setPort('5701'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:5701</span>
              <span className="ml-2 text-slate-400">- Local Hazelcast first member</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('5702'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:5702</span>
              <span className="ml-2 text-slate-400">- Local Hazelcast second member</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
