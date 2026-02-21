import { useState } from 'react';
import ProtocolClientLayout from './ProtocolClientLayout';

interface EPPClientProps {
  onBack: () => void;
}

export default function EPPClient({ onBack }: EPPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('700');
  const [clid, setClid] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
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
      const response = await fetch('/api/epp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        code?: number;
        data?: Record<string, unknown>;
      };

      if (response.ok && data.success) {
        setResult(`✓ Connected to EPP server at ${host}:${port}

Result Code: ${data.code}
Message: ${data.message}

Server Greeting (first 300 chars):
${data.data?.greeting || 'N/A'}

Hello Response (first 300 chars):
${data.data?.serverResponse || 'N/A'}`);
      } else {
        setError(data.error || data.message || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!clid) {
      setError('Client ID is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/epp/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          clid,
          pw: password,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        code?: number;
        data?: Record<string, unknown>;
      };

      if (response.ok && data.success) {
        setResult(`✓ EPP Login Successful

Result Code: ${data.code}
Message: ${data.message}

Client ID: ${clid}

Login Response (first 300 chars):
${data.data?.loginResponse || 'N/A'}`);
      } else {
        setError(data.error || data.message || `Login failed (code: ${data.code})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDomainCheck = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!clid) {
      setError('Client ID is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    if (!domain) {
      setError('Domain name is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/epp/domain-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          clid,
          pw: password,
          domain,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        code?: number;
        data?: Record<string, unknown>;
      };

      if (response.ok && data.success) {
        const availability = data.data?.available === true
          ? '✓ AVAILABLE'
          : data.data?.available === false
          ? '✗ NOT AVAILABLE'
          : 'UNKNOWN';

        setResult(`✓ Domain Check Complete

Domain: ${domain}
Status: ${availability}

Result Code: ${data.code}
Message: ${data.message}

Response (first 300 chars):
${data.data?.response || 'N/A'}`);
      } else {
        setError(data.error || data.message || `Domain check failed (code: ${data.code})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Domain check failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtocolClientLayout
      title="EPP (Extensible Provisioning Protocol)"
      onBack={onBack}
    >
      <div className="space-y-6">
        {/* Description */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-4">
          <p className="text-slate-300 text-sm">
            Domain registration provisioning protocol (RFCs 5730-5734). Connect to EPP servers, login with credentials, and check domain availability. Default port: 700.
          </p>
        </div>

        {/* Connection Settings */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Connection Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                EPP Server Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="epp.example.com"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="700"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleConnect}
              disabled={loading || !host}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors"
            >
              {loading ? 'Connecting...' : 'Connect & Send Hello'}
            </button>
          </div>
        </div>

        {/* Authentication */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Authentication</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Client ID (Username)
              </label>
              <input
                type="text"
                value={clid}
                onChange={(e) => setClid(e.target.value)}
                placeholder="registrar-clid"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={loading || !host || !clid || !password}
              className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </div>

        {/* Domain Check */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Domain Check</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Domain Name
              </label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleDomainCheck}
              disabled={loading || !host || !clid || !password || !domain}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors"
            >
              {loading ? 'Checking...' : 'Check Domain Availability'}
            </button>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="bg-green-900/30 border border-green-600/50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-green-400 mb-4">✓ Success</h3>
            <pre className="text-sm text-green-100 whitespace-pre-wrap font-mono overflow-x-auto">
              {result}
            </pre>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-600/50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-red-400 mb-4">✗ Error</h3>
            <p className="text-sm text-red-100">{error}</p>
          </div>
        )}

        {/* Info */}
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">📘 EPP Protocol Info</h4>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• <strong>RFCs:</strong> 5730 (base), 5731 (domain), 5732 (host), 5733 (contact), 5734 (TCP transport)</li>
            <li>• <strong>Port:</strong> 700 (standard)</li>
            <li>• <strong>Protocol:</strong> XML-based with 4-byte length-prefixed framing</li>
            <li>• <strong>Commands:</strong> hello, login, check, info, create, renew, transfer, update, delete</li>
            <li>• <strong>Use Case:</strong> Domain registration provisioning between registrars and registries</li>
            <li>• <strong>Note:</strong> Requires valid registrar credentials to test domain operations</li>
          </ul>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
