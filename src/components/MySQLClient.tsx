import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MySQLClientProps {
  onBack: () => void;
}

export default function MySQLClient({ onBack }: MySQLClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
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
      const response = await fetch('/api/mysql/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          database: database || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverVersion?: string;
        protocolVersion?: number;
        note?: string;
      };

      if (response.ok && data.success) {
        setResult(`Connected to MySQL server at ${host}:${port}\n\nServer Version: ${data.serverVersion || 'Unknown'}\nProtocol Version: ${data.protocolVersion || 'Unknown'}\n\n${data.note || ''}`);
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
    <ProtocolClientLayout title="MySQL Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mysql-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mysql.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="mysql-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />

          <FormField
            id="mysql-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="root"
            optional
          />

          <FormField
            id="mysql-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password"
            optional
          />

          <div className="md:col-span-2">
            <FormField
              id="mysql-database"
              label="Database"
              type="text"
              value={database}
              onChange={setDatabase}
              onKeyDown={handleKeyDown}
              placeholder="mydb"
              optional
            />
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test MySQL connection"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MySQL"
          description="MySQL is a popular relational database. This interface tests connectivity by reading the server handshake. Port 3306 is the default. Full query execution requires implementing the complete MySQL binary protocol."
        />
      </div>
    </ProtocolClientLayout>
  );
}
