import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AboutPage from './AboutPage';
import ChecklistTab from './ChecklistTab';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolCategoryGroup from './ProtocolCategoryGroup';
import CommandPalette from './CommandPalette';
import type { ProtocolCategory, SortOption } from '../types/protocols';
import type { RFCEntry } from '../types/protocols';
import { protocols, nonImplementableRFCs, categoryOrder, sortKey } from '../data/protocols';

// Re-export for ChecklistTab compatibility
export { protocols } from '../data/protocols';

interface ProtocolSelectorProps {
  onSelect: (protocol: string) => void;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  recent: string[];
}

const tabHashes = ['about', 'rfcs', 'checklist'] as const;
type TabType = 'protocols' | 'about' | 'rfcs' | 'checklist';

const tabLabels: Record<TabType, string> = {
  protocols: 'Protocols',
  about: 'About',
  rfcs: 'RFCs',
  checklist: 'Checklist',
};

function getTabFromHash(): TabType {
  const hash = window.location.hash.replace('#', '');
  if (tabHashes.includes(hash as typeof tabHashes[number])) return hash as TabType;
  return 'protocols';
}

export default function ProtocolSelector({ onSelect, favorites, toggleFavorite, isFavorite, recent }: ProtocolSelectorProps) {
  const [activeTab, setActiveTab] = useState<TabType>(getTabFromHash);
  const [selectedCategory, setSelectedCategory] = useState<'all' | ProtocolCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'deprecated'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('category');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [rfcSortBy, setRfcSortBy] = useState<'rfc' | 'year' | null>(null);
  const [rfcSortDirection, setRfcSortDirection] = useState<'asc' | 'desc'>('asc');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<ProtocolCategory>>(() => {
    try {
      const saved = localStorage.getItem('portofcall-collapsed');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const mainRef = useRef<HTMLDivElement>(null);

  const switchTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'protocols') {
      history.pushState(null, '', window.location.pathname);
    } else {
      window.location.hash = tab;
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const toggleCollapse = useCallback((cat: ProtocolCategory) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      localStorage.setItem('portofcall-collapsed', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Filter and sort protocols
  const filteredProtocols = useMemo(() => {
    return protocols
      .filter(p => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'active') return p.status !== 'deprecated';
        return p.status === 'deprecated';
      });
  }, [statusFilter]);

  const sortedProtocols = useMemo(() => {
    return [...filteredProtocols].sort((a, b) => {
      switch (sortBy) {
        case 'year-asc': return a.year - b.year;
        case 'year-desc': return b.year - a.year;
        case 'port-asc': return a.port - b.port;
        case 'port-desc': return b.port - a.port;
        case 'category':
        case 'popularity':
        default: {
          const keyDiff = sortKey(a) - sortKey(b);
          if (keyDiff !== 0) return keyDiff;
          if (a.status === 'deprecated' && b.status === 'deprecated') return a.year - b.year;
          return 0;
        }
      }
    });
  }, [filteredProtocols, sortBy]);

  // Group by category
  const protocolsByCategory = useMemo(() => {
    const groups = new Map<ProtocolCategory, typeof sortedProtocols>();
    for (const cat of categoryOrder) {
      const catProtocols = sortedProtocols.filter(p => p.category === cat);
      if (catProtocols.length > 0) {
        groups.set(cat, catProtocols);
      }
    }
    return groups;
  }, [sortedProtocols]);

  // Flat list for keyboard navigation
  const flatProtocolIds = useMemo(() => {
    if (sortBy !== 'category') {
      return sortedProtocols.map(p => p.id);
    }
    const ids: string[] = [];
    for (const [cat, protos] of protocolsByCategory) {
      if (!collapsedCategories.has(cat)) {
        ids.push(...protos.map(p => p.id));
      }
    }
    return ids;
  }, [sortBy, sortedProtocols, protocolsByCategory, collapsedCategories]);

  const focusedId = focusedIndex >= 0 && focusedIndex < flatProtocolIds.length ? flatProtocolIds[focusedIndex] : undefined;

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (isInput || activeTab !== 'protocols') return;

      if (e.key === '/') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, flatProtocolIds.length - 1));
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && focusedId) {
        e.preventDefault();
        onSelect(focusedId);
        return;
      }
      if (e.key === 'f' && focusedId) {
        e.preventDefault();
        toggleFavorite(focusedId);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        return;
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= 8) {
        const cat = categoryOrder[num - 1];
        if (cat) {
          const el = document.getElementById(`category-${cat}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, flatProtocolIds, focusedId, focusedIndex, onSelect, toggleFavorite]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedId) {
      const el = document.querySelector(`[aria-label*="${focusedId}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedId]);

  const totalCount = protocols.length;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <h1 className="text-3xl font-bold text-white">
              L4.FYI
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-slate-400">
                {totalCount} TCP Protocol Clients
              </p>
              <span className="text-[10px] text-slate-600">
                · Powered by{' '}
                <a
                  href="https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 underline"
                >
                  Workers Sockets
                </a>
              </span>
            </div>
          </div>

          {/* Tab Navigation + Mobile Menu */}
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden px-3 py-2 text-sm bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
              aria-label="Open menu"
            >
              ☰
            </button>

            {(['protocols', 'about', 'rfcs', 'checklist'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-all rounded-lg ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={onSelect}
        favorites={favorites}
        recent={recent}
      />

      {/* Protocols Tab */}
      {activeTab === 'protocols' && (
        <div className="flex items-start">
          <ProtocolSidebar
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            favorites={favorites}
            recent={recent}
            onSelect={onSelect}
            isMobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
          />

          {/* Main content area */}
          <div ref={mainRef} className="flex-1 min-w-0">
            {/* Favorites section at top if any */}
            {favorites.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs uppercase tracking-wider font-semibold mb-3 px-1 text-slate-500">
                  ★ Favorites
                </h3>
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-auto" />
                      <col className="w-24" />
                      <col className="w-10" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-600">
                        <th className="text-left py-1.5 px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Protocol</th>
                        <th className="text-left py-1.5 px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Port</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {favorites.map(id => {
                        const p = protocols.find(pr => pr.id === id);
                        if (!p) return null;
                        return (
                          <tr
                            key={p.id}
                            onClick={() => onSelect(p.id)}
                            className="cursor-pointer transition-colors border-b border-slate-700/50 hover:bg-slate-700/50"
                          >
                            <td className="py-1.5 px-3">
                              <div className="flex items-center gap-2">
                                <span className="text-base" aria-hidden="true">{p.icon}</span>
                                <span className="font-medium text-white">{p.name}</span>
                              </div>
                            </td>
                            <td className="py-1.5 px-3 font-mono text-xs text-slate-400">:{p.port}</td>
                            <td className="py-1.5 px-3 text-right">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                                className="text-xs text-yellow-400"
                              >
                                ★
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Category groups or flat table */}
            {sortBy === 'category' ? (
              categoryOrder.map(cat => {
                const catProtocols = protocolsByCategory.get(cat);
                if (!catProtocols || catProtocols.length === 0) return null;
                return (
                  <ProtocolCategoryGroup
                    key={cat}
                    category={cat}
                    protocols={catProtocols}
                    isCollapsed={collapsedCategories.has(cat)}
                    onToggleCollapse={toggleCollapse}
                    onSelect={onSelect}
                    onToggleFavorite={toggleFavorite}
                    isFavorite={isFavorite}
                    focusedId={focusedId}
                  />
                );
              })
            ) : (
              <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-auto" />
                    <col className="w-24" />
                    <col className="w-16 hidden md:table-column" />
                    <col className="w-10" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-left py-1.5 px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Protocol</th>
                      <th className="text-left py-1.5 px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Port</th>
                      <th className="text-left py-1.5 px-3 hidden md:table-cell text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Year</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProtocols.map((protocol, idx) => (
                      <tr
                        key={protocol.id}
                        onClick={() => onSelect(protocol.id)}
                        className={`cursor-pointer transition-colors border-b border-slate-700/50 hover:bg-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${protocol.status === 'deprecated' ? 'opacity-50' : ''} ${focusedId === protocol.id ? 'bg-indigo-900/30' : ''}`}
                      >
                        <td className="py-1.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base" aria-hidden="true">{protocol.icon}</span>
                            <span className="font-medium text-white">{protocol.name}</span>
                            {protocol.status === 'deprecated' && (
                              <span className="text-[9px] uppercase text-red-400">DEP</span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-3 font-mono text-xs text-slate-400">
                          :{protocol.port}
                        </td>
                        <td className="py-1.5 px-3 hidden md:table-cell text-xs text-slate-500">
                          {protocol.year}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(protocol.id); }}
                            className={`text-xs ${isFavorite(protocol.id) ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-400'}`}
                          >
                            {isFavorite(protocol.id) ? '★' : '☆'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* About Tab */}
      {activeTab === 'about' && <AboutPage />}

      {/* RFCs Tab */}
      {activeTab === 'rfcs' && (() => {
        const allRFCEntries: Array<RFCEntry & { implemented?: boolean; protocolId?: string }> = [
          ...protocols
            .map(p => {
              const rfcMatch = p.description.match(/RFC\s*(\d+)/i);
              return {
                name: p.name,
                icon: p.icon,
                rfc: rfcMatch ? rfcMatch[1] : null,
                year: p.year,
                description: p.description.replace(/\s*\(RFC.*?\)\s*-?\s*/i, ' - '),
                workersCompatible: true,
                layer: 'Application' as const,
                implemented: true,
                protocolId: p.id,
              };
            })
            .filter(entry => entry.rfc !== null),
          ...nonImplementableRFCs
            .filter(r => r.rfc !== null)
            .map(r => ({ ...r, implemented: false })),
        ];

        const sortedRFCEntries = [...allRFCEntries].sort((a, b) => {
          if (rfcSortBy === 'rfc') {
            const aNum = a.rfc ? parseInt(a.rfc, 10) : 99999;
            const bNum = b.rfc ? parseInt(b.rfc, 10) : 99999;
            return rfcSortDirection === 'asc' ? aNum - bNum : bNum - aNum;
          } else if (rfcSortBy === 'year') {
            return rfcSortDirection === 'asc' ? a.year - b.year : b.year - a.year;
          }
          if (a.workersCompatible !== b.workersCompatible) {
            return a.workersCompatible ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const handleRFCSort = (column: 'rfc' | 'year') => {
          if (rfcSortBy === column) {
            setRfcSortDirection(rfcSortDirection === 'asc' ? 'desc' : 'asc');
          } else {
            setRfcSortBy(column);
            setRfcSortDirection('asc');
          }
        };

        const SortIndicator = ({ column }: { column: 'rfc' | 'year' }) => {
          if (rfcSortBy !== column) return <span className="opacity-30 ml-1">▼</span>;
          return <span className="ml-1">{rfcSortDirection === 'asc' ? '▲' : '▼'}</span>;
        };

        return (
          <div className="max-w-7xl mx-auto mt-8">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
              <h2 className="text-3xl font-bold mb-6 text-white">
                Comprehensive Protocol RFC List
              </h2>
              <p className="text-slate-300 text-sm mb-6">
                All protocol RFCs including Layer 2, 3, and 4 protocols. Shows implementation status on Cloudflare Workers TCP Sockets API.
                Click RFC or Year column headers to sort.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-600">
                      <th className="text-left py-3 px-4 text-slate-300 font-semibold">Protocol</th>
                      <th
                        className="text-left py-3 px-4 text-slate-300 font-semibold cursor-pointer hover:text-blue-400"
                        onClick={() => handleRFCSort('rfc')}
                      >
                        RFC <SortIndicator column="rfc" />
                      </th>
                      <th
                        className="text-center py-3 px-4 text-slate-300 font-semibold cursor-pointer hover:text-blue-400"
                        onClick={() => handleRFCSort('year')}
                      >
                        Year Created <SortIndicator column="year" />
                      </th>
                      <th className="text-center py-3 px-4 text-slate-300 font-semibold">Layer</th>
                      <th className="text-left py-3 px-4 text-slate-300 font-semibold">Description</th>
                      <th className="text-center py-3 px-4 text-slate-300 font-semibold">Workers Compatible</th>
                      <th className="text-center py-3 px-4 text-slate-300 font-semibold">Implemented</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRFCEntries.map((entry, idx) => (
                      <tr
                        key={`${entry.name}-${entry.rfc}`}
                        className={`border-b border-slate-700 ${idx % 2 === 0 ? 'bg-slate-800/50' : ''}`}
                      >
                        <td className="py-3 px-4 text-white font-medium">
                          {entry.implemented && entry.protocolId ? (
                            <button
                              onClick={() => onSelect(entry.protocolId!)}
                              className="flex items-center gap-2 text-blue-400 hover:text-blue-300 underline decoration-blue-400/40 hover:decoration-blue-300 underline-offset-2 transition-colors text-left"
                            >
                              <span className="text-xl" aria-hidden="true">{entry.icon}</span>
                              <span className="whitespace-nowrap">{entry.name}</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xl" aria-hidden="true">{entry.icon}</span>
                              <span className="whitespace-nowrap">{entry.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-blue-400">
                          {entry.rfc ? (
                            <a
                              href={`https://www.rfc-editor.org/rfc/rfc${entry.rfc}.html`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              RFC {entry.rfc}
                            </a>
                          ) : (
                            <span className="text-slate-500">N/A</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center text-slate-300">
                          {entry.year}
                        </td>
                        <td className="py-3 px-4 text-center text-slate-400">
                          <span className={`px-2 py-1 rounded text-xs ${
                            entry.layer === 'L2' ? 'bg-red-900/30 text-red-300' :
                            entry.layer === 'L3' ? 'bg-orange-900/30 text-orange-300' :
                            entry.layer === 'L4/L7' ? 'bg-yellow-900/30 text-yellow-300' :
                            'bg-green-900/30 text-green-300'
                          }`}>
                            {entry.layer}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 text-xs">
                          {entry.description}
                          {entry.reason && (
                            <div className="mt-1 text-slate-500 italic">
                              {entry.reason}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {entry.workersCompatible ? (
                            <span className="inline-flex items-center text-green-400">✓ Yes</span>
                          ) : (
                            <span className="inline-flex items-center text-red-400">✗ No</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {entry.implemented ? (
                            <span className="inline-flex items-center text-green-400">✓ Yes</span>
                          ) : (
                            <span className="inline-flex items-center text-slate-500">✗ No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 bg-slate-700/50 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">
                  <strong className="text-slate-300">Legend:</strong>
                </p>
                <ul className="text-xs text-slate-400 space-y-1 ml-4">
                  <li>• <strong>Workers Compatible:</strong> Whether the protocol can be implemented using Cloudflare Workers TCP Sockets API</li>
                  <li>• <strong>Implemented:</strong> Whether this protocol has been implemented in this application (includes both active and deprecated protocols)</li>
                  <li>• <strong>Layer:</strong> OSI model layer - L2 (Data Link), L3 (Network), L4/L7 (Transport/Application), Application (TCP-based)</li>
                  <li>• Workers only supports TCP connections via connect() API - UDP and raw Layer 2/3 protocols cannot be implemented</li>
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Checklist Tab */}
      {activeTab === 'checklist' && <ChecklistTab />}
    </div>
  );
}
