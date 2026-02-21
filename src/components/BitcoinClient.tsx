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

interface BitcoinClientProps {
  onBack: () => void;
}

export default function BitcoinClient({ onBack }: BitcoinClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8333');
  const [network, setNetwork] = useState('mainnet');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/bitcoin/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          network,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        network?: string;
        rtt?: number;
        handshakeComplete?: boolean;
        node?: {
          version: number;
          userAgent: string;
          services: string[];
          servicesRaw: string;
          startHeight: number;
          timestamp: string;
          relay: boolean;
        };
        note?: string;
      };

      if (response.ok && data.success && data.node) {
        const lines = [
          `Bitcoin Node Connected (${data.network})`,
          '',
          `User Agent:    ${data.node.userAgent}`,
          `Protocol Ver:  ${data.node.version}`,
          `Block Height:  ${data.node.startHeight.toLocaleString()}`,
          `Services:      ${data.node.services.join(', ')}`,
          `Services Raw:  ${data.node.servicesRaw}`,
          `Node Time:     ${data.node.timestamp}`,
          `Relay:         ${data.node.relay ? 'Yes' : 'No'}`,
          `Verack:        ${data.handshakeComplete ? 'Received' : 'Not received'}`,
          `RTT:           ${data.rtt}ms`,
          '',
        ];

        if (data.note) lines.push(data.note);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGetAddr = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/bitcoin/getaddr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          network,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        nodeVersion?: string;
        blockHeight?: number;
        messagesReceived?: Array<{ command: string; payloadSize: number }>;
        note?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `Bitcoin GetAddr Response`,
          '',
          `Node:         ${data.nodeVersion}`,
          `Block Height: ${data.blockHeight?.toLocaleString()}`,
          '',
          'Messages Received After getaddr:',
        ];

        if (data.messagesReceived?.length) {
          for (const msg of data.messagesReceived) {
            lines.push(`  ${msg.command} (${msg.payloadSize} bytes)`);
          }
        } else {
          lines.push('  (no messages received)');
        }

        lines.push('');
        if (data.note) lines.push(data.note);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Bitcoin Node Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Bitcoin || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Bitcoin Node" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="bitcoin-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="seed.bitcoin.sipa.be"
            required
            error={errors.host}
          />

          <FormField
            id="bitcoin-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8333 (mainnet)"
            error={errors.port}
          />

          <div>
            <label htmlFor="bitcoin-network" className="block text-sm font-medium text-slate-300 mb-1">
              Network
            </label>
            <select
              id="bitcoin-network"
              value={network}
              onChange={(e) => {
                setNetwork(e.target.value);
                if (e.target.value === 'mainnet') setPort('8333');
                else if (e.target.value === 'testnet3') setPort('18333');
                else if (e.target.value === 'testnet4') setPort('48333');
                else if (e.target.value === 'signet') setPort('38333');
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="mainnet">Mainnet (0xf9beb4d9)</option>
              <option value="testnet3">Testnet3 (0x0b110907)</option>
              <option value="testnet4">Testnet4 (0x1c163f28)</option>
              <option value="signet">Signet (0x0a03cf40)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">Network magic bytes for message framing</p>
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Connect to Bitcoin node"
          >
            Version Handshake
          </ActionButton>

          <button
            onClick={handleGetAddr}
            disabled={loading || !host || !port}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Get Addresses
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Bitcoin Wire Protocol"
          description="The Bitcoin P2P protocol (port 8333) is used by all Bitcoin nodes to communicate. Every message has a 24-byte header with 4-byte network magic, 12-byte command name, payload length, and double-SHA256 checksum. The handshake exchanges version/verack messages revealing node software, services, and blockchain height."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Service Flags</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">NODE_NETWORK (1):</strong> Full node with complete blockchain</p>
            <p><strong className="text-slate-300">NODE_BLOOM (4):</strong> Supports BIP37 bloom filter SPV queries</p>
            <p><strong className="text-slate-300">NODE_WITNESS (8):</strong> Supports SegWit (BIP144)</p>
            <p><strong className="text-slate-300">NODE_NETWORK_LIMITED (1024):</strong> Serves last 288 blocks only (pruned)</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
