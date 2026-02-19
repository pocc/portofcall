import { useState } from 'react';

export interface CurlExample {
  title: string;
  command: string;
}

interface ApiExamplesProps {
  examples: CurlExample[];
}

export default function ApiExamples({ examples }: ApiExamplesProps) {
  const [open, setOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (examples.length === 0) return null;

  const handleCopy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback: select text
    }
  };

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-500 text-slate-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-expanded={open}
      >
        <span className="font-mono text-blue-400 text-xs">{'{}'}</span>
        API Examples
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 bg-slate-900 border border-slate-600 rounded-xl p-4 space-y-4">
          <p className="text-xs text-slate-400">
            Use these curl commands to interact with the API directly. Replace example values with your own.
          </p>
          {examples.map((example, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">{example.title}</span>
                <button
                  onClick={() => handleCopy(example.command, i)}
                  className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-700"
                >
                  {copiedIndex === i ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs text-green-400 bg-slate-950 rounded-lg p-3 overflow-x-auto font-mono whitespace-pre-wrap break-all">
                {example.command}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
