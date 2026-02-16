import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface PJLinkClientProps {
  onBack: () => void;
}

export default function PJLinkClient({ onBack }: PJLinkClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4352');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [projInfo, setProjInfo] = useState<{
    name?: string;
    manufacturer?: string;
    productName?: string;
    otherInfo?: string;
    class?: string;
    powerStatus?: string;
    lampHours?: { hours: number; on: boolean }[];
    errorStatus?: {
      fan: string;
      lamp: string;
      temperature: string;
      coverOpen: string;
      filter: string;
      other: string;
    };
    inputs?: string[];
    currentInput?: string;
    avMute?: string;
    authRequired?: boolean;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setProjInfo(null);

    try {
      const response = await fetch('/api/pjlink/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        authRequired?: boolean;
        authenticated?: boolean;
        rtt?: number;
        projectorInfo?: {
          name?: string;
          manufacturer?: string;
          productName?: string;
          otherInfo?: string;
          class?: string;
          powerStatus?: string;
          lampHours?: { hours: number; on: boolean }[];
          errorStatus?: {
            fan: string;
            lamp: string;
            temperature: string;
            coverOpen: string;
            filter: string;
            other: string;
          };
          inputs?: string[];
          currentInput?: string;
          avMute?: string;
        };
        error?: string;
      };

      if (response.ok && data.success) {
        const info = data.projectorInfo || {};
        setProjInfo({
          ...info,
          authRequired: data.authRequired,
        });

        const lines = [
          `Projector: ${host}:${port}`,
          `RTT: ${data.rtt}ms`,
          `Auth Required: ${data.authRequired ? 'Yes' : 'No'}`,
          '',
        ];
        if (info.name) lines.push(`Name: ${info.name}`);
        if (info.manufacturer) lines.push(`Manufacturer: ${info.manufacturer}`);
        if (info.productName) lines.push(`Product: ${info.productName}`);
        if (info.class) lines.push(`PJLink Class: ${info.class}`);
        if (info.powerStatus) lines.push(`Power: ${info.powerStatus}`);
        if (info.currentInput) lines.push(`Input: ${info.currentInput}`);
        if (info.avMute) lines.push(`AV Mute: ${info.avMute}`);
        if (info.otherInfo) lines.push(`Info: ${info.otherInfo}`);
        if (info.lampHours) {
          info.lampHours.forEach((lamp, i) => {
            lines.push(`Lamp ${i + 1}: ${lamp.hours}h (${lamp.on ? 'On' : 'Off'})`);
          });
        }

        setResult(lines.join('\n'));
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
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="PJLink Projector Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Projector Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="pjlink-host"
            label="Projector Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.1.100"
            required
            helpText="Projector/display IP address"
            error={errors.host}
          />

          <FormField
            id="pjlink-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4352"
            error={errors.port}
          />

          <FormField
            id="pjlink-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="(optional)"
            helpText="MD5 auth password"
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe PJLink projector"
        >
          Probe Projector
        </ActionButton>

        {projInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="Projector Information" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Identity */}
              {(projInfo.manufacturer || projInfo.productName) && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Device</span>
                  <p className="text-sm text-green-400 font-mono">
                    {[projInfo.manufacturer, projInfo.productName].filter(Boolean).join(' ')}
                  </p>
                </div>
              )}

              {projInfo.name && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Name</span>
                  <p className="text-sm text-blue-400 font-mono">{projInfo.name}</p>
                </div>
              )}

              {/* Status Row */}
              <div className="flex gap-4 flex-wrap">
                {projInfo.powerStatus && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Power</span>
                    <p className={`text-sm font-mono ${projInfo.powerStatus === 'Power On' ? 'text-green-400' : projInfo.powerStatus === 'Standby' ? 'text-yellow-400' : 'text-slate-200'}`}>
                      {projInfo.powerStatus}
                    </p>
                  </div>
                )}
                {projInfo.class && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Class</span>
                    <p className="text-sm text-slate-200 font-mono">{projInfo.class}</p>
                  </div>
                )}
                {projInfo.currentInput && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Input</span>
                    <p className="text-sm text-slate-200 font-mono">{projInfo.currentInput}</p>
                  </div>
                )}
              </div>

              {/* Lamp Hours */}
              {projInfo.lampHours && projInfo.lampHours.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Lamps</span>
                  <div className="flex gap-3 mt-1">
                    {projInfo.lampHours.map((lamp, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${lamp.on ? 'bg-green-500' : 'bg-slate-500'}`} />
                        <span className="text-xs text-slate-300">Lamp {i + 1}: {lamp.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Status */}
              {projInfo.errorStatus && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Diagnostics</span>
                  <div className="flex gap-3 flex-wrap mt-1">
                    {Object.entries(projInfo.errorStatus).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${val === 'OK' ? 'bg-green-500' : val === 'Warning' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                        <span className="text-xs text-slate-300">{key}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About PJLink"
          description="PJLink is a unified standard for projector and display control defined by JBMiA. It uses a simple text-based protocol over TCP port 4352. This client queries projector identity (manufacturer, model, name), power status, lamp hours, error diagnostics, input selection, and AV mute state."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 4352</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP (text, CR-terminated)</p>
            <p><strong className="text-slate-300">Auth:</strong> Optional MD5 (random + password)</p>
            <p><strong className="text-slate-300">Commands:</strong> %1CMD param\r (Class 1)</p>
            <p><strong className="text-slate-300">Devices:</strong> Projectors, flat panels, LED walls</p>
            <p><strong className="text-slate-300">Standard:</strong> JBMiA PJLink Class 1/2</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
