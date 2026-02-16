import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface NNTPClientProps {
  onBack: () => void;
}

interface ArticleSummary {
  number: number;
  subject: string;
  from: string;
  date: string;
  messageId: string;
  lines: number;
}

export default function NNTPClient({ onBack }: NNTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('119');
  const [group, setGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [groupInfo, setGroupInfo] = useState<{
    group: string;
    count: number;
    first: number;
    last: number;
    articles: ArticleSummary[];
  } | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<{
    articleNumber: number;
    messageId: string;
    headers: Record<string, string>;
    body: string;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setGroupInfo(null);
    setSelectedArticle(null);

    try {
      const response = await fetch('/api/nntp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 10000 }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        welcome?: string;
        postingAllowed?: boolean;
        capabilities?: string[];
        modeReader?: string;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to ${host}:${port}\n`;
        resultText += `${'='.repeat(60)}\n\n`;
        resultText += `Welcome: ${data.welcome}\n`;
        resultText += `Posting: ${data.postingAllowed ? 'Allowed' : 'Not allowed'}\n`;
        if (data.capabilities && data.capabilities.length > 0) {
          resultText += `\nCapabilities:\n`;
          for (const cap of data.capabilities) {
            resultText += `  ${cap}\n`;
          }
        }
        if (data.modeReader) {
          resultText += `\nMODE READER: ${data.modeReader}\n`;
        }
        setResult(resultText);
      } else {
        setError(data.error || 'NNTP connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NNTP connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGroup = async () => {
    if (!group.trim()) { setError('Please enter a newsgroup name'); return; }
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setSelectedArticle(null);

    try {
      const response = await fetch('/api/nntp/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), group: group.trim(), timeout: 15000 }),
      });

      const data = (await response.json()) as {
        success?: boolean; error?: string; group?: string;
        count?: number; first?: number; last?: number; articles?: ArticleSummary[];
      };

      if (response.ok && data.success) {
        setGroupInfo({
          group: data.group || group, count: data.count || 0,
          first: data.first || 0, last: data.last || 0, articles: data.articles || [],
        });
      } else {
        setError(data.error || 'Failed to select newsgroup');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select newsgroup');
    } finally {
      setLoading(false);
    }
  };

  const handleViewArticle = async (articleNumber: number) => {
    if (!groupInfo) return;
    setLoading(true);
    setError('');
    setSelectedArticle(null);

    try {
      const response = await fetch('/api/nntp/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), group: groupInfo.group, articleNumber, timeout: 15000 }),
      });

      const data = (await response.json()) as {
        success?: boolean; error?: string; articleNumber?: number;
        messageId?: string; headers?: Record<string, string>; body?: string;
      };

      if (response.ok && data.success) {
        setSelectedArticle({
          articleNumber: data.articleNumber || articleNumber,
          messageId: data.messageId || '', headers: data.headers || {}, body: data.body || '',
        });
      } else {
        setError(data.error || 'Failed to retrieve article');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve article');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      group.trim() ? handleSelectGroup() : handleConnect();
    }
  };

  const handleExampleServer = (exampleHost: string, exampleGroup?: string) => {
    setHost(exampleHost);
    if (exampleGroup) setGroup(exampleGroup);
    setGroupInfo(null); setSelectedArticle(null); setResult(''); setError('');
  };

  return (
    <ProtocolClientLayout title="NNTP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="News Server Configuration" />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="nntp-host" label="NNTP Server Host" type="text" value={host}
            onChange={setHost} onKeyDown={handleKeyDown} placeholder="news.aioe.org"
            required helpText="Usenet news server address" error={errors.host} />
          <FormField id="nntp-port" label="Port" type="number" value={port}
            onChange={setPort} onKeyDown={handleKeyDown} min="1" max="65535"
            helpText="Default: 119 (NNTP), 563 (NNTPS)" error={errors.port} />
        </div>

        <ActionButton onClick={handleConnect} disabled={loading || !host || !port}
          loading={loading} ariaLabel="Test NNTP connection">
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={!groupInfo && !selectedArticle ? error : undefined} />

        <div className="mt-8">
          <SectionHeader stepNumber={2} title="Browse Newsgroup" color="green" />
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <FormField id="nntp-group" label="Newsgroup Name" type="text" value={group}
                onChange={setGroup} onKeyDown={handleKeyDown} placeholder="comp.lang.python"
                optional helpText="e.g., comp.lang.python, sci.math, alt.test" />
            </div>
            <div className="flex items-end">
              <ActionButton onClick={handleSelectGroup}
                disabled={loading || !host || !port || !group.trim()}
                loading={loading} variant="success" ariaLabel="Browse newsgroup">
                Browse Group
              </ActionButton>
            </div>
          </div>
        </div>

        {groupInfo && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              <h3 className="text-sm font-semibold text-slate-300">{groupInfo.group}</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4 text-xs text-slate-400">
              <div><span className="font-semibold text-slate-300">Articles:</span> {groupInfo.count.toLocaleString()}</div>
              <div><span className="font-semibold text-slate-300">First:</span> {groupInfo.first.toLocaleString()}</div>
              <div><span className="font-semibold text-slate-300">Last:</span> {groupInfo.last.toLocaleString()}</div>
            </div>
            {groupInfo.articles.length > 0 ? (
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-slate-400 mb-2">Recent Articles ({groupInfo.articles.length})</h4>
                {groupInfo.articles.map((article) => (
                  <button key={article.number} onClick={() => handleViewArticle(article.number)}
                    disabled={loading}
                    className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-3 py-2 transition-colors disabled:opacity-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white truncate">{article.subject}</div>
                        <div className="text-xs text-slate-400 truncate">{article.from}</div>
                      </div>
                      <div className="text-xs text-slate-500 flex-shrink-0">#{article.number}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No recent articles found (OVER command may not be supported)</p>
            )}
          </div>
        )}

        {selectedArticle && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-blue-600/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-blue-400">Article #{selectedArticle.articleNumber}</h3>
              <button onClick={() => setSelectedArticle(null)}
                className="text-xs text-slate-400 hover:text-white transition-colors">Close</button>
            </div>
            <div className="space-y-1 mb-4 text-xs">
              {selectedArticle.headers['Subject'] && (
                <div><span className="font-semibold text-slate-300">Subject:</span>{' '}
                  <span className="text-white">{selectedArticle.headers['Subject']}</span></div>
              )}
              {selectedArticle.headers['From'] && (
                <div><span className="font-semibold text-slate-300">From:</span>{' '}
                  <span className="text-slate-400">{selectedArticle.headers['From']}</span></div>
              )}
              {selectedArticle.headers['Date'] && (
                <div><span className="font-semibold text-slate-300">Date:</span>{' '}
                  <span className="text-slate-400">{selectedArticle.headers['Date']}</span></div>
              )}
              {selectedArticle.headers['Newsgroups'] && (
                <div><span className="font-semibold text-slate-300">Newsgroups:</span>{' '}
                  <span className="text-slate-400">{selectedArticle.headers['Newsgroups']}</span></div>
              )}
              {selectedArticle.messageId && (
                <div><span className="font-semibold text-slate-300">Message-ID:</span>{' '}
                  <span className="text-slate-500 font-mono">&lt;{selectedArticle.messageId}&gt;</span></div>
              )}
            </div>
            <div className="border-t border-slate-700 pt-3">
              <pre className="text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                {selectedArticle.body || '(empty body)'}
              </pre>
            </div>
          </div>
        )}

        {(groupInfo || selectedArticle) && error && <ResultDisplay error={error} />}

        <HelpSection title="About NNTP Protocol"
          description="NNTP (RFC 3977, 1986) is the protocol for Usenet newsgroups - a distributed discussion system predating the Web. Newsgroups are organized hierarchically (comp.*, sci.*, alt.*) and articles are distributed across servers worldwide."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Public News Servers</h3>
          <div className="grid gap-2">
            <button onClick={() => handleExampleServer('news.aioe.org', 'comp.lang.python')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors">
              <span className="font-mono text-blue-400">news.aioe.org</span>
              <span className="ml-2 text-slate-400">- Free, no registration required</span>
            </button>
            <button onClick={() => handleExampleServer('news.eternal-september.org', 'comp.lang.c')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors">
              <span className="font-mono text-blue-400">news.eternal-september.org</span>
              <span className="ml-2 text-slate-400">- Free with registration</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common Newsgroup Hierarchies</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">comp.*</span> - Computing topics</div>
            <div><span className="font-mono text-blue-400">sci.*</span> - Science topics</div>
            <div><span className="font-mono text-blue-400">rec.*</span> - Recreation</div>
            <div><span className="font-mono text-blue-400">soc.*</span> - Social issues</div>
            <div><span className="font-mono text-blue-400">alt.*</span> - Alternative (anything goes)</div>
            <div><span className="font-mono text-blue-400">misc.*</span> - Miscellaneous</div>
            <div><span className="font-mono text-blue-400">news.*</span> - Usenet admin</div>
            <div><span className="font-mono text-blue-400">talk.*</span> - Debates</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">NNTP Commands Used</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">CAPABILITIES</span> <span className="text-slate-400">- List server features</span></div>
            <div><span className="text-green-400">MODE READER</span> <span className="text-slate-400">- Switch to reader mode</span></div>
            <div><span className="text-green-400">GROUP name</span> <span className="text-slate-400">- Select newsgroup</span></div>
            <div><span className="text-green-400">OVER range</span> <span className="text-slate-400">- Fetch article headers</span></div>
            <div><span className="text-green-400">ARTICLE num</span> <span className="text-slate-400">- Retrieve full article</span></div>
            <div><span className="text-green-400">QUIT</span> <span className="text-slate-400">- Close connection</span></div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
