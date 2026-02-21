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

interface RloginClientProps {
  onBack: () => void;
}

export default function RloginClient({ onBack }: RloginClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('513');
  const [localUser, setLocalUser] = useState('guest');
  const [remoteUser, setRemoteUser] = useState('guest');
  const [terminalType, setTerminalType] = useState('xterm');
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
      const response = await fetch('/api/rlogin/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          localUser,
          remoteUser,
          terminalType,
          terminalSpeed: '38400',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverAccepted?: boolean;
        serverMessage?: string;
        banner?: string;
        rtt?: number;
        handshake?: {
          localUser: string;
          remoteUser: string;
          terminalType: string;
          terminalSpeed: string;
        };
        security?: string;
      };

      if (response.ok && data.success) {
        const status = data.serverAccepted ? 'ACCEPTED' : 'REJECTED';
        const icon = data.serverAccepted ? 'OK' : 'FAIL';

        setResult(
          `[${icon}] Rlogin Handshake: ${status}\n\n` +
          `Server Response: ${data.serverMessage || '(none)'}\n` +
          (data.banner ? `Banner: ${data.banner}\n` : '') +
          `RTT: ${data.rtt}ms\n\n` +
          `Handshake Sent:\n` +
          `  Local User:  ${data.handshake?.localUser}\n` +
          `  Remote User: ${data.handshake?.remoteUser}\n` +
          `  Terminal:    ${data.handshake?.terminalType}/${data.handshake?.terminalSpeed}\n\n` +
          `WARNING: ${data.security}`
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Rlogin Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RLogin || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rlogin-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="server.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="rlogin-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 513 (standard Rlogin port)"
            error={errors.port}
          />

          <FormField
            id="rlogin-local-user"
            label="Local Username"
            type="text"
            value={localUser}
            onChange={setLocalUser}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            helpText="Your local username (sent in handshake)"
          />

          <FormField
            id="rlogin-remote-user"
            label="Remote Username"
            type="text"
            value={remoteUser}
            onChange={setRemoteUser}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            helpText="Username to log in as on the remote server"
          />

          <FormField
            id="rlogin-terminal"
            label="Terminal Type"
            type="text"
            value={terminalType}
            onChange={setTerminalType}
            onKeyDown={handleKeyDown}
            placeholder="xterm"
            helpText="Terminal emulation type (xterm, vt100, etc.)"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Rlogin connection"
        >
          Test Rlogin Handshake
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Rlogin Protocol"
          description="Rlogin (RFC 1282) is the BSD remote login protocol from the 1980s — the predecessor to SSH. It provides interactive terminal sessions with automatic user identity passing via a simple handshake. Unlike Telnet, it doesn't use command negotiation. SECURITY WARNING: Rlogin transmits everything in cleartext and relies on .rhosts trust. Always use SSH instead for production systems."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Rlogin vs Other Remote Access</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">vs Telnet:</strong> Simpler — no IAC command negotiation; sends user identity in handshake</p>
            <p><strong className="text-slate-300">vs SSH:</strong> No encryption, no host key verification, no tunneling — completely insecure</p>
            <p><strong className="text-slate-300">Trust model:</strong> Uses .rhosts/hosts.equiv for password-free login between trusted hosts</p>
            <p><strong className="text-red-400">Status:</strong> Deprecated — disabled by default on modern systems. Use SSH.</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
