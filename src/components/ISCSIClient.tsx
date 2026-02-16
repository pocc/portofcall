import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ISCSIClientProps {
  onBack: () => void;
}

export default function ISCSIClient({ onBack }: ISCSIClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3260');
  const [initiatorName, setInitiatorName] = useState('iqn.2024-01.gg.ross.portofcall:initiator');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleDiscover = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/iscsi/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
          initiatorName: initiatorName.trim() || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isISCSI?: boolean;
        loginStatus?: string;
        loginStatusClass?: number;
        loginStatusDetail?: number;
        versionMax?: number;
        versionActive?: number;
        tsih?: number;
        negotiatedParams?: Record<string, string>;
        targets?: Array<{ name: string; addresses: string[] }>;
        targetCount?: number;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `iSCSI Target Discovery\n`;
        output += `========================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Login Status: ${data.loginStatus}\n`;
        if (data.versionMax !== undefined) output += `iSCSI Version: ${data.versionMax}\n`;
        if (data.tsih !== undefined) output += `TSIH: 0x${data.tsih.toString(16).padStart(4, '0')}\n`;

        if (data.negotiatedParams && Object.keys(data.negotiatedParams).length > 0) {
          output += `\nNegotiated Parameters:\n`;
          for (const [key, value] of Object.entries(data.negotiatedParams)) {
            output += `  ${key} = ${value}\n`;
          }
        }

        if (data.targets && data.targets.length > 0) {
          output += `\nDiscovered Targets (${data.targetCount}):\n`;
          data.targets.forEach((target, i) => {
            output += `\n  [${i + 1}] ${target.name}\n`;
            if (target.addresses.length > 0) {
              target.addresses.forEach(addr => {
                output += `      Portal: ${addr}\n`;
              });
            }
          });
        } else {
          output += `\nNo targets discovered (target may require authentication or ACLs)\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Discovery failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleDiscover();
    }
  };

  return (
    <ProtocolClientLayout title="iSCSI Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="iscsi-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="storage.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="iscsi-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 3260"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="iscsi-initiator"
            label="Initiator Name (IQN)"
            type="text"
            value={initiatorName}
            onChange={setInitiatorName}
            onKeyDown={handleKeyDown}
            placeholder="iqn.YYYY-MM.domain:identifier"
            helpText="iSCSI Qualified Name identifying this client"
          />
        </div>

        <ActionButton
          onClick={handleDiscover}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Discover iSCSI targets"
        >
          Discover Targets (SendTargets)
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About iSCSI"
          description="iSCSI (RFC 7143) transports SCSI block storage commands over TCP/IP, allowing remote disks to appear as local devices. The Login phase negotiates session parameters and authentication (CHAP, Kerberos, or None). SendTargets discovery enumerates available storage volumes (LUNs) and their portal addresses. Port 2375 is unencrypted by default — production deployments should use IPsec or CHAP authentication. Common targets include TrueNAS, Windows Storage Server, and Linux LIO/targetcli."
        />
      </div>
    </ProtocolClientLayout>
  );
}
