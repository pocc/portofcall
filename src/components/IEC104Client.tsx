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

interface IEC104ClientProps {
  onBack: () => void;
}

interface FrameInfo {
  type: string;
  length: number;
  controlField: string;
  description: string;
}

export default function IEC104Client({ onBack }: IEC104ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2404');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [probeInfo, setProbeInfo] = useState<{
    startdtConfirmed?: boolean;
    testfrConfirmed?: boolean;
    framesReceived?: FrameInfo[];
    rtt?: number;
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
    setProbeInfo(null);

    try {
      const response = await fetch('/api/iec104/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isCloudflare?: boolean;
        host?: string;
        port?: number;
        rtt?: number;
        startdtConfirmed?: boolean;
        testfrConfirmed?: boolean;
        framesReceived?: FrameInfo[];
      };

      if (response.ok && data.success) {
        setProbeInfo({
          startdtConfirmed: data.startdtConfirmed,
          testfrConfirmed: data.testfrConfirmed,
          framesReceived: data.framesReceived,
          rtt: data.rtt,
        });

        const lines = [
          `IEC 104 Server: ${data.host}:${data.port}`,
          `RTT: ${data.rtt}ms`,
          '',
          `STARTDT: ${data.startdtConfirmed ? 'Confirmed' : 'No response'}`,
          `TESTFR: ${data.testfrConfirmed ? 'Confirmed' : 'No response'}`,
        ];

        if (data.framesReceived && data.framesReceived.length > 0) {
          lines.push('', 'Frames Received:');
          for (const frame of data.framesReceived) {
            lines.push(`  [${frame.type}] ${frame.description}`);
            lines.push(`    Control: ${frame.controlField} (${frame.length} bytes)`);
          }
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Probe failed');
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
    <ProtocolClientLayout title="IEC 60870-5-104 Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.IEC104 || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* SCADA Safety Warning */}
        <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-xl" aria-hidden="true">⚠</span>
            <div>
              <p className="text-red-200 text-sm font-semibold mb-1">Critical Infrastructure Warning</p>
              <p className="text-red-100/80 text-xs leading-relaxed">
                IEC 104 is used in power grids, substations, and critical infrastructure SCADA systems.
                This client sends read-only U-frame probes (STARTDT/TESTFR). Only connect to systems
                you are authorized to access. Unauthorized access may violate regulations.
              </p>
            </div>
          </div>
        </div>

        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="iec104-host"
            label="RTU/Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.1.100"
            required
            helpText="IEC 104 server or RTU IP address"
            error={errors.host}
          />

          <FormField
            id="iec104-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2404"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe IEC 104 server"
        >
          Probe Server
        </ActionButton>

        {probeInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="Connection Status" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Connection Status Indicators */}
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${probeInfo.startdtConfirmed ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm text-slate-300">STARTDT</span>
                  <span className={`text-xs ${probeInfo.startdtConfirmed ? 'text-green-400' : 'text-red-400'}`}>
                    {probeInfo.startdtConfirmed ? 'Confirmed' : 'No Response'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${probeInfo.testfrConfirmed ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm text-slate-300">TESTFR</span>
                  <span className={`text-xs ${probeInfo.testfrConfirmed ? 'text-green-400' : 'text-red-400'}`}>
                    {probeInfo.testfrConfirmed ? 'Confirmed' : 'No Response'}
                  </span>
                </div>
              </div>

              {probeInfo.rtt !== undefined && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Round Trip Time</span>
                  <p className="text-sm text-slate-200 font-mono">{probeInfo.rtt}ms</p>
                </div>
              )}

              {/* Frame Details */}
              {probeInfo.framesReceived && probeInfo.framesReceived.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase mb-2 block">
                    Frames Received ({probeInfo.framesReceived.length})
                  </span>
                  <div className="space-y-2">
                    {probeInfo.framesReceived.map((frame, i) => (
                      <div key={i} className="bg-slate-800 rounded p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                            frame.type === 'U-frame' ? 'bg-blue-900/50 text-blue-300' :
                            frame.type === 'I-frame' ? 'bg-green-900/50 text-green-300' :
                            frame.type === 'S-frame' ? 'bg-yellow-900/50 text-yellow-300' :
                            'bg-slate-600 text-slate-300'
                          }`}>
                            {frame.type}
                          </span>
                          <span className="text-xs text-slate-300">{frame.description}</span>
                        </div>
                        <span className="text-xs text-slate-500 font-mono">
                          Control: {frame.controlField} ({frame.length}B)
                        </span>
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
          title="About IEC 60870-5-104"
          description="IEC 104 is the TCP/IP extension of IEC 60870-5-101, used for telecontrol in power systems and SCADA. It runs on port 2404 and uses a 6-byte APCI frame with start byte 0x68. U-frames manage connections (STARTDT activates data transfer, TESTFR tests keepalive). I-frames carry process data (measurements, commands). S-frames acknowledge received data."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 2404 (TCP)</p>
            <p><strong className="text-slate-300">Standard:</strong> IEC 60870-5-104:2006</p>
            <p><strong className="text-slate-300">Encoding:</strong> Little-endian binary</p>
            <p><strong className="text-slate-300">Frame Size:</strong> 6 bytes (U/S) to 255 bytes (I)</p>
            <p><strong className="text-slate-300">Auth:</strong> None (network-level access control)</p>
            <p><strong className="text-slate-300">Use:</strong> Power grids, substations, water/gas SCADA</p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Frame Types</h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-blue-900/30 border border-blue-700/30 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono block">U-frame</span>
              <span className="text-slate-400">Connection mgmt</span>
            </div>
            <div className="bg-green-900/30 border border-green-700/30 px-3 py-2 rounded">
              <span className="text-green-400 font-mono block">I-frame</span>
              <span className="text-slate-400">Data transfer</span>
            </div>
            <div className="bg-yellow-900/30 border border-yellow-700/30 px-3 py-2 rounded">
              <span className="text-yellow-400 font-mono block">S-frame</span>
              <span className="text-slate-400">Acknowledgment</span>
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
