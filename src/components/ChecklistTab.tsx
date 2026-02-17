import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { protocols } from './ProtocolSelector';

type ChecklistState = Record<string, Record<string, boolean>>;

const categoryOrder = ['databases', 'messaging', 'email', 'remote', 'files', 'web', 'network', 'specialty'] as const;
const categoryLabels: Record<string, string> = {
  databases: 'Databases',
  messaging: 'Messaging',
  email: 'Email',
  remote: 'Remote Access',
  files: 'File Transfer',
  web: 'Web & APIs',
  network: 'Network',
  specialty: 'Specialty',
};

export default function ChecklistTab() {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';
  const [checklist, setChecklist] = useState<ChecklistState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'complete'>('all');

  useEffect(() => {
    fetch('/api/checklist')
      .then(r => r.json<ChecklistState>())
      .then(data => { setChecklist(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggle = useCallback(async (protocolId: string, item: string, checked: boolean) => {
    // Optimistic update
    setChecklist(prev => ({
      ...prev,
      [protocolId]: { ...(prev[protocolId] ?? {}), [item]: checked },
    }));
    setSaving(`${protocolId}:${item}`);
    try {
      await fetch('/api/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolId, item, checked }),
      });
    } catch {
      // Revert on failure
      setChecklist(prev => ({
        ...prev,
        [protocolId]: { ...(prev[protocolId] ?? {}), [item]: !checked },
      }));
    } finally {
      setSaving(null);
    }
  }, []);

  const getProgress = (protocolId: string, features: string[]) => {
    const state = checklist[protocolId] ?? {};
    const done = features.filter(f => state[f]).length;
    return { done, total: features.length };
  };

  const grouped = categoryOrder.map(cat => ({
    category: cat,
    label: categoryLabels[cat],
    items: protocols.filter(p => p.category === cat),
  }));

  const filteredGrouped = grouped.map(g => ({
    ...g,
    items: g.items.filter(p => {
      const { done, total } = getProgress(p.id, p.features);
      if (filter === 'complete') return done === total && total > 0;
      if (filter === 'incomplete') return done < total;
      return true;
    }),
  })).filter(g => g.items.length > 0);

  const totalDone = protocols.reduce((acc, p) => {
    const state = checklist[p.id] ?? {};
    return acc + p.features.filter(f => state[f]).length;
  }, 0);
  const totalItems = protocols.reduce((acc, p) => acc + p.features.length, 0);
  const pct = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

  if (loading) {
    return (
      <div className={`text-center py-16 ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
        {isRetro ? 'LOADING CHECKLIST...' : 'Loading checklist...'}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      {/* Summary header */}
      <div className={`mb-8 p-4 rounded-xl ${isRetro ? 'retro-panel' : 'bg-slate-800'}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`font-semibold ${isRetro ? 'retro-text' : 'text-slate-200'}`}>
            {isRetro ? 'OVERALL PROGRESS' : 'Overall Progress'}
          </span>
          <span className={`text-sm ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
            {totalDone} / {totalItems} ({pct}%)
          </span>
        </div>
        <div className={`w-full h-3 rounded-full ${isRetro ? 'bg-slate-900' : 'bg-slate-700'}`}>
          <div
            className={`h-3 rounded-full transition-all duration-300 ${isRetro ? 'bg-green-400' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex gap-2 mb-8 justify-center flex-wrap">
        {(['all', 'incomplete', 'complete'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium transition-all ${
              isRetro
                ? `retro-button ${filter === f ? 'retro-glow retro-text' : 'retro-text-amber'}`
                : `rounded-lg ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`
            }`}
          >
            {f === 'all' ? 'All' : f === 'incomplete' ? 'Incomplete' : 'Complete'}
          </button>
        ))}
      </div>

      {/* Protocol groups */}
      {filteredGrouped.map(({ category, label, items }) => (
        <div key={category} className="mb-10">
          <h2 className={`text-lg font-bold mb-4 pb-2 border-b ${
            isRetro
              ? 'retro-text border-green-800'
              : 'text-slate-200 border-slate-700'
          }`}>
            {label}
          </h2>
          <div className="space-y-4">
            {items.map(protocol => {
              const { done, total } = getProgress(protocol.id, protocol.features);
              const allDone = done === total;
              const state = checklist[protocol.id] ?? {};
              return (
                <div
                  key={protocol.id}
                  className={`rounded-lg p-4 ${
                    isRetro
                      ? 'retro-panel'
                      : `bg-slate-800 border ${allDone ? 'border-green-700' : 'border-slate-700'}`
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={`font-semibold flex items-center gap-2 ${isRetro ? 'retro-text' : 'text-slate-100'}`}>
                      <span>{protocol.icon}</span>
                      <span>{protocol.name}</span>
                      {protocol.port > 0 && (
                        <span className={`text-xs font-normal ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
                          :{protocol.port}
                        </span>
                      )}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      allDone
                        ? isRetro ? 'retro-text bg-green-900' : 'bg-green-900 text-green-300'
                        : isRetro ? 'retro-text-amber' : 'text-slate-400'
                    }`}>
                      {done}/{total}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {protocol.features.map(feature => {
                      const checked = !!(state[feature]);
                      const key = `${protocol.id}:${feature}`;
                      const isSaving = saving === key;
                      return (
                        <label
                          key={feature}
                          className={`flex items-center gap-3 cursor-pointer group select-none ${
                            isSaving ? 'opacity-60' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isSaving}
                            onChange={e => toggle(protocol.id, feature, e.target.checked)}
                            className={`w-4 h-4 rounded cursor-pointer ${
                              isRetro
                                ? 'accent-green-400'
                                : 'accent-blue-500'
                            }`}
                          />
                          <span className={`text-sm transition-colors ${
                            checked
                              ? isRetro ? 'line-through retro-text-amber opacity-60' : 'line-through text-slate-500'
                              : isRetro ? 'retro-text' : 'text-slate-300 group-hover:text-slate-100'
                          }`}>
                            {feature}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {filteredGrouped.length === 0 && (
        <div className={`text-center py-16 ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
          No protocols match this filter.
        </div>
      )}
    </div>
  );
}
