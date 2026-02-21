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

interface PortmapperClientProps {
  onBack: () => void;
}

interface MappingEntry {
  program: number;
  programName: string;
  version: number;
  protocol: string;
  protocolNumber: number;
  port: number;
}

export default function PortmapperClient({ onBack }: PortmapperClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('111');
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
      const response = await fetch('/api/portmapper/probe', {
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
        host?: string;
        port?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Portmapper is running!\n\n` +
          `Host:  ${data.host}\n` +
          `Port:  ${data.port}\n` +
          `RTT:   ${data.rtt}ms\n\n` +
          `The rpcbind service responded to a NULL procedure call.\n` +
          `Use "Dump Services" to list all registered RPC programs.`
        );
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDump = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/portmapper/dump', {
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
        host?: string;
        port?: number;
        mappings?: MappingEntry[];
        totalServices?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `Portmapper DUMP — ${data.totalServices} registered service(s)\n`;
        output += `Host: ${data.host}  Port: ${data.port}  RTT: ${data.rtt}ms\n\n`;

        if (data.mappings && data.mappings.length > 0) {
          // Table header
          output += `${'Program'.padEnd(12)} ${'Name'.padEnd(22)} ${'Ver'.padEnd(5)} ${'Proto'.padEnd(6)} Port\n`;
          output += `${'─'.repeat(12)} ${'─'.repeat(22)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(6)}\n`;

          for (const m of data.mappings) {
            output += `${String(m.program).padEnd(12)} ${m.programName.padEnd(22)} ${String(m.version).padEnd(5)} ${m.protocol.padEnd(6)} ${m.port}\n`;
          }

          // Summary by unique program
          const uniquePrograms = new Set(data.mappings.map(m => m.program));
          output += `\n${uniquePrograms.size} unique RPC program(s) across ${data.totalServices} mapping(s)`;
        } else {
          output += 'No RPC services registered (empty mapping table).';
        }

        setResult(output);
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
      handleDump();
    }
  };

  return (
    <ProtocolClientLayout title="Portmapper / rpcbind Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Portmapper || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="portmapper-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="nfs-server.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="portmapper-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 111 (standard rpcbind port)"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe portmapper with NULL call"
            variant="secondary"
          >
            Probe (NULL Ping)
          </ActionButton>

          <ActionButton
            onClick={handleDump}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Dump all registered RPC services"
          >
            Dump Services
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Portmapper / rpcbind"
          description="The Portmapper (rpcbind, RFC 1833) maps ONC RPC program numbers to network ports. It's the service discovery layer for NFS, NIS, mountd, and other Unix RPC services. The DUMP command lists all registered services, revealing what RPC programs are available on the target host."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common RPC Services</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-400">
            <div><span className="text-blue-400 font-mono">100003</span> NFS</div>
            <div><span className="text-blue-400 font-mono">100005</span> mountd</div>
            <div><span className="text-blue-400 font-mono">100021</span> nlockmgr</div>
            <div><span className="text-blue-400 font-mono">100024</span> status (NSM)</div>
            <div><span className="text-blue-400 font-mono">100000</span> portmapper</div>
            <div><span className="text-blue-400 font-mono">100004</span> ypserv (NIS)</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Port 111 is typically open on NFS servers, NIS servers, and other systems running ONC RPC services.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
