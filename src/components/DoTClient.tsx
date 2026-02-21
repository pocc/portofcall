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

interface DoTClientProps {
  onBack: () => void;
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'PTR', 'ANY'];

const DOT_SERVERS = [
  { name: 'Cloudflare', host: '1.1.1.1', description: 'Fast, privacy-focused' },
  { name: 'Google', host: '8.8.8.8', description: 'Reliable, global' },
  { name: 'Quad9', host: '9.9.9.9', description: 'Security-focused, malware blocking' },
  { name: 'Cloudflare Family', host: '1.1.1.3', description: 'Blocks malware + adult content' },
];

export default function DoTClient({ onBack }: DoTClientProps) {
  const [domain, setDomain] = useState('');
  const [server, setServer] = useState('1.1.1.1');
  const [port, setPort] = useState('853');
  const [recordType, setRecordType] = useState('A');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    domain: [validationRules.required('Domain is required')],
    port: [validationRules.port()],
  });

  const handleQuery = async () => {
    const isValid = validateAll({ domain, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          server,
          port: parseInt(port, 10),
          type: recordType,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        encrypted?: boolean;
        protocol?: string;
        domain?: string;
        server?: string;
        port?: number;
        queryType?: string;
        rtt?: number;
        connectTime?: number;
        rcode?: string;
        flags?: {
          qr?: boolean;
          aa?: boolean;
          tc?: boolean;
          rd?: boolean;
          ra?: boolean;
        };
        questions?: number;
        answers?: Array<{
          name: string;
          type: string;
          ttl: number;
          data: string;
        }>;
        authority?: Array<{
          name: string;
          type: string;
          ttl: number;
          data: string;
        }>;
        additional?: Array<{
          name: string;
          type: string;
          ttl: number;
          data: string;
        }>;
      };

      if (response.ok && data.success) {
        let resultText = `DNS over TLS Query Result\n`;
        resultText += `${'─'.repeat(40)}\n\n`;
        resultText += `🔒 Encrypted:      Yes (TLS)\n`;
        resultText += `Server:            ${data.server}:${data.port}\n`;
        resultText += `Domain:            ${data.domain}\n`;
        resultText += `Query Type:        ${data.queryType}\n`;
        resultText += `Response Code:     ${data.rcode}\n`;
        resultText += `RTT:               ${data.rtt}ms (TLS connect: ${data.connectTime}ms)\n`;

        if (data.flags) {
          const flagStr = [
            data.flags.qr ? 'QR' : '',
            data.flags.aa ? 'AA' : '',
            data.flags.tc ? 'TC' : '',
            data.flags.rd ? 'RD' : '',
            data.flags.ra ? 'RA' : '',
          ].filter(Boolean).join(' ');
          resultText += `Flags:             ${flagStr}\n`;
        }

        if (data.answers && data.answers.length > 0) {
          resultText += `\n--- Answers (${data.answers.length}) ---\n`;
          for (const record of data.answers) {
            resultText += `  ${record.name.padEnd(30)} ${record.type.padEnd(6)} TTL=${String(record.ttl).padEnd(6)} ${record.data}\n`;
          }
        } else {
          resultText += `\nNo answer records returned.\n`;
        }

        if (data.authority && data.authority.length > 0) {
          resultText += `\n--- Authority (${data.authority.length}) ---\n`;
          for (const record of data.authority) {
            resultText += `  ${record.name.padEnd(30)} ${record.type.padEnd(6)} TTL=${String(record.ttl).padEnd(6)} ${record.data}\n`;
          }
        }

        if (data.additional && data.additional.length > 0) {
          resultText += `\n--- Additional (${data.additional.length}) ---\n`;
          for (const record of data.additional) {
            resultText += `  ${record.name.padEnd(30)} ${record.type.padEnd(6)} TTL=${String(record.ttl).padEnd(6)} ${record.data}\n`;
          }
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
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
    <ProtocolClientLayout title="DNS over TLS (DoT) Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.DoT || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Encrypted DNS Query" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="dot-domain"
            label="Domain Name"
            type="text"
            value={domain}
            onChange={setDomain}
            onKeyDown={handleKeyDown}
            placeholder="example.com"
            required
            helpText="Domain to resolve via encrypted DNS"
            error={errors.domain}
          />

          <div>
            <label htmlFor="dot-type" className="block text-sm font-medium text-slate-300 mb-1">
              Record Type
            </label>
            <select
              id="dot-type"
              value={recordType}
              onChange={(e) => setRecordType(e.target.value)}
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-white text-sm"
            >
              {RECORD_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">DNS record type to query</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="dot-server"
            label="DoT Server"
            type="text"
            value={server}
            onChange={setServer}
            onKeyDown={handleKeyDown}
            placeholder="1.1.1.1"
            helpText="DNS-over-TLS resolver IP address"
          />

          <FormField
            id="dot-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 853 (standard DoT port)"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Quick Connect</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {DOT_SERVERS.map((s) => (
              <button
                key={s.host}
                onClick={() => { setServer(s.host); setPort('853'); }}
                className={`text-left text-xs py-2 px-3 rounded transition-colors ${
                  server === s.host
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
              >
                <span className="font-semibold block">{s.name}</span>
                <span className="font-mono text-blue-400">{s.host}</span>
              </button>
            ))}
          </div>
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !domain}
          loading={loading}
          ariaLabel="Send encrypted DNS query"
        >
          Query via DoT (Encrypted)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About DNS over TLS (DoT)"
          description="DoT (RFC 7858) encrypts DNS queries using TLS, preventing ISPs and network operators from eavesdropping on your DNS lookups. Unlike plain DNS (port 53), DoT uses port 853 with TLS encryption. This provides privacy while using standard DNS wire format."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">DNS over TLS (RFC 7858)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">853</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Transport:</td>
                  <td className="py-2 px-2">TCP + TLS 1.2/1.3</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Framing:</td>
                  <td className="py-2 px-2">2-byte TCP length prefix (same as DNS over TCP)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Privacy:</td>
                  <td className="py-2 px-2 text-green-400">Encrypted - ISP cannot see queries</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Detection:</td>
                  <td className="py-2 px-2 text-yellow-400">Port 853 identifiable (unlike DoH on 443)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">DoT vs DoH vs Plain DNS</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Feature</th>
                  <th className="text-left py-2 px-2 text-slate-300">Plain DNS</th>
                  <th className="text-left py-2 px-2 text-slate-300">DoT</th>
                  <th className="text-left py-2 px-2 text-slate-300">DoH</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Port</td>
                  <td className="py-2 px-2 font-mono">53</td>
                  <td className="py-2 px-2 font-mono text-green-400">853</td>
                  <td className="py-2 px-2 font-mono">443</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encryption</td>
                  <td className="py-2 px-2 text-red-400">None</td>
                  <td className="py-2 px-2 text-green-400">TLS</td>
                  <td className="py-2 px-2 text-green-400">HTTPS (TLS)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Blockable</td>
                  <td className="py-2 px-2">Easy</td>
                  <td className="py-2 px-2 text-yellow-400">By port</td>
                  <td className="py-2 px-2 text-green-400">Hard (blends with HTTPS)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">RFC</td>
                  <td className="py-2 px-2">1035</td>
                  <td className="py-2 px-2">7858</td>
                  <td className="py-2 px-2">8484</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Public DoT Servers</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Provider</th>
                  <th className="text-left py-2 px-2 text-slate-300">IP</th>
                  <th className="text-left py-2 px-2 text-slate-300">Hostname</th>
                  <th className="text-left py-2 px-2 text-slate-300">Features</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Cloudflare</td>
                  <td className="py-2 px-2 font-mono text-blue-400">1.1.1.1</td>
                  <td className="py-2 px-2 font-mono">cloudflare-dns.com</td>
                  <td className="py-2 px-2">Fast, privacy-first</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Google</td>
                  <td className="py-2 px-2 font-mono text-blue-400">8.8.8.8</td>
                  <td className="py-2 px-2 font-mono">dns.google</td>
                  <td className="py-2 px-2">Reliable, global anycast</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Quad9</td>
                  <td className="py-2 px-2 font-mono text-blue-400">9.9.9.9</td>
                  <td className="py-2 px-2 font-mono">dns.quad9.net</td>
                  <td className="py-2 px-2">Malware blocking</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">AdGuard</td>
                  <td className="py-2 px-2 font-mono text-blue-400">94.140.14.14</td>
                  <td className="py-2 px-2 font-mono">dns.adguard-dns.com</td>
                  <td className="py-2 px-2">Ad blocking</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-3">
            <p className="text-xs text-green-200">
              <strong>Privacy Note:</strong> All DNS queries through this tool are encrypted via TLS.
              Your ISP or network operator cannot see what domains you are looking up.
              The query is sent from Cloudflare's edge network to the DoT server.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
