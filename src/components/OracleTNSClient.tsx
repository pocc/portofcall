import { useState } from 'react';

interface OracleTNSClientProps {
  onBack: () => void;
}

export default function OracleTNSClient({ onBack }: OracleTNSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1521');
  const [serviceName, setServiceName] = useState('ORCL');
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
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
      const response = await fetch('/api/oracle-tns/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          serviceName,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        serviceName?: string;
        responseType?: string;
        accepted?: boolean;
        tnsVersion?: number;
        compatibleVersion?: number;
        sduSize?: number;
        tduSize?: number;
        oracleVersion?: string;
        errorCode?: string;
        refuseData?: string;
        redirectData?: string;
        redirected?: boolean;
        listenerDetected?: boolean;
        message?: string;
        rawHeader?: string;
      };

      if (response.ok && data.success) {
        let text = `Oracle TNS Connection Test — ${host}:${port}\n`;
        text += `Service Name:    ${serviceName}\n`;
        text += `Response Type:   ${data.responseType}\n\n`;

        if (data.accepted) {
          text += `Status:          ACCEPTED\n`;
          if (data.tnsVersion) text += `TNS Version:     ${data.tnsVersion}\n`;
          if (data.compatibleVersion) text += `Compatible Ver:  ${data.compatibleVersion}\n`;
          if (data.sduSize) text += `SDU Size:        ${data.sduSize} bytes\n`;
          if (data.tduSize) text += `TDU Size:        ${data.tduSize} bytes\n`;
        } else if (data.redirected) {
          text += `Status:          REDIRECTED\n`;
          if (data.oracleVersion) text += `Oracle Version:  ${data.oracleVersion}\n`;
          if (data.redirectData) text += `Redirect To:     ${data.redirectData}\n`;
        } else {
          text += `Status:          REFUSED\n`;
          if (data.oracleVersion) text += `Oracle Version:  ${data.oracleVersion}\n`;
          if (data.errorCode) text += `Error Code:      ${data.errorCode}\n`;
          if (data.refuseData) text += `Refuse Data:     ${data.refuseData}\n`;
        }

        if (data.listenerDetected) {
          text += `\nOracle listener detected on ${host}:${port}`;
        }

        if (data.rawHeader) {
          text += `\n\nRaw Header:  ${data.rawHeader}`;
        }

        setResult(text);
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

    setProbing(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/oracle-tns/probe', {
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
        isOracle?: boolean;
        responseType?: string;
        oracleVersion?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        let text = `Oracle TNS Listener Probe — ${host}:${port}\n\n`;
        text += `Oracle Listener:  ${data.isOracle ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Response Type:    ${data.responseType}\n`;
        if (data.oracleVersion) text += `Oracle Version:   ${data.oracleVersion}\n`;
        text += `\n${data.message}`;
        setResult(text);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setProbing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && !probing && host) {
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
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Oracle TNS Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="tns-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="tns-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="oracle-db.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="tns-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="tns-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 1521</p>
          </div>

          <div>
            <label htmlFor="tns-service" className="block text-sm font-medium text-slate-300 mb-1">
              Service Name
            </label>
            <input
              id="tns-service"
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ORCL"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: ORCL</p>
          </div>
        </div>

        {/* Step 2: Actions */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">2</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Action</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || probing || !host}
            className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Test Oracle TNS connection with service name"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Connect to Service'
            )}
          </button>

          <button
            onClick={handleProbe}
            disabled={loading || probing || !host}
            className="bg-slate-600 hover:bg-slate-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Probe for Oracle TNS listener"
          >
            {probing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Listener'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Oracle TNS</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            TNS (Transparent Network Substrate) is Oracle Database's native wire protocol for
            client-server communication. The TNS listener on port 1521 handles incoming connection
            requests and routes them to the appropriate database instance. This tool performs the
            TNS Connect handshake to detect Oracle listeners, probe for version information, and
            test service name accessibility without requiring authentication credentials.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 1521: Standard listener port</div>
            <div>Port 1522-1530: Common alt ports</div>
            <div>TNS v316: Oracle 12c+ clients</div>
            <div>TNS v300: Oracle 10g+ compatible</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
            — <strong>Connect</strong> tests a specific service, <strong>Probe</strong> just detects the listener
          </p>
        </div>
      </div>
    </div>
  );
}
