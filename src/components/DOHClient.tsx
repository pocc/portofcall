import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface DOHClientProps {
  onBack: () => void;
}

const DOH_RESOLVERS = [
  { label: 'Cloudflare (1.1.1.1)', value: 'https://cloudflare-dns.com/dns-query' },
  { label: 'Google', value: 'https://dns.google/dns-query' },
  { label: 'Quad9', value: 'https://dns.quad9.net/dns-query' },
  { label: 'NextDNS', value: 'https://dns.nextdns.io/dns-query' },
];

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'PTR', 'SRV', 'ANY'];

interface DOHRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

interface DOHResult {
  success?: boolean;
  error?: string;
  domain?: string;
  resolver?: string;
  queryType?: string;
  rcode?: string;
  answers?: DOHRecord[];
  authority?: DOHRecord[];
  additional?: DOHRecord[];
  queryTimeMs?: number;
}

export default function DOHClient({ onBack }: DOHClientProps) {
  const [domain, setDomain] = useState('');
  const [recordType, setRecordType] = useState('A');
  const [resolver, setResolver] = useState(DOH_RESOLVERS[0].value);
  const [customResolver, setCustomResolver] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    domain: [validationRules.required('Domain is required')],
  });

  const activeResolver = customResolver.trim() || resolver;

  const handleQuery = async () => {
    const isValid = validateAll({ domain });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/doh/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          type: recordType,
          resolver: activeResolver,
          timeout: 10000,
        }),
      });

      const data = await response.json() as DOHResult;

      if (data.success) {
        let output = `DoH Query — ${data.domain} (${data.queryType})\n`;
        output += `Resolver: ${data.resolver}\n`;
        output += `Response: ${data.rcode}\n`;
        output += `Time: ${data.queryTimeMs}ms\n`;
        output += '='.repeat(60) + '\n\n';

        const formatSection = (label: string, records: DOHRecord[]) => {
          if (records.length === 0) return '';
          let s = `${label} (${records.length}):\n`;
          for (const r of records) {
            s += `  ${r.name.padEnd(30)} ${r.type.padEnd(8)} TTL=${r.ttl.toString().padEnd(8)} ${r.data}\n`;
          }
          return s + '\n';
        };

        output += formatSection('ANSWER', data.answers ?? []);
        output += formatSection('AUTHORITY', data.authority ?? []);
        output += formatSection('ADDITIONAL', data.additional ?? []);

        if (!data.answers?.length && !data.authority?.length) {
          output += '(No records returned)\n';
        }

        setResult(output);
      } else {
        setError(data.error || `DoH query failed: ${data.rcode}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DoH query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && domain) {
      handleQuery();
    }
  };

  return (
    <ProtocolClientLayout title="DoH Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Query Parameters" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="md:col-span-2">
            <FormField
              id="doh-domain"
              label="Domain"
              type="text"
              value={domain}
              onChange={setDomain}
              onKeyDown={handleKeyDown}
              placeholder="example.com"
              required
              error={errors.domain}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Record Type</label>
            <select
              value={recordType}
              onChange={e => setRecordType(e.target.value)}
              className="w-full bg-slate-700 border border-slate-500 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {RECORD_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Resolver</label>
            <select
              value={resolver}
              onChange={e => setResolver(e.target.value)}
              className="w-full bg-slate-700 border border-slate-500 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DOH_RESOLVERS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <FormField
              id="doh-custom"
              label="Custom Resolver URL"
              type="text"
              value={customResolver}
              onChange={setCustomResolver}
              onKeyDown={handleKeyDown}
              placeholder="https://custom.resolver/dns-query"
              optional
              helpText="Overrides the resolver dropdown if set"
            />
          </div>
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !domain}
          loading={loading}
          ariaLabel="Send DoH query"
        >
          Send Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About DNS over HTTPS (DoH)"
          description="DoH (RFC 8484) encrypts DNS queries inside HTTPS, hiding them from network observers and preventing DNS-based censorship. Unlike traditional DNS (UDP port 53), DoH uses POST requests to a well-known HTTPS endpoint with binary DNS wire format. The query and response are indistinguishable from regular HTTPS traffic."
          showKeyboardShortcut
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Queries</h3>
          <div className="grid gap-2">
            {[
              { domain: 'example.com', type: 'A', desc: 'Basic A record' },
              { domain: 'google.com', type: 'MX', desc: 'Mail exchanger records' },
              { domain: 'cloudflare.com', type: 'AAAA', desc: 'IPv6 address' },
              { domain: '_dmarc.gmail.com', type: 'TXT', desc: 'DMARC policy' },
            ].map(({ domain: d, type: t, desc }) => (
              <button
                key={`${d}-${t}`}
                onClick={() => { setDomain(d); setRecordType(t); }}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-blue-400">{d}</span>
                <span className="ml-2 text-yellow-400 font-mono">{t}</span>
                <span className="ml-2 text-slate-400">— {desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
