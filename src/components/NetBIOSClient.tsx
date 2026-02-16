import { useState } from 'react';

interface NetBIOSClientProps {
  onBack: () => void;
}

const SUFFIX_OPTIONS = [
  { value: 0x20, label: 'File Server (0x20)', description: 'SMB file sharing service' },
  { value: 0x00, label: 'Workstation (0x00)', description: 'Workstation service' },
  { value: 0x1b, label: 'Domain Master Browser (0x1B)', description: 'Domain master browser' },
  { value: 0x1c, label: 'Domain Controller (0x1C)', description: 'Domain controller' },
  { value: 0x1d, label: 'Master Browser (0x1D)', description: 'Local master browser' },
  { value: 0x03, label: 'Messenger (0x03)', description: 'Messenger service' },
];

export default function NetBIOSClient({ onBack }: NetBIOSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('139');
  const [calledName, setCalledName] = useState('*SMBSERVER');
  const [calledSuffix, setCalledSuffix] = useState(0x20);
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
      const response = await fetch('/api/netbios/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          calledName,
          calledSuffix,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        calledName?: string;
        calledSuffix?: number;
        calledSuffixName?: string;
        responseTypeName?: string;
        sessionEstablished?: boolean;
        message?: string;
        errorCode?: string;
        errorReason?: string;
        retargetIP?: string;
        retargetPort?: number;
      };

      if (response.ok && data.success) {
        let output = `NetBIOS Session at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Called Name:  ${data.calledName || calledName}\n`;
        output += `Suffix:       ${data.calledSuffixName || 'Unknown'}\n`;
        output += `Response:     ${data.responseTypeName || 'Unknown'}\n`;
        output += `Session:      ${data.sessionEstablished ? 'ESTABLISHED' : 'NOT ESTABLISHED'}\n`;
        if (data.message) output += `Message:      ${data.message}\n`;
        if (data.errorCode) output += `Error Code:   ${data.errorCode}\n`;
        if (data.errorReason) output += `Error Reason: ${data.errorReason}\n`;
        if (data.retargetIP) output += `Retarget:     ${data.retargetIP}:${data.retargetPort}\n`;
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

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/netbios/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        servicesFound?: number;
        totalProbed?: number;
        services?: Array<{
          suffix: string;
          suffixName: string;
          available: boolean;
          error?: string;
        }>;
      };

      if (response.ok && data.success) {
        let output = `NetBIOS Service Probe: ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Found: ${data.servicesFound}/${data.totalProbed} services\n\n`;

        if (data.services) {
          for (const svc of data.services) {
            const status = svc.available ? '\u2713' : '\u2717';
            output += `${status} ${svc.suffix} ${svc.suffixName.padEnd(24)} ${svc.available ? 'Available' : svc.error || 'Not available'}\n`;
          }
        }
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
        <h1 className="text-3xl font-bold text-white">NetBIOS Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Session Request</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="netbios-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="netbios-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="windows-server.local"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="netbios-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="netbios-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 139 (NetBIOS Session Service)</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="netbios-called" className="block text-sm font-medium text-slate-300 mb-1">
              Called Name
            </label>
            <input
              id="netbios-called"
              type="text"
              value={calledName}
              onChange={(e) => setCalledName(e.target.value)}
              placeholder="*SMBSERVER"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              aria-describedby="netbios-called-help"
            />
            <p id="netbios-called-help" className="text-xs text-slate-400 mt-1">
              *SMBSERVER is the wildcard SMB name
            </p>
          </div>

          <div>
            <label htmlFor="netbios-suffix" className="block text-sm font-medium text-slate-300 mb-1">
              Service Suffix
            </label>
            <select
              id="netbios-suffix"
              value={calledSuffix}
              onChange={(e) => setCalledSuffix(parseInt(e.target.value))}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SUFFIX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Send NetBIOS Session Request"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Send Session Request'
          )}
        </button>

        {/* Step 2: Service Probe */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Service Discovery</h2>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Probes multiple NetBIOS service suffixes to discover available services
            (Workstation, File Server, Domain Controller, etc.)
          </p>

          <button
            onClick={handleProbe}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Probe NetBIOS services"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe All Services'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About NetBIOS Session Service</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            NetBIOS Session Service (RFC 1002, port 139) provides session-oriented communication
            for Windows networking. It was the original transport for SMB/CIFS file sharing before
            direct SMB over TCP (port 445) became the standard.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Each NetBIOS name has a 16th-byte suffix indicating the service type. Common suffixes
            include 0x20 (File Server), 0x00 (Workstation), 0x1C (Domain Controller), and 0x1D
            (Master Browser). Names are encoded using first-level encoding where each byte becomes
            two bytes (nibble + 0x41).
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
