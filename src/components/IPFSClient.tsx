import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface IPFSClientProps {
  onBack: () => void;
}

export default function IPFSClient({ onBack }: IPFSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4001');
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
      const response = await fetch('/api/ipfs/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          protocols: ['/multistream/1.0.0', '/p2p/0.1.0', '/ipfs/0.1.0', '/ipfs/kad/1.0.0'],
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        isIPFSNode?: boolean;
        serverHeader?: string;
        negotiatedProtocols?: string[];
        unsupportedProtocols?: string[];
        allMessages?: string[];
        note?: string;
        references?: string[];
      };

      if (data.success) {
        const lines = [
          `IPFS / libp2p Probe — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:  ${data.tcpLatency}ms`,
          `IPFS Node:    ${data.isIPFSNode ? '✓ Yes — multistream/1.0.0 detected' : '✗ Not detected'}`,
        ];
        if (data.serverHeader) lines.push(`Server:       ${data.serverHeader}`);

        if (data.negotiatedProtocols && data.negotiatedProtocols.length > 0) {
          lines.push('', '--- Negotiated Protocols ---');
          for (const p of data.negotiatedProtocols) {
            lines.push(`  ✓ ${p}`);
          }
        }
        if (data.unsupportedProtocols && data.unsupportedProtocols.length > 0) {
          lines.push('', '--- Unsupported Protocols ---');
          for (const p of data.unsupportedProtocols) {
            lines.push(`  ✗ ${p}`);
          }
        }
        if (data.allMessages && data.allMessages.length > 0) {
          lines.push('', '--- All Messages ---');
          for (const m of data.allMessages) {
            lines.push(`  ${m}`);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleProbe();
  };

  return (
    <ProtocolClientLayout title="IPFS Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="IPFS Node" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ipfs-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ipfs.example.com or 192.168.1.1"
            required
            error={errors.host}
          />
          <FormField
            id="ipfs-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4001 (IPFS swarm listener)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe IPFS node"
        >
          Probe IPFS Node
        </ActionButton>
        <p className="text-xs text-slate-400 mt-2 mb-6">
          Performs libp2p multistream-select negotiation to identify the node and its
          supported protocols.
        </p>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IPFS / libp2p (port 4001)"
          description="IPFS (InterPlanetary File System) uses libp2p for peer-to-peer networking. Nodes listen on port 4001 for incoming TCP connections. The connection begins with a multistream-select handshake: both sides exchange varint-length-prefixed protocol identifiers to negotiate the application protocol. After negotiation, encryption (Noise or TLS) is established, followed by protocol-specific communication. The IPFS network has hundreds of thousands of nodes serving content-addressed data identified by CIDs (Content Identifiers)."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">libp2p Protocol IDs</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
            <div><code className="text-slate-300">/multistream/1.0.0</code> — Protocol negotiation</div>
            <div><code className="text-slate-300">/p2p/0.1.0</code> — IPFS peer exchange (modern)</div>
            <div><code className="text-slate-300">/ipfs/0.1.0</code> — Peer exchange (legacy)</div>
            <div><code className="text-slate-300">/noise</code> — Noise encryption (current)</div>
            <div><code className="text-slate-300">/tls/1.0.0</code> — TLS encryption</div>
            <div><code className="text-slate-300">/ipfs/kad/1.0.0</code> — Kademlia DHT</div>
            <div><code className="text-slate-300">/ipfs/bitswap/1.2.0</code> — Block exchange</div>
            <div><code className="text-slate-300">/libp2p/identify/1.0.0</code> — Peer identity</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
