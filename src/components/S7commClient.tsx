import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface S7commClientProps {
  onBack: () => void;
}

export default function S7commClient({ onBack }: S7commClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('102');
  const [rack, setRack] = useState('0');
  const [slot, setSlot] = useState('2');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [plcInfo, setPlcInfo] = useState<{
    cotpConnected?: boolean;
    s7Connected?: boolean;
    pduSize?: number;
    cpuInfo?: string;
    moduleType?: string;
    serialNumber?: string;
    plantId?: string;
    copyright?: string;
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
      const response = await fetch('/api/s7comm/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          rack: parseInt(rack),
          slot: parseInt(slot),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        cotpConnected?: boolean;
        s7Connected?: boolean;
        pduSize?: number;
        cpuInfo?: string;
        moduleType?: string;
        serialNumber?: string;
        plantId?: string;
        copyright?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        setPlcInfo({
          cotpConnected: data.cotpConnected,
          s7Connected: data.s7Connected,
          pduSize: data.pduSize,
          cpuInfo: data.cpuInfo,
          moduleType: data.moduleType,
          serialNumber: data.serialNumber,
          plantId: data.plantId,
          copyright: data.copyright,
        });

        const lines = [
          `PLC: ${host}:${port} (Rack ${rack}, Slot ${slot})`,
          '',
          `COTP Connected: ${data.cotpConnected ? 'Yes' : 'No'}`,
          `S7 Connected: ${data.s7Connected ? 'Yes' : 'No'}`,
        ];
        if (data.pduSize) lines.push(`PDU Size: ${data.pduSize} bytes`);
        if (data.cpuInfo) lines.push(`CPU Info: ${data.cpuInfo}`);
        if (data.moduleType) lines.push(`Module Type: ${data.moduleType}`);
        if (data.serialNumber) lines.push(`Serial Number: ${data.serialNumber}`);
        if (data.plantId) lines.push(`Plant ID: ${data.plantId}`);
        if (data.copyright) lines.push(`Copyright: ${data.copyright}`);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Connection failed');
        if (data.cotpConnected !== undefined) {
          setPlcInfo({ cotpConnected: data.cotpConnected, s7Connected: data.s7Connected });
        }
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
    <ProtocolClientLayout title="S7comm PLC Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="PLC Connection" />

        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <FormField
            id="s7-host"
            label="PLC Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.0.1"
            required
            helpText="Siemens S7 PLC IP address"
            error={errors.host}
          />

          <FormField
            id="s7-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 102 (ISO-TSAP)"
            error={errors.port}
          />

          <FormField
            id="s7-rack"
            label="Rack"
            type="number"
            value={rack}
            onChange={setRack}
            onKeyDown={handleKeyDown}
            min="0"
            max="7"
            helpText="PLC rack number (0-7)"
          />

          <FormField
            id="s7-slot"
            label="Slot"
            type="number"
            value={slot}
            onChange={setSlot}
            onKeyDown={handleKeyDown}
            min="0"
            max="31"
            helpText="CPU slot (usually 2)"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to S7 PLC"
        >
          Connect & Identify
        </ActionButton>

        {plcInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="PLC Information" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Connection Status */}
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${plcInfo.cotpConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs text-slate-300">COTP</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${plcInfo.s7Connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs text-slate-300">S7</span>
                </div>
                {plcInfo.pduSize && (
                  <span className="text-xs text-slate-400">PDU: {plcInfo.pduSize}B</span>
                )}
              </div>

              {/* CPU Info */}
              {plcInfo.cpuInfo && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">CPU</span>
                  <p className="text-sm text-green-400 font-mono">{plcInfo.cpuInfo}</p>
                </div>
              )}

              {plcInfo.moduleType && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Module</span>
                  <p className="text-sm text-blue-400 font-mono">{plcInfo.moduleType}</p>
                </div>
              )}

              {plcInfo.serialNumber && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Serial</span>
                  <p className="text-sm text-slate-200 font-mono">{plcInfo.serialNumber}</p>
                </div>
              )}

              {plcInfo.plantId && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Plant ID</span>
                  <p className="text-sm text-slate-200 font-mono">{plcInfo.plantId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common Rack/Slot Configs</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { r: 0, s: 2, label: 'S7-300 (0/2)' },
              { r: 0, s: 0, label: 'S7-1200 (0/0)' },
              { r: 0, s: 1, label: 'S7-1500 (0/1)' },
              { r: 0, s: 3, label: 'S7-400 (0/3)' },
            ].map(({ r, s, label }) => (
              <button
                key={label}
                onClick={() => { setRack(String(r)); setSlot(String(s)); }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About S7comm"
          description="S7comm is the proprietary protocol used by Siemens S7 PLCs (S7-300, S7-400, S7-1200, S7-1500) in industrial automation. It runs over ISO-TSAP (port 102) using TPKT/COTP framing. This client performs a COTP connection, S7 setup communication, and reads the CPU identification via SZL."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 102 (ISO-TSAP / RFC 1006)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP (binary)</p>
            <p><strong className="text-slate-300">Stack:</strong> TPKT → COTP → S7comm</p>
            <p><strong className="text-slate-300">Auth:</strong> None (network-level access control)</p>
            <p><strong className="text-slate-300">Encoding:</strong> Big-endian binary</p>
            <p><strong className="text-slate-300">PLCs:</strong> S7-300, S7-400, S7-1200, S7-1500</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
