import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CoAPClientProps {
  onBack: () => void;
}

const COAP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

export default function CoAPClient({ onBack }: CoAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5683');
  const [path, setPath] = useState('/');
  const [method, setMethod] = useState('GET');
  const [payload, setPayload] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleDiscover = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/coap/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        resources?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [`CoAP Resource Discovery — ${host}:${port}`, `RTT: ${data.rtt}ms`, ''];
        if (data.resources && data.resources.length > 0) {
          lines.push('Resources:');
          data.resources.forEach(r => lines.push(`  ${r}`));
        } else {
          lines.push('No resources discovered.');
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Discovery failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/coap/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          method,
          path,
          payload: payload || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: string;
        payload?: string;
        contentFormat?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `CoAP ${method} ${path}\n` +
          `Status: ${data.statusCode}\n` +
          `RTT:    ${data.rtt}ms\n` +
          (data.contentFormat ? `Format: ${data.contentFormat}\n` : '') +
          (data.payload ? `\nPayload:\n${data.payload}` : '')
        );
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
      handleRequest();
    }
  };

  return (
    <ProtocolClientLayout title="CoAP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="CoAP Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="coap-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="coap.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="coap-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5683 (CoAP) / 5684 (CoAPS)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Request" />

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div>
            <label htmlFor="coap-method" className="block text-sm font-medium text-slate-300 mb-1">Method</label>
            <select
              id="coap-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {COAP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <FormField
              id="coap-path"
              label="Path"
              type="text"
              value={path}
              onChange={setPath}
              onKeyDown={handleKeyDown}
              placeholder="/"
              helpText="Resource path (e.g. /temperature)"
            />
          </div>
        </div>

        <div className="mb-6">
          <FormField
            id="coap-payload"
            label="Payload (optional)"
            type="text"
            value={payload}
            onChange={setPayload}
            onKeyDown={handleKeyDown}
            placeholder="Request body for POST/PUT"
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleRequest}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Send CoAP request"
          >
            Send Request
          </ActionButton>
          <button
            onClick={handleDiscover}
            disabled={loading || !host || !port}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Discover Resources
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About CoAP (Constrained Application Protocol)"
          description="CoAP (RFC 7252) is a lightweight RESTful protocol designed for IoT and constrained devices. It uses the same methods as HTTP (GET, POST, PUT, DELETE) but in a compact binary format. The TCP variant (RFC 8323) wraps CoAP messages with a 2-byte length prefix for reliable delivery. Resource discovery uses the /.well-known/core endpoint with application/link-format content."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
