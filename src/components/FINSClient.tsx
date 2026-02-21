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

interface FINSClientProps {
  onBack: () => void;
}

export default function FINSClient({ onBack }: FINSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9600');
  const [clientNode, setClientNode] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [plcInfo, setPlcInfo] = useState<{
    serverNode?: number;
    clientNode?: number;
    model?: string;
    mode?: string;
    fatalError?: boolean;
    nonFatalError?: boolean;
  } | null>(null);

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
    setPlcInfo(null);

    try {
      const response = await fetch('/api/fins/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          clientNode: parseInt(clientNode, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        serverNode?: number;
        clientNode?: number;
        rtt?: number;
        connectTime?: number;
        controllerInfo?: {
          model?: string;
          mode?: string;
          fatalError?: boolean;
          nonFatalError?: boolean;
        };
        error?: string;
      };

      if (response.ok && data.success) {
        setPlcInfo({
          serverNode: data.serverNode,
          clientNode: data.clientNode,
          model: data.controllerInfo?.model,
          mode: data.controllerInfo?.mode,
          fatalError: data.controllerInfo?.fatalError,
          nonFatalError: data.controllerInfo?.nonFatalError,
        });

        const lines = [
          `PLC: ${host}:${port}`,
          '',
          `Server Node: ${data.serverNode}`,
          `Client Node: ${data.clientNode}`,
          `Connect Time: ${data.connectTime}ms`,
          `Total RTT: ${data.rtt}ms`,
        ];
        if (data.controllerInfo?.model) lines.push(`Model: ${data.controllerInfo.model}`);
        if (data.controllerInfo?.mode) lines.push(`Mode: ${data.controllerInfo.mode}`);
        if (data.controllerInfo?.fatalError !== undefined) {
          lines.push(`Fatal Error: ${data.controllerInfo.fatalError ? 'Yes' : 'No'}`);
        }
        if (data.controllerInfo?.nonFatalError !== undefined) {
          lines.push(`Non-Fatal Error: ${data.controllerInfo.nonFatalError ? 'Yes' : 'No'}`);
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
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Omron FINS Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.FINS || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="PLC Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="fins-host"
            label="PLC Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.250.1"
            required
            helpText="Omron PLC IP address"
            error={errors.host}
          />

          <FormField
            id="fins-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9600 (FINS/TCP)"
            error={errors.port}
          />

          <FormField
            id="fins-node"
            label="Client Node"
            type="number"
            value={clientNode}
            onChange={setClientNode}
            onKeyDown={handleKeyDown}
            min="0"
            max="254"
            helpText="0 = auto-assign"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to Omron FINS PLC"
        >
          Connect & Identify
        </ActionButton>

        {plcInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="PLC Information" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Node Addresses */}
              <div className="flex gap-4">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Server Node</span>
                  <p className="text-sm text-blue-400 font-mono">{plcInfo.serverNode}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Client Node</span>
                  <p className="text-sm text-blue-400 font-mono">{plcInfo.clientNode}</p>
                </div>
              </div>

              {/* Model */}
              {plcInfo.model && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Controller Model</span>
                  <p className="text-sm text-green-400 font-mono">{plcInfo.model}</p>
                </div>
              )}

              {/* Mode & Status */}
              {plcInfo.mode && (
                <div className="flex gap-4 items-center">
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Mode</span>
                    <p className={`text-sm font-mono ${plcInfo.mode === 'Run' ? 'text-green-400' : plcInfo.mode === 'Program' ? 'text-yellow-400' : 'text-slate-200'}`}>
                      {plcInfo.mode}
                    </p>
                  </div>
                  {plcInfo.fatalError !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${plcInfo.fatalError ? 'bg-red-500' : 'bg-green-500'}`} />
                      <span className="text-xs text-slate-300">Fatal</span>
                    </div>
                  )}
                  {plcInfo.nonFatalError !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${plcInfo.nonFatalError ? 'bg-yellow-500' : 'bg-green-500'}`} />
                      <span className="text-xs text-slate-300">Non-Fatal</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Omron FINS"
          description="FINS (Factory Interface Network Service) is Omron's proprietary protocol for communicating with CJ, CS, CP, and NX-series PLCs. It runs over TCP on port 9600 using a binary framing protocol with 'FINS' magic header. This client performs a FINS/TCP node address handshake and reads controller identification data."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 9600 (FINS/TCP)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP (binary)</p>
            <p><strong className="text-slate-300">Framing:</strong> &quot;FINS&quot; magic + length + command + error + data</p>
            <p><strong className="text-slate-300">Byte Order:</strong> Big-endian</p>
            <p><strong className="text-slate-300">Auth:</strong> None (network-level access control)</p>
            <p><strong className="text-slate-300">PLCs:</strong> CJ1, CJ2, CS1, CP1, NJ/NX series</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
