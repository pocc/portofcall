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

interface HTTPProxyClientProps {
  onBack: () => void;
}

export default function HTTPProxyClient({ onBack }: HTTPProxyClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3128');
  const [targetUrl, setTargetUrl] = useState('http://example.com/');
  const [targetHost, setTargetHost] = useState('example.com');
  const [targetPort, setTargetPort] = useState('443');
  const [proxyAuth, setProxyAuth] = useState('');
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
      const response = await fetch('/api/httpproxy/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          targetUrl,
          proxyAuth: proxyAuth || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isProxy?: boolean;
        proxyType?: string;
        requiresAuth?: boolean;
        authMethod?: string;
        statusCode?: number;
        statusText?: string;
        targetUrl?: string;
        proxyHeaders?: string[];
        server?: string;
        rtt?: number;
        note?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `HTTP Proxy ${data.isProxy ? 'Detected' : 'Not Detected'}`,
          '',
          `Status:     ${data.statusCode} ${data.statusText}`,
          `Proxy Type: ${data.proxyType}`,
          `Target:     ${data.targetUrl}`,
          `RTT:        ${data.rtt}ms`,
        ];

        if (data.requiresAuth) {
          lines.push(`Auth:       Required (${data.authMethod || 'unknown method'})`);
        }

        if (data.proxyHeaders?.length) {
          lines.push('', 'Proxy Headers:');
          for (const h of data.proxyHeaders) {
            lines.push(`  ${h}`);
          }
        }

        if (data.server) lines.push(`Server:     ${data.server}`);
        lines.push('');
        if (data.note) lines.push(data.note);

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

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/httpproxy/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          targetHost,
          targetPort: parseInt(targetPort),
          proxyAuth: proxyAuth || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        tunnelEstablished?: boolean;
        requiresAuth?: boolean;
        statusCode?: number;
        statusText?: string;
        target?: string;
        authMethod?: string;
        rtt?: number;
        note?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `CONNECT Tunnel ${data.tunnelEstablished ? 'Established' : 'Failed'}`,
          '',
          `Status:  ${data.statusCode} ${data.statusText}`,
          `Target:  ${data.target}`,
          `RTT:     ${data.rtt}ms`,
        ];

        if (data.requiresAuth) {
          lines.push(`Auth:    Required (${data.authMethod || 'unknown'})`);
        }

        lines.push('');
        if (data.note) lines.push(data.note);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'CONNECT test failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
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
    <ProtocolClientLayout title="HTTP Proxy Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.HTTPProxy || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Proxy Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="proxy-host"
            label="Proxy Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="proxy.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="proxy-port"
            label="Proxy Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Common: 3128 (Squid), 8080, 8888"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="proxy-auth"
            label="Proxy Auth (user:password)"
            type="text"
            value={proxyAuth}
            onChange={setProxyAuth}
            onKeyDown={handleKeyDown}
            placeholder="username:password (optional)"
            helpText="Sent as Basic auth via Proxy-Authorization header"
          />
        </div>

        <SectionHeader stepNumber={2} title="Forward Proxy Test" />

        <div className="mb-4">
          <FormField
            id="proxy-target-url"
            label="Target URL"
            type="text"
            value={targetUrl}
            onChange={setTargetUrl}
            onKeyDown={handleKeyDown}
            placeholder="http://example.com/"
            helpText="URL to request through the proxy (GET)"
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test HTTP forward proxy"
        >
          Test Forward Proxy
        </ActionButton>

        <div className="mt-8 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={3} title="CONNECT Tunnel Test" />

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField
              id="proxy-connect-host"
              label="Tunnel Target Host"
              type="text"
              value={targetHost}
              onChange={setTargetHost}
              placeholder="example.com"
              helpText="Host to tunnel to via CONNECT"
            />

            <FormField
              id="proxy-connect-port"
              label="Tunnel Target Port"
              type="number"
              value={targetPort}
              onChange={setTargetPort}
              min="1"
              max="65535"
              helpText="Port to tunnel to (usually 443)"
            />
          </div>

          <button
            onClick={handleConnect}
            disabled={loading || !host || !port}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Test CONNECT Tunnel
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About HTTP Proxy Protocol"
          description="HTTP proxies (RFC 9110) support two modes: forward proxy (sends absolute-URI requests like GET http://...) and CONNECT tunnel (creates a TCP tunnel for HTTPS and other protocols). Common ports are 3128 (Squid), 8080, and 8888. This complements SOCKS4/SOCKS5 proxy testing with HTTP-specific capabilities."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Proxy Comparison</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">HTTP Proxy:</strong> Application-layer, understands HTTP, can cache and filter</p>
            <p><strong className="text-slate-300">SOCKS4:</strong> Transport-layer TCP proxy, no authentication support</p>
            <p><strong className="text-slate-300">SOCKS5:</strong> Transport-layer TCP/UDP proxy with auth and DNS resolution</p>
            <p><strong className="text-slate-300">CONNECT:</strong> HTTP method to establish a raw TCP tunnel through an HTTP proxy</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
