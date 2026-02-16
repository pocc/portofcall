import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface BGPClientProps {
  onBack: () => void;
}

export default function BGPClient({ onBack }: BGPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('179');
  const [localAS, setLocalAS] = useState('65000');
  const [routerId, setRouterId] = useState('10.0.0.1');
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
      const response = await fetch('/api/bgp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          localAS: parseInt(localAS),
          routerId,
          holdTime: 90,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        peerOpen?: {
          version?: number;
          peerAS?: number;
          holdTime?: number;
          routerId?: string;
          capabilities?: string[];
        } | null;
        sessionEstablished?: boolean;
        notification?: {
          errorCode?: number;
          errorSubcode?: number;
          errorName?: string;
          errorDetail?: string;
        } | null;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to BGP speaker!\n\n`;
        resultText += `Host:              ${data.host}:${data.port}\n`;
        resultText += `RTT:               ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;

        if (data.peerOpen) {
          resultText += `\n--- Peer OPEN Message ---\n`;
          resultText += `BGP Version:       ${data.peerOpen.version}\n`;
          resultText += `Peer AS:           ${data.peerOpen.peerAS}\n`;
          resultText += `Hold Time:         ${data.peerOpen.holdTime}s\n`;
          resultText += `Router ID:         ${data.peerOpen.routerId}\n`;
          resultText += `Session:           ${data.sessionEstablished ? 'ESTABLISHED' : 'OpenConfirm (KEEPALIVE pending)'}\n`;

          if (data.peerOpen.capabilities && data.peerOpen.capabilities.length > 0) {
            resultText += `\n--- Capabilities ---\n`;
            for (const cap of data.peerOpen.capabilities) {
              resultText += `  - ${cap}\n`;
            }
          }
        } else {
          resultText += `\nNo OPEN message received from peer.\n`;
        }

        if (data.notification) {
          resultText += `\n--- NOTIFICATION ---\n`;
          resultText += `Error:             ${data.notification.errorName} (${data.notification.errorCode}/${data.notification.errorSubcode})\n`;
          resultText += `Detail:            ${data.notification.errorDetail}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Connection failed');
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
    <ProtocolClientLayout title="BGP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="BGP Peer Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="bgp-host"
            label="Peer Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="router.example.com"
            required
            helpText="BGP speaker hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="bgp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 179 (standard BGP port)"
            error={errors.port}
          />

          <FormField
            id="bgp-local-as"
            label="Local AS Number"
            type="number"
            value={localAS}
            onChange={setLocalAS}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Your autonomous system number (1-65535)"
          />

          <FormField
            id="bgp-router-id"
            label="Router ID"
            type="text"
            value={routerId}
            onChange={setRouterId}
            onKeyDown={handleKeyDown}
            placeholder="10.0.0.1"
            helpText="BGP identifier in IPv4 format"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test BGP peer connection"
        >
          Test Connection (OPEN Handshake)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About BGP Protocol"
          description="BGP (Border Gateway Protocol, RFC 4271) is the routing protocol that makes the Internet work. It exchanges routing information between autonomous systems using a TCP connection on port 179. This client sends an OPEN message to detect the BGP speaker's version, AS number, router ID, and capabilities."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('179');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:179</span>
              <span className="ml-2 text-slate-400">- Local BGP speaker (BIRD/GoBGP/FRR)</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start with GoBGP:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 179:179 osrg/gobgp</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">BGP-4 (binary, path-vector routing)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">179</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">RFC:</td>
                  <td className="py-2 px-2">RFC 4271 (BGP-4)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Transport:</td>
                  <td className="py-2 px-2">TCP (reliable delivery)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">TCP MD5 (RFC 2385) or TCP-AO (RFC 5925)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Scale:</td>
                  <td className="py-2 px-2">Full Internet table: ~1M+ routes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">BGP Message Types</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Type</th>
                  <th className="text-left py-2 px-2 text-slate-300">Name</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">1</td>
                  <td className="py-2 px-2">OPEN</td>
                  <td className="py-2 px-2">Session initialization (version, AS, hold time)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">2</td>
                  <td className="py-2 px-2">UPDATE</td>
                  <td className="py-2 px-2">Route advertisement / withdrawal</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-red-400">3</td>
                  <td className="py-2 px-2">NOTIFICATION</td>
                  <td className="py-2 px-2">Error notification (closes session)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-green-400">4</td>
                  <td className="py-2 px-2">KEEPALIVE</td>
                  <td className="py-2 px-2">Periodic liveness check</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">AS Number Ranges</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Range</th>
                  <th className="text-left py-2 px-2 text-slate-300">Use</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">1-23455</td>
                  <td className="py-2 px-2">Public AS numbers (IANA assigned)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">23456</td>
                  <td className="py-2 px-2">AS_TRANS (RFC 6793)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">64512-65534</td>
                  <td className="py-2 px-2">Private AS numbers (RFC 6996)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-blue-400">65535</td>
                  <td className="py-2 px-2">Reserved</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> BGP is a critical Internet infrastructure protocol. Only connect to
              BGP speakers you are authorized to test. This tool sends an OPEN message for version/capability
              detection — it does <strong>not</strong> advertise or withdraw routes.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
