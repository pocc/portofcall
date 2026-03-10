import { useState, useRef, useEffect, useMemo } from 'react';

export interface CurlExample {
  title: string;
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
  if (host) result = result.replace(/"host":"[^"]*"/g, `"host":"${host}"`);
  if (port) result = result.replace(/"port":\d+/g, `"port":${port}`);
  if (username) result = result.replace(/"username":"[^"]*"/g, `"username":"${username}"`);
  if (database) result = result.replace(/"database":"[^"]*"/g, `"database":"${database}"`);
  return result;
}

export default function ApiExamples({ examples, protocolId }: ApiExamplesProps) {
  const [open, setOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [storageVersion, setStorageVersion] = useState(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);

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
    <div className="mt-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-lg px-2 py-1.5 -ml-2 group"
        aria-expanded={open}
      >
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-mono text-xs text-blue-400/70 group-hover:text-blue-400">{'{ }'}</span>
        <span className="font-medium">API Reference</span>
        <span className="text-xs text-slate-500">({examples.length} endpoint{examples.length !== 1 ? 's' : ''})</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm overflow-hidden animate-in fade-in duration-200"
        >
          <div className="px-4 py-3 border-b border-slate-700/40 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {protocolId
                ? 'Curl commands populated with your connection details.'
                : 'Use these curl commands to interact with the API directly.'}
            </p>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded"
              aria-label="Close API examples"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-800/60">
            {processedExamples.map((example, i) => (
              <div key={i} className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 font-mono">{example.title}</span>
                  <button
                    onClick={() => handleCopy(example.command, i)}
                    className={`text-xs px-2 py-0.5 rounded-md transition-all duration-200 ${
                      copiedIndex === i
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-slate-500 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {copiedIndex === i ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="text-xs text-emerald-400/80 bg-slate-950/50 rounded-lg p-3 overflow-x-auto font-mono whitespace-pre-wrap break-all leading-relaxed border border-slate-800/40">
                  {example.command}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
