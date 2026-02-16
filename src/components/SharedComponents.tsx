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
    error: 'bg-red-900/30 border-red-600/40 text-red-300',
    success: 'bg-green-900/30 border-green-600/40 text-green-300',
    info: 'bg-blue-900/30 border-blue-600/40 text-blue-300',
  };

  return (
    <div className={`border rounded-lg p-3 text-sm ${styles[type]}`}>
      {message}
    </div>
  );
}

interface ConnectionInfoProps {
  items: Array<{ label: string; value: string }>;
}

export function ConnectionInfo({ items }: ConnectionInfoProps) {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-slate-400 mb-4">
      {items.map(({ label, value }) => (
        <div key={label} className="flex gap-1">
          <span className="text-slate-500">{label}:</span>
          <span className="text-slate-300 font-mono">{value}</span>
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
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h4 className="text-white font-semibold mb-2">{title}</h4>
      <div className="space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex gap-2 text-sm">
            <span className="text-slate-400 min-w-[100px]">{key}:</span>
            <span className="text-slate-200 font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
