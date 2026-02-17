import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MaxDBClientProps {
  onBack: () => void;
}

export default function MaxDBClient({ onBack }: MaxDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7200');
  const [database, setDatabase] = useState('MAXDB');
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
      const response = await fetch('/api/maxdb/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          database: database || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        latencyMs?: number;
        serverInfo?: {
          responded: boolean;
          dataReceived: boolean;
          byteCount?: number;
          hexDump?: string;
          isMaxDB?: boolean;
        };
      };

      if (response.ok && data.success) {
        let output = `SAP MaxDB Connection Test (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Host: ${host}:${port}\n`;
        output += `Database: ${database}\n`;
        output += `Status: Connected\n\n`;

        if (data.serverInfo) {
          output += `Server Response:\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Responded: ${data.serverInfo.responded ? 'Yes' : 'No'}\n`;
          output += `Data Received: ${data.serverInfo.dataReceived ? 'Yes' : 'No'}\n`;
          if (data.serverInfo.byteCount) {
            output += `Bytes Received: ${data.serverInfo.byteCount}\n`;
          }
          if (data.serverInfo.isMaxDB !== undefined) {
            output += `MaxDB Detected: ${data.serverInfo.isMaxDB ? 'Yes' : 'Unknown'}\n`;
          }
          if (data.serverInfo.hexDump) {
            output += `\nResponse (hex):\n${data.serverInfo.hexDump}\n`;
          }
        }

        output += `\n✓ MaxDB X Server is responding`;
        setResult(output);
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
    <ProtocolClientLayout title="SAP MaxDB Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="maxdb-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="maxdb.example.com"
            required
            helpText="MaxDB X Server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="maxdb-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 7200 (X Server), 7210 (sql6)"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="maxdb-database"
            label="Database Name"
            type="text"
            value={database}
            onChange={setDatabase}
            onKeyDown={handleKeyDown}
            placeholder="MAXDB"
            optional
            helpText="Target database instance name"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test MaxDB connection"
          variant="success"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SAP MaxDB"
          description="MaxDB (formerly SAP DB) is a relational database from SAP. Port 7200 is the legacy X Server port, while 7210 is the modern sql6 port. The X Server acts as a connection router to database instances. MaxDB uses the NI (Network Interface) or NISSL (NI over SSL) protocol for client-server communication. This tool tests connectivity to the MaxDB X Server."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Ports</h3>
          <div className="grid gap-2">
            <button
              onClick={() => setPort('7200')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-green-400">7200</span>
              <span className="text-slate-400 ml-2">- X Server (legacy/compatibility)</span>
            </button>
            <button
              onClick={() => setPort('7210')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-green-400">7210</span>
              <span className="text-slate-400 ml-2">- sql6 (modern standard)</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
