import { useState } from 'react';

interface DNSClientProps {
  onBack: () => void;
}

interface DNSRecord {
  name: string;
  type: string;
  typeCode: number;
  class: number;
  ttl: number;
  data: string;
}

interface DNSResult {
  success: boolean;
  domain: string;
  server: string;
  port: number;
  queryType: string;
  rcode: string;
  flags: {
    qr: boolean;
    aa: boolean;
    tc: boolean;
    rd: boolean;
    ra: boolean;
  };
  questions: number;
  answers: DNSRecord[];
  authority: DNSRecord[];
  additional: DNSRecord[];
  queryTimeMs: number;
  error?: string;
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'PTR', 'ANY'];

const DNS_SERVERS = [
  { name: 'Google', ip: '8.8.8.8' },
  { name: 'Google Secondary', ip: '8.8.4.4' },
  { name: 'Cloudflare', ip: '1.1.1.1' },
  { name: 'Quad9', ip: '9.9.9.9' },
  { name: 'OpenDNS', ip: '208.67.222.222' },
];

export default function DNSClient({ onBack }: DNSClientProps) {
  const [domain, setDomain] = useState('example.com');
  const [recordType, setRecordType] = useState('A');
  const [server, setServer] = useState('8.8.8.8');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DNSResult[]>([]);
  const [error, setError] = useState('');

  const handleQuery = async () => {
    if (!domain.trim()) {
      setError('Domain name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/dns/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domain.trim(),
          type: recordType,
          server,
        }),
      });

      const data = (await response.json()) as DNSResult;

      if (!response.ok) {
        setError(data.error || 'DNS query failed');
      } else {
        setResults((prev) => [data, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleQuery();
    }
  };

  const formatTTL = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white hover:text-blue-400 transition-colors">
            &larr; Back
          </button>
          <h1 className="text-3xl font-bold text-white">DNS Lookup</h1>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Query Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Query</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="example.com"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Record Type</label>
                <select
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {RECORD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">DNS Server</label>
                <select
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DNS_SERVERS.map((s) => (
                    <option key={s.ip} value={s.ip}>
                      {s.name} ({s.ip})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleQuery}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Querying...' : 'Lookup'}
              </button>

              {/* Quick queries */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-2">Quick Queries</h3>
                <div className="space-y-1">
                  {[
                    { domain: 'google.com', type: 'A' },
                    { domain: 'google.com', type: 'MX' },
                    { domain: 'google.com', type: 'NS' },
                    { domain: 'example.com', type: 'TXT' },
                  ].map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setDomain(q.domain);
                        setRecordType(q.type);
                      }}
                      className="w-full text-left text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1.5 px-2 rounded transition-colors"
                    >
                      {q.domain} ({q.type})
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">About DNS</h3>
              <p className="text-xs text-slate-400">
                DNS over TCP (RFC 1035) resolves domain names to IP addresses. This tool queries DNS
                servers directly over TCP port 53, showing raw record data.
              </p>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Results</h2>
              {results.length > 0 && (
                <button
                  onClick={() => setResults([])}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-3 mb-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {results.length === 0 && !error ? (
              <div className="text-center py-12 text-slate-500">
                Enter a domain name and click Lookup to query DNS records
              </div>
            ) : (
              <div className="space-y-6">
                {results.map((result, resultIdx) => (
                  <div
                    key={resultIdx}
                    className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden"
                  >
                    {/* Query header */}
                    <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-white">{result.domain}</span>
                        <span className="bg-blue-600 px-2 py-0.5 rounded text-xs text-white font-semibold">
                          {result.queryType}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            result.rcode === 'NOERROR'
                              ? 'bg-green-600/30 text-green-400'
                              : result.rcode === 'NXDOMAIN'
                              ? 'bg-yellow-600/30 text-yellow-400'
                              : 'bg-red-600/30 text-red-400'
                          }`}
                        >
                          {result.rcode}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>@{result.server}</span>
                        <span>{result.queryTimeMs}ms</span>
                        {result.flags.aa && (
                          <span className="text-green-400" title="Authoritative Answer">
                            AA
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Answer records */}
                    {result.answers.length > 0 && (
                      <div className="px-4 py-3">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                          Answer ({result.answers.length})
                        </h4>
                        <div className="space-y-1 font-mono text-sm">
                          {result.answers.map((record, idx) => (
                            <div key={idx} className="flex items-start gap-4 text-slate-300">
                              <span className="text-slate-500 w-40 flex-shrink-0 truncate">
                                {record.name}
                              </span>
                              <span className="text-slate-500 w-12 flex-shrink-0 text-right">
                                {formatTTL(record.ttl)}
                              </span>
                              <span className="text-blue-400 w-12 flex-shrink-0">{record.type}</span>
                              <span className="text-green-400 break-all">{record.data}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Authority records */}
                    {result.authority.length > 0 && (
                      <div className="px-4 py-3 border-t border-slate-700">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                          Authority ({result.authority.length})
                        </h4>
                        <div className="space-y-1 font-mono text-sm">
                          {result.authority.map((record, idx) => (
                            <div key={idx} className="flex items-start gap-4 text-slate-300">
                              <span className="text-slate-500 w-40 flex-shrink-0 truncate">
                                {record.name}
                              </span>
                              <span className="text-slate-500 w-12 flex-shrink-0 text-right">
                                {formatTTL(record.ttl)}
                              </span>
                              <span className="text-yellow-400 w-12 flex-shrink-0">
                                {record.type}
                              </span>
                              <span className="text-slate-400 break-all">{record.data}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Additional records */}
                    {result.additional.length > 0 && (
                      <div className="px-4 py-3 border-t border-slate-700">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                          Additional ({result.additional.length})
                        </h4>
                        <div className="space-y-1 font-mono text-sm">
                          {result.additional.map((record, idx) => (
                            <div key={idx} className="flex items-start gap-4 text-slate-300">
                              <span className="text-slate-500 w-40 flex-shrink-0 truncate">
                                {record.name}
                              </span>
                              <span className="text-slate-500 w-12 flex-shrink-0 text-right">
                                {formatTTL(record.ttl)}
                              </span>
                              <span className="text-purple-400 w-12 flex-shrink-0">
                                {record.type}
                              </span>
                              <span className="text-slate-400 break-all">{record.data}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No records */}
                    {result.answers.length === 0 &&
                      result.authority.length === 0 &&
                      result.additional.length === 0 && (
                        <div className="px-4 py-6 text-center text-slate-500 text-sm">
                          No records returned ({result.rcode})
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
