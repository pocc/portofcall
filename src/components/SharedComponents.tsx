/**
 * Shared UI components used by protocol clients.
 * Re-exports common components from ProtocolClientLayout and adds
 * additional components (StatusMessage, ConnectionInfo, ResultDisplay with data prop).
 */

export { SectionHeader, FormField, ActionButton } from './ProtocolClientLayout';

interface StatusMessageProps {
  type: 'error' | 'success' | 'info';
  message: string;
}

export function StatusMessage({ type, message }: StatusMessageProps) {
  const styles = {
    error: 'bg-red-950/30 border-red-500/20 text-red-300',
    success: 'bg-emerald-950/30 border-emerald-500/20 text-emerald-300',
    info: 'bg-blue-950/30 border-blue-500/20 text-blue-300',
  };

  const icons = {
    error: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    success: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    info: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className={`border rounded-xl p-3.5 text-sm flex items-start gap-2.5 ${styles[type]}`}>
      {icons[type]}
      <span>{message}</span>
    </div>
  );
}

interface ConnectionInfoProps {
  items: Array<{ label: string; value: string }>;
}

export function ConnectionInfo({ items }: ConnectionInfoProps) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400 mb-4">
      {items.map(({ label, value }) => (
        <div key={label} className="flex gap-1.5 items-center">
          <span className="text-slate-500 text-xs uppercase tracking-wider">{label}</span>
          <span className="text-slate-200 font-mono text-xs bg-slate-800/50 px-2 py-0.5 rounded">{value}</span>
        </div>
      ))}
    </div>
  );
}

interface ResultDisplayProps {
  title: string;
  data: Record<string, string>;
}

export function ResultDisplay({ title, data }: ResultDisplayProps) {
  return (
    <div className="bg-slate-800/60 backdrop-blur-sm rounded-xl p-4 border border-slate-700/40">
      <h4 className="text-white font-semibold mb-3 text-sm">{title}</h4>
      <div className="space-y-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex gap-3 text-sm">
            <span className="text-slate-500 min-w-[100px] text-xs uppercase tracking-wider pt-0.5">{key}</span>
            <span className="text-slate-200 font-mono text-xs">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
