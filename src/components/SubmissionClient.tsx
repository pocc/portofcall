import { useState } from 'react';
import { FormField, ActionButton, ResultDisplay, HelpSection } from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SubmissionClientProps {
  onBack: () => void;
}

export default function SubmissionClient({ onBack }: SubmissionClientProps) {
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
      const response = await fetch('/api/submission/connect', {
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
        starttlsSupported?: boolean;
        note?: string;
      };

      if (response.ok && data.success) {
        setConnected(true);
        const starttlsIndicator = data.starttlsSupported ? '✅ STARTTLS supported' : '⚠️  STARTTLS not advertised';
        setResult(`Connected to ${host}:${port}\n\n${starttlsIndicator}\n\nGreeting: ${data.greeting || 'N/A'}\n\nCapabilities:\n${data.capabilities || 'N/A'}${data.note ? '\n\nNote: ' + data.note : ''}`);
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
      const response = await fetch('/api/submission/send', {
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
        note?: string;
      };

      if (response.ok && data.success) {
        setResult(`✅ ${data.message || 'Email sent successfully via Message Submission Protocol'}\n\nFrom: ${from}\nTo: ${to}\nSubject: ${subject}${data.note ? '\n\nNote: ' + data.note : ''}`);
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
          <h1 className="text-3xl font-bold text-white">Message Submission Client</h1>
          <span className="text-xs bg-blue-600/30 text-blue-400 px-2 py-0.5 rounded-full">RFC 6409</span>
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

      {/* Main Content */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left: Connection Form */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Server Connection</h2>

          <div className="space-y-4">
            <FormField
              id="host"
              label="SMTP Server"
              value={host}
              onChange={setHost}
              placeholder="smtp.example.com"
              error={errors.host}
              onKeyDown={handleKeyDown}
              required
            />

            <FormField
              id="port"
              label="Port"
              type="number"
              value={port}
              onChange={setPort}
              placeholder="587"
              error={errors.port}
              onKeyDown={handleKeyDown}
              required
            />

            <FormField
              id="username"
              label="Username (optional for auth)"
              value={username}
              onChange={setUsername}
              placeholder="username@example.com"
              onKeyDown={handleKeyDown}
            />

            <FormField
              id="password"
              label="Password (optional for auth)"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Password"
              onKeyDown={handleKeyDown}
            />

            {!connected ? (
              <ActionButton
                onClick={handleConnect}
                disabled={loading || !host || !port}
                loading={loading}
              >
                Connect to Server
              </ActionButton>
            ) : (
              <ActionButton
                onClick={handleDisconnect}
                variant="secondary"
              >
                Disconnect
              </ActionButton>
            )}
          </div>
        </div>

        {/* Right: Email Send Form */}
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Send Email</h2>

          <div className="space-y-4">
            <FormField
              id="from"
              label="From"
              value={from}
              onChange={setFrom}
              placeholder="sender@example.com"
              onKeyDown={handleKeyDown}
              required
            />

            <FormField
              id="to"
              label="To"
              value={to}
              onChange={setTo}
              placeholder="recipient@example.com"
              onKeyDown={handleKeyDown}
              required
            />

            <FormField
              id="subject"
              label="Subject"
              value={subject}
              onChange={setSubject}
              placeholder="Email subject"
              onKeyDown={handleKeyDown}
              required
            />

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Message Body <span className="text-red-400">*</span>
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Email message body"
                disabled={!connected || loading}
                rows={6}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <ActionButton
              onClick={handleSend}
              disabled={!connected || loading || !from || !to || !subject || !body}
              loading={loading}
            >
              Send Email
            </ActionButton>
          </div>
        </div>
      </div>

      {/* Results Area */}
      <div className="mt-6">
        <ResultDisplay result={result} error={error} />
      </div>

      {/* Help Section */}
      <div className="mt-6">
        <HelpSection
          title="About Message Submission Protocol"
          description="The Message Submission Protocol (RFC 6409) uses port 587 for mail submission by email clients. Unlike port 25 (SMTP for server-to-server transfer), port 587 is specifically designed for authenticated message submission from mail user agents (MUAs) to mail submission agents (MSAs). RFC 6409 mandates STARTTLS for encryption and requires authentication before accepting mail. Note: Cloudflare Workers sockets don't support mid-stream TLS upgrades (STARTTLS). This client demonstrates the protocol flow but connects in plaintext."
        />
      </div>
    </div>
  );
}
