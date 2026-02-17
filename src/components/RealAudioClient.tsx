import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RealAudioClientProps {
  onBack: () => void;
}

export default function RealAudioClient({ onBack }: RealAudioClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7070');
  const [streamPath, setStreamPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleDescribe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/realaudio/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          streamPath: streamPath || '/',
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        cseq?: number;
        contentType?: string;
        contentBase?: string;
        streamInfo?: string;
        isRealServer?: boolean;
        rtt?: number;
      };

      if (data.success) {
        let msg = `RealAudio/RTSP server detected at ${host}:${port}\n`;
        if (data.server) msg += `Server: ${data.server}\n`;
        if (data.contentType) msg += `Content Type: ${data.contentType}\n`;
        if (data.contentBase) msg += `Content Base: ${data.contentBase}\n`;
        if (data.streamInfo) msg += `Stream: ${data.streamInfo}\n`;
        if (data.cseq !== undefined) msg += `CSeq: ${data.cseq}\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleDescribe();
    }
  };

  return (
    <ProtocolClientLayout title="RealAudio / RTSP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-1">
            <FormField
              id="realaudio-host"
              label="Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="media.example.com"
              required
              error={errors.host}
            />
          </div>

          <FormField
            id="realaudio-port"
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
            id="realaudio-path"
            label="Stream Path"
            type="text"
            value={streamPath}
            onChange={setStreamPath}
            onKeyDown={handleKeyDown}
            placeholder="/stream.rm"
            optional
          />
        </div>

        <ActionButton
          onClick={handleDescribe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Describe RealAudio stream"
        >
          Describe Stream
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RealAudio/RTSP"
          description="RealNetworks RealAudio/RealVideo uses RTSP (Real-Time Streaming Protocol) with RealMedia extensions. This sends RTSP OPTIONS and DESCRIBE requests to detect the server and retrieve stream metadata. Default port is 7070."
        />
      </div>
    </ProtocolClientLayout>
  );
}
