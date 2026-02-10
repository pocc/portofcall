import { useState } from 'react';

interface KafkaClientProps {
  onBack: () => void;
}

interface ApiVersionEntry {
  apiKey: number;
  apiName: string;
  minVersion: number;
  maxVersion: number;
}

interface ApiVersionsResult {
  success: boolean;
  host: string;
  port: number;
  correlationId: number;
  errorCode: number;
  errorName: string;
  apiVersions: ApiVersionEntry[];
  apiCount: number;
  connectTimeMs: number;
  totalTimeMs: number;
  error?: string;
}

interface MetadataResult {
  success: boolean;
  host: string;
  port: number;
  brokers: Array<{ nodeId: number; host: string; port: number }>;
  brokerCount: number;
  topics: Array<{
    errorCode: number;
    name: string;
    partitions: Array<{
      errorCode: number;
      partitionId: number;
      leader: number;
      replicas: number[];
      isr: number[];
    }>;
  }>;
  topicCount: number;
  connectTimeMs: number;
  totalTimeMs: number;
  error?: string;
}

type ActiveTab = 'versions' | 'metadata';

export default function KafkaClient({ onBack }: KafkaClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(9092);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('versions');
  const [versionsResult, setVersionsResult] = useState<ApiVersionsResult | null>(null);
  const [metadataResult, setMetadataResult] = useState<MetadataResult | null>(null);
  const [error, setError] = useState('');

  const handleApiVersions = async () => {
    setLoading(true);
    setError('');
    setVersionsResult(null);

    try {
      const response = await fetch('/api/kafka/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port }),
      });

      const data: ApiVersionsResult = await response.json();

      if (data.success) {
        setVersionsResult(data);
      } else {
        setError(data.error || 'Failed to get API versions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMetadata = async () => {
    setLoading(true);
    setError('');
    setMetadataResult(null);

    try {
      const response = await fetch('/api/kafka/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port }),
      });

      const data: MetadataResult = await response.json();

      if (data.success) {
        setMetadataResult(data);
      } else {
        setError(data.error || 'Failed to get metadata');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = () => {
    if (activeTab === 'versions') {
      handleApiVersions();
    } else {
      handleMetadata();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors flex items-center gap-2"
        >
          <span aria-hidden="true">&larr;</span> Back to Protocol List
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-8 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="text-5xl" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="16" cy="12" r="5" fill="#231F20" stroke="#fff" strokeWidth="2" />
              <circle cx="16" cy="24" r="5" fill="#231F20" stroke="#fff" strokeWidth="2" />
              <circle cx="16" cy="36" r="5" fill="#231F20" stroke="#fff" strokeWidth="2" />
              <circle cx="32" cy="18" r="5" fill="#231F20" stroke="#fff" strokeWidth="2" />
              <circle cx="32" cy="30" r="5" fill="#231F20" stroke="#fff" strokeWidth="2" />
              <line x1="21" y1="12" x2="27" y2="18" stroke="#fff" strokeWidth="2" />
              <line x1="21" y1="24" x2="27" y2="18" stroke="#fff" strokeWidth="2" />
              <line x1="21" y1="24" x2="27" y2="30" stroke="#fff" strokeWidth="2" />
              <line x1="21" y1="36" x2="27" y2="30" stroke="#fff" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Apache Kafka</h1>
            <p className="text-slate-400">
              Port 9092 &middot; Distributed Event Streaming Platform
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Kafka Broker Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="kafka.example.com"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Tab selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('versions')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'versions'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              API Versions
            </button>
            <button
              onClick={() => setActiveTab('metadata')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'metadata'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Cluster Metadata
            </button>
          </div>

          <button
            onClick={handleQuery}
            disabled={loading || !host}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading
              ? 'Querying...'
              : activeTab === 'versions'
                ? 'Get API Versions'
                : 'Get Cluster Metadata'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-600/50 rounded-xl p-6 mb-6">
          <h3 className="text-red-200 font-semibold mb-2">Error</h3>
          <p className="text-red-100/80 text-sm font-mono">{error}</p>
        </div>
      )}

      {/* API Versions Result */}
      {versionsResult && activeTab === 'versions' && (
        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Broker Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-400">{versionsResult.apiCount}</div>
                <div className="text-xs text-slate-400">Supported APIs</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${versionsResult.errorCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {versionsResult.errorName}
                </div>
                <div className="text-xs text-slate-400">Status</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{versionsResult.connectTimeMs}ms</div>
                <div className="text-xs text-slate-400">Connect</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-purple-400">{versionsResult.totalTimeMs}ms</div>
                <div className="text-xs text-slate-400">Total</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Supported API Versions ({versionsResult.apiVersions.length})
            </h3>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="text-slate-400 text-left">
                    <th className="py-2 px-2">Key</th>
                    <th className="py-2 px-2">API Name</th>
                    <th className="py-2 px-2">Min</th>
                    <th className="py-2 px-2">Max</th>
                    <th className="py-2 px-2">Versions</th>
                  </tr>
                </thead>
                <tbody>
                  {versionsResult.apiVersions.map((api) => (
                    <tr
                      key={api.apiKey}
                      className="border-t border-slate-700 hover:bg-slate-700/50"
                    >
                      <td className="py-2 px-2 text-slate-400 font-mono">{api.apiKey}</td>
                      <td className="py-2 px-2 text-white">{api.apiName}</td>
                      <td className="py-2 px-2 text-slate-300 font-mono">v{api.minVersion}</td>
                      <td className="py-2 px-2 text-slate-300 font-mono">v{api.maxVersion}</td>
                      <td className="py-2 px-2">
                        <div className="flex gap-1">
                          {Array.from(
                            { length: api.maxVersion - api.minVersion + 1 },
                            (_, i) => api.minVersion + i
                          )
                            .slice(0, 10)
                            .map((v) => (
                              <span
                                key={v}
                                className="px-1.5 py-0.5 bg-blue-900/50 text-blue-300 text-xs rounded"
                              >
                                {v}
                              </span>
                            ))}
                          {api.maxVersion - api.minVersion >= 10 && (
                            <span className="text-slate-500 text-xs">...</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Result */}
      {metadataResult && activeTab === 'metadata' && (
        <div className="space-y-6">
          {/* Brokers */}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Cluster Brokers ({metadataResult.brokerCount})
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-400">{metadataResult.brokerCount}</div>
                <div className="text-xs text-slate-400">Brokers</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{metadataResult.topicCount}</div>
                <div className="text-xs text-slate-400">Topics</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{metadataResult.totalTimeMs}ms</div>
                <div className="text-xs text-slate-400">Response Time</div>
              </div>
            </div>

            {metadataResult.brokers.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="py-2 px-2">Node ID</th>
                    <th className="py-2 px-2">Host</th>
                    <th className="py-2 px-2">Port</th>
                  </tr>
                </thead>
                <tbody>
                  {metadataResult.brokers.map((broker) => (
                    <tr
                      key={broker.nodeId}
                      className="border-t border-slate-700 hover:bg-slate-700/50"
                    >
                      <td className="py-2 px-2 text-blue-400 font-mono">{broker.nodeId}</td>
                      <td className="py-2 px-2 text-white font-mono">{broker.host}</td>
                      <td className="py-2 px-2 text-slate-300 font-mono">{broker.port}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Topics */}
          {metadataResult.topics.length > 0 && (
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Topics ({metadataResult.topicCount})
              </h3>
              <div className="max-h-96 overflow-y-auto space-y-3">
                {metadataResult.topics.map((topic) => (
                  <div key={topic.name} className="bg-slate-900 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-mono font-medium">{topic.name}</span>
                      <span className="text-xs text-slate-400">
                        {topic.partitions.length} partition{topic.partitions.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {topic.partitions.map((p) => (
                        <div
                          key={p.partitionId}
                          className="px-2 py-1 bg-slate-800 rounded text-xs"
                          title={`Leader: ${p.leader}, Replicas: [${p.replicas.join(',')}], ISR: [${p.isr.join(',')}]`}
                        >
                          <span className="text-slate-400">P{p.partitionId}</span>
                          <span className="text-green-400 ml-1">L:{p.leader}</span>
                          <span className="text-blue-400 ml-1">R:{p.replicas.length}</span>
                          <span className="text-yellow-400 ml-1">ISR:{p.isr.length}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Protocol Info */}
      <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About Apache Kafka Protocol</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-300">
          <div>
            <h4 className="text-white font-medium mb-2">Protocol Details</h4>
            <ul className="space-y-1">
              <li><span className="text-slate-400">Port:</span> 9092 (plaintext), 9093 (SSL)</li>
              <li><span className="text-slate-400">Type:</span> Binary wire protocol</li>
              <li><span className="text-slate-400">Framing:</span> 4-byte size prefix (big-endian)</li>
              <li><span className="text-slate-400">Pattern:</span> Request/Response with Correlation ID</li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-medium mb-2">Key APIs</h4>
            <ul className="space-y-1">
              <li><span className="text-slate-400">ApiVersions (18):</span> Discover supported versions</li>
              <li><span className="text-slate-400">Metadata (3):</span> Brokers, topics, partitions</li>
              <li><span className="text-slate-400">Produce (0):</span> Send messages to topics</li>
              <li><span className="text-slate-400">Fetch (1):</span> Consume messages from topics</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
