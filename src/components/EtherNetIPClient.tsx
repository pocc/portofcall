import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface EtherNetIPClientProps {
  onBack: () => void;
}

export default function EtherNetIPClient({ onBack }: EtherNetIPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('44818');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [deviceInfo, setDeviceInfo] = useState<{
    productName?: string;
    deviceType?: string;
    vendorId?: number;
    productCode?: number;
    revision?: string;
    serialNumber?: string;
    status?: string;
    state?: string;
    socketAddress?: string;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleIdentity = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setDeviceInfo(null);

    try {
      const response = await fetch('/api/ethernetip/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
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
        encapsulationCommand?: number;
        encapsulationStatus?: number;
        identity?: {
          protocolVersion?: number;
          vendorId?: number;
          deviceType?: number;
          deviceTypeName?: string;
          productCode?: number;
          revisionMajor?: number;
          revisionMinor?: number;
          status?: number;
          statusDescription?: string;
          serialNumber?: string;
          productName?: string;
          state?: number;
          stateName?: string;
          socketAddress?: string;
        };
      };

      if (response.ok && data.success) {
        const id = data.identity;
        if (id) {
          setDeviceInfo({
            productName: id.productName,
            deviceType: id.deviceTypeName,
            vendorId: id.vendorId,
            productCode: id.productCode,
            revision: id.revisionMajor !== undefined ? `${id.revisionMajor}.${id.revisionMinor}` : undefined,
            serialNumber: id.serialNumber,
            status: id.statusDescription,
            state: id.stateName,
            socketAddress: id.socketAddress,
          });
        }

        const lines = [
          `EtherNet/IP Device: ${data.host}:${data.port}`,
          `RTT: ${data.rtt}ms`,
          '',
        ];

        if (id) {
          if (id.productName) lines.push(`Product: ${id.productName}`);
          if (id.deviceTypeName) lines.push(`Type: ${id.deviceTypeName}`);
          if (id.vendorId !== undefined) lines.push(`Vendor ID: ${id.vendorId}`);
          if (id.productCode !== undefined) lines.push(`Product Code: ${id.productCode}`);
          if (id.revisionMajor !== undefined) lines.push(`Revision: ${id.revisionMajor}.${id.revisionMinor}`);
          if (id.serialNumber) lines.push(`Serial: ${id.serialNumber}`);
          if (id.statusDescription) lines.push(`Status: ${id.statusDescription}`);
          if (id.stateName) lines.push(`State: ${id.stateName}`);
          if (id.socketAddress) lines.push(`Socket: ${id.socketAddress}`);
          if (id.protocolVersion !== undefined) lines.push(`Protocol Version: ${id.protocolVersion}`);
        } else {
          lines.push('Device responded but no identity data returned.');
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Identity query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleIdentity();
    }
  };

  return (
    <ProtocolClientLayout title="EtherNet/IP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* ICS Safety Warning */}
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-xl" aria-hidden="true">⚠</span>
            <div>
              <p className="text-yellow-200 text-sm font-semibold mb-1">ICS/SCADA Safety Notice</p>
              <p className="text-yellow-100/80 text-xs leading-relaxed">
                EtherNet/IP is used in industrial control systems. This client sends a read-only
                ListIdentity command. Only connect to devices you are authorized to access.
              </p>
            </div>
          </div>
        </div>

        <SectionHeader stepNumber={1} title="Device Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="enip-host"
            label="Device Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.1.100"
            required
            helpText="PLC or device IP address"
            error={errors.host}
          />

          <FormField
            id="enip-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 44818"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleIdentity}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Discover EtherNet/IP device identity"
        >
          Discover Device
        </ActionButton>

        {deviceInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="Device Identity" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {deviceInfo.productName && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Product</span>
                  <p className="text-sm text-green-400 font-mono">{deviceInfo.productName}</p>
                </div>
              )}

              {deviceInfo.deviceType && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Device Type</span>
                  <p className="text-sm text-blue-400 font-mono">{deviceInfo.deviceType}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {deviceInfo.vendorId !== undefined && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Vendor ID</span>
                    <p className="text-sm text-slate-200 font-mono">{deviceInfo.vendorId}</p>
                  </div>
                )}
                {deviceInfo.productCode !== undefined && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Product Code</span>
                    <p className="text-sm text-slate-200 font-mono">{deviceInfo.productCode}</p>
                  </div>
                )}
                {deviceInfo.revision && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Revision</span>
                    <p className="text-sm text-slate-200 font-mono">{deviceInfo.revision}</p>
                  </div>
                )}
                {deviceInfo.serialNumber && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Serial</span>
                    <p className="text-sm text-slate-200 font-mono">{deviceInfo.serialNumber}</p>
                  </div>
                )}
              </div>

              {deviceInfo.status && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Status</span>
                  <p className="text-sm text-slate-200 font-mono">{deviceInfo.status}</p>
                </div>
              )}

              {deviceInfo.state && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">State</span>
                  <p className="text-sm text-slate-200 font-mono">{deviceInfo.state}</p>
                </div>
              )}

              {deviceInfo.socketAddress && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Socket Address</span>
                  <p className="text-sm text-slate-200 font-mono">{deviceInfo.socketAddress}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About EtherNet/IP"
          description="EtherNet/IP (Ethernet Industrial Protocol) uses CIP (Common Industrial Protocol) over TCP port 44818. It is used by Allen-Bradley/Rockwell PLCs, drives, I/O modules, and other industrial devices. The ListIdentity command discovers device type, vendor, product name, serial number, and firmware revision without requiring authentication or a CIP session."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 44818 (TCP)</p>
            <p><strong className="text-slate-300">Encoding:</strong> Little-endian binary</p>
            <p><strong className="text-slate-300">Header:</strong> 24-byte encapsulation</p>
            <p><strong className="text-slate-300">Auth:</strong> None for ListIdentity</p>
            <p><strong className="text-slate-300">Standard:</strong> ODVA EtherNet/IP Specification</p>
            <p><strong className="text-slate-300">Devices:</strong> Allen-Bradley, Rockwell, various CIP vendors</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
