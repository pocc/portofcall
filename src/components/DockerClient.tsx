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

interface DockerClientProps {
  onBack: () => void;
}

export default function DockerClient({ onBack }: DockerClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2375');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query mode state
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/version');
  const [queryBody, setQueryBody] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHealthCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/docker/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: {
          ping?: string;
          version?: {
            Version?: string;
            ApiVersion?: string;
            MinAPIVersion?: string;
            GitCommit?: string;
            GoVersion?: string;
            Os?: string;
            Arch?: string;
            BuildTime?: string;
            KernelVersion?: string;
          };
          system?: {
            Containers?: number;
            ContainersRunning?: number;
            ContainersPaused?: number;
            ContainersStopped?: number;
            Images?: number;
            ServerVersion?: string;
            OperatingSystem?: string;
            OSType?: string;
            Architecture?: string;
            NCPU?: number;
            MemTotal?: number;
            Name?: string;
            KernelVersion?: string;
            Driver?: string;
          };
        };
      };

      if (data.success && data.parsed) {
        const { ping, version, system } = data.parsed;

        let output = `Docker Health Check (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Ping: ${ping || 'unknown'}\n`;

        if (version) {
          output += `\nDocker Version\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Version: ${version.Version || 'unknown'}\n`;
          output += `API Version: ${version.ApiVersion || 'unknown'}`;
          if (version.MinAPIVersion) output += ` (min: ${version.MinAPIVersion})`;
          output += `\n`;
          if (version.Os) output += `OS/Arch: ${version.Os}/${version.Arch || 'unknown'}\n`;
          if (version.GoVersion) output += `Go: ${version.GoVersion}\n`;
          if (version.GitCommit) output += `Git Commit: ${version.GitCommit}\n`;
          if (version.KernelVersion) output += `Kernel: ${version.KernelVersion}\n`;
          if (version.BuildTime) output += `Built: ${version.BuildTime}\n`;
        }

        if (system) {
          output += `\nSystem Info\n`;
          output += `${'-'.repeat(30)}\n`;
          if (system.Name) output += `Hostname: ${system.Name}\n`;
          if (system.OperatingSystem) output += `OS: ${system.OperatingSystem}\n`;
          if (system.Driver) output += `Storage Driver: ${system.Driver}\n`;
          output += `Containers: ${system.Containers ?? 'unknown'}`;
          if (system.ContainersRunning !== undefined) {
            output += ` (running: ${system.ContainersRunning}, paused: ${system.ContainersPaused}, stopped: ${system.ContainersStopped})`;
          }
          output += `\n`;
          output += `Images: ${system.Images ?? 'unknown'}\n`;
          if (system.NCPU) output += `CPUs: ${system.NCPU}\n`;
          if (system.MemTotal) {
            const memGB = (system.MemTotal / (1024 * 1024 * 1024)).toFixed(1);
            output += `Memory: ${memGB} GB\n`;
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'Health check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/docker/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          method,
          path,
          body: queryBody || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: unknown;
        body?: string;
      };

      if (data.success) {
        let output = `${method} ${path} -> ${data.statusCode} (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (data.parsed) {
          output += JSON.stringify(data.parsed, null, 2);
        } else {
          output += data.body || '(empty response)';
        }

        setResult(output);
      } else {
        let errMsg = data.error || 'Query failed';
        if (data.statusCode) errMsg += ` (HTTP ${data.statusCode})`;
        if (data.parsed) errMsg += `\n${JSON.stringify(data.parsed, null, 2)}`;
        setError(errMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHealthCheck();
    }
  };

  const handleQuickQuery = (qMethod: string, qPath: string) => {
    setMethod(qMethod);
    setPath(qPath);
    setQueryBody('');
  };

  return (
    <ProtocolClientLayout title="Docker Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Docker || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="docker-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="docker.example.com"
            required
            helpText="Docker daemon hostname or IP"
            error={errors.host}
          />

          <FormField
            id="docker-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2375 (HTTP), 2376 (HTTPS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check Docker daemon health"
          variant="success"
        >
          Health Check
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="API Query" color="purple" />

        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label htmlFor="docker-method" className="block text-sm font-medium text-slate-300 mb-1">
              Method
            </label>
            <select
              id="docker-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <FormField
              id="docker-path"
              label="Path"
              type="text"
              value={path}
              onChange={setPath}
              placeholder="/version"
              helpText="Docker API endpoint (e.g., /containers/json, /images/json)"
            />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="docker-body" className="block text-sm font-medium text-slate-300 mb-1">
            Request Body <span className="text-xs text-slate-400">(optional, JSON)</span>
          </label>
          <textarea
            id="docker-body"
            value={queryBody}
            onChange={(e) => setQueryBody(e.target.value)}
            placeholder='{"Image": "alpine", "Cmd": ["echo", "hello"]}'
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute Docker API query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              { label: 'GET /version', method: 'GET', path: '/version' },
              { label: 'GET /_ping', method: 'GET', path: '/_ping' },
              { label: 'GET /containers/json (running)', method: 'GET', path: '/containers/json' },
              { label: 'GET /containers/json?all=1 (all)', method: 'GET', path: '/containers/json?all=1' },
              { label: 'GET /images/json', method: 'GET', path: '/images/json' },
              { label: 'GET /info (system info)', method: 'GET', path: '/info' },
              { label: 'GET /networks', method: 'GET', path: '/networks' },
              { label: 'GET /volumes', method: 'GET', path: '/volumes' },
            ].map(({ label, method: qMethod, path: qPath }) => (
              <button
                key={label}
                onClick={() => handleQuickQuery(qMethod, qPath)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About Docker Engine API"
          description="Docker Engine exposes a REST API on port 2375 (HTTP) or 2376 (HTTPS) for managing containers, images, volumes, and networks. This client sends raw HTTP/1.1 requests over TCP sockets. Warning: The Docker API without TLS provides unrestricted access to the Docker daemon - use only with trusted hosts."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
