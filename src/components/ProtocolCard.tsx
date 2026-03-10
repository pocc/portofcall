import type { ReactNode } from 'react';
import type { Protocol } from '../types/protocols';
import { popularityConfig } from '../data/protocols';
import { useTheme } from '../contexts/ThemeContext';

function highlightMatch(text: string, query: string): ReactNode {
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

interface ProtocolCardProps {
  protocol: Protocol;
  onSelect: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  isFavorite?: boolean;
  searchQuery?: string;
  isFocused?: boolean;
}

export default function ProtocolCard({ protocol, onSelect, onToggleFavorite, isFavorite, searchQuery, isFocused }: ProtocolCardProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';
  const pop = popularityConfig[protocol.popularity];

  return (
    <div className="relative group">
      {onToggleFavorite && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(protocol.id); }}
          className={`absolute top-1.5 right-1.5 z-10 text-xs transition-opacity ${
            isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
          } ${isRetro ? 'retro-text-amber' : 'text-yellow-400 hover:text-yellow-300'}`}
          aria-label={isFavorite ? `Remove ${protocol.name} from favorites` : `Add ${protocol.name} to favorites`}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isRetro ? (isFavorite ? '[*]' : '[ ]') : (isFavorite ? '★' : '☆')}
        </button>
      )}
      <button
        onClick={() => onSelect(protocol.id)}
        className={`w-full text-left transition-all duration-150 ${
          isRetro
            ? `retro-card retro-button p-3 ${protocol.status === 'deprecated' ? 'opacity-50' : ''} ${isFocused ? 'retro-glow' : ''}`
            : `rounded-lg border p-3 ${
                protocol.status === 'deprecated'
                  ? 'border-dashed border-slate-600 opacity-50 bg-slate-800/50'
                  : 'border-slate-700 bg-slate-800 hover:bg-slate-750'
              } hover:scale-[1.02] hover:shadow-lg ${
                isFocused ? 'ring-2 ring-indigo-500 border-indigo-500/30' : 'hover:border-indigo-500/30'
              } focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none`
        }`}
        aria-label={`${protocol.name} on port ${protocol.port}${protocol.status === 'deprecated' ? ' (deprecated)' : ''}`}
      >
        {/* Row 1: Icon + Name + Port */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0" aria-hidden="true">{protocol.icon}</span>
            <span className={`font-semibold truncate ${isRetro ? 'retro-text' : 'text-white'}`}>
              {searchQuery ? highlightMatch(protocol.name, searchQuery) : protocol.name}
            </span>
            {protocol.status === 'deprecated' && (
              <span className={`text-[9px] uppercase flex-shrink-0 ${isRetro ? 'retro-text-amber' : 'text-red-400'}`}>DEP</span>
            )}
            {protocol.status === 'niche' && (
              <span className={`text-[9px] uppercase flex-shrink-0 ${isRetro ? 'retro-text-amber' : 'text-purple-400'}`}>NICHE</span>
            )}
          </div>
          <span className={`text-xs font-mono flex-shrink-0 ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
            :{protocol.port}
          </span>
        </div>

        {/* Row 2: Description */}
        <p className={`text-xs mt-1.5 line-clamp-2 ${isRetro ? 'retro-text' : 'text-slate-400'}`}>
          {searchQuery ? highlightMatch(protocol.description, searchQuery) : protocol.description}
        </p>

        {/* Row 3: Popularity bar + Year */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1.5">
            {isRetro ? (
              <span className="retro-text text-[10px]">
                [{('#').repeat(Math.ceil(pop.width / 10))}{('.').repeat(10 - Math.ceil(pop.width / 10))}]
              </span>
            ) : (
              <>
                <div className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${pop.barColor}`} style={{ width: `${pop.width}%` }} />
                </div>
                <span className={`text-[9px] ${pop.textColor}`}>{pop.label}</span>
              </>
            )}
          </div>
          <span className={`text-[9px] ${isRetro ? 'retro-text-amber' : 'text-slate-600'}`}>{protocol.year}</span>
        </div>
      </button>
    </div>
  );
}
