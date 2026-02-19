import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface DCERPCClientProps {
  onBack: () => void;
}

const WELL_KNOWN_INTERFACES = [
  { key: 'epm', name: 'Endpoint Mapper (EPM)', uuid: 'e1af8308-5d1f-11c9-91a4-08002b14a0fa', version: 3 },
  { key: 'samr', name: 'Security Account Manager (SAMR)', uuid: '12345778-1234-abcd-ef00-0123456789ac', version: 1 },
  { key: 'lsarpc', name: 'Local Security Authority (LSARPC)', uuid: '12345778-1234-abcd-ef00-0123456789ab', version: 0 },
  { key: 'srvsvc', name: 'Server Service (SRVSVC)', uuid: '4b324fc8-1670-01d3-1278-5a47bf6ee188', version: 3 },
  { key: 'wkssvc', name: 'Workstation Service (WKSSVC)', uuid: '6bffd098-a112-3610-9833-46c3f87e345a', version: 1 },
  { key: 'netlogon', name: 'Netlogon Service', uuid: '12345678-1234-abcd-ef00-01234567cffb', version: 1 },
  { key: 'winreg', name: 'Windows Registry (WINREG)', uuid: '338cd001-2244-31f1-aaaa-900038001003', version: 1 },
  { key: 'svcctl', name: 'Service Control Manager (SVCCTL)', uuid: '367abb81-9844-35f1-ad32-98f038001003', version: 2 },
];

export default function DCERPCClient({ onBack }: DCERPCClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('135');
  const [selectedInterface, setSelectedInterface] = useState('epm');
  const [customUuid, setCustomUuid] = useState('');
  const [customVersion, setCustomVersion] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dcerpc/connect', {
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
        rtt?: number;
        protocol?: {
          version?: string;
          maxXmitFrag?: number;
          maxRecvFrag?: number;
          assocGroup?: number;
          secondaryAddr?: string;
        };
        epmResult?: {
          accepted?: boolean;
          result?: string;
          transferSyntax?: string;
        };
      };

      if (response.ok && data.success) {
        const p = data.protocol;
        let output = `Connected to DCE/RPC service at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Protocol Version: ${p?.version || 'Unknown'}\n`;
        output += `Max Xmit Frag:    ${p?.maxXmitFrag ?? 'Unknown'}\n`;
        output += `Max Recv Frag:    ${p?.maxRecvFrag ?? 'Unknown'}\n`;
        output += `Assoc Group:      ${p?.assocGroup ?? 'Unknown'}\n`;
        if (p?.secondaryAddr) {
          output += `Secondary Addr:   ${p.secondaryAddr}\n`;
        }
        output += `\nEndpoint Mapper:\n`;
        output += `  Accepted: ${data.epmResult?.accepted ? 'Yes' : 'No'}\n`;
        output += `  Result:   ${data.epmResult?.result || 'Unknown'}\n`;
        setResult(output);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleProbe = async (interfaceKey?: string) => {
    if (!host) {
      setError('Host is required');
      return;
    }

    const target = interfaceKey || selectedInterface;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const payload: Record<string, unknown> = {
        host,
        port: parseInt(port),
        timeout: 10000,
      };

      if (target === 'custom') {
        if (!customUuid.trim()) {
          setError('Custom UUID is required');
          setLoading(false);
          return;
        }
        payload.interfaceUuid = customUuid.trim();
        payload.interfaceVersion = parseInt(customVersion) || 0;
      } else {
        payload.interfaceName = target;
      }

      const response = await fetch('/api/dcerpc/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        available?: boolean;
        response?: string;
        result?: string;
        reason?: string;
        secondaryAddr?: string;
        maxXmitFrag?: number;
        maxRecvFrag?: number;
        interface?: {
          name?: string;
          uuid?: string;
          version?: number;
        };
      };

      if (response.ok && data.success) {
        const iface = data.interface;
        let output = `Probed ${iface?.name || 'interface'} at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Interface: ${iface?.name || 'Unknown'}\n`;
        output += `UUID:      ${iface?.uuid || 'Unknown'}\n`;
        output += `Version:   ${iface?.version ?? 'Unknown'}\n\n`;
        output += `Available: ${data.available ? 'YES' : 'NO'}\n`;
        output += `Response:  ${data.response || 'Unknown'}\n`;
        if (data.result) output += `Result:    ${data.result}\n`;
        if (data.reason) output += `Reason:    ${data.reason}\n`;
        if (data.secondaryAddr) output += `Sec Addr:  ${data.secondaryAddr}\n`;
        setResult(output);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
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
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">DCE/RPC Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.DCERPC || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="dcerpc-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="dcerpc-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="windows-server.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="dcerpc-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="dcerpc-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 135 (Endpoint Mapper)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test DCE/RPC connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection (EPM Bind)'
          )}
        </button>

        {/* Step 2: Interface Probe */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Probe RPC Interface</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="dcerpc-interface" className="block text-sm font-medium text-slate-300 mb-1">
              Interface
            </label>
            <select
              id="dcerpc-interface"
              value={selectedInterface}
              onChange={(e) => setSelectedInterface(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {WELL_KNOWN_INTERFACES.map((iface) => (
                <option key={iface.key} value={iface.key}>
                  {iface.name} (v{iface.version})
                </option>
              ))}
              <option value="custom">Custom UUID...</option>
            </select>
          </div>

          {selectedInterface === 'custom' && (
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="dcerpc-uuid" className="block text-sm font-medium text-slate-300 mb-1">
                  Interface UUID <span className="text-red-400" aria-label="required">*</span>
                </label>
                <input
                  id="dcerpc-uuid"
                  type="text"
                  value={customUuid}
                  onChange={(e) => setCustomUuid(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
              <div>
                <label htmlFor="dcerpc-version" className="block text-sm font-medium text-slate-300 mb-1">
                  Version
                </label>
                <input
                  id="dcerpc-version"
                  type="number"
                  value={customVersion}
                  onChange={(e) => setCustomVersion(e.target.value)}
                  min="0"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Quick probe buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {WELL_KNOWN_INTERFACES.slice(0, 6).map((iface) => (
              <button
                key={iface.key}
                onClick={() => handleProbe(iface.key)}
                disabled={loading || !host}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs font-mono rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600"
                title={`${iface.uuid} v${iface.version}`}
              >
                {iface.key.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleProbe()}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Probe RPC interface"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Interface'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">&#x2715;</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">&#x2713;</span>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About DCE/RPC</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            DCE/RPC (Distributed Computing Environment / Remote Procedure Calls) is the foundation
            of Windows networking. The Endpoint Mapper (EPM) service on port 135 acts as a directory
            for RPC services, allowing clients to discover which interfaces are available on a server.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            The protocol uses a binary PDU format with Bind/Bind Ack handshakes for interface
            negotiation. Each RPC service is identified by a UUID and version number. Common services
            include SAMR (user management), LSARPC (security policy), SRVSVC (file shares), and
            SVCCTL (service control).
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
