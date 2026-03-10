import { useCallback } from 'react';
import type { ProtocolCategory, SortOption } from '../types/protocols';
import { protocols, categoryConfig, categoryOrder } from '../data/protocols';

interface ProtocolSidebarProps {
  selectedCategory: 'all' | ProtocolCategory;
  onCategoryChange: (category: 'all' | ProtocolCategory) => void;
  statusFilter: 'all' | 'active' | 'deprecated';
  onStatusFilterChange: (filter: 'all' | 'active' | 'deprecated') => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  onOpenCommandPalette: () => void;
  favorites: string[];
  recent: string[];
  onSelect: (protocolId: string) => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

export default function ProtocolSidebar({
  selectedCategory,
  onCategoryChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  onOpenCommandPalette,
  favorites,
  recent,
  onSelect,
  isMobileOpen,
  onMobileClose,
}: ProtocolSidebarProps) {

  const getCategoryCount = useCallback((cat: 'all' | ProtocolCategory) => {
    if (cat === 'all') return protocols.length;
    return protocols.filter(p => p.category === cat).length;
  }, []);

  const scrollToCategory = useCallback((cat: ProtocolCategory) => {
    onCategoryChange(cat);
    const el = document.getElementById(`category-${cat}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onMobileClose();
  }, [onCategoryChange, onMobileClose]);

  const favoriteProtocols = favorites
    .map(id => protocols.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 5);

  const recentProtocols = recent
    .filter(id => !favorites.includes(id))
    .map(id => protocols.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 5);

  const activeCount = protocols.filter(p => p.status !== 'deprecated').length;
  const deprecatedCount = protocols.filter(p => p.status === 'deprecated').length;

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Search trigger */}
      <button
        onClick={() => { onOpenCommandPalette(); onMobileClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 mb-4 text-sm bg-slate-700/50 border border-slate-600 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white"
      >
        <span>🔍</span>
        <span className="flex-1 text-left text-xs">Search...</span>
        <kbd className="text-[10px] bg-slate-600 text-slate-400 px-1.5 py-0.5 rounded">⌘K</kbd>
      </button>

      {/* Favorites */}
      {favoriteProtocols.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-1 text-slate-500">
            Favorites
          </h3>
          {favoriteProtocols.map(p => p && (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); onMobileClose(); }}
              className="w-full text-left px-2 py-1 text-xs flex items-center gap-2 transition-colors rounded text-slate-300 hover:bg-slate-700/50 hover:text-white"
            >
              <span className="text-sm">{p.icon}</span>
              <span className="truncate">{p.name}</span>
              <span className="font-mono text-[10px] ml-auto text-slate-600">:{p.port}</span>
            </button>
          ))}
        </div>
      )}

      {/* Recently Used */}
      {recentProtocols.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-1 text-slate-500">
            Recently Used
          </h3>
          {recentProtocols.map(p => p && (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); onMobileClose(); }}
              className="w-full text-left px-2 py-1 text-xs flex items-center gap-2 transition-colors rounded text-slate-300 hover:bg-slate-700/50 hover:text-white"
            >
              <span className="text-sm">{p.icon}</span>
              <span className="truncate">{p.name}</span>
              <span className="font-mono text-[10px] ml-auto text-slate-600">:{p.port}</span>
            </button>
          ))}
        </div>
      )}

      {/* Categories */}
      <div className="mb-4">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-1 text-slate-500">
          Categories
        </h3>
        {categoryOrder.map(cat => {
          const cfg = categoryConfig[cat];
          const count = getCategoryCount(cat);
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => scrollToCategory(cat)}
              className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 transition-colors rounded ${
                isActive ? 'bg-indigo-900/40 text-white' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <span>{cfg.icon}</span>
              <span className="flex-1">{cfg.label}</span>
              <span className="text-[10px] text-slate-600">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mb-4 border-t border-slate-700" />

      {/* Status Filter */}
      <div className="mb-4">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-1 text-slate-500">
          Status
        </h3>
        <div className="space-y-1">
          {[
            { value: 'all' as const, label: `All (${protocols.length})` },
            { value: 'active' as const, label: `Active (${activeCount})` },
            { value: 'deprecated' as const, label: `Historical (${deprecatedCount})` },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => onStatusFilterChange(opt.value)}
              className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 rounded transition-colors ${
                statusFilter === opt.value ? 'text-white bg-slate-700/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${statusFilter === opt.value ? 'bg-indigo-500' : 'bg-slate-600'}`} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="mb-4">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-1 text-slate-500">
          Sort
        </h3>
        <div className="space-y-1">
          {[
            { value: 'popularity' as SortOption, label: 'Commonality' },
            { value: 'year-asc' as SortOption, label: 'Year (Oldest)' },
            { value: 'year-desc' as SortOption, label: 'Year (Newest)' },
            { value: 'port-asc' as SortOption, label: 'Port (Low→High)' },
            { value: 'port-desc' as SortOption, label: 'Port (High→Low)' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => onSortChange(opt.value)}
              className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 rounded transition-colors ${
                sortBy === opt.value ? 'text-white bg-slate-700/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${sortBy === opt.value ? 'bg-indigo-500' : 'bg-slate-600'}`} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="mt-auto pt-4">
        <div className="text-[10px] space-y-0.5 text-slate-600">
          <div><kbd className="bg-slate-700 px-1 rounded text-slate-400">⌘K</kbd> search</div>
          <div><kbd className="bg-slate-700 px-1 rounded text-slate-400">j/k</kbd> navigate</div>
          <div><kbd className="bg-slate-700 px-1 rounded text-slate-400">f</kbd> favorite</div>
          <div><kbd className="bg-slate-700 px-1 rounded text-slate-400">1-8</kbd> category</div>
          <div><kbd className="bg-slate-700 px-1 rounded text-slate-400">?</kbd> shortcuts</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-60 flex-shrink-0 sticky top-4 h-[calc(100vh-2rem)] overflow-y-auto px-3 py-4 mr-6 bg-slate-800/70 backdrop-blur-md border border-slate-700 rounded-xl">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={onMobileClose}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-72 overflow-y-auto px-4 py-6 bg-slate-800 border-r border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm text-white">Menu</span>
              <button
                onClick={onMobileClose}
                className="p-1 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
