import { useState } from 'react';
import { FormField, ActionButton, ResultDisplay, HelpSection } from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SMTPClientProps {
  onBack: () => void;
}

export default function SMTPClient({ onBack }: SMTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/smtp/connect', {
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
        greeting?: string;
        capabilities?: string;
      };

      if (response.ok && data.success) {
        setConnected(true);
        setResult(`Connected to ${host}:${port}\n\nGreeting: ${data.greeting || 'N/A'}\n\nCapabilities:\n${data.capabilities || 'N/A'}`);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!host || !from || !to || !subject || !body) {
      setError('All fields are required to send an email');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/smtp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          from,
          to,
          subject,
          body,
          timeout: 30000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        setResult(`✅ ${data.message || 'Email sent successfully'}\n\nFrom: ${from}\nTo: ${to}\nSubject: ${subject}`);
      } else {
        setError(data.error || 'Failed to send email');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setResult('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (!connected && host && port) {
        handleConnect();
      } else if (connected && from && to && subject && body) {
        handleSend();
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            aria-label="Go back to protocol selector"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">SMTP Client</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" aria-hidden="true"></div>
            <span className="text-green-400 text-sm">
              Connected to {host}:{port}
            </span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Connection Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">1</span>
              </div>
              <h2 className="text-xl font-semibold text-white">Server</h2>
            </div>

            <div className="space-y-4">
              <FormField
                id="smtp-host"
                label="Host"
                type="text"
                value={host}
                onChange={setHost}
                onKeyDown={handleKeyDown}
                placeholder="smtp.example.com"
                required
                error={errors.host}
              />

              <div>
                <label htmlFor="smtp-port" className="block text-sm font-medium text-slate-300 mb-1">
                  Port
                </label>
                <select
                  id="smtp-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  aria-required="true"
                >
                  <option value="25">25 (SMTP)</option>
                  <option value="587">587 (Submission)</option>
                  <option value="465">465 (SMTPS)</option>
                </select>
                {errors.port && (
                  <p className="text-red-400 text-xs mt-1" role="alert">{errors.port}</p>
                )}
              </div>

              <FormField
                id="smtp-username"
                label="Username"
                type="text"
                value={username}
                onChange={setUsername}
                onKeyDown={handleKeyDown}
                placeholder="username"
                optional
              />

              <FormField
                id="smtp-password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                onKeyDown={handleKeyDown}
                placeholder="password"
                optional
              />

              {!connected ? (
                <ActionButton
                  onClick={handleConnect}
                  disabled={loading || !host || !port}
                  loading={loading}
                  ariaLabel="Test SMTP connection"
                >
                  Test Connection
                </ActionButton>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Disconnect from SMTP server"
                >
                  Disconnect
                </button>
              )}
            </div>

            <HelpSection
              title="About SMTP"
              description="Simple Mail Transfer Protocol for sending emails. Port 25 may be blocked by cloud providers. Use port 587 (submission) or 465 (SMTPS) for authenticated sending."
              showKeyboardShortcut={true}
            />
          </div>
        </div>

        {/* Email Form */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">2</span>
              </div>
              <h2 className="text-xl font-semibold text-white">Compose Email</h2>
            </div>

            <div className="space-y-4 mb-6">
              <FormField
                id="smtp-from"
                label="From"
                type="text"
                value={from}
                onChange={setFrom}
                onKeyDown={handleKeyDown}
                placeholder="sender@example.com"
                required
              />

              <FormField
                id="smtp-to"
                label="To"
                type="text"
                value={to}
                onChange={setTo}
                onKeyDown={handleKeyDown}
                placeholder="recipient@example.com"
                required
              />

              <FormField
                id="smtp-subject"
                label="Subject"
                type="text"
                value={subject}
                onChange={setSubject}
                onKeyDown={handleKeyDown}
                placeholder="Email subject"
                required
              />

              <div>
                <label htmlFor="smtp-body" className="block text-sm font-medium text-slate-300 mb-1">
                  Message <span className="text-red-400" aria-label="required">*</span>
                </label>
                <textarea
                  id="smtp-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Email body..."
                  rows={8}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  aria-required="true"
                />
              </div>

              <ActionButton
                onClick={handleSend}
                disabled={loading || !host || !from || !to || !subject || !body}
                loading={loading}
                variant="primary"
                ariaLabel="Send email"
              >
                Send Email
              </ActionButton>
            </div>

            <ResultDisplay result={result} error={error} />
          </div>
        </div>
      </div>
    </div>
  );
}
