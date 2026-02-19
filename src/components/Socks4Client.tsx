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

interface Socks4ClientProps {
  onBack: () => void;
}

export default function Socks4Client({ onBack }: Socks4ClientProps) {
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('1080');
  const [destHost, setDestHost] = useState('');
  const [destPort, setDestPort] = useState('80');
  const [userId, setUserId] = useState('');
  const [useSocks4a, setUseSocks4a] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    proxyHost: [validationRules.required('Proxy host is required')],
    proxyPort: [validationRules.port()],
    destHost: [validationRules.required('Destination host is required')],
    destPort: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ proxyHost, proxyPort, destHost, destPort });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/socks4/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost,
          proxyPort: parseInt(proxyPort),
          destHost,
          destPort: parseInt(destPort),
          userId: userId || undefined,
          useSocks4a,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        granted?: boolean;
        responseCode?: number;
        responseMessage?: string;
        boundAddress?: string;
        boundPort?: number;
      };

      if (response.ok && data.success) {
        if (data.granted) {
          setResult(
            `✅ Connection Granted!\n\n` +
            `Proxy: ${proxyHost}:${proxyPort}\n` +
            `Destination: ${destHost}:${destPort}\n` +
            `Response Code: 0x${data.responseCode?.toString(16).toUpperCase()} (${data.responseCode})\n` +
            `Message: ${data.responseMessage}\n` +
            `Bound Address: ${data.boundAddress}:${data.boundPort}\n\n` +
            `The SOCKS4 proxy accepted the connection request.`
          );
        } else {
          setError(
            `❌ Connection Rejected\n\n` +
            `Response Code: 0x${data.responseCode?.toString(16).toUpperCase()} (${data.responseCode})\n` +
            `Message: ${data.responseMessage}\n\n` +
            `The SOCKS4 proxy rejected the connection request.`
          );
        }
      } else {
        setError(data.error || 'SOCKS4 connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SOCKS4 connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && proxyHost && proxyPort && destHost && destPort) {
      handleConnect();
    }
  };

  const handleExampleProxy = (proxy: string, port: string) => {
    setProxyHost(proxy);
    setProxyPort(port);
  };

  return (
    <ProtocolClientLayout title="SOCKS4 Proxy Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.SOCKS4 || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SOCKS4 Proxy Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="socks4-proxy-host"
            label="SOCKS Proxy Host"
            type="text"
            value={proxyHost}
            onChange={setProxyHost}
            onKeyDown={handleKeyDown}
            placeholder="proxy.example.com"
            required
            error={errors.proxyHost}
          />

          <FormField
            id="socks4-proxy-port"
            label="SOCKS Proxy Port"
            type="number"
            value={proxyPort}
            onChange={setProxyPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1080"
            error={errors.proxyPort}
          />
        </div>

        <SectionHeader stepNumber={2} title="Destination Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="socks4-dest-host"
            label="Destination Host"
            type="text"
            value={destHost}
            onChange={setDestHost}
            onKeyDown={handleKeyDown}
            placeholder="example.com or 93.184.216.34"
            required
            helpText="Hostname (SOCKS4a) or IP address"
            error={errors.destHost}
          />

          <FormField
            id="socks4-dest-port"
            label="Destination Port"
            type="number"
            value={destPort}
            onChange={setDestPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Target service port (e.g., 80 for HTTP)"
            error={errors.destPort}
          />

          <FormField
            id="socks4-userid"
            label="User ID"
            type="text"
            value={userId}
            onChange={setUserId}
            onKeyDown={handleKeyDown}
            placeholder="(optional)"
            optional
            helpText="Optional user ID (not used for auth)"
          />

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Protocol Version
            </label>
            <div className="flex items-center gap-4 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!useSocks4a}
                  onChange={() => setUseSocks4a(false)}
                  className="text-blue-500"
                />
                <span className="text-white text-sm">SOCKS4 (IP only)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={useSocks4a}
                  onChange={() => setUseSocks4a(true)}
                  className="text-blue-500"
                />
                <span className="text-white text-sm">SOCKS4a (Hostname support)</span>
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              SOCKS4a allows hostname resolution by proxy
            </p>
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !proxyHost || !proxyPort || !destHost || !destPort}
          loading={loading}
          ariaLabel="Test SOCKS4 connection"
        >
          Test Proxy Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SOCKS4 Protocol"
          description="SOCKS4 is a legacy protocol for proxying TCP connections through firewalls. SOCKS4a extension adds hostname resolution support. No authentication built-in (superseded by SOCKS5). Common uses: SSH tunneling (ssh -D), firewall traversal."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Proxies</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleProxy('localhost', '1080')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:1080</span>
              <span className="ml-2 text-slate-400">- Local SOCKS proxy</span>
            </button>
            <button
              onClick={() => handleExampleProxy('localhost', '9050')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:9050</span>
              <span className="ml-2 text-slate-400">- Tor SOCKS proxy (if running)</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              💡 <strong>Note:</strong> Test with SSH tunnel: <code className="bg-slate-900 px-1">ssh -D 1080 user@host</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Response Codes</h3>
          <div className="grid gap-1 text-xs">
            <div className="flex justify-between bg-slate-700 px-3 py-1 rounded">
              <span className="text-green-400 font-mono">0x5A (90)</span>
              <span className="text-slate-300">Request granted</span>
            </div>
            <div className="flex justify-between bg-slate-700 px-3 py-1 rounded">
              <span className="text-red-400 font-mono">0x5B (91)</span>
              <span className="text-slate-300">Request rejected or failed</span>
            </div>
            <div className="flex justify-between bg-slate-700 px-3 py-1 rounded">
              <span className="text-orange-400 font-mono">0x5C (92)</span>
              <span className="text-slate-300">Client not reachable</span>
            </div>
            <div className="flex justify-between bg-slate-700 px-3 py-1 rounded">
              <span className="text-yellow-400 font-mono">0x5D (93)</span>
              <span className="text-slate-300">User ID mismatch</span>
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
