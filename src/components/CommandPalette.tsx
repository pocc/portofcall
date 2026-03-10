import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Protocol } from '../types/protocols';
import { protocols, categoryConfig, popularityConfig } from '../data/protocols';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (protocolId: string) => void;
  favorites: string[];
  recent: string[];
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring match gets highest priority
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    // Word start or beginning of string bonus
    if (subIdx === 0) return 1000;
    if (t[subIdx - 1] === ' ' || t[subIdx - 1] === '-' || t[subIdx - 1] === '/') return 900;
    return 800;
  }

  // Fuzzy character matching
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-') ? 10 : 1;
      score += consecutive * 5; // Bonus for consecutive matches
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : 0;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function CommandPalette({ isOpen, onClose, onSelect, favorites, recent }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // Show favorites then recent when no query
      const favProtos = favorites
        .map(id => protocols.find(p => p.id === id))
        .filter((p): p is Protocol => !!p);
      const recentProtos = recent
        .filter(id => !favorites.includes(id))
        .map(id => protocols.find(p => p.id === id))
        .filter((p): p is Protocol => !!p);
      const shown = new Set([...favorites, ...recent]);
      const rest = protocols
        .filter(p => !shown.has(p.id) && p.status !== 'deprecated')
        .slice(0, 20 - favProtos.length - recentProtos.length);

      const sections: { label: string; protocols: Protocol[] }[] = [];
      if (favProtos.length > 0) sections.push({ label: 'Favorites', protocols: favProtos });
      if (recentProtos.length > 0) sections.push({ label: 'Recently Used', protocols: recentProtos });
      if (rest.length > 0) sections.push({ label: 'Popular', protocols: rest });
      return sections;
    }

    const q = query.trim();
    const scored = protocols
      .map(p => {
        // Score across multiple fields
        const nameScore = fuzzyScore(q, p.name);
        const idScore = fuzzyScore(q, p.id) * 0.9;
        const descScore = fuzzyScore(q, p.description) * 0.5;
        const portScore = p.port.toString() === q ? 500 : 0;
        const featureScore = Math.max(0, ...p.features.map(f => fuzzyScore(q, f) * 0.3));
        const score = Math.max(nameScore, idScore, descScore, portScore, featureScore);
        return { protocol: p, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(r => r.protocol);

    // Group favorites/recent matches first
    const favMatches = scored.filter(p => favorites.includes(p.id));
    const recentMatches = scored.filter(p => recent.includes(p.id) && !favorites.includes(p.id));
    const otherMatches = scored.filter(p => !favorites.includes(p.id) && !recent.includes(p.id));

    const sections: { label: string; protocols: Protocol[] }[] = [];
    if (favMatches.length > 0) sections.push({ label: 'Favorites', protocols: favMatches });
    if (recentMatches.length > 0) sections.push({ label: 'Recent', protocols: recentMatches });
    if (otherMatches.length > 0) sections.push({ label: 'All Protocols', protocols: otherMatches });
    return sections;
  }, [query, favorites, recent]);

  const flatResults = useMemo(() => results.flatMap(s => s.protocols), [results]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatResults[selectedIndex]) {
      e.preventDefault();
      onSelect(flatResults[selectedIndex].id);
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [flatResults, selectedIndex, onSelect, onClose]);

  // Scroll selected into view
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg mx-4 overflow-hidden bg-slate-800 border border-slate-600 rounded-xl shadow-2xl shadow-black/50"
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <span className="text-sm text-slate-400">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search protocols by name, port, or feature..."
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-slate-500"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 border border-slate-600">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {flatResults.length === 0 && query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No protocols found
            </div>
          )}

          {results.map(section => (
            <div key={section.label}>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold sticky top-0 text-slate-500 bg-slate-800/95 backdrop-blur-sm">
                {section.label}
              </div>
              {section.protocols.map(protocol => {
                const globalIdx = flatResults.indexOf(protocol);
                const isSelected = globalIdx === selectedIndex;
                const pop = popularityConfig[protocol.popularity];
                const cat = categoryConfig[protocol.category];
                return (
                  <button
                    key={protocol.id}
                    data-index={globalIdx}
                    onClick={() => { onSelect(protocol.id); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-indigo-900/40' : 'hover:bg-slate-700/50'
                    }`}
                  >
                    <span className="text-lg flex-shrink-0" aria-hidden="true">{protocol.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white">
                          {highlightMatch(protocol.name, query)}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          :{protocol.port}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${pop.textColor} bg-slate-700/50`}>
                          {cat.icon} {cat.label}
                        </span>
                      </div>
                      <p className="text-xs truncate mt-0.5 text-slate-400">
                        {highlightMatch(protocol.description, query)}
                      </p>
                    </div>
                    {favorites.includes(protocol.id) && (
                      <span className="text-yellow-400 text-xs flex-shrink-0">★</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 flex items-center gap-4 text-[10px] border-t border-slate-700 text-slate-500">
          <span><kbd className="bg-slate-700 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-slate-700 px-1 rounded">↵</kbd> select</span>
          <span><kbd className="bg-slate-700 px-1 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
