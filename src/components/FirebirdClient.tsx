import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface FirebirdClientProps {
  onBack: () => void;
}

interface FirebirdResponse {
  success?: boolean;
  error?: string;
  version?: string;
  protocol?: number;
  architecture?: number;
  accepted?: boolean;
  responseLength?: number;
  responseHex?: string;
  rawOpcode?: number;
}

export default function FirebirdClient({ onBack }: FirebirdClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3050');
  const [database, setDatabase] = useState('/tmp/test.fdb');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/firebird/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port),
          database: database.trim(),
        }),
      });

      const data = await response.json() as FirebirdResponse;

      if (data.success) {
        setResult(
          `✓ Firebird Server Detected\n\n` +
            `Version: ${data.version || 'Unknown'}\n` +
            `Protocol: ${data.protocol !== undefined ? data.protocol : 'N/A'}\n` +
            `Architecture: ${data.architecture !== undefined ? data.architecture : 'N/A'}\n` +
            `Accepted: ${data.accepted ? 'Yes' : 'No'}\n` +
            `Response Length: ${data.responseLength} bytes\n\n` +
            `Raw Response (first 64 bytes):\n${data.responseHex || 'N/A'}`
        );
      } else {
        setResult(`✗ Connection Failed\n\n${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setResult(
        `✗ Request Error\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVersion = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/firebird/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port),
          database: database.trim(),
        }),
      });

      const data = await response.json() as FirebirdResponse;

      if (data.success) {
        setResult(
          `✓ Firebird Version Information\n\n` +
            `${data.version || 'Version information unavailable'}\n\n` +
            `Details:\n` +
            `- Protocol Version: ${data.protocol !== undefined ? data.protocol : 'Unknown'}\n` +
            `- Architecture: ${data.architecture !== undefined ? data.architecture : 'Unknown'}\n` +
            `- Connection: ${data.accepted ? 'Accepted' : 'Rejected/Error'}\n` +
            `- Opcode: ${data.rawOpcode !== undefined ? `${data.rawOpcode} (0x${data.rawOpcode.toString(16)})` : 'N/A'}`
        );
      } else {
        setResult(`✗ Version Query Failed\n\n${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setResult(
        `✗ Request Error\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtocolClientLayout
      title="Firebird SQL Database"
      onBack={onBack}
    >
      <SectionHeader
        stepNumber={1}
        title="Connection Settings"
      />

      <FormField
        id="host"
        label="Host"
        value={host}
        onChange={setHost}
        placeholder="localhost or IP address"
        error={errors.host}
      />

      <FormField
        id="port"
        label="Port"
        value={port}
        onChange={setPort}
        placeholder="3050"
        type="number"
        error={errors.port}
      />

      <FormField
        id="database"
        label="Database Path"
        value={database}
        onChange={setDatabase}
        placeholder="/tmp/test.fdb or C:\data\mydb.fdb"
        helpText="Path to database file on server (used in connection string)"
      />

      <div className="flex gap-3">
        <ActionButton onClick={handleProbe} loading={loading}>
          Probe (Connect)
        </ActionButton>
        <ActionButton
          onClick={handleVersion}
          loading={loading}
          variant="secondary"
        >
          Get Server Info
        </ActionButton>
      </div>

      {result && <ResultDisplay result={result} />}

      <HelpSection
        title="About Firebird Protocol"
        description="Firebird uses a binary wire protocol on port 3050. Client sends op_connect (opcode 1) with database path and protocol version. Server responds with op_accept (2), op_reject (3), or op_response (9). Protocol uses big-endian 32-bit integers and length-prefixed strings. Probe detects Firebird servers and extracts protocol/architecture info. Used by Firebird 2.x, 3.x, and 4.x databases. Common database paths: /opt/firebird/examples/empbuild/employee.fdb (Linux), C:\\Program Files\\Firebird\\examples\\empbuild\\employee.fdb (Windows)."
      />
    </ProtocolClientLayout>
  );
}
