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

interface WhoisClientProps {
  onBack: () => void;
}

export default function WhoisClient({ onBack }: WhoisClientProps) {
  const [domain, setDomain] = useState('');
  const [server, setServer] = useState('');
  const [port, setPort] = useState('43');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    domain: [validationRules.required('Domain is required')],
    port: [validationRules.port()],
  });

  const handleLookup = async () => {
    const isValid = validateAll({ domain, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/whois/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          server: server || undefined,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        domain?: string;
        server?: string;
        response?: string;
      };

      if (response.ok && data.success) {
        setResult(
          `WHOIS lookup for: ${data.domain}\n` +
          `Server: ${data.server}\n` +
          `${'='.repeat(60)}\n\n` +
          `${data.response}`
        );
      } else {
        setError(data.error || 'WHOIS lookup failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WHOIS lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && domain) {
      handleLookup();
    }
  };

  const handleExampleDomain = (exampleDomain: string) => {
    setDomain(exampleDomain);
    setServer('');
  };

  return (
    <ProtocolClientLayout title="WHOIS Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Whois || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Domain Information" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="md:col-span-2">
            <FormField
              id="whois-domain"
              label="Domain Name"
              type="text"
              value={domain}
              onChange={setDomain}
              onKeyDown={handleKeyDown}
              placeholder="example.com"
              required
              helpText="Enter a domain name to look up registration information"
              error={errors.domain}
            />
          </div>

          <FormField
            id="whois-server"
            label="WHOIS Server"
            type="text"
            value={server}
            onChange={setServer}
            onKeyDown={handleKeyDown}
            placeholder="Auto-detect"
            optional
            helpText="Leave blank to auto-select based on TLD"
          />

          <FormField
            id="whois-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 43 (standard WHOIS port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleLookup}
          disabled={loading || !domain}
          loading={loading}
          ariaLabel="Perform WHOIS lookup"
        >
          Lookup Domain
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About WHOIS Protocol"
          description="WHOIS (RFC 3912) provides domain registration information including registrar, creation date, expiration date, and nameservers. Port 43 is the standard WHOIS port. The protocol is simple: send a domain name, receive text information."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Domains</h3>
          <div className="grid gap-2">
            {[
              { domain: 'example.com', desc: 'Classic example domain' },
              { domain: 'google.com', desc: 'Popular .com domain' },
              { domain: 'wikipedia.org', desc: '.org domain' },
              { domain: 'mit.edu', desc: 'Educational institution' },
            ].map(({ domain: exampleDomain, desc }) => (
              <button
                key={exampleDomain}
                onClick={() => handleExampleDomain(exampleDomain)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-blue-400">{exampleDomain}</span>
                <span className="ml-2 text-slate-400">- {desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
