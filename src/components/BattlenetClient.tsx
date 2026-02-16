import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface BattlenetClientProps {
  onBack: () => void;
}

interface BattlenetResponse {
  success: boolean;
  host: string;
  port: number;
  protocolId?: number;
  serverResponse?: boolean;
  messageId?: number;
  messageLength?: number;
  rawData?: string;
  error?: string;
  details?: string;
}

export default function BattlenetClient({ onBack }: BattlenetClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6112');
  const [protocolId, setProtocolId] = useState('1');
  const [timeout, setTimeout] = useState('15000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });

    if (!isValid) return;

    const portNum = parseInt(port);
    if (portNum < 1 || portNum > 65535) {
      alert('Port must be between 1 and 65535');
      return;
    }

    const timeoutNum = parseInt(timeout);
    if (timeoutNum < 1000) {
      alert('Timeout must be at least 1000ms');
      return;
    }

    const protocolNum = parseInt(protocolId);
    if (![1, 2, 3].includes(protocolNum)) {
      alert('Protocol ID must be 1 (Game), 2 (BNFTP), or 3 (Telnet)');
      return;
    }

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/battlenet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: portNum,
          protocolId: protocolNum,
          timeout: timeoutNum,
        }),
      });

      const data = await response.json() as BattlenetResponse;

      if (data.success && data.serverResponse) {
        setResult(
          `✅ Battle.net Server Detected\n\n` +
          `Host: ${data.host}\n` +
          `Port: ${data.port}\n` +
          `Protocol ID: 0x${data.protocolId?.toString(16).padStart(2, '0') || '??'}\n` +
          `Message ID: 0x${data.messageId?.toString(16).padStart(2, '0') || '??'}\n` +
          `Message Length: ${data.messageLength || 0} bytes\n` +
          (data.rawData ? `\nRaw Data (hex):\n${data.rawData}` : '')
        );
      } else {
        setResult(
          `❌ Connection Failed\n\n` +
          `Host: ${data.host}\n` +
          `Port: ${data.port}\n` +
          `Error: ${data.error || 'Unknown error'}`
        );
      }
    } catch (error) {
      setResult(
        `❌ Request Failed\n\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtocolClientLayout title="Battle.net BNCS Protocol" onBack={onBack}>
      <SectionHeader stepNumber={1} title="Connection Settings" />

      <FormField
        id="host"
        label="Host"
        placeholder="useast.battle.net"
        value={host}
        onChange={setHost}
        error={errors.host}
        required
        helpText="Battle.net server hostname (e.g., useast.battle.net, europe.battle.net)"
      />

      <FormField
        id="port"
        label="Port"
        type="number"
        value={port}
        onChange={setPort}
        error={errors.port}
        required
        helpText="Default: 6112"
      />

      <FormField
        id="protocolId"
        label="Protocol ID (1=Game, 2=BNFTP, 3=Telnet)"
        type="number"
        value={protocolId}
        onChange={setProtocolId}
        required
        helpText="Protocol selector: 1 for Game, 2 for BNFTP, 3 for Telnet/Chat"
      />

      <FormField
        id="timeout"
        label="Timeout (ms)"
        type="number"
        value={timeout}
        onChange={setTimeout}
        required
        helpText="Connection timeout in milliseconds"
      />

      <ActionButton onClick={handleConnect} disabled={loading || !host.trim()} loading={loading}>
        {loading ? 'Connecting...' : 'Connect to Battle.net Server'}
      </ActionButton>

      {result && <ResultDisplay result={result} />}

      <HelpSection
        title="About Battle.net BNCS Protocol"
        description="Battle.net BNCS (Battle.net Chat Server) is the protocol used by classic Blizzard games including Diablo, StarCraft, Warcraft II/III, and Diablo II. The protocol operates on TCP port 6112 and uses a binary format with 0xFF header bytes. Each message includes a protocol selector (0x01 for Game, 0x02 for BNFTP, 0x03 for Telnet/Chat) followed by SID_* messages. Classic Battle.net realms include useast.battle.net, uswest.battle.net, asia.battle.net, and europe.battle.net. Note: Classic BNCS is different from modern Battle.net used by newer Blizzard games."
      />
    </ProtocolClientLayout>
  );
}
