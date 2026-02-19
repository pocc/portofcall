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

interface SMTPSClientProps {
  onBack: () => void;
}

export default function SMTPSClient({ onBack }: SMTPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('465');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
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
      const response = await fetch('/api/smtps/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        greeting?: string;
        capabilities?: string[];
        authenticated?: boolean;
        tls?: boolean;
      };

      if (response.ok && data.success) {
        let out = `SMTPS server detected!\n\n`;
        out += `Host:       ${data.host}:${data.port}\n`;
        out += `TLS:        ${data.tls ? 'Implicit (from first byte)' : 'No'}\n`;
        out += `RTT:        ${data.rtt}ms\n`;
        out += `Auth:       ${data.authenticated ? 'Authenticated' : 'Not authenticated'}\n\n`;
        out += `--- Server Greeting ---\n`;
        out += `${data.greeting}\n\n`;

        if (data.capabilities && data.capabilities.length > 0) {
          out += `--- EHLO Capabilities ---\n`;
          for (const cap of data.capabilities) {
            out += `  ${cap}\n`;
          }
          out += `\n`;
        }

        out += data.authenticated
          ? `Successfully authenticated over implicit TLS.\nReady to send emails.`
          : `Connection verified over implicit TLS.\nProvide credentials and use "Send Email" to deliver mail.`;

        setResult(out);
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
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!from || !to || !subject || !body) {
      setError('All email fields are required (From, To, Subject, Body)');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/smtps/send', {
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
        host?: string;
        port?: number;
        from?: string;
        to?: string;
        subject?: string;
        rtt?: number;
        tls?: boolean;
      };

      if (response.ok && data.success) {
        let out = `Email sent successfully!\n\n`;
        out += `Host:    ${data.host}:${data.port}\n`;
        out += `TLS:     Implicit\n`;
        out += `RTT:     ${data.rtt}ms\n\n`;
        out += `From:    ${data.from}\n`;
        out += `To:      ${data.to}\n`;
        out += `Subject: ${data.subject}\n\n`;
        out += `The message was delivered over implicit TLS (port 465).`;

        setResult(out);
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="SMTPS Client (Implicit TLS)" onBack={onBack}>
      <ApiExamples examples={apiExamples.SMTPS || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SMTPS Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="smtps-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="smtp.gmail.com"
            required
            error={errors.host}
          />

          <FormField
            id="smtps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 465 (SMTPS implicit TLS)"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="smtps-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="user@gmail.com"
            helpText="For AUTH LOGIN"
          />

          <FormField
            id="smtps-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="App password or credential"
            helpText="Required for authenticated sending"
          />
        </div>

        <SectionHeader stepNumber={2} title="Compose Email" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="smtps-from"
            label="From"
            type="text"
            value={from}
            onChange={setFrom}
            placeholder="sender@example.com"
            helpText="Sender email address"
          />

          <FormField
            id="smtps-to"
            label="To"
            type="text"
            value={to}
            onChange={setTo}
            placeholder="recipient@example.com"
            helpText="Recipient email address"
          />
        </div>

        <div className="grid md:grid-cols-1 gap-4 mb-4">
          <FormField
            id="smtps-subject"
            label="Subject"
            type="text"
            value={subject}
            onChange={setSubject}
            placeholder="Email subject line"
          />
        </div>

        <div className="mb-6">
          <label htmlFor="smtps-body" className="block text-sm font-medium text-slate-300 mb-2">
            Message Body
          </label>
          <textarea
            id="smtps-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Email body text..."
            rows={5}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none font-mono text-sm"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Test SMTPS connection"
            variant="secondary"
          >
            Test Connection
          </ActionButton>

          <ActionButton
            onClick={handleSend}
            disabled={loading || !host || !port || !from || !to || !subject || !body}
            loading={loading}
            ariaLabel="Send email over SMTPS"
          >
            Send Email
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SMTPS (Port 465)"
          description="SMTPS uses implicit TLS — the entire SMTP connection is encrypted from the first byte, unlike STARTTLS (port 587) which upgrades a plaintext connection. Port 465 was originally assigned for SMTPS, then reassigned, but RFC 8314 (2018) re-standardized it as the recommended way to submit email over TLS. Most major providers (Gmail, Outlook, Yahoo) support port 465."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">SMTP Ports Comparison</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-400">
            <div><span className="text-green-400 font-mono">465</span> SMTPS (implicit TLS) - This client</div>
            <div><span className="text-yellow-400 font-mono">587</span> Submission (STARTTLS) - Standard SMTP client</div>
            <div><span className="text-slate-400 font-mono"> 25</span> SMTP (plaintext) - Server-to-server relay</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            RFC 8314 recommends implicit TLS (port 465) for email submission.
            Use STARTTLS on port 587 only when 465 is unavailable.
            Port 25 is for MTA-to-MTA relay and often blocked by cloud providers.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
