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

interface NomadClientProps {
  onBack: () => void;
}

export default function NomadClient({ onBack }: NomadClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4646');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHealth = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nomad/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: string;
        region?: string;
        datacenter?: string;
        nodeName?: string;
        server?: boolean | null;
        leader?: string | null;
        raftPeers?: string | null;
        rtt?: number;
        statusCode?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Nomad Agent Info`,
          '',
          `Version:      ${data.version || 'Unknown'}`,
          `Region:       ${data.region || 'Unknown'}`,
          `Datacenter:   ${data.datacenter || 'Unknown'}`,
          `Node Name:    ${data.nodeName || 'Unknown'}`,
        ];
        if (data.server !== null && data.server !== undefined) {
          lines.push(`Role:         ${data.server ? 'Server' : 'Client'}`);
        }
        if (data.leader) {
          lines.push(`Leader:       ${data.leader}`);
        }
        if (data.raftPeers) {
          lines.push(`Raft Peers:   ${data.raftPeers}`);
        }
        lines.push(`Latency:      ${data.rtt}ms`);
        lines.push(`HTTP Status:  ${data.statusCode}`);
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

  const handleJobs = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nomad/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        jobs?: { id: string; name: string; type: string; status: string; priority: number }[];
        jobCount?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Nomad Jobs (${data.jobCount || 0} found)`,
          '',
        ];

        if (data.jobs?.length) {
          for (const job of data.jobs) {
            const statusIcon = job.status === 'running' ? '+' : job.status === 'dead' ? '-' : '?';
            lines.push(`  [${statusIcon}] ${job.name || job.id} (${job.type}) — ${job.status}`);
          }
        } else {
          lines.push('  (no jobs found)');
        }

        lines.push('', `Latency: ${data.rtt}ms`);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to list jobs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleNodes = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nomad/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        nodes?: { id: string; name: string; datacenter: string; status: string; drain: boolean }[];
        nodeCount?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Nomad Nodes (${data.nodeCount || 0} found)`,
          '',
        ];

        if (data.nodes?.length) {
          for (const node of data.nodes) {
            const statusIcon = node.status === 'ready' ? '+' : '-';
            const drainTag = node.drain ? ' [draining]' : '';
            lines.push(`  [${statusIcon}] ${node.name || node.id} (${node.datacenter}) — ${node.status}${drainTag}`);
          }
        } else {
          lines.push('  (no nodes found)');
        }

        lines.push('', `Latency: ${data.rtt}ms`);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to list nodes');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list nodes');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleHealth();
    }
  };

  return (
    <ProtocolClientLayout title="Nomad Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Nomad || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Nomad Server" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="nomad-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="nomad.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="nomad-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4646"
            error={errors.port}
          />

          <FormField
            id="nomad-token"
            label="ACL Token"
            type="password"
            value={token}
            onChange={setToken}
            onKeyDown={handleKeyDown}
            placeholder="Optional"
            helpText="X-Nomad-Token header"
          />
        </div>

        <ActionButton
          onClick={handleHealth}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Check Nomad agent health"
        >
          Check Health
        </ActionButton>

        <div className="mt-8 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Cluster Operations" />

          <div className="flex gap-3">
            <button
              onClick={handleJobs}
              disabled={loading || !host || !port}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              List Jobs
            </button>

            <button
              onClick={handleNodes}
              disabled={loading || !host || !port}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              List Nodes
            </button>
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About HashiCorp Nomad"
          description="Nomad is a workload orchestrator by HashiCorp for deploying containers, VMs, and non-containerized applications. The HTTP API on port 4646 provides cluster management, job scheduling, and health monitoring. Nomad integrates natively with Consul for service discovery and Vault for secrets management."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">HashiCorp Stack</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">Nomad (Port 4646):</strong> Workload orchestration & job scheduling</p>
            <p><strong className="text-slate-300">Consul (Port 8500):</strong> Service discovery & health checking</p>
            <p><strong className="text-slate-300">Vault (Port 8200):</strong> Secrets management & encryption</p>
            <p><strong className="text-slate-300">Boundary (Port 9200):</strong> Identity-based access management</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
