import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SOAPClientProps {
  onBack: () => void;
}

const SAMPLE_ENVELOPES = {
  soap11: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetServerInfo xmlns="http://example.com/service"/>
  </soap:Body>
</soap:Envelope>`,
  soap12: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <GetServerInfo xmlns="http://example.com/service"/>
  </soap:Body>
</soap:Envelope>`,
  weather: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetWeather xmlns="http://www.webserviceX.NET">
      <CityName>New York</CityName>
      <CountryName>United States</CountryName>
    </GetWeather>
  </soap:Body>
</soap:Envelope>`,
  calculator: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Add xmlns="http://tempuri.org/">
      <intA>5</intA>
      <intB>3</intB>
    </Add>
  </soap:Body>
</soap:Envelope>`,
};

export default function SOAPClient({ onBack }: SOAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('80');
  const [path, setPath] = useState('/');
  const [soapAction, setSoapAction] = useState('');
  const [soapBody, setSoapBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleCall = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!soapBody.trim()) {
      setError('SOAP XML envelope is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/soap/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          path,
          soapAction: soapAction || undefined,
          body: soapBody,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        body?: string;
        parsed?: {
          isSoap?: boolean;
          hasFault?: boolean;
          faultCode?: string;
          faultString?: string;
          soapVersion?: string;
        };
      };

      if (data.statusCode) {
        let output = `SOAP Response (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `HTTP Status: ${data.statusCode}\n`;

        if (data.parsed) {
          output += `SOAP Detected: ${data.parsed.isSoap ? 'Yes' : 'No'}\n`;
          if (data.parsed.soapVersion) {
            output += `SOAP Version: ${data.parsed.soapVersion}\n`;
          }
          if (data.parsed.hasFault) {
            output += `\nSOAP Fault:\n`;
            output += `  Code: ${data.parsed.faultCode || 'unknown'}\n`;
            output += `  Message: ${data.parsed.faultString || 'unknown'}\n`;
          }
        }

        output += `\nResponse Body:\n${'-'.repeat(30)}\n`;
        output += data.body || '(empty)';

        setResult(output);
      } else {
        setError(data.error || 'SOAP call failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SOAP call failed');
    } finally {
      setLoading(false);
    }
  };

  const handleWsdl = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/soap/wsdl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          path,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        isWsdl?: boolean;
        serviceName?: string;
        operations?: string[];
        body?: string;
      };

      if (data.statusCode) {
        let output = `WSDL Discovery (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `HTTP Status: ${data.statusCode}\n`;
        output += `WSDL Detected: ${data.isWsdl ? 'Yes' : 'No'}\n`;

        if (data.isWsdl) {
          if (data.serviceName) {
            output += `Service: ${data.serviceName}\n`;
          }
          if (data.operations && data.operations.length > 0) {
            output += `\nOperations (${data.operations.length}):\n`;
            for (const op of data.operations) {
              output += `  - ${op}\n`;
            }
          }
        }

        output += `\nWSDL Body:\n${'-'.repeat(30)}\n`;
        output += data.body || '(empty)';

        setResult(output);
      } else {
        setError(data.error || 'WSDL fetch failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WSDL fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleCall();
    }
  };

  const handleQuickTemplate = (key: keyof typeof SAMPLE_ENVELOPES) => {
    setSoapBody(SAMPLE_ENVELOPES[key]);
  };

  return (
    <ProtocolClientLayout title="SOAP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="soap-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ws.example.com"
            required
            helpText="SOAP web service hostname or IP"
            error={errors.host}
          />

          <FormField
            id="soap-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 80 (HTTP), 8080 (alt)"
            error={errors.port}
          />

          <FormField
            id="soap-path"
            label="Endpoint Path"
            type="text"
            value={path}
            onChange={setPath}
            onKeyDown={handleKeyDown}
            placeholder="/service"
            helpText="SOAP service endpoint path"
          />
        </div>

        <div className="mb-6">
          <FormField
            id="soap-action"
            label="SOAPAction"
            type="text"
            value={soapAction}
            onChange={setSoapAction}
            onKeyDown={handleKeyDown}
            placeholder="http://example.com/GetUser"
            optional
            helpText="SOAPAction HTTP header (SOAP 1.1)"
          />
        </div>

        <ActionButton
          onClick={handleWsdl}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Fetch WSDL document"
          variant="success"
        >
          Fetch WSDL
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="SOAP Envelope" color="purple" />

        <div className="mb-4">
          <label htmlFor="soap-body" className="block text-sm font-medium text-slate-300 mb-1">
            XML Envelope <span className="text-xs text-slate-400">(required)</span>
          </label>
          <textarea
            id="soap-body"
            value={soapBody}
            onChange={(e) => setSoapBody(e.target.value)}
            placeholder={'<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    ...\n  </soap:Body>\n</soap:Envelope>'}
            rows={8}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleCall}
          disabled={loading || !host || !soapBody.trim()}
          loading={loading}
          ariaLabel="Send SOAP request"
          variant="primary"
        >
          Send SOAP Request
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Templates</h3>
          <div className="grid gap-2">
            {[
              { key: 'soap11' as const, label: 'SOAP 1.1 Envelope' },
              { key: 'soap12' as const, label: 'SOAP 1.2 Envelope' },
              { key: 'calculator' as const, label: 'Calculator Add (tempuri.org)' },
              { key: 'weather' as const, label: 'Weather Service' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleQuickTemplate(key)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About SOAP"
          description="SOAP (Simple Object Access Protocol) is an XML-based messaging protocol for web services. While declining in favor of REST and gRPC, SOAP remains widely used in enterprise environments (banking, healthcare, government). This client sends raw HTTP/1.1 POST requests with XML SOAP envelopes over TCP sockets. WSDL discovery fetches the service description document to enumerate available operations."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
