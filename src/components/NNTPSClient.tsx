import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface NNTPSClientProps {
  onBack: () => void;
}

export default function NNTPSClient({ onBack }: NNTPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('563');
  const [group, setGroup] = useState('');
  const [articleNumber, setArticleNumber] = useState('');
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
      const response = await fetch('/api/nntps/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        welcome?: string;
        postingAllowed?: boolean;
        capabilities?: string[];
        modeReader?: string;
        tls?: boolean;
      };

      if (response.ok && data.success) {
        let out = `NNTPS server detected!\n\n`;
        out += `Host:     ${data.host}:${data.port}\n`;
        out += `TLS:      Implicit (from first byte)\n`;
        out += `RTT:      ${data.rtt}ms\n`;
        out += `Posting:  ${data.postingAllowed ? 'Allowed' : 'Read-only'}\n\n`;
        out += `--- Server Banner ---\n`;
        out += `${data.welcome}\n\n`;

        if (data.capabilities && data.capabilities.length > 0) {
          out += `--- Capabilities ---\n`;
          for (const cap of data.capabilities) {
            out += `  ${cap}\n`;
          }
          out += `\n`;
        }

        if (data.modeReader) {
          out += `MODE READER: ${data.modeReader}\n\n`;
        }

        out += `Connection verified over implicit TLS (port 563).\n`;
        out += `Use "Browse Group" to select a newsgroup.`;

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

  const handleGroup = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!group) {
      setError('Newsgroup name is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nntps/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          group,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        group?: string;
        count?: number;
        first?: number;
        last?: number;
        articles?: Array<{
          number: number;
          subject: string;
          from: string;
          date: string;
          messageId: string;
          lines: number;
        }>;
      };

      if (response.ok && data.success) {
        let out = `Newsgroup: ${data.group}\n\n`;
        out += `Articles:  ${data.count}\n`;
        out += `Range:     ${data.first} - ${data.last}\n\n`;

        if (data.articles && data.articles.length > 0) {
          out += `--- Recent Articles (${data.articles.length}) ---\n`;
          for (const art of data.articles) {
            out += `#${art.number}  ${art.subject}\n`;
            out += `  From: ${art.from}  Date: ${art.date}\n`;
          }
        } else {
          out += `No articles found in this group.`;
        }

        setResult(out);
      } else {
        setError(data.error || 'Group command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Group command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleArticle = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!group) {
      setError('Newsgroup name is required');
      return;
    }
    if (!articleNumber || parseInt(articleNumber) < 1) {
      setError('Valid article number is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nntps/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          group,
          articleNumber: parseInt(articleNumber),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        articleNumber?: number;
        messageId?: string;
        headers?: Record<string, string>;
        body?: string;
      };

      if (response.ok && data.success) {
        let out = `Article #${data.articleNumber}\n`;
        out += `Message-ID: <${data.messageId}>\n\n`;

        if (data.headers) {
          out += `--- Headers ---\n`;
          for (const [key, value] of Object.entries(data.headers)) {
            out += `${key}: ${value}\n`;
          }
          out += `\n`;
        }

        out += `--- Body ---\n`;
        // Truncate very long bodies for display
        const body = data.body || '';
        out += body.length > 5000 ? body.slice(0, 5000) + '\n...[truncated]' : body;

        setResult(out);
      } else {
        setError(data.error || 'Article retrieval failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Article retrieval failed');
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
    <ProtocolClientLayout title="NNTPS Client (Implicit TLS)" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="NNTPS Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="nntps-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="news.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="nntps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 563 (NNTPS implicit TLS)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Newsgroup" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="nntps-group"
            label="Newsgroup"
            type="text"
            value={group}
            onChange={setGroup}
            placeholder="comp.lang.python"
            helpText="Usenet newsgroup name"
          />

          <FormField
            id="nntps-article"
            label="Article Number"
            type="number"
            value={articleNumber}
            onChange={setArticleNumber}
            placeholder="12345"
            min="1"
            helpText="Article # from Browse Group"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Test NNTPS connection"
            variant="secondary"
          >
            Test Connection
          </ActionButton>

          <ActionButton
            onClick={handleGroup}
            disabled={loading || !host || !port || !group}
            loading={loading}
            ariaLabel="Browse newsgroup"
            variant="secondary"
          >
            Browse Group
          </ActionButton>

          <ActionButton
            onClick={handleArticle}
            disabled={loading || !host || !port || !group || !articleNumber}
            loading={loading}
            ariaLabel="Retrieve article"
          >
            Read Article
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About NNTPS (Port 563)"
          description="NNTPS uses implicit TLS for encrypted Usenet access. Unlike STARTTLS on port 119, the TLS handshake happens immediately. RFC 4642 defines NNTP with TLS, and port 563 was the original IANA assignment for encrypted news access. Many modern Usenet providers require TLS and offer both port 119 with STARTTLS and port 563 with implicit TLS."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">NNTP Response Codes</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-400">
            <div><span className="text-green-400 font-mono">200</span> Posting OK</div>
            <div><span className="text-blue-400 font-mono">201</span> Read-only</div>
            <div><span className="text-yellow-400 font-mono">211</span> Group selected</div>
            <div><span className="text-red-400 font-mono">411</span> No such group</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Port 563 (implicit TLS) vs port 119 (plaintext/STARTTLS).
            Complements the NNTP client (port 119) in this tool.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
