import { useState, useRef, useEffect, useMemo } from 'react';

export interface CurlExample {
  title: string;
  description?: string;
  command: string;
}

interface ApiExamplesProps {
  examples: CurlExample[];
  protocolId?: string;
}

function substituteValues(command: string, protocolId: string): string {
  const prefix = `poc-form:${protocolId}-`;
  const host = localStorage.getItem(`${prefix}host`) || '';
  const port = localStorage.getItem(`${prefix}port`) || '';
  const username = localStorage.getItem(`${prefix}username`) ||
                   localStorage.getItem(`${prefix}user`) || '';
  const database = localStorage.getItem(`${prefix}database`) || '';

  let result = command;
  if (host) result = result.replace(/"host":\s*"[^"]*"/g, `"host": "${host}"`);
  if (port) result = result.replace(/"port":\s*\d+/g, `"port": ${port}`);
  if (username) result = result.replace(/"username":\s*"[^"]*"/g, `"username": "${username}"`);
  if (database) result = result.replace(/"database":\s*"[^"]*"/g, `"database": "${database}"`);
  return result;
}

export default function ApiExamples({ examples, protocolId }: ApiExamplesProps) {
  const [open, setOpen] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [storageVersion, setStorageVersion] = useState(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => { clearTimeout(copyTimerRef.current); };
  }, []);

  // Re-read localStorage when panel opens to pick up latest form values
  useEffect(() => {
    if (open) setStorageVersion(v => v + 1);
  }, [open]);

  const processedExamples = useMemo(() => {
    if (!protocolId) return examples;
    // storageVersion dependency forces re-computation when panel opens
    void storageVersion;
    return examples.map(ex => ({
      ...ex,
      command: substituteValues(ex.command, protocolId),
    }));
  }, [examples, protocolId, storageVersion]);

  if (examples.length === 0) return null;

  const handleCopy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback: select text
    }
  };

  return (
    <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
      {/* Section header — always visible, acts as toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/50 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-blue-400">{'{ }'}</span>
          <span className="font-semibold text-white text-sm">API Reference</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
            {examples.length} endpoint{examples.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {protocolId ? 'Curl commands pre-filled with your connection details' : 'Use these curl commands to interact with the API directly'}
          </span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="divide-y divide-slate-800/60 border-t border-slate-700/60">
          {processedExamples.map((example, i) => (
            <div key={i} className="px-5 py-4 hover:bg-slate-800/20 transition-colors">
              {/* Endpoint title + copy button */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-slate-200 font-mono">{example.title}</span>
                <button
                  onClick={() => handleCopy(example.command, i)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-all duration-200 ${
                    copiedIndex === i
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                  }`}
                >
                  {copiedIndex === i ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {/* Human-readable description */}
              {example.description && (
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">{example.description}</p>
              )}

              {/* Curl command */}
              <pre className="text-xs text-emerald-400/80 bg-slate-950/50 rounded-lg p-3 overflow-x-auto font-mono whitespace-pre leading-relaxed border border-slate-800/40">
                {example.command}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
