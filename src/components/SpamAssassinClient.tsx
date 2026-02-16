import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SpamAssassinClientProps {
  onBack: () => void;
}

export default function SpamAssassinClient({ onBack }: SpamAssassinClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('783');
  const [message, setMessage] = useState(
    'From: sender@example.com\r\n' +
    'To: recipient@example.com\r\n' +
    'Subject: Test message\r\n' +
    '\r\n' +
    'This is a test email message for SpamAssassin analysis.\r\n'
  );
  const [command, setCommand] = useState<'CHECK' | 'SYMBOLS' | 'REPORT'>('SYMBOLS');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handlePing = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/spamd/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        version?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `SpamAssassin spamd is running!\n\n` +
          `Host:     ${data.host}\n` +
          `Port:     ${data.port}\n` +
          `Version:  SPAMD/${data.version || 'unknown'}\n` +
          `RTT:      ${data.rtt}ms\n\n` +
          `Server responded with PONG. Use "Check Message" to analyze email content.`
        );
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!message.trim()) {
      setError('Message content is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/spamd/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          message,
          command,
          timeout: 30000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        command?: string;
        isSpam?: boolean;
        score?: number;
        threshold?: number;
        symbols?: string[];
        report?: string;
        responseCode?: number;
        responseMessage?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const spamIcon = data.isSpam ? 'SPAM' : 'HAM (not spam)';
        const spamIndicator = data.isSpam ? '!!!' : '';

        let output = `${spamIndicator} ${spamIcon}\n\n`;
        output += `Command:   ${data.command}\n`;
        output += `Score:     ${data.score ?? 'N/A'} / ${data.threshold ?? 'N/A'}\n`;
        output += `Status:    ${data.responseMessage} (code ${data.responseCode})\n`;
        output += `RTT:       ${data.rtt}ms\n`;

        if (data.symbols && data.symbols.length > 0) {
          output += `\nMatched Rules (${data.symbols.length}):\n`;
          for (const sym of data.symbols) {
            output += `  ${sym}\n`;
          }
        }

        if (data.report) {
          output += `\nFull Report:\n${data.report}`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && !loading && host && port) {
      handleCheck();
    }
  };

  const loadGtube = () => {
    setMessage(
      'From: sender@example.com\r\n' +
      'To: recipient@example.com\r\n' +
      'Subject: GTUBE Test\r\n' +
      '\r\n' +
      'XJS*C4JDBQADN1.NSBN3*2IDNEN*GTUBE-STANDARD-ANTI-UBE-TEST-EMAIL*C.34X\r\n'
    );
  };

  return (
    <ProtocolClientLayout title="SpamAssassin Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="spamd-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="spamd.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="spamd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 783 (standard spamd port)"
            error={errors.port}
          />
        </div>

        <div className="mb-4">
          <ActionButton
            onClick={handlePing}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Ping SpamAssassin daemon"
            variant="secondary"
          >
            Ping (PONG Test)
          </ActionButton>
        </div>

        <SectionHeader stepNumber={2} title="Spam Check" color="green" />

        <div className="mb-4">
          <label htmlFor="spamd-command" className="block text-sm font-medium text-slate-300 mb-1">
            Command
          </label>
          <select
            id="spamd-command"
            value={command}
            onChange={(e) => setCommand(e.target.value as 'CHECK' | 'SYMBOLS' | 'REPORT')}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="SYMBOLS">SYMBOLS (score + matched rules)</option>
            <option value="CHECK">CHECK (score only)</option>
            <option value="REPORT">REPORT (full text report)</option>
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor="spamd-message" className="block text-sm font-medium text-slate-300 mb-1">
            Email Message <span className="text-red-400" aria-label="required">*</span>
          </label>
          <textarea
            id="spamd-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder="From: sender@example.com&#10;To: recipient@example.com&#10;Subject: Test&#10;&#10;Message body..."
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={loadGtube}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
            >
              Load GTUBE Test Pattern
            </button>
            <span className="text-xs text-slate-500">
              (Generic Test for Unsolicited Bulk Email - guaranteed spam detection)
            </span>
          </div>
        </div>

        <ActionButton
          onClick={handleCheck}
          disabled={loading || !host || !port || !message.trim()}
          loading={loading}
          ariaLabel="Check message for spam"
        >
          Check Message
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SpamAssassin spamd"
          description="SpamAssassin's daemon (spamd) listens on port 783 and provides spam checking via a text-based protocol. PING tests connectivity, CHECK returns a spam score, SYMBOLS lists matched rules, and REPORT gives a full analysis. The GTUBE test pattern is guaranteed to be detected as spam."
          showKeyboardShortcut={false}
        />
      </div>
    </ProtocolClientLayout>
  );
}
