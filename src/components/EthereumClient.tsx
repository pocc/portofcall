import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface EthereumClientProps {
  onBack: () => void;
}

export default function EthereumClient({ onBack }: EthereumClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('30303');
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
      const response = await fetch('/api/ethereum/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        portOpen?: boolean;
        receivedBytes?: number;
        rlpxFingerprint?: string;
        protocol?: string;
        limitations?: string[];
        references?: string[];
        note?: string;
      };

      if (data.success) {
        const lines = [
          `Ethereum P2P Probe — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:    ${data.tcpLatency}ms`,
          `Port Open:      ${data.portOpen ? '✓ Yes' : '✗ No'}`,
          `Bytes Received: ${data.receivedBytes ?? 0}`,
        ];
        if (data.rlpxFingerprint) lines.push(`RLPx:           ${data.rlpxFingerprint}`);
        if (data.protocol) lines.push(`Protocol:       ${data.protocol}`);

        if (data.limitations && data.limitations.length > 0) {
          lines.push('', '--- Limitations ---');
          for (const lim of data.limitations) {
            lines.push(`  • ${lim}`);
          }
        }
        if (data.references && data.references.length > 0) {
          lines.push('', '--- References ---');
          for (const ref of data.references) {
            lines.push(`  ${ref}`);
          }
        }
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
    <ProtocolClientLayout title="Ethereum P2P Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="mb-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
          <p className="text-xs text-amber-300">
            <strong>Partial probe only.</strong> Full RLPx handshake requires secp256k1 ECIES
            cryptography, which is unavailable in Cloudflare Workers. This probe confirms port
            connectivity and fingerprints any initial bytes the peer sends.
          </p>
        </div>

        <SectionHeader stepNumber={1} title="Ethereum Node" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="eth-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="eth.example.com or 192.168.1.1"
            required
            error={errors.host}
          />
          <FormField
            id="eth-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 30303 (go-ethereum, Nethermind, Besu)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe Ethereum P2P node"
        >
          Probe RLPx
        </ActionButton>
        <p className="text-xs text-slate-400 mt-2 mb-6">
          Connects via TCP and reads any initial bytes to fingerprint the RLPx handshake.
        </p>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Ethereum P2P / RLPx (port 30303)"
          description="Ethereum nodes communicate via the RLPx protocol (Recursive Length Prefix eXchange), an encrypted peer-to-peer transport. After a TCP connection on port 30303, nodes perform an ECIES (Elliptic Curve Integrated Encryption Scheme) handshake using secp256k1 keys to establish an encrypted channel. Over this channel, the DevP2P wire protocol carries sub-protocols: eth (block/transaction sync), snap (state sync), and les (light clients). The Ethereum network has ~6,000+ publicly reachable nodes."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">RLPx Handshake Flow</h3>
          <div className="text-xs text-slate-400 space-y-1 font-mono">
            <div>1. TCP connect to port 30303</div>
            <div>2. Initiator sends <span className="text-slate-300">auth-message</span> (ECIES encrypted, 307 or EIP-8 bytes)</div>
            <div>3. Receiver responds with <span className="text-slate-300">auth-ack</span></div>
            <div>4. Both derive shared secrets (AES + MAC keys)</div>
            <div>5. DevP2P Hello frames exchanged (capabilities list)</div>
            <div>6. Sub-protocol negotiation (eth/68, snap/1, ...)</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
