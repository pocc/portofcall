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

interface GaduGaduClientProps {
  onBack: () => void;
}

export default function GaduGaduClient({ onBack }: GaduGaduClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8074');
  const [uin, setUin] = useState('');
  const [password, setPassword] = useState('');
  const [hashType, setHashType] = useState<'gg32' | 'sha1'>('sha1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    uin: [validationRules.required('UIN is required'), validationRules.number('UIN must be a number')],
    password: [validationRules.required('Password is required')],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port, uin, password });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gadugadu/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          uin: parseInt(uin),
          password,
          hashType,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        uin?: number;
        serverSeed?: number;
        loginStatus?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Connected to Gadu-Gadu server at ${host}:${port}\n`;
        if (data.uin) msg += `UIN: ${data.uin}\n`;
        if (data.loginStatus) msg += `Login Status: ${data.loginStatus}\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
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
    if (e.key === 'Enter' && !loading && host && port && uin && password) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Gadu-Gadu Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.GaduGadu || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="gg-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="gg.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="gg-port"
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
            id="gg-uin"
            label="UIN (User ID)"
            type="number"
            value={uin}
            onChange={setUin}
            onKeyDown={handleKeyDown}
            placeholder="12345678"
            required
            error={errors.uin}
          />

          <FormField
            id="gg-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password"
            required
            error={errors.password}
          />

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Hash Type
            </label>
            <select
              value={hashType}
              onChange={(e) => setHashType(e.target.value as 'gg32' | 'sha1')}
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-400"
            >
              <option value="sha1">SHA-1 (recommended)</option>
              <option value="gg32">GG32 (legacy)</option>
            </select>
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port || !uin || !password}
          loading={loading}
          ariaLabel="Connect to Gadu-Gadu server"
        >
          Connect
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Gadu-Gadu"
          description="Gadu-Gadu (GG) is a Polish instant messaging protocol using a proprietary binary format. The client authenticates with a UIN (User Identification Number) and password hashed with either GG32 or SHA-1. Default port is 8074."
        />
      </div>
    </ProtocolClientLayout>
  );
}
