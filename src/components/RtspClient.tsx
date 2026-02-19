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

interface RtspClientProps {
  onBack: () => void;
}

export default function RtspClient({ onBack }: RtspClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('554');
  const [path, setPath] = useState('/');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleOptions = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rtsp/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: path || '/',
          username: username || undefined,
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        statusCode?: number;
        statusText?: string;
        methods?: string[];
        serverHeader?: string;
        rawResponse?: string;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `RTSP Server: ${data.host}:${data.port}\n`;
        output += `Status: ${data.statusCode} ${data.statusText}\n`;
        output += `Server: ${data.serverHeader}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;

        if (data.methods && data.methods.length > 0) {
          output += `Supported Methods:\n`;
          data.methods.forEach((method: string) => {
            output += `  - ${method}\n`;
          });
        }

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

  const handleDescribe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rtsp/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: path || '/',
          username: username || undefined,
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        statusText?: string;
        serverHeader?: string;
        sdpInfo?: Record<string, string>;
        sdpRaw?: string;
      };

      if (data.success) {
        let output = `RTSP DESCRIBE: ${data.statusCode} ${data.statusText}\n`;
        output += `Server: ${data.serverHeader}\n\n`;

        if (data.sdpInfo) {
          output += `Stream Information:\n`;
          if (data.sdpInfo.sessionName) output += `  Session: ${data.sdpInfo.sessionName}\n`;
          if (data.sdpInfo.sessionInfo) output += `  Info: ${data.sdpInfo.sessionInfo}\n`;
          if (data.sdpInfo.mediaTypes) output += `  Media: ${data.sdpInfo.mediaTypes}\n`;
          if (data.sdpInfo.codecs) output += `  Codecs: ${data.sdpInfo.codecs}\n`;
          if (data.sdpInfo.controlUrl) output += `  Control: ${data.sdpInfo.controlUrl}\n`;
        }

        if (data.sdpRaw) {
          output += `\nRaw SDP:\n${data.sdpRaw}`;
        }

        setResult(output);
      } else {
        setError(data.error || `Server returned ${data.statusCode} ${data.statusText}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleOptions();
    }
  };

  return (
    <ProtocolClientLayout title="RTSP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RTSP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rtsp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="camera.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="rtsp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 554, Alternative: 8554"
            error={errors.port}
          />

          <FormField
            id="rtsp-path"
            label="Stream Path"
            type="text"
            value={path}
            onChange={setPath}
            onKeyDown={handleKeyDown}
            placeholder="/stream1"
            optional
            helpText="e.g. /live, /stream1, /cam/realmonitor"
          />

          <FormField
            id="rtsp-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="admin"
            optional
          />

          <div className="md:col-span-2">
            <FormField
              id="rtsp-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              onKeyDown={handleKeyDown}
              placeholder="password"
              optional
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ActionButton
            onClick={handleOptions}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Send RTSP OPTIONS request"
          >
            OPTIONS (Capabilities)
          </ActionButton>

          <ActionButton
            onClick={handleDescribe}
            disabled={loading || !host || !port}
            loading={loading}
            variant="secondary"
            ariaLabel="Send RTSP DESCRIBE request"
          >
            DESCRIBE (Stream Info)
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RTSP"
          description="RTSP (Real Time Streaming Protocol, RFC 2326) is an HTTP-like text protocol for controlling streaming media servers. It's widely used in IP cameras (ONVIF), video surveillance, and streaming servers. OPTIONS discovers supported methods, while DESCRIBE retrieves stream details via SDP (Session Description Protocol). Port 554 is standard; 8554 is a common alternative."
        />
      </div>
    </ProtocolClientLayout>
  );
}
