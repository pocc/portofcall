import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SHOUTcastClientProps {
  onBack: () => void;
}

export default function SHOUTcastClient({ onBack }: SHOUTcastClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8000');
  const [stream, setStream] = useState('/');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleInfo = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/shoutcast/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          stream: stream || '/',
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isShoutCast?: boolean;
        stationName?: string;
        genre?: string;
        bitrate?: number;
        url?: string;
        metaInt?: number;
        sampleRate?: number;
        contentType?: string;
        isPublic?: boolean;
        rtt?: number;
      };

      if (data.success) {
        let msg = `SHOUTcast server detected at ${host}:${port}\n`;
        if (data.stationName) msg += `Station: ${data.stationName}\n`;
        if (data.genre) msg += `Genre: ${data.genre}\n`;
        if (data.bitrate) msg += `Bitrate: ${data.bitrate} kbps\n`;
        if (data.contentType) msg += `Format: ${data.contentType}\n`;
        if (data.sampleRate) msg += `Sample Rate: ${data.sampleRate} Hz\n`;
        if (data.metaInt) msg += `Meta Interval: ${data.metaInt} bytes\n`;
        if (data.url) msg += `URL: ${data.url}\n`;
        if (data.isPublic !== undefined) msg += `Public: ${data.isPublic ? 'Yes' : 'No'}\n`;
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
      handleInfo();
    }
  };

  return (
    <ProtocolClientLayout title="SHOUTcast Radio Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Stream Details" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-1">
            <FormField
              id="shoutcast-host"
              label="Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="radio.example.com"
              required
              error={errors.host}
            />
          </div>

          <FormField
            id="shoutcast-port"
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
            id="shoutcast-stream"
            label="Stream Path"
            type="text"
            value={stream}
            onChange={setStream}
            onKeyDown={handleKeyDown}
            placeholder="/"
            optional
          />
        </div>

        <ActionButton
          onClick={handleInfo}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Get SHOUTcast stream info"
        >
          Get Stream Info
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SHOUTcast"
          description="SHOUTcast (by Nullsoft/Winamp) is an internet radio streaming protocol using ICY extensions over HTTP/1.0. It provides station name, genre, bitrate, and metadata interval information. Default port is 8000."
        />
      </div>
    </ProtocolClientLayout>
  );
}
