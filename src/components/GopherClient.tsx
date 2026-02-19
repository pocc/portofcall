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

interface GopherClientProps {
  onBack: () => void;
}

interface GopherItem {
  type: string;
  display: string;
  selector: string;
  host: string;
  port: number;
}

interface HistoryEntry {
  host: string;
  port: number;
  selector: string;
}

const GOPHER_TYPE_LABELS: Record<string, string> = {
  '0': 'TXT',
  '1': 'DIR',
  '2': 'CSO',
  '3': 'ERR',
  '4': 'BHX',
  '5': 'DOS',
  '6': 'UUE',
  '7': 'SEARCH',
  '8': 'TEL',
  '9': 'BIN',
  'g': 'GIF',
  'I': 'IMG',
  'h': 'HTML',
  'i': 'info',
  's': 'SND',
  'p': 'PNG',
};

function getTypeLabel(type: string): string {
  return GOPHER_TYPE_LABELS[type] || type;
}

function getTypeColor(type: string): string {
  switch (type) {
    case '1': return 'text-blue-400';
    case '0': return 'text-green-400';
    case '7': return 'text-yellow-400';
    case '3': return 'text-red-400';
    case '9':
    case '5':
    case '4':
    case '6': return 'text-purple-400';
    case 'g':
    case 'I':
    case 'p': return 'text-pink-400';
    case 'h': return 'text-cyan-400';
    case 'i': return 'text-slate-500';
    default: return 'text-slate-400';
  }
}

export default function GopherClient({ onBack }: GopherClientProps) {
  const [host, setHost] = useState('gopher.floodgap.com');
  const [port, setPort] = useState('70');
  const [selector, setSelector] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<GopherItem[]>([]);
  const [content, setContent] = useState('');
  const [isMenu, setIsMenu] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentLocation, setCurrentLocation] = useState('');
  const [searchPrompt, setSearchPrompt] = useState<{ selector: string; host: string; port: number } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const navigate = async (
    navSelector: string = '',
    navHost?: string,
    navPort?: number,
    query?: string,
  ) => {
    const targetHost = navHost || host;
    const targetPort = navPort || parseInt(port);

    const isValid = validateAll({ host: targetHost, port: String(targetPort) });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setSearchPrompt(null);

    try {
      const response = await fetch('/api/gopher/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: targetHost,
          port: targetPort,
          selector: navSelector,
          query,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isMenu?: boolean;
        items?: GopherItem[];
        content?: string;
        selector?: string;
      };

      if (response.ok && data.success) {
        // Push current location to history before navigating
        if (currentLocation || items.length > 0 || content) {
          setHistory(prev => [...prev, {
            host: targetHost,
            port: targetPort,
            selector: currentLocation,
          }]);
        }

        setHost(targetHost);
        setPort(String(targetPort));
        setCurrentLocation(navSelector);

        if (data.isMenu && data.items) {
          setItems(data.items);
          setContent('');
          setIsMenu(true);
        } else {
          setContent(data.content || '');
          setItems([]);
          setIsMenu(false);
        }
      } else {
        setError(data.error || 'Gopher fetch failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gopher fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGo = () => {
    // Reset history when navigating to a new server
    setHistory([]);
    setItems([]);
    setContent('');
    navigate(selector);
  };

  const handleBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    // Navigate without pushing to history
    setCurrentLocation(prev.selector);
    setHost(prev.host);
    setPort(String(prev.port));

    setLoading(true);
    setError('');
    setSearchPrompt(null);

    fetch('/api/gopher/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: prev.host,
        port: prev.port,
        selector: prev.selector,
        timeout: 15000,
      }),
    })
      .then(r => r.json() as Promise<{ success?: boolean; isMenu?: boolean; items?: GopherItem[]; content?: string; error?: string }>)
      .then(data => {
        if (data.success) {
          if (data.isMenu && data.items) {
            setItems(data.items);
            setContent('');
            setIsMenu(true);
          } else {
            setContent(data.content || '');
            setItems([]);
            setIsMenu(false);
          }
        } else {
          setError(data.error || 'Navigation failed');
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Navigation failed'))
      .finally(() => setLoading(false));
  };

  const handleItemClick = (item: GopherItem) => {
    if (item.type === 'i') return; // Info text is not clickable

    if (item.type === '7') {
      // Search server - prompt for query
      setSearchPrompt({
        selector: item.selector,
        host: item.host || host,
        port: item.port || parseInt(port),
      });
      setSearchQuery('');
      return;
    }

    if (item.type === '8') {
      // Telnet - can't handle directly
      setError(`Telnet links are not supported in the Gopher browser. Target: ${item.host}:${item.port}`);
      return;
    }

    // Navigate to the item
    navigate(
      item.selector,
      item.host || undefined,
      item.port || undefined,
    );
  };

  const handleSearch = () => {
    if (!searchPrompt || !searchQuery.trim()) return;
    navigate(searchPrompt.selector, searchPrompt.host, searchPrompt.port, searchQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (searchPrompt) {
        handleSearch();
      } else {
        handleGo();
      }
    }
  };

  const handleExampleServer = (exHost: string, exPort: number, exSelector: string = '') => {
    setHost(exHost);
    setPort(String(exPort));
    setSelector(exSelector);
  };

  const locationString = `gopher://${host}:${port}${currentLocation ? '/' + currentLocation : '/'}`;

  return (
    <ProtocolClientLayout title="Gopher Browser" onBack={onBack}>
      <ApiExamples examples={apiExamples.Gopher || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Gopher Server" />

        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-2">
            <FormField
              id="gopher-host"
              label="Gopher Server Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="gopher.floodgap.com"
              required
              helpText="Gopher server hostname"
              error={errors.host}
            />
          </div>

          <FormField
            id="gopher-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 70"
            error={errors.port}
          />

          <FormField
            id="gopher-selector"
            label="Selector"
            type="text"
            value={selector}
            onChange={setSelector}
            onKeyDown={handleKeyDown}
            placeholder="/ (root)"
            optional
            helpText="Path to fetch (empty = root)"
          />
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={handleBack}
            disabled={loading || history.length === 0}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg transition-colors"
            aria-label="Go back in Gopher history"
          >
            &larr; Back
          </button>
          <div className="flex-1">
            <ActionButton
              onClick={handleGo}
              disabled={loading || !host || !port}
              loading={loading}
              ariaLabel="Navigate to Gopher server"
            >
              Navigate
            </ActionButton>
          </div>
        </div>

        {/* Location bar */}
        {(items.length > 0 || content) && (
          <div className="mb-4 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 font-mono text-sm text-slate-300 flex items-center gap-2">
            <span className="text-slate-500 select-none">gopher://</span>
            <span className="text-blue-400">{locationString.replace('gopher://', '')}</span>
          </div>
        )}

        {/* Search prompt */}
        {searchPrompt && (
          <div className="mb-4 bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-yellow-200 mb-2">Search Query</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="Enter search query..."
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
                className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Search
              </button>
              <button
                onClick={() => setSearchPrompt(null)}
                className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Menu view */}
        {isMenu && items.length > 0 && (
          <div className="bg-slate-900 border border-slate-600 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-slate-800 border-b border-slate-600 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-semibold">
                GOPHER MENU ({items.length} items)
              </span>
              <span className="text-xs text-slate-500">
                {history.length > 0 ? `Depth: ${history.length}` : 'Root'}
              </span>
            </div>
            <div className="divide-y divide-slate-800">
              {items.map((item, i) => (
                <div key={i} className="group">
                  {item.type === 'i' ? (
                    <div className="px-4 py-1 font-mono text-sm text-slate-500">
                      {item.display || '\u00A0'}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleItemClick(item)}
                      disabled={loading}
                      className="w-full text-left px-4 py-2 hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center gap-3"
                    >
                      <span className={`text-xs font-mono font-bold ${getTypeColor(item.type)} min-w-[3rem] text-center bg-slate-800 group-hover:bg-slate-700 px-1 py-0.5 rounded`}>
                        {getTypeLabel(item.type)}
                      </span>
                      <span className={`font-mono text-sm ${item.type === '1' ? 'text-blue-300' : item.type === '0' ? 'text-green-300' : 'text-slate-300'}`}>
                        {item.display}
                      </span>
                      {item.host && item.host !== host && (
                        <span className="text-xs text-slate-600 ml-auto">
                          {item.host}:{item.port}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Text content view */}
        {!isMenu && content && (
          <div className="bg-slate-900 border border-slate-600 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-slate-800 border-b border-slate-600">
              <span className="text-xs text-slate-400 font-semibold">
                DOCUMENT CONTENT
              </span>
            </div>
            <pre className="p-4 text-sm text-slate-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-[600px] overflow-y-auto">
              {content}
            </pre>
          </div>
        )}

        <ResultDisplay error={error} />

        <HelpSection
          title="About Gopher Protocol"
          description="Gopher (RFC 1436, 1991) is a pre-Web hypertext browsing protocol from the University of Minnesota. It organizes documents in hierarchical menus. While the Web superseded Gopher, a small but enthusiastic community (Gopherspace) keeps it alive."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Public Gopher Servers</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleServer('gopher.floodgap.com', 70)}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gopher.floodgap.com</span>
              <span className="ml-2 text-slate-400">- Floodgap Gopher archive (largest directory)</span>
            </button>
            <button
              onClick={() => handleExampleServer('gopher.club', 70)}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gopher.club</span>
              <span className="ml-2 text-slate-400">- Community Gopher server</span>
            </button>
            <button
              onClick={() => handleExampleServer('sdf.org', 70)}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">sdf.org</span>
              <span className="ml-2 text-slate-400">- SDF Public Access UNIX System</span>
            </button>
            <button
              onClick={() => handleExampleServer('gopher.quux.org', 70)}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">gopher.quux.org</span>
              <span className="ml-2 text-slate-400">- Quux.org Gopher server</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Item Type Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { type: '0', label: 'Text File', color: 'text-green-400' },
              { type: '1', label: 'Directory', color: 'text-blue-400' },
              { type: '7', label: 'Search', color: 'text-yellow-400' },
              { type: '9', label: 'Binary', color: 'text-purple-400' },
              { type: 'g', label: 'GIF Image', color: 'text-pink-400' },
              { type: 'I', label: 'Image', color: 'text-pink-400' },
              { type: 'h', label: 'HTML Link', color: 'text-cyan-400' },
              { type: 'i', label: 'Info Text', color: 'text-slate-500' },
            ].map(({ type, label, color }) => (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span className={`font-mono font-bold ${color}`}>[{type}]</span>
                <span className="text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Historical Context</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              <strong>1991:</strong> Gopher created at University of Minnesota
            </p>
            <p>
              <strong>1993:</strong> RFC 1436 published; Gopher peaked with ~10% of internet traffic
            </p>
            <p>
              <strong>1993:</strong> UMinn announced licensing fees, accelerating shift to the Web
            </p>
            <p>
              <strong>Today:</strong> Small "Gopherspace" community still maintains active servers
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
