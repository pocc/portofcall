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

interface LMTPClientProps {
  onBack: () => void;
}

export default function LMTPClient({ onBack }: LMTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('24');
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
      const response = await fetch('/api/lmtp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        greeting?: string;
        capabilities?: string[];
        note?: string;
      };

      if (response.ok && data.success) {
        setConnected(true);
        const caps = data.capabilities?.join('\n  ') || 'none detected';
        setResult(
          `LMTP Server Connected\n\n` +
          `Greeting: ${data.greeting}\n\n` +
          `Capabilities (via LHLO):\n  ${caps}\n\n` +
          (data.note || '')
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

  const handleSend = async () => {
    if (!from || !to || !subject || !body) {
      setError('All message fields are required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      // Split recipients by comma/semicolon
      const recipients = to.split(/[,;]\s*/).map(r => r.trim()).filter(Boolean);

      const response = await fetch('/api/lmtp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          from,
          to: recipients,
          subject,
          body,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        recipientCount?: number;
        acceptedCount?: number;
        allDelivered?: boolean;
        deliveryStatus?: Array<{
          recipient: string;
          code: number;
          message: string;
          delivered: boolean;
        }>;
        note?: string;
      };

      if (response.ok && data.success) {
        let statusLines = '';
        if (data.deliveryStatus) {
          statusLines = data.deliveryStatus.map(s =>
            `  ${s.delivered ? 'OK' : 'FAIL'} ${s.recipient}: ${s.message}`
          ).join('\n');
        }

        setResult(
          `${data.allDelivered ? 'All Delivered' : 'Partial Delivery'}\n\n` +
          `Recipients: ${data.recipientCount}\n` +
          `Accepted:   ${data.acceptedCount}\n\n` +
          `Per-Recipient Delivery Status:\n${statusLines}\n\n` +
          (data.note || '')
        );
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
      if (!connected) handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="LMTP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.LMTP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="LMTP Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="lmtp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mail.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="lmtp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 24 (standard LMTP port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading && !connected}
          ariaLabel="Test LMTP connection"
        >
          Test Connection (LHLO)
        </ActionButton>

        {connected && (
          <>
            <div className="mt-8 pt-6 border-t border-slate-600">
              <SectionHeader stepNumber={2} title="Compose Message" />

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <FormField
                  id="lmtp-from"
                  label="From"
                  type="text"
                  value={from}
                  onChange={setFrom}
                  placeholder="sender@example.com"
                  required
                />

                <FormField
                  id="lmtp-to"
                  label="To (comma-separated)"
                  type="text"
                  value={to}
                  onChange={setTo}
                  placeholder="user1@example.com, user2@example.com"
                  required
                  helpText="Multiple recipients get individual delivery status"
                />
              </div>

              <div className="mb-4">
                <FormField
                  id="lmtp-subject"
                  label="Subject"
                  type="text"
                  value={subject}
                  onChange={setSubject}
                  placeholder="Test LMTP delivery"
                  required
                />
              </div>

              <div className="mb-4">
                <label htmlFor="lmtp-body" className="block text-sm font-medium text-slate-300 mb-1">
                  Body
                </label>
                <textarea
                  id="lmtp-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Message body..."
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <ActionButton
                onClick={handleSend}
                disabled={loading || !from || !to || !subject || !body}
                loading={loading}
                ariaLabel="Send message via LMTP"
              >
                Deliver via LMTP
              </ActionButton>
            </div>
          </>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About LMTP Protocol"
          description="LMTP (RFC 2033) is a variant of SMTP designed for final mail delivery to local mailboxes. Unlike SMTP, LMTP uses LHLO instead of EHLO and returns individual delivery status codes for each recipient after the DATA command. Used by Dovecot, Cyrus IMAP, and Postfix for local delivery. Standard port is 24."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">LMTP vs SMTP</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">LHLO vs EHLO:</strong> LMTP uses LHLO to identify itself as an LMTP session</p>
            <p><strong className="text-slate-300">Per-recipient status:</strong> After DATA, LMTP returns one status code per RCPT TO recipient</p>
            <p><strong className="text-slate-300">No queuing:</strong> LMTP immediately accepts or rejects — it never queues for retry</p>
            <p><strong className="text-slate-300">Local delivery:</strong> Designed for MTA-to-MDA delivery, not relay between servers</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
