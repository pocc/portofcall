import { useState } from 'react';

interface GitClientProps {
  onBack: () => void;
}

interface GitRef {
  sha: string;
  name: string;
}

interface GitResult {
  success: boolean;
  host: string;
  port: number;
  repo: string;
  refs: GitRef[];
  capabilities: string[];
  headSha?: string;
  branchCount: number;
  tagCount: number;
  connectTimeMs: number;
  totalTimeMs: number;
  error?: string;
}

type RefFilter = 'all' | 'branches' | 'tags' | 'other';

const EXAMPLE_REPOS = [
  { host: 'git.kernel.org', repo: '/pub/scm/git/git.git', label: 'Git (git.kernel.org)' },
  { host: 'git.kernel.org', repo: '/pub/scm/linux/kernel/git/torvalds/linux.git', label: 'Linux Kernel' },
  { host: 'git.savannah.gnu.org', repo: '/git/coreutils.git', label: 'GNU Coreutils' },
];

export default function GitClient({ onBack }: GitClientProps) {
  const [host, setHost] = useState('git.kernel.org');
  const [port, setPort] = useState(9418);
  const [repo, setRepo] = useState('/pub/scm/git/git.git');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GitResult | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<RefFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [history, setHistory] = useState<GitResult[]>([]);

  const handleBrowse = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/git/refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, repo }),
      });

      const data: GitResult = await response.json();

      if (data.success) {
        setResult(data);
        setHistory(prev => [data, ...prev.slice(0, 9)]);
      } else {
        setError(data.error || 'Failed to fetch refs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const loadExample = (example: typeof EXAMPLE_REPOS[number]) => {
    setHost(example.host);
    setRepo(example.repo);
    setPort(9418);
  };

  const getFilteredRefs = (): GitRef[] => {
    if (!result) return [];

    let refs = result.refs;

    // Apply type filter
    switch (filter) {
      case 'branches':
        refs = refs.filter(r => r.name.startsWith('refs/heads/'));
        break;
      case 'tags':
        refs = refs.filter(r => r.name.startsWith('refs/tags/'));
        break;
      case 'other':
        refs = refs.filter(r => !r.name.startsWith('refs/heads/') && !r.name.startsWith('refs/tags/'));
        break;
    }

    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      refs = refs.filter(r => r.name.toLowerCase().includes(q) || r.sha.includes(q));
    }

    return refs;
  };

  const getRefDisplayName = (name: string): string => {
    if (name.startsWith('refs/heads/')) return name.replace('refs/heads/', '');
    if (name.startsWith('refs/tags/')) return name.replace('refs/tags/', '');
    return name;
  };

  const getRefBadge = (name: string): { label: string; color: string } => {
    if (name === 'HEAD') return { label: 'HEAD', color: 'bg-purple-600' };
    if (name.startsWith('refs/heads/')) return { label: 'branch', color: 'bg-green-600' };
    if (name.startsWith('refs/tags/')) return { label: 'tag', color: 'bg-yellow-600' };
    return { label: 'ref', color: 'bg-slate-600' };
  };

  const filteredRefs = getFilteredRefs();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors flex items-center gap-2"
        >
          <span aria-hidden="true">&larr;</span> Back to Protocol List
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-8 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="text-5xl" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="#F05032" strokeWidth="3" fill="none" />
              <circle cx="24" cy="12" r="4" fill="#F05032" />
              <circle cx="24" cy="36" r="4" fill="#F05032" />
              <circle cx="36" cy="24" r="4" fill="#F05032" />
              <line x1="24" y1="16" x2="24" y2="32" stroke="#F05032" strokeWidth="2.5" />
              <line x1="24" y1="24" x2="32" y2="24" stroke="#F05032" strokeWidth="2.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Git Protocol</h1>
            <p className="text-slate-400">
              Port 9418 &middot; Read-only repository access via git:// protocol
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {EXAMPLE_REPOS.map((example) => (
              <button
                key={example.label}
                onClick={() => loadExample(example)}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-full transition-colors"
              >
                {example.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Git Server</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="git.kernel.org"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Repository Path</label>
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="/pub/scm/git/git.git"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleBrowse}
            disabled={loading || !host || !repo}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading ? 'Fetching Refs...' : 'Browse Repository'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-600/50 rounded-xl p-6 mb-6">
          <h3 className="text-red-200 font-semibold mb-2">Error</h3>
          <p className="text-red-100/80 text-sm font-mono">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Repository Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-orange-400">{result.refs.length}</div>
                <div className="text-xs text-slate-400">Total Refs</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{result.branchCount}</div>
                <div className="text-xs text-slate-400">Branches</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{result.tagCount}</div>
                <div className="text-xs text-slate-400">Tags</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-400">{result.totalTimeMs}ms</div>
                <div className="text-xs text-slate-400">Response Time</div>
              </div>
            </div>

            {result.headSha && (
              <div className="mt-4 bg-slate-900 rounded-lg p-3">
                <span className="text-slate-400 text-sm">HEAD: </span>
                <span className="text-purple-400 font-mono text-sm">{result.headSha}</span>
              </div>
            )}

            <div className="mt-3 text-xs text-slate-500">
              Connected to {result.host}:{result.port} &middot; {result.repo}
              &middot; Connect: {result.connectTimeMs}ms
            </div>
          </div>

          {/* Capabilities */}
          {result.capabilities.length > 0 && (
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-3">Server Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {result.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded font-mono"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Refs List */}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">References</h3>
              <span className="text-sm text-slate-400">
                {filteredRefs.length} of {result.refs.length}
              </span>
            </div>

            {/* Filter controls */}
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="flex gap-1">
                {(['all', 'branches', 'tags', 'other'] as RefFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      filter === f
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search refs..."
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-white text-sm focus:border-orange-500 focus:outline-none"
              />
            </div>

            {/* Refs table */}
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="text-slate-400 text-left">
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2">Name</th>
                    <th className="py-2 px-2">SHA</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRefs.map((ref, idx) => {
                    const badge = getRefBadge(ref.name);
                    return (
                      <tr
                        key={idx}
                        className="border-t border-slate-700 hover:bg-slate-700/50"
                      >
                        <td className="py-2 px-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${badge.color} text-white`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-white font-mono">
                          {getRefDisplayName(ref.name)}
                        </td>
                        <td className="py-2 px-2 text-slate-400 font-mono">
                          {ref.sha.substring(0, 12)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredRefs.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  No refs match the current filter
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-3">Query History</h3>
          <div className="space-y-2">
            {history.slice(1).map((h, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-slate-900 rounded-lg p-3 text-sm"
              >
                <div>
                  <span className="text-white font-mono">{h.host}</span>
                  <span className="text-slate-400 font-mono">{h.repo}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-green-400">{h.branchCount} branches</span>
                  <span className="text-yellow-400">{h.tagCount} tags</span>
                  <span className="text-slate-400">{h.totalTimeMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol Info */}
      <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About Git Protocol</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-300">
          <div>
            <h4 className="text-white font-medium mb-2">Protocol Details</h4>
            <ul className="space-y-1">
              <li><span className="text-slate-400">Port:</span> 9418 (git://)</li>
              <li><span className="text-slate-400">Mode:</span> Read-only access</li>
              <li><span className="text-slate-400">Format:</span> Pkt-line framing</li>
              <li><span className="text-slate-400">Auth:</span> None (public repos)</li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-medium mb-2">Pkt-Line Format</h4>
            <ul className="space-y-1">
              <li><span className="text-slate-400">Length:</span> 4-byte hex prefix</li>
              <li><span className="text-slate-400">Flush:</span> "0000" = end of list</li>
              <li><span className="text-slate-400">Capabilities:</span> NUL-separated on first line</li>
              <li><span className="text-slate-400">Ref format:</span> SHA + space + ref name</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
