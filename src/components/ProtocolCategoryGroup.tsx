import { useRef } from 'react';
import type { Protocol, ProtocolCategory } from '../types/protocols';
import { categoryConfig } from '../data/protocols';
import { useTheme } from '../contexts/ThemeContext';
import ProtocolCard from './ProtocolCard';

interface ProtocolCategoryGroupProps {
  category: ProtocolCategory;
  protocols: Protocol[];
  isCollapsed: boolean;
  onToggleCollapse: (category: ProtocolCategory) => void;
  onSelect: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  isFavorite?: (id: string) => boolean;
  searchQuery?: string;
  focusedId?: string;
  viewMode: 'cards' | 'compact';
}

export default function ProtocolCategoryGroup({
  category,
  protocols,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onToggleFavorite,
  isFavorite,
  searchQuery,
  focusedId,
  viewMode,
}: ProtocolCategoryGroupProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';
  const cfg = categoryConfig[category];
  const headerRef = useRef<HTMLDivElement>(null);

  if (protocols.length === 0) return null;

  return (
    <div id={`category-${category}`} ref={headerRef} className="mb-6">
      {/* Category Header */}
      <button
        onClick={() => onToggleCollapse(category)}
        className={`w-full flex items-center justify-between px-4 py-2.5 mb-3 transition-colors ${
          isRetro
            ? 'retro-border retro-button'
            : 'bg-slate-800/80 border border-slate-700 rounded-lg hover:bg-slate-700/80'
        }`}
        aria-expanded={!isCollapsed}
        aria-controls={`category-content-${category}`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{cfg.icon}</span>
          <span className={`font-semibold text-sm ${isRetro ? 'retro-text' : 'text-white'}`}>
            {cfg.label}
          </span>
          <span className={`text-xs ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
            ({protocols.length})
          </span>
        </div>
        <span className={`text-xs transition-transform ${isCollapsed ? '' : 'rotate-180'} ${isRetro ? 'retro-text' : 'text-slate-400'}`}>
          {isRetro ? (isCollapsed ? '[+]' : '[-]') : '▼'}
        </span>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div id={`category-content-${category}`}>
          {viewMode === 'cards' ? (
            <div className={isRetro ? 'retro-grid' : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'}>
              {protocols.map(protocol => (
                <ProtocolCard
                  key={protocol.id}
                  protocol={protocol}
                  onSelect={onSelect}
                  onToggleFavorite={onToggleFavorite}
                  isFavorite={isFavorite?.(protocol.id)}
                  searchQuery={searchQuery}
                  isFocused={focusedId === protocol.id}
                />
              ))}
            </div>
          ) : (
            <div className={`${isRetro ? 'retro-box' : 'bg-slate-800/50 rounded-lg border border-slate-700'} overflow-hidden`}>
              <table className="w-full text-sm">
                <tbody>
                  {protocols.map((protocol, idx) => (
                    <tr
                      key={protocol.id}
                      onClick={() => onSelect(protocol.id)}
                      className={`cursor-pointer transition-colors ${
                        isRetro
                          ? 'retro-border hover:bg-green-900/20'
                          : `border-b border-slate-700/50 hover:bg-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${protocol.status === 'deprecated' ? 'opacity-50' : ''}`
                      } ${focusedId === protocol.id ? (isRetro ? 'bg-green-900/30' : 'bg-indigo-900/30') : ''}`}
                    >
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base" aria-hidden="true">{protocol.icon}</span>
                          <span className={`font-medium ${isRetro ? 'retro-text' : 'text-white'}`}>
                            {searchQuery ? (
                              <HighlightText text={protocol.name} query={searchQuery} />
                            ) : protocol.name}
                          </span>
                          {protocol.status === 'deprecated' && (
                            <span className={`text-[9px] uppercase ${isRetro ? 'retro-text-amber' : 'text-red-400'}`}>DEP</span>
                          )}
                        </div>
                      </td>
                      <td className={`py-1.5 px-3 font-mono text-xs ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
                        :{protocol.port}
                      </td>
                      <td className={`py-1.5 px-3 hidden md:table-cell text-xs ${isRetro ? 'retro-text' : 'text-slate-500'}`}>
                        {protocol.year}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {onToggleFavorite && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite(protocol.id); }}
                            className={`text-xs ${isFavorite?.(protocol.id) ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-400'}`}
                          >
                            {isFavorite?.(protocol.id) ? '★' : '☆'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
