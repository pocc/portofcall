import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SNPPClientProps {
  onBack: () => void;
}

export default function SNPPClient({ onBack }: SNPPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('444');
  const [pagerId, setPagerId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'probe' | 'page'>('probe');

  const probeValidation = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const pageValidation = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    pagerId: [validationRules.required('Pager ID is required')],
    message: [validationRules.required('Message is required')],
  });

  const handleProbe = async () => {
    const isValid = probeValidation.validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/snpp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        banner?: string;
        serverInfo?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `SNPP Server Detected\n\n` +
            `Banner:  ${data.banner}\n` +
            `Info:    ${data.serverInfo}\n` +
            `RTT:     ${data.rtt}ms\n\n` +
            `The server is ready to accept paging commands.`,
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

  const handlePage = async () => {
    const isValid = pageValidation.validateAll({ host, port, pagerId, message });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/snpp/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          pagerId,
          message,
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        pagerId?: string;
        pageResponse?: string;
        sendResponse?: string;
        transcript?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        const transcriptStr = data.transcript?.join('\n') || '';
        setResult(
          `Page Sent Successfully\n\n` +
            `Pager ID: ${data.pagerId}\n` +
            `SEND:     ${data.sendResponse}\n` +
            `RTT:      ${data.rtt}ms\n\n` +
            `--- Transcript ---\n${transcriptStr}`,
        );
      } else {
        const transcriptStr = data.transcript?.join('\n') || '';
        setError(
          (data.error || 'Page failed') +
            (transcriptStr ? `\n\n--- Transcript ---\n${transcriptStr}` : ''),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (activeTab === 'probe' && host && port) {
        handleProbe();
      } else if (activeTab === 'page' && host && port && pagerId && message) {
        handlePage();
      }
    }
  };

  const errors = activeTab === 'probe' ? probeValidation.errors : pageValidation.errors;

  return (
    <ProtocolClientLayout title="SNPP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Tab Selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => {
              setActiveTab('probe');
              setResult('');
              setError('');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'probe'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Probe Server
          </button>
          <button
            onClick={() => {
              setActiveTab('page');
              setResult('');
              setError('');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'page'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Send Page
          </button>
        </div>

        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="snpp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="snpp.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="snpp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 444 (standard SNPP port)"
            error={errors.port}
          />
        </div>

        {activeTab === 'page' && (
          <>
            <SectionHeader stepNumber={2} title="Page Details" />

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <FormField
                id="snpp-pager-id"
                label="Pager ID"
                type="text"
                value={pagerId}
                onChange={setPagerId}
                onKeyDown={handleKeyDown}
                placeholder="5551234567"
                required
                helpText="The pager number or ID to send to"
                error={errors.pagerId}
              />

              <div className="md:col-span-2">
                <FormField
                  id="snpp-message"
                  label="Message"
                  type="text"
                  value={message}
                  onChange={setMessage}
                  onKeyDown={handleKeyDown}
                  placeholder="Server alert: CPU usage above 90%"
                  required
                  helpText="The page message content"
                  error={errors.message}
                />
              </div>
            </div>
          </>
        )}

        <ActionButton
          onClick={activeTab === 'probe' ? handleProbe : handlePage}
          disabled={
            loading ||
            !host ||
            !port ||
            (activeTab === 'page' && (!pagerId || !message))
          }
          loading={loading}
          ariaLabel={activeTab === 'probe' ? 'Probe SNPP server' : 'Send page via SNPP'}
        >
          {activeTab === 'probe' ? 'Probe Server' : 'Send Page'}
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SNPP Protocol"
          description="SNPP (RFC 1861) is a text-based TCP protocol for sending pages to pagers and beepers. It uses numeric response codes similar to SMTP. Commands include PAGE (set recipient), MESS (set message), SEND (transmit), and QUIT. Standard port is 444. Used in hospitals, emergency systems, and industrial monitoring."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">SNPP Command Reference</h3>
          <div className="grid gap-2 text-sm font-mono">
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="text-blue-400">PAGE &lt;id&gt;</span>
              <span className="ml-2 text-slate-400">— Set pager ID / phone number</span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="text-blue-400">MESS &lt;text&gt;</span>
              <span className="ml-2 text-slate-400">— Set message content</span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="text-blue-400">SEND</span>
              <span className="ml-2 text-slate-400">— Transmit the page</span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="text-blue-400">QUIT</span>
              <span className="ml-2 text-slate-400">— Disconnect from server</span>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Response codes: 220 (ready), 250 (OK), 421 (unavailable), 550 (error).
            Level 2+ adds LOGIn, HOLDuntil, CALLerid commands.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
