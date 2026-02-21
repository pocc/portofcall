import { useState } from 'react';

interface GangliaClientProps {
  onBack: () => void;
}

interface GangliaMetric {
  name: string;
  val: string;
  type: string;
  units: string;
  tn?: string;
  tmax?: string;
  group?: string;
  desc?: string;
  title?: string;
}

interface GangliaHost {
  name: string;
  ip: string;
  os?: string;
  reported?: string;
  metricCount: number;
  metricsTruncated?: boolean;
  metrics: GangliaMetric[];
}

interface GangliaCluster {
  name: string;
  owner?: string;
  url?: string;
  hostCount: number;
  hosts: GangliaHost[];
}

export default function GangliaClient({ onBack }: GangliaClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8649');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [clusters, setClusters] = useState<GangliaCluster[]>([]);
  const [expandedHost, setExpandedHost] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');
    setClusters([]);
    setExpandedHost(null);

    try {
      const response = await fetch('/api/ganglia/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        gangliaVersion?: string;
        source?: string;
        clusterCount?: number;
        hostCount?: number;
        metricCount?: number;
        connectTime?: number;
        rtt?: number;
        xmlSize?: number;
        clusters?: GangliaCluster[];
      };

      if (response.ok && data.success) {
        let output = `Ganglia gmond at ${host}:${port}\n\n`;
        output += `Version: ${data.gangliaVersion || 'unknown'}\n`;
        output += `Source: ${data.source || 'unknown'}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        output += `XML Size: ${((data.xmlSize || 0) / 1024).toFixed(1)} KB\n\n`;
        output += `Clusters: ${data.clusterCount}\n`;
        output += `Hosts: ${data.hostCount}\n`;
        output += `Total Metrics: ${data.metricCount}\n`;

        if (data.clusters && data.clusters.length > 0) {
          output += '\n';
          for (const cluster of data.clusters) {
            output += `\nCluster: ${cluster.name}`;
            if (cluster.owner) output += ` (owner: ${cluster.owner})`;
            output += `\n  Hosts: ${cluster.hostCount}\n`;

            for (const h of cluster.hosts) {
              output += `    ${h.name} (${h.ip})`;
              if (h.os) output += ` - ${h.os}`;
              output += ` [${h.metricCount} metrics]\n`;
            }
          }
          setClusters(data.clusters);
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

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');
    setClusters([]);

    try {
      const response = await fetch('/api/ganglia/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 5000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isGanglia?: boolean;
        gangliaVersion?: string;
        source?: string;
        connectTime?: number;
        rtt?: number;
        previewSize?: number;
      };

      if (response.ok && data.success) {
        let output = `Ganglia Probe: ${host}:${port}\n\n`;
        output += `Detected: ${data.isGanglia ? 'Yes - Ganglia gmond' : 'Unknown service'}\n`;
        if (data.gangliaVersion) output += `Version: ${data.gangliaVersion}\n`;
        if (data.source) output += `Source: ${data.source}\n`;
        output += `Connect: ${data.connectTime}ms\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Preview: ${data.previewSize} bytes\n`;
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  const toggleHostMetrics = (hostKey: string) => {
    setExpandedHost(expandedHost === hostKey ? null : hostKey);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Ganglia Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="ganglia-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="ganglia-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ganglia.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="ganglia-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="ganglia-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 8649</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || !host}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Connect to Ganglia gmond and read full XML dump"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Connect & Read'
            )}
          </button>

          <button
            onClick={handleProbe}
            disabled={loading || !host}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Quick probe to detect Ganglia gmond"
          >
            {loading ? 'Probing...' : 'Probe'}
          </button>
        </div>

        {/* Host Metrics Browser */}
        {clusters.length > 0 && (
          <div className="pt-6 border-t border-slate-600">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">2</span>
              </div>
              <h2 className="text-xl font-semibold text-white">Host Metrics</h2>
            </div>
            <p className="text-xs text-slate-400 mb-3">Click a host to expand its metrics</p>

            {clusters.map((cluster) => (
              <div key={cluster.name} className="mb-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">
                  Cluster: {cluster.name}
                  {cluster.owner && <span className="text-slate-500 font-normal"> ({cluster.owner})</span>}
                </h3>
                <div className="space-y-2">
                  {cluster.hosts.map((h) => {
                    const hostKey = `${cluster.name}:${h.name}`;
                    const isExpanded = expandedHost === hostKey;
                    return (
                      <div key={hostKey} className="bg-slate-700/50 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleHostMetrics(hostKey)}
                          className="w-full text-left px-4 py-2 hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-blue-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                              <span className="text-white text-sm font-medium">{h.name}</span>
                              <span className="text-slate-400 text-xs">({h.ip})</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {h.os && <span className="text-slate-500 text-xs">{h.os}</span>}
                              <span className="text-slate-400 text-xs">{h.metricCount} metrics</span>
                            </div>
                          </div>
                        </button>
                        {isExpanded && h.metrics.length > 0 && (
                          <div className="px-4 pb-3 border-t border-slate-600">
                            {h.metricsTruncated && (
                              <p className="mt-2 text-xs text-yellow-400">
                                Showing 50 of {h.metricCount} metrics (truncated for response size)
                              </p>
                            )}
                            <div className="mt-2 max-h-64 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-slate-400">
                                    <th className="text-left py-1 pr-3">Metric</th>
                                    <th className="text-right py-1 pr-3">Value</th>
                                    <th className="text-left py-1 pr-3">Units</th>
                                    <th className="text-left py-1 pr-3">Type</th>
                                    <th className="text-left py-1">Group</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {h.metrics.map((m, i) => (
                                    <tr key={i} className="text-slate-300 border-t border-slate-700" title={m.desc || m.title || ''}>
                                      <td className="py-1 pr-3 font-mono">{m.name}</td>
                                      <td className="py-1 pr-3 text-right font-mono text-green-400">{m.val}</td>
                                      <td className="py-1 pr-3 text-slate-500">{m.units || '-'}</td>
                                      <td className="py-1 pr-3 text-slate-500">{m.type}</td>
                                      <td className="py-1 text-slate-500">{m.group || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Ganglia</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Ganglia is a scalable distributed monitoring system designed for high-performance
            computing environments like clusters and grids. The <code className="text-slate-300">gmond</code> daemon
            runs on each monitored node and exposes the entire cluster state as an XML document
            over TCP port 8649. On connect, gmond immediately dumps XML containing
            <code className="text-slate-300"> CLUSTER</code>, <code className="text-slate-300">HOST</code>,
            and <code className="text-slate-300"> METRIC</code> elements with CPU, memory, disk, and
            network statistics. The protocol is read-only with no authentication.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
