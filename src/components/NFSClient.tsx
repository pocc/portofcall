import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface NFSClientProps {
  onBack: () => void;
}

export default function NFSClient({ onBack }: NFSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2049');
  const [mountPort, setMountPort] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

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

    try {
      const response = await fetch('/api/nfs/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        versions?: Record<string, {
          supported: boolean;
          rtt?: number;
          error?: string;
          mismatch?: { low: number; high: number };
        }>;
      };

      if (data.success && data.versions) {
        let output = `NFS Version Probe (${data.rtt}ms total)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Host: ${host}:${port}\n\n`;

        output += `Supported Versions\n`;
        output += `${'-'.repeat(30)}\n`;

        for (const [ver, info] of Object.entries(data.versions)) {
          if (info.supported) {
            output += `  ${ver}: SUPPORTED (${info.rtt}ms)\n`;
          } else if (info.error === 'PROG_MISMATCH' && info.mismatch) {
            output += `  ${ver}: not supported (server supports v${info.mismatch.low}-v${info.mismatch.high})\n`;
          } else {
            output += `  ${ver}: not available (${info.error})\n`;
          }
        }

        const supportedVersions = Object.entries(data.versions)
          .filter(([, v]) => v.supported)
          .map(([k]) => k);

        if (supportedVersions.length > 0) {
          output += `\nSummary: NFS service active with ${supportedVersions.join(', ')}\n`;
        } else {
          output += `\nSummary: NFS service not responding on port ${port}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExports = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nfs/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          mountPort: mountPort ? parseInt(mountPort) : undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        mountVersion?: number | null;
        exports?: Array<{ path: string; groups: string[] }>;
      };

      if (data.success) {
        let output = `NFS Export List (${data.rtt}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (data.mountVersion) {
          output += `Mount Protocol Version: ${data.mountVersion}\n\n`;
        }

        if (data.exports && data.exports.length > 0) {
          output += `Exported Filesystems\n`;
          output += `${'-'.repeat(30)}\n`;

          for (const exp of data.exports) {
            output += `\n  ${exp.path}\n`;
            if (exp.groups.length > 0) {
              output += `    Allowed: ${exp.groups.join(', ')}\n`;
            } else {
              output += `    Allowed: (everyone)\n`;
            }
          }

          output += `\n${data.exports.length} export(s) found\n`;
        } else {
          output += `No exports found.\n`;
          if (data.error) {
            output += `Note: ${data.error}\n`;
          }
          output += `\nTip: The mount protocol may be on a different port.\n`;
          output += `NFSv4 does not use the mount protocol.\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Export list failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export list failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="NFS Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="nfs-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="nfs-server.example.com"
            required
            helpText="NFS server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="nfs-port"
            label="NFS Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2049"
            error={errors.port}
          />

          <FormField
            id="nfs-mount-port"
            label="Mount Port"
            type="number"
            value={mountPort}
            onChange={setMountPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            optional
            helpText="Separate mount daemon port (if different)"
          />
        </div>

        <div className="flex gap-3 flex-wrap">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Probe NFS versions"
          >
            Version Probe
          </ActionButton>

          <ActionButton
            onClick={handleExports}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="List NFS exports"
            variant="success"
          >
            List Exports
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />
      </div>

      <HelpSection
        title="About NFS Protocol"
        description="NFS (Network File System) allows clients to access remote files over a network as if they were local. It uses ONC-RPC (Remote Procedure Call) with XDR encoding over TCP port 2049. NFSv2/v3 are stateless and may use a separate mount daemon; NFSv4 is stateful and uses only port 2049. The version probe sends RPC NULL calls to detect supported versions. The export list uses the MOUNT protocol to discover shared filesystems."
        showKeyboardShortcut={true}
      />

      <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">NFS Quick Reference</h3>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-2">
          <p className="text-slate-400"># NFS Versions</p>
          <p>NFSv2: 32-bit offsets, UDP only, stateless</p>
          <p>NFSv3: 64-bit offsets, TCP support, READDIRPLUS</p>
          <p>NFSv4: Stateful, single port 2049, compound ops, ACLs</p>
          <p>NFSv4.1: pNFS (parallel NFS), sessions</p>
          <p>NFSv4.2: Server-side copy, sparse files</p>
          <p className="text-slate-400 mt-2"># Common ports</p>
          <p>2049/tcp - NFS service (all versions)</p>
          <p>111/tcp  - Portmapper/rpcbind (NFSv2/v3)</p>
          <p className="text-slate-400 mt-2"># Linux mount example</p>
          <p>mount -t nfs4 server:/export /mnt</p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
