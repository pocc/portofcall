import { useState, useEffect, useMemo } from 'react';
import { protocols } from '../data/protocols';

type ChecklistState = Record<string, Record<string, boolean>>;

const categoryOrder = ['remote', 'files', 'databases', 'messaging', 'email', 'web', 'network', 'specialty'] as const;
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

/** All e2e tests that have been run (from e2e/protocols/*.spec.ts and smoke.spec.ts) */
const completedE2eTests: { protocol: string; tests: string[] }[] = [
  { protocol: 'Smoke Tests', tests: ['App loads and shows header', 'Command palette search works', 'Can navigate to a protocol via hash and back'] },
  { protocol: 'ECHO', tests: ['Sends message and receives echo match'] },
  { protocol: 'Discard', tests: ['Sends data and confirms discard'] },
  { protocol: 'Daytime', tests: ['Gets remote time'] },
  { protocol: 'CHARGEN', tests: ['Receives character stream'] },
  { protocol: 'TIME', tests: ['Gets binary time'] },
  { protocol: 'Finger', tests: ['Queries finger server'] },
  { protocol: 'PostgreSQL', tests: ['Connects to PostgreSQL server'] },
  { protocol: 'MySQL', tests: ['Connects to MySQL server'] },
  { protocol: 'MongoDB', tests: ['Connects to MongoDB server', 'Pings MongoDB server'] },
  { protocol: 'MQTT', tests: ['Connects to MQTT broker'] },
  { protocol: 'Redis', tests: ['Connects to Redis', 'PING returns PONG', 'SET and GET key', 'INFO server', 'KEYS returns response'] },
  { protocol: 'Memcached', tests: ['Connects to Memcached', 'Version command', 'Stats command', 'Set and get key'] },
  { protocol: 'SSH', tests: ['Connects to SSH server', 'Disconnects from SSH server', 'Can type in terminal after connecting'] },
  { protocol: 'Telnet', tests: ['Connects to Telnet server', 'Sends command and receives output'] },
  { protocol: 'IRC', tests: ['Connects to IRC server', 'Joins channel and sends message'] },
  { protocol: 'FTP', tests: ['Connects to FTP server', 'Lists directory after connect', 'Creates a directory', 'Uploads a file', 'Downloads a file', 'Renames a file', 'Deletes files', 'Removes directory'] },
];

export default function ChecklistTab() {
  const [checklist, setChecklist] = useState<ChecklistState>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/checklist')
      .then(r => r.json<ChecklistState>())
      .then(data => { setChecklist(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => categoryOrder.map(cat => ({
    category: cat,
    label: categoryLabels[cat],
    items: protocols.filter(p => p.category === cat),
  })), []);

  const { totalDone, totalItems, pct } = useMemo(() => {
    const done = protocols.reduce((acc, p) => {
      const state = checklist[p.id] ?? {};
      return acc + p.features.filter(f => state[f]).length;
    }, 0);
    const items = protocols.reduce((acc, p) => acc + p.features.length, 0);
    return { totalDone: done, totalItems: items, pct: items ? Math.round((done / items) * 100) : 0 };
  }, [checklist]);

  const totalE2eTests = completedE2eTests.reduce((acc, g) => acc + g.tests.length, 0);

  if (loading) {
    return (
      <div className="text-center py-16 text-slate-400">
        Loading checklist...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      {/* Summary header */}
      <div className="mb-8 p-4 rounded-xl bg-slate-800">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-slate-200">
            Overall Progress
          </span>
          <span className="text-sm text-slate-400">
            {totalDone} / {totalItems} ({pct}%)
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-slate-700">
          <div
            className="h-3 rounded-full transition-all duration-300 bg-blue-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Protocol groups — all items locked as done */}
      {grouped.map(({ category, label, items }) => (
        <div key={category} className="mb-10">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b text-slate-200 border-slate-700">
            {label}
          </h2>
          <div className="space-y-4">
            {items.map(protocol => {
              const state = checklist[protocol.id] ?? {};
              const done = protocol.features.filter(f => state[f]).length;
              const total = protocol.features.length;
              const allDone = done === total;
              return (
                <div
                  key={protocol.id}
                  className={`rounded-lg p-4 bg-slate-800/60 border ${allDone ? 'border-green-700/50' : 'border-slate-700/50'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2 text-slate-400">
                      <span className="opacity-60">{protocol.icon}</span>
                      <span>{protocol.name}</span>
                      {protocol.port > 0 && (
                        <span className="text-xs font-normal text-slate-600">
                          :{protocol.port}
                        </span>
                      )}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      allDone ? 'bg-green-900/50 text-green-400/70' : 'text-slate-500'
                    }`}>
                      {done}/{total}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {protocol.features.map(feature => {
                      const checked = !!(state[feature]);
                      return (
                        <label
                          key={feature}
                          className="flex items-center gap-3 select-none cursor-default opacity-60"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled
                            className="w-4 h-4 rounded accent-blue-500 cursor-default"
                          />
                          <span className={`text-sm ${
                            checked ? 'line-through text-slate-500' : 'text-slate-500'
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

      {/* Completed E2E Tests section */}
      <div className="mt-16 mb-10">
        <h2 className="text-lg font-bold mb-4 pb-2 border-b text-slate-200 border-slate-700">
          Playwright E2E Tests ({totalE2eTests} passed)
        </h2>
        <div className="space-y-4">
          {completedE2eTests.map(group => (
            <div key={group.protocol} className="rounded-lg p-4 bg-slate-800/40 border border-green-700/30">
              <h3 className="font-semibold flex items-center gap-2 mb-3 text-slate-400">
                <span className="text-green-500/70 text-xs">PASS</span>
                <span>{group.protocol}</span>
              </h3>
              <div className="space-y-1.5">
                {group.tests.map(t => (
                  <div key={t} className="flex items-center gap-3 opacity-50">
                    <input type="checkbox" checked disabled className="w-4 h-4 rounded accent-green-600 cursor-default" />
                    <span className="text-sm line-through text-slate-500">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
