import { useRef } from 'react';
import type { Protocol, ProtocolCategory } from '../types/protocols';
import { categoryConfig } from '../data/protocols';

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
}: ProtocolCategoryGroupProps) {
  const cfg = categoryConfig[category];
  const headerRef = useRef<HTMLDivElement>(null);

  if (protocols.length === 0) return null;

  return (
    <div id={`category-${category}`} ref={headerRef} className="mb-6">
      {/* Category Header */}
      <button
        onClick={() => onToggleCollapse(category)}
        className="w-full flex items-center justify-between px-4 py-2.5 mb-3 transition-colors bg-slate-800/80 border border-slate-700 rounded-lg hover:bg-slate-700/80"
        aria-expanded={!isCollapsed}
        aria-controls={`category-content-${category}`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{cfg.icon}</span>
          <span className="font-semibold text-sm text-white">
            {cfg.label}
          </span>
          <span className="text-xs text-slate-500">
            ({protocols.length})
          </span>
        </div>
        <span className={`text-xs transition-transform ${isCollapsed ? '' : 'rotate-180'} text-slate-400`}>
          ▼
        </span>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div id={`category-content-${category}`}>
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
                {protocols.map((protocol, idx) => (
                  <tr
                    key={protocol.id}
                    onClick={() => onSelect(protocol.id)}
                    className={`cursor-pointer transition-colors border-b border-slate-700/50 hover:bg-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${protocol.status === 'deprecated' ? 'opacity-50' : ''} ${focusedId === protocol.id ? 'bg-indigo-900/30' : ''}`}
                  >
                    <td className="py-1.5 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden="true">{protocol.icon}</span>
                        <span className="font-medium text-white">
                          {searchQuery ? (
                            <HighlightText text={protocol.name} query={searchQuery} />
                          ) : protocol.name}
                        </span>
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
