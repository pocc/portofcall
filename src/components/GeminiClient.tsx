import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface GeminiClientProps {
  onBack: () => void;
}

export default function GeminiClient({ onBack }: GeminiClientProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<number | null>(null);
  const [meta, setMeta] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    url: [validationRules.required('URL is required')],
  });

  const getStatusDescription = (code: number): string => {
    const category = Math.floor(code / 10);
    switch (category) {
      case 1: return 'INPUT - Server requests input from user';
      case 2: return 'SUCCESS - Request completed successfully';
      case 3: return 'REDIRECT - Resource has moved';
      case 4: return 'TEMPORARY FAILURE - Try again later';
      case 5: return 'PERMANENT FAILURE - Do not retry';
      case 6: return 'CLIENT CERTIFICATE REQUIRED';
      default: return 'Unknown status';
    }
  };

  const getStatusColor = (code: number): string => {
    const category = Math.floor(code / 10);
    switch (category) {
      case 1: return 'text-blue-400';
      case 2: return 'text-green-400';
      case 3: return 'text-yellow-400';
      case 4: return 'text-orange-400';
      case 5: return 'text-red-400';
      case 6: return 'text-purple-400';
      default: return 'text-slate-400';
    }
  };

  const handleFetch = async () => {
    const isValid = validateAll({ url });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setStatus(null);
    setMeta('');

    try {
      const response = await fetch('/api/gemini/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        status?: number;
        meta?: string;
        body?: string;
      };

      if (response.ok && data.success) {
        setStatus(data.status || 0);
        setMeta(data.meta || '');
        setResult(data.body || '(No content)');
      } else {
        setError(data.error || 'Failed to fetch Gemini resource');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Gemini resource');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && url) {
      handleFetch();
    }
  };

  const handleExampleUrl = (exampleUrl: string) => {
    setUrl(exampleUrl);
  };

  return (
    <ProtocolClientLayout title="Gemini Protocol Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Gemini URL" />

        <div className="mb-6">
          <FormField
            id="gemini-url"
            label="Gemini URL"
            type="text"
            value={url}
            onChange={setUrl}
            onKeyDown={handleKeyDown}
            placeholder="gemini://gemini.circumlunar.space/"
            required
            helpText="Full Gemini URL (gemini://host/path)"
            error={errors.url}
          />
        </div>

        <ActionButton
          onClick={handleFetch}
          disabled={loading || !url}
          loading={loading}
          ariaLabel="Fetch Gemini resource"
        >
          Fetch Resource
        </ActionButton>

        {status !== null && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Response Status</h3>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-slate-400">Status Code</div>
                <div className={`text-2xl font-bold ${getStatusColor(status)}`}>{status}</div>
              </div>
              <div className="flex-1">
                <div className="text-xs text-slate-400">Description</div>
                <div className="text-sm text-slate-300">{getStatusDescription(status)}</div>
              </div>
            </div>
            {meta && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400">Meta Information</div>
                <div className="text-sm font-mono text-blue-400">{meta}</div>
              </div>
            )}
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Gemini Protocol"
          description="Gemini is a modern internet protocol heavier than Gopher but lighter than the Web. Uses mandatory TLS encryption, simple text-based requests, and Gemtext markup. Emphasizes privacy, simplicity, and user agency. No JavaScript, no cookies, no tracking."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Gemini URLs</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleUrl('gemini://gemini.circumlunar.space/')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gemini://gemini.circumlunar.space/</span>
              <span className="ml-2 text-slate-400">- Project Gemini homepage</span>
            </button>
            <button
              onClick={() => handleExampleUrl('gemini://gemini.circumlunar.space/docs/')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gemini://gemini.circumlunar.space/docs/</span>
              <span className="ml-2 text-slate-400">- Gemini documentation</span>
            </button>
            <button
              onClick={() => handleExampleUrl('gemini://localhost/')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gemini://localhost/</span>
              <span className="ml-2 text-slate-400">- Local Gemini server</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Status Code Reference</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Code</th>
                  <th className="text-left py-2 px-2 text-slate-300">Category</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">1x</td>
                  <td className="py-2 px-2">INPUT</td>
                  <td className="py-2 px-2">Server requests input from user</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">2x</td>
                  <td className="py-2 px-2">SUCCESS</td>
                  <td className="py-2 px-2">Request completed, body contains content</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-yellow-400">3x</td>
                  <td className="py-2 px-2">REDIRECT</td>
                  <td className="py-2 px-2">Resource has moved to new URL</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-orange-400">4x</td>
                  <td className="py-2 px-2">TEMPORARY FAILURE</td>
                  <td className="py-2 px-2">Temporary problem, retry later</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-red-400">5x</td>
                  <td className="py-2 px-2">PERMANENT FAILURE</td>
                  <td className="py-2 px-2">Permanent problem, do not retry</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-purple-400">6x</td>
                  <td className="py-2 px-2">CLIENT CERTIFICATE REQUIRED</td>
                  <td className="py-2 px-2">Authentication required</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              <strong className="text-slate-300">Port:</strong> 1965 (default)
            </p>
            <p>
              <strong className="text-slate-300">Transport:</strong> TCP over TLS (mandatory)
            </p>
            <p>
              <strong className="text-slate-300">Request Format:</strong> Single-line URL + \r\n
            </p>
            <p>
              <strong className="text-slate-300">Response Format:</strong> &lt;STATUS&gt; &lt;META&gt;\r\n + body
            </p>
            <p>
              <strong className="text-slate-300">Content Type:</strong> Gemtext (text/gemini)
            </p>
            <p>
              <strong className="text-slate-300">Max URL Length:</strong> 1024 bytes
            </p>
            <p>
              <strong className="text-slate-300">Max Response Size:</strong> Implementation-dependent
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Key Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-700 rounded p-3">
              <h4 className="text-xs font-semibold text-green-400 mb-1">✓ Privacy First</h4>
              <p className="text-xs text-slate-400">No cookies, no tracking, no analytics</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <h4 className="text-xs font-semibold text-green-400 mb-1">✓ TLS Mandatory</h4>
              <p className="text-xs text-slate-400">All connections are encrypted</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <h4 className="text-xs font-semibold text-green-400 mb-1">✓ Simple Markup</h4>
              <p className="text-xs text-slate-400">Gemtext format, no complex HTML</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <h4 className="text-xs font-semibold text-green-400 mb-1">✓ Lightweight</h4>
              <p className="text-xs text-slate-400">Minimal protocol overhead</p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Gemtext Example</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs overflow-x-auto">
            <pre className="text-slate-200 whitespace-pre">{`# Heading 1
## Heading 2
### Heading 3

This is a paragraph of text.

* Bullet item 1
* Bullet item 2

=> gemini://example.com/ Link text
=> /relative/path Another link

> Quote text

\`\`\`
Preformatted text
Code blocks
\`\`\``}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Resources</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              📖 <strong>Specification:</strong> gemini://gemini.circumlunar.space/docs/specification.html
            </p>
            <p>
              🌐 <strong>Gemini Space:</strong> Community of Gemini capsules (sites)
            </p>
            <p>
              🔍 <strong>Search:</strong> GUS - Gemini Universal Search
            </p>
            <p>
              📱 <strong>Clients:</strong> Lagrange, Amfora, Elaho, Bombadillo
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
