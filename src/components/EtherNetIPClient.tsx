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

type Tab = 'identity' | 'cip-read' | 'get-all' | 'cip-write' | 'list-services';

// Quick-access CIP object presets
const CIP_PRESETS: Array<{ label: string; classId: number; instanceId: number; attributeId: number; desc: string }> = [
  { label: 'Identity: Product Name',     classId: 0x01, instanceId: 1, attributeId: 7,  desc: 'Identity Object — product name string' },
  { label: 'Identity: Vendor ID',         classId: 0x01, instanceId: 1, attributeId: 1,  desc: 'Identity Object — vendor ID (UINT)' },
  { label: 'Identity: Device Type',       classId: 0x01, instanceId: 1, attributeId: 2,  desc: 'Identity Object — device type (UINT)' },
  { label: 'Identity: Revision',          classId: 0x01, instanceId: 1, attributeId: 3,  desc: 'Identity Object — revision (USINT.USINT)' },
  { label: 'Identity: Serial Number',     classId: 0x01, instanceId: 1, attributeId: 6,  desc: 'Identity Object — serial number (UDINT)' },
  { label: 'Identity: Status',            classId: 0x01, instanceId: 1, attributeId: 8,  desc: 'Identity Object — status word (WORD)' },
  { label: 'TCP/IP: Interface Config',    classId: 0xF5, instanceId: 1, attributeId: 5,  desc: 'TCP/IP Object — IP config (IP, mask, gateway, DNS)' },
  { label: 'TCP/IP: Hostname',            classId: 0xF5, instanceId: 1, attributeId: 6,  desc: 'TCP/IP Object — hostname string' },
  { label: 'Ethernet Link: Speed',        classId: 0xF6, instanceId: 1, attributeId: 4,  desc: 'Ethernet Link Object — interface speed (UDINT, Mbps)' },
  { label: 'Ethernet Link: Flags',        classId: 0xF6, instanceId: 1, attributeId: 2,  desc: 'Ethernet Link Object — interface flags (DWORD)' },
  { label: 'Message Router: Object List', classId: 0x02, instanceId: 1, attributeId: 1,  desc: 'Message Router — list of supported objects' },
  { label: 'Connection Mgr: Open Count',  classId: 0x06, instanceId: 1, attributeId: 3,  desc: 'Connection Manager — total open connections (UINT)' },
];

export default function EtherNetIPClient({ onBack }: EtherNetIPClientProps) {
  const [tab, setTab] = useState<Tab>('identity');

  // ── Shared connection fields ──────────────────────────────────────────────
  const [host, setHost] = useState('');
  const [port, setPort] = useState('44818');

  // ── Identity tab state ────────────────────────────────────────────────────
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityResult, setIdentityResult] = useState('');
  const [identityError, setIdentityError] = useState('');
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

  // ── CIP Read tab state ────────────────────────────────────────────────────
  const [cipClassId, setCipClassId] = useState('0x01');
  const [cipInstanceId, setCipInstanceId] = useState('1');
  const [cipAttributeId, setCipAttributeId] = useState('7');
  const [cipReadLoading, setCipReadLoading] = useState(false);
  const [cipReadResult, setCipReadResult] = useState('');
  const [cipReadError, setCipReadError] = useState('');

  // ── Get All Attributes tab state ──────────────────────────────────────────
  const [getAllClassId, setGetAllClassId] = useState('0x01');
  const [getAllInstanceId, setGetAllInstanceId] = useState('1');
  const [getAllLoading, setGetAllLoading] = useState(false);
  const [getAllResult, setGetAllResult] = useState('');
  const [getAllError, setGetAllError] = useState('');

  // ── CIP Write tab state ───────────────────────────────────────────────────
  const [writeClassId, setWriteClassId] = useState('0x01');
  const [writeInstanceId, setWriteInstanceId] = useState('1');
  const [writeAttributeId, setWriteAttributeId] = useState('7');
  const [writeHex, setWriteHex] = useState('');
  const [writeLoading, setWriteLoading] = useState(false);
  const [writeResult, setWriteResult] = useState('');
  const [writeError, setWriteError] = useState('');

  // ── List Services tab state ───────────────────────────────────────────────
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesResult, setServicesResult] = useState('');
  const [servicesError, setServicesError] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function parseHexId(s: string): number {
    const trimmed = s.trim();
    if (trimmed.toLowerCase().startsWith('0x')) {
      return parseInt(trimmed, 16);
    }
    return parseInt(trimmed, 10);
  }

  function hexToBytes(hex: string): number[] | null {
    const clean = hex.replace(/[\s,]/g, '').replace(/^0x/i, '');
    if (clean.length === 0 || clean.length % 2 !== 0) return null;
    if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) {
      bytes.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return bytes;
  }

  // ── Identity handler ──────────────────────────────────────────────────────

  const handleIdentity = async () => {
    if (!validateAll({ host, port })) return;

    setIdentityLoading(true);
    setIdentityError('');
    setIdentityResult('');
    setDeviceInfo(null);

    try {
      const res = await fetch('/api/ethernetip/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        isCloudflare?: boolean;
        host?: string;
        port?: number;
        rtt?: number;
        identity?: {
          protocolVersion?: number;
          vendorId?: number;
          deviceTypeName?: string;
          productCode?: number;
          revisionMajor?: number;
          revisionMinor?: number;
          statusDescription?: string;
          serialNumber?: string;
          productName?: string;
          stateName?: string;
          socketAddress?: string;
        };
      };

      if (res.ok && data.success) {
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

        const lines = [`EtherNet/IP Device: ${data.host}:${data.port}`, `RTT: ${data.rtt}ms`, ''];
        if (id) {
          if (id.productName)      lines.push(`Product:      ${id.productName}`);
          if (id.deviceTypeName)   lines.push(`Type:         ${id.deviceTypeName}`);
          if (id.vendorId !== undefined) lines.push(`Vendor ID:    ${id.vendorId}`);
          if (id.productCode !== undefined) lines.push(`Product Code: ${id.productCode}`);
          if (id.revisionMajor !== undefined) lines.push(`Revision:     ${id.revisionMajor}.${id.revisionMinor}`);
          if (id.serialNumber)     lines.push(`Serial:       ${id.serialNumber}`);
          if (id.statusDescription) lines.push(`Status:       ${id.statusDescription}`);
          if (id.stateName)        lines.push(`State:        ${id.stateName}`);
          if (id.socketAddress)    lines.push(`Socket:       ${id.socketAddress}`);
          if (id.protocolVersion !== undefined) lines.push(`Protocol Ver: ${id.protocolVersion}`);
        }
        setIdentityResult(lines.join('\n'));
      } else {
        setIdentityError(data.error || 'Identity query failed');
      }
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIdentityLoading(false);
    }
  };

  // ── CIP Read handler ──────────────────────────────────────────────────────

  const handleCIPRead = async () => {
    if (!validateAll({ host, port })) return;

    const classId = parseHexId(cipClassId);
    const instanceId = parseInt(cipInstanceId, 10);
    const attributeId = parseInt(cipAttributeId, 10);

    if (isNaN(classId) || isNaN(instanceId) || isNaN(attributeId)) {
      setCipReadError('Invalid class, instance, or attribute ID');
      return;
    }

    setCipReadLoading(true);
    setCipReadError('');
    setCipReadResult('');

    try {
      const res = await fetch('/api/ethernetip/cip-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000, classId, instanceId, attributeId }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        statusName?: string;
        sessionHandle?: string;
        classId?: string;
        instanceId?: number;
        attributeId?: number;
        hex?: string;
        data?: number[];
        rtt?: number;
      };

      if (data.success) {
        const bytes = data.data ?? [];
        const lines = [
          `Class:    ${data.classId}  Instance: ${data.instanceId}  Attribute: ${data.attributeId}`,
          `Status:   ${data.statusName} (0x00)`,
          `Session:  ${data.sessionHandle}`,
          `RTT:      ${data.rtt}ms`,
          '',
          `Bytes (${bytes.length}):`,
          data.hex || '(none)',
        ];

        // Try to decode as ASCII if printable
        const ascii = bytes.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        if (ascii.trim().length > 0) {
          lines.push('', `ASCII: ${ascii}`);
        }

        // Try to decode as UINT16 / UINT32 for small responses
        if (bytes.length === 2) {
          const val = bytes[0] | (bytes[1] << 8);
          lines.push(`UINT16: ${val} (0x${val.toString(16).toUpperCase()})`);
        }
        if (bytes.length === 4) {
          const val = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
          lines.push(`UINT32: ${val >>> 0} (0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')})`);
        }

        setCipReadResult(lines.join('\n'));
      } else {
        setCipReadError(data.error || `CIP error: ${data.statusName}`);
      }
    } catch (err) {
      setCipReadError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setCipReadLoading(false);
    }
  };

  const applyPreset = (preset: typeof CIP_PRESETS[0]) => {
    setCipClassId(`0x${preset.classId.toString(16).toUpperCase().padStart(2, '0')}`);
    setCipInstanceId(String(preset.instanceId));
    setCipAttributeId(String(preset.attributeId));
  };

  // ── Get All Attributes handler ────────────────────────────────────────────

  const handleGetAll = async () => {
    if (!validateAll({ host, port })) return;

    const classId = parseHexId(getAllClassId);
    const instanceId = parseInt(getAllInstanceId, 10);

    if (isNaN(classId) || isNaN(instanceId)) {
      setGetAllError('Invalid class or instance ID');
      return;
    }

    setGetAllLoading(true);
    setGetAllError('');
    setGetAllResult('');

    try {
      const res = await fetch('/api/ethernetip/get-attribute-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000, classId, instanceId }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        statusName?: string;
        classId?: string;
        instanceId?: number;
        hex?: string;
        data?: number[];
        rtt?: number;
      };

      if (data.success) {
        const bytes = data.data ?? [];
        const lines = [
          `Get_Attributes_All — Class: ${data.classId}  Instance: ${data.instanceId}`,
          `Status: ${data.statusName}  RTT: ${data.rtt}ms`,
          '',
          `Raw bytes (${bytes.length}):`,
          data.hex || '(none)',
        ];
        setCipReadResult('');
        setGetAllResult(lines.join('\n'));
      } else {
        setGetAllError(data.error || `CIP error: ${data.statusName}`);
      }
    } catch (err) {
      setGetAllError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setGetAllLoading(false);
    }
  };

  // ── CIP Write handler ─────────────────────────────────────────────────────

  const handleCIPWrite = async () => {
    if (!validateAll({ host, port })) return;

    const classId = parseHexId(writeClassId);
    const instanceId = parseInt(writeInstanceId, 10);
    const attributeId = parseInt(writeAttributeId, 10);

    if (isNaN(classId) || isNaN(instanceId) || isNaN(attributeId)) {
      setWriteError('Invalid class, instance, or attribute ID');
      return;
    }

    const bytes = hexToBytes(writeHex);
    if (!bytes) {
      setWriteError('Invalid hex data — enter an even number of hex digits (e.g. 01 02 03 or 010203)');
      return;
    }

    setWriteLoading(true);
    setWriteError('');
    setWriteResult('');

    try {
      const res = await fetch('/api/ethernetip/set-attribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(port, 10), timeout: 10000,
          classId, instanceId, attributeId, data: bytes,
        }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        statusName?: string;
        classId?: string;
        instanceId?: number;
        attributeId?: number;
        bytesWritten?: number;
        rtt?: number;
      };

      if (data.success) {
        setWriteResult([
          `Set_Attribute_Single — Success`,
          `Class: ${data.classId}  Instance: ${data.instanceId}  Attribute: ${data.attributeId}`,
          `Bytes written: ${data.bytesWritten}`,
          `RTT: ${data.rtt}ms`,
        ].join('\n'));
      } else {
        setWriteError(data.error || `CIP error: ${data.statusName}`);
      }
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setWriteLoading(false);
    }
  };

  // ── List Services handler ─────────────────────────────────────────────────

  const handleListServices = async () => {
    if (!validateAll({ host, port })) return;

    setServicesLoading(true);
    setServicesError('');
    setServicesResult('');

    try {
      const res = await fetch('/api/ethernetip/list-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        serviceCount?: number;
        services?: Array<{
          typeId: number;
          version: number;
          capabilityFlags: number;
          name: string;
          supportsTCP: boolean;
          supportsUDP: boolean;
        }>;
      };

      if (data.success) {
        const lines = [
          `ListServices — ${data.serviceCount} service(s)  RTT: ${data.rtt}ms`,
          '',
        ];
        for (const svc of data.services ?? []) {
          lines.push(`Type ID: 0x${svc.typeId.toString(16).toUpperCase().padStart(4, '0')}  Version: ${svc.version}`);
          if (svc.name) lines.push(`  Name: "${svc.name}"`);
          lines.push(`  Capabilities: 0x${svc.capabilityFlags.toString(16).toUpperCase().padStart(4, '0')}`);
          lines.push(`  TCP: ${svc.supportsTCP ? 'Yes' : 'No'}  UDP: ${svc.supportsUDP ? 'Yes' : 'No'}`);
          lines.push('');
        }
        setServicesResult(lines.join('\n').trimEnd());
      } else {
        setServicesError(data.error || 'ListServices failed');
      }
    } catch (err) {
      setServicesError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setServicesLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'identity',      label: 'Identity' },
    { id: 'cip-read',      label: 'CIP Read' },
    { id: 'get-all',       label: 'Get All' },
    { id: 'cip-write',     label: 'CIP Write' },
    { id: 'list-services', label: 'Services' },
  ];

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
                EtherNet/IP is used in industrial control systems. The CIP Write tab sends real data to devices.
                Only connect to devices you are authorized to access. Writing to production PLCs may cause harm.
              </p>
            </div>
          </div>
        </div>

        {/* Connection fields — shared across all tabs */}
        <SectionHeader stepNumber={1} title="Device Connection" />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="enip-host"
            label="Device Host"
            type="text"
            value={host}
            onChange={setHost}
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
            min="1"
            max="65535"
            helpText="Default: 44818"
            error={errors.port}
          />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-6 border-b border-slate-600 pb-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === t.id
                  ? 'bg-slate-700 text-blue-400 border-b-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Identity tab ──────────────────────────────────────────────── */}
        {tab === 'identity' && (
          <div>
            <SectionHeader stepNumber={2} title="ListIdentity (no session required)" />
            <p className="text-slate-400 text-sm mb-4">
              Queries device type, vendor, product name, revision, serial number, and state. Read-only.
            </p>

            <ActionButton
              onClick={handleIdentity}
              disabled={identityLoading || !host || !port}
              loading={identityLoading}
              ariaLabel="Discover EtherNet/IP device identity"
            >
              Discover Device
            </ActionButton>

            {deviceInfo && (
              <div className="mt-6">
                <SectionHeader stepNumber={3} title="Device Identity" color="green" />
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

            <ResultDisplay result={identityResult} error={identityError} />
          </div>
        )}

        {/* ── CIP Read tab ──────────────────────────────────────────────── */}
        {tab === 'cip-read' && (
          <div>
            <SectionHeader stepNumber={2} title="Get_Attribute_Single (CIP Read)" />
            <p className="text-slate-400 text-sm mb-4">
              Reads a single attribute from any CIP object. Opens a session via RegisterSession, then sends SendRRData.
            </p>

            {/* Quick presets */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Quick Presets</p>
              <div className="flex flex-wrap gap-2">
                {CIP_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    title={preset.desc}
                    className="px-2.5 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 hover:text-slate-100 transition-colors font-mono"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <FormField
                id="cip-class"
                label="Class ID"
                type="text"
                value={cipClassId}
                onChange={setCipClassId}
                placeholder="0x01"
                helpText="Hex (0x01) or decimal"
              />
              <FormField
                id="cip-instance"
                label="Instance ID"
                type="number"
                value={cipInstanceId}
                onChange={setCipInstanceId}
                placeholder="1"
                helpText="Usually 1"
              />
              <FormField
                id="cip-attribute"
                label="Attribute ID"
                type="number"
                value={cipAttributeId}
                onChange={setCipAttributeId}
                placeholder="7"
                helpText="1-based attribute number"
              />
            </div>

            <ActionButton
              onClick={handleCIPRead}
              disabled={cipReadLoading || !host || !port}
              loading={cipReadLoading}
              ariaLabel="Read CIP attribute"
            >
              Read Attribute
            </ActionButton>

            <ResultDisplay result={cipReadResult} error={cipReadError} />
          </div>
        )}

        {/* ── Get All Attributes tab ────────────────────────────────────── */}
        {tab === 'get-all' && (
          <div>
            <SectionHeader stepNumber={2} title="Get_Attributes_All (bulk read)" />
            <p className="text-slate-400 text-sm mb-4">
              Reads all attributes for a given CIP class and instance in a single request. Returns raw bytes
              since the structure depends on the object type.
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <FormField
                id="getall-class"
                label="Class ID"
                type="text"
                value={getAllClassId}
                onChange={setGetAllClassId}
                placeholder="0x01"
                helpText="Hex (0x01) or decimal"
              />
              <FormField
                id="getall-instance"
                label="Instance ID"
                type="number"
                value={getAllInstanceId}
                onChange={setGetAllInstanceId}
                placeholder="1"
                helpText="0 = class-level attributes, 1+ = instance"
              />
            </div>

            {/* Common objects shortcut */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Common Objects</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Identity (0x01)', classId: 0x01 },
                  { label: 'Msg Router (0x02)', classId: 0x02 },
                  { label: 'Assembly (0x04)', classId: 0x04 },
                  { label: 'Conn Manager (0x06)', classId: 0x06 },
                  { label: 'TCP/IP (0xF5)', classId: 0xF5 },
                  { label: 'Eth Link (0xF6)', classId: 0xF6 },
                ].map(obj => (
                  <button
                    key={obj.label}
                    onClick={() => {
                      setGetAllClassId(`0x${obj.classId.toString(16).toUpperCase().padStart(2, '0')}`);
                      setGetAllInstanceId('1');
                    }}
                    className="px-2.5 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors font-mono"
                  >
                    {obj.label}
                  </button>
                ))}
              </div>
            </div>

            <ActionButton
              onClick={handleGetAll}
              disabled={getAllLoading || !host || !port}
              loading={getAllLoading}
              ariaLabel="Get all CIP attributes"
            >
              Get All Attributes
            </ActionButton>

            <ResultDisplay result={getAllResult} error={getAllError} />
          </div>
        )}

        {/* ── CIP Write tab ─────────────────────────────────────────────── */}
        {tab === 'cip-write' && (
          <div>
            <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-4 mb-5">
              <p className="text-red-200 text-sm font-semibold">Write Operation Warning</p>
              <p className="text-red-100/80 text-xs mt-1">
                Set_Attribute_Single writes data to the device. Incorrect writes to production PLCs
                can disrupt operations. Only use this on test equipment or with explicit authorization.
              </p>
            </div>

            <SectionHeader stepNumber={2} title="Set_Attribute_Single (CIP Write)" />

            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <FormField
                id="write-class"
                label="Class ID"
                type="text"
                value={writeClassId}
                onChange={setWriteClassId}
                placeholder="0x01"
                helpText="Hex or decimal"
              />
              <FormField
                id="write-instance"
                label="Instance ID"
                type="number"
                value={writeInstanceId}
                onChange={setWriteInstanceId}
                placeholder="1"
              />
              <FormField
                id="write-attribute"
                label="Attribute ID"
                type="number"
                value={writeAttributeId}
                onChange={setWriteAttributeId}
                placeholder="7"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="write-hex" className="block text-sm font-medium text-slate-300 mb-1">
                Value (hex bytes)
                <span className="ml-1 text-red-400">*</span>
              </label>
              <input
                id="write-hex"
                type="text"
                value={writeHex}
                onChange={e => setWriteHex(e.target.value)}
                placeholder="01 00 or 0100 or 01,00"
                className="w-full bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-400"
              />
              <p className="text-xs text-slate-500 mt-1">
                Enter bytes as hex (spaces/commas optional). Example: <code className="text-slate-400">48 65 6C 6C 6F</code>
              </p>
            </div>

            <ActionButton
              onClick={handleCIPWrite}
              disabled={writeLoading || !host || !port || !writeHex.trim()}
              loading={writeLoading}
              ariaLabel="Write CIP attribute"
            >
              Write Attribute
            </ActionButton>

            <ResultDisplay result={writeResult} error={writeError} />
          </div>
        )}

        {/* ── List Services tab ─────────────────────────────────────────── */}
        {tab === 'list-services' && (
          <div>
            <SectionHeader stepNumber={2} title="ListServices (no session required)" />
            <p className="text-slate-400 text-sm mb-4">
              Queries the device for its supported encapsulation services and capability flags.
              Returns the transport type (TCP/UDP) and named service descriptions.
            </p>

            <ActionButton
              onClick={handleListServices}
              disabled={servicesLoading || !host || !port}
              loading={servicesLoading}
              ariaLabel="List EtherNet/IP services"
            >
              List Services
            </ActionButton>

            <ResultDisplay result={servicesResult} error={servicesError} />
          </div>
        )}

        <HelpSection
          title="About EtherNet/IP"
          description="EtherNet/IP (Ethernet Industrial Protocol) uses CIP (Common Industrial Protocol) over TCP port 44818. Used by Allen-Bradley/Rockwell PLCs, drives, I/O modules, and other automation devices. ListIdentity and ListServices require no session. CIP Read/Write/GetAll use RegisterSession → SendRRData → UnregisterSession."
          showKeyboardShortcut={false}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 44818 TCP</p>
            <p><strong className="text-slate-300">Encoding:</strong> Little-endian binary, 24-byte encapsulation header</p>
            <p><strong className="text-slate-300">Session-less:</strong> ListIdentity (0x0063), ListServices (0x0004)</p>
            <p><strong className="text-slate-300">Session-based:</strong> RegisterSession (0x0065) → SendRRData (0x006F)</p>
            <p><strong className="text-slate-300">Standard:</strong> ODVA EtherNet/IP Specification / CIP Volume 1</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
