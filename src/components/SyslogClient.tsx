import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface SyslogClientProps {
  onBack: () => void;
}

interface LogEntry {
  severity: number;
  severityName: string;
  message: string;
  timestamp: Date;
  formatted: string;
}

const SEVERITY_INFO = [
  { value: 0, name: 'Emergency', color: '#DC2626', desc: 'System is unusable' },
  { value: 1, name: 'Alert', color: '#EA580C', desc: 'Action must be taken immediately' },
  { value: 2, name: 'Critical', color: '#F97316', desc: 'Critical conditions' },
  { value: 3, name: 'Error', color: '#FB923C', desc: 'Error conditions' },
  { value: 4, name: 'Warning', color: '#FBBF24', desc: 'Warning conditions' },
  { value: 5, name: 'Notice', color: '#10B981', desc: 'Normal but significant condition' },
  { value: 6, name: 'Informational', color: '#3B82F6', desc: 'Informational messages' },
  { value: 7, name: 'Debug', color: '#9CA3AF', desc: 'Debug-level messages' },
];

export default function SyslogClient({ onBack }: SyslogClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('514');
  const [severity, setSeverity] = useState(6); // Informational
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<'rfc5424' | 'rfc3164'>('rfc5424');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [logHistory, setLogHistory] = useState<LogEntry[]>([]);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    message: [validationRules.required('Message is required')],
  });

  const handleSendLog = async () => {
    const isValid = validateAll({ host, port, message });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/syslog/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          severity,
          facility: 16, // Local0
          message,
          hostname: 'portofcall',
          appName: 'webapp',
          format,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        formatted?: string;
      };

      if (response.ok && data.success) {
        setResult(`✅ ${data.message}`);

        // Add to log history
        const newEntry: LogEntry = {
          severity,
          severityName: SEVERITY_INFO[severity].name,
          message,
          timestamp: new Date(),
          formatted: data.formatted || '',
        };
        setLogHistory([newEntry, ...logHistory].slice(0, 20)); // Keep last 20

        // Clear message input
        setMessage('');
      } else {
        setError(data.error || 'Failed to send syslog message');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send syslog message');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port && message) {
      handleSendLog();
    }
  };

  const handleQuickLog = (sev: number, msg: string) => {
    setSeverity(sev);
    setMessage(msg);
  };

  const getSeverityColor = (sev: number): string => {
    return SEVERITY_INFO[sev]?.color || '#9CA3AF';
  };

  return (
    <ProtocolClientLayout title="Syslog Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Syslog || []} />
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Configuration & Send Panel */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <SectionHeader stepNumber={1} title="Syslog Configuration" />

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <FormField
                id="syslog-host"
                label="Syslog Server"
                type="text"
                value={host}
                onChange={setHost}
                onKeyDown={handleKeyDown}
                placeholder="syslog.example.com"
                required
                error={errors.host}
              />

              <FormField
                id="syslog-port"
                label="Port"
                type="number"
                value={port}
                onChange={setPort}
                onKeyDown={handleKeyDown}
                min="1"
                max="65535"
                helpText="514 (TCP), 6514 (TLS)"
                error={errors.port}
              />

              <div>
                <label htmlFor="syslog-severity" className="block text-sm font-medium text-slate-300 mb-1">
                  Severity Level <span className="text-red-400" aria-label="required">*</span>
                </label>
                <select
                  id="syslog-severity"
                  value={severity}
                  onChange={(e) => setSeverity(parseInt(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-required="true"
                >
                  {SEVERITY_INFO.map((sev) => (
                    <option key={sev.value} value={sev.value}>
                      {sev.name} ({sev.value}) - {sev.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="syslog-format" className="block text-sm font-medium text-slate-300 mb-1">
                  Message Format
                </label>
                <select
                  id="syslog-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'rfc5424' | 'rfc3164')}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="rfc5424">RFC 5424 (Modern)</option>
                  <option value="rfc3164">RFC 3164 (Legacy/BSD)</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <FormField
                  id="syslog-message"
                  label="Log Message"
                  type="text"
                  value={message}
                  onChange={setMessage}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your log message..."
                  required
                  error={errors.message}
                />
              </div>
            </div>

            <ActionButton
              onClick={handleSendLog}
              disabled={loading || !host || !port || !message}
              loading={loading}
              ariaLabel="Send syslog message"
            >
              Send Log Message
            </ActionButton>

            <ResultDisplay result={result} error={error} />

            <HelpSection
              title="About Syslog Protocol"
              description="Syslog (RFC 5424/3164) provides centralized logging for applications and systems. Messages include severity levels (0=Emergency to 7=Debug) and facility codes. Commonly used in SIEM systems and enterprise monitoring."
              showKeyboardShortcut={true}
            />

            {/* Quick Log Templates */}
            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Log Templates</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleQuickLog(3, 'Application error occurred')}
                  className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                >
                  <span className="font-semibold" style={{ color: getSeverityColor(3) }}>Error</span>
                  <span className="block text-xs text-slate-400">Application error</span>
                </button>
                <button
                  onClick={() => handleQuickLog(4, 'High memory usage detected')}
                  className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                >
                  <span className="font-semibold" style={{ color: getSeverityColor(4) }}>Warning</span>
                  <span className="block text-xs text-slate-400">High memory usage</span>
                </button>
                <button
                  onClick={() => handleQuickLog(6, 'User logged in successfully')}
                  className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                >
                  <span className="font-semibold" style={{ color: getSeverityColor(6) }}>Info</span>
                  <span className="block text-xs text-slate-400">User logged in</span>
                </button>
                <button
                  onClick={() => handleQuickLog(7, 'Debug: Processing request')}
                  className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                >
                  <span className="font-semibold" style={{ color: getSeverityColor(7) }}>Debug</span>
                  <span className="block text-xs text-slate-400">Processing request</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Log History Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Log History</h2>
              {logHistory.length > 0 && (
                <button
                  onClick={() => setLogHistory([])}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                  aria-label="Clear log history"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logHistory.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No logs sent yet
                </div>
              ) : (
                logHistory.map((log, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-700 border-l-4 rounded p-3 text-sm"
                    style={{ borderLeftColor: getSeverityColor(log.severity) }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="font-semibold text-xs"
                        style={{ color: getSeverityColor(log.severity) }}
                      >
                        {log.severityName}
                      </span>
                      <span className="text-xs text-slate-400">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-300 mb-2 break-words">{log.message}</div>
                    {log.formatted && (
                      <div className="text-xs text-slate-500 font-mono break-all">
                        {log.formatted}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
