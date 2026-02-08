import { useState } from 'react';

interface FTPClientProps {
  onBack: () => void;
}

interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory';
  modified: string;
}

export default function FTPClient({ onBack }: FTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('21');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FTPFile[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleConnect = async () => {
    if (!host || !username) {
      addLog('❌ Error: Host and username are required');
      return;
    }

    setLoading(true);
    addLog(`🔄 Connecting to ${host}:${port}...`);

    try {
      // Call Cloudflare Worker API
      const response = await fetch('/api/ftp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          passive: true,
        }),
      });

      const data = await response.json() as { error?: string };

      if (response.ok) {
        setConnected(true);
        addLog(`✅ Connected to ${host}`);
        addLog('📡 Using PASSIVE mode');
        // Auto-list directory
        await handleListDirectory('/');
      } else {
        addLog(`❌ Connection failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleListDirectory = async (path: string) => {
    setLoading(true);
    addLog(`📂 Listing directory: ${path}`);

    try {
      const response = await fetch('/api/ftp/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      const data = await response.json() as { files: FTPFile[]; error?: string };

      if (response.ok) {
        setFiles(data.files);
        setCurrentPath(path);
        addLog(`✅ Found ${data.files.length} items`);
      } else {
        addLog(`❌ List failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setFiles([]);
    setCurrentPath('/');
    addLog('🔌 Disconnected');
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-400 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">FTP Client (Passive Mode)</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm">Connected</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Connection Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Connection</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="ftp.example.com"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {!connected ? (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Logs */}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Logs</h2>
            <div className="bg-slate-900 rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-8">No logs yet</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="text-slate-300 mb-1">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* File Browser */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">File Browser</h2>
              <div className="text-sm text-slate-400 font-mono">{currentPath}</div>
            </div>

            {!connected ? (
              <div className="text-center py-16 text-slate-500">
                Connect to an FTP server to browse files
              </div>
            ) : (
              <div className="space-y-2">
                {files.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    Empty directory
                  </div>
                ) : (
                  files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-slate-700 hover:bg-slate-600 rounded-lg p-3 cursor-pointer transition-colors"
                      onClick={() => {
                        if (file.type === 'directory') {
                          handleListDirectory(`${currentPath}/${file.name}`);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">
                          {file.type === 'directory' ? '📁' : '📄'}
                        </div>
                        <div>
                          <div className="text-white font-medium">{file.name}</div>
                          <div className="text-xs text-slate-400">
                            {file.modified}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm text-slate-400">
                        {file.type === 'file' ? `${(file.size / 1024).toFixed(1)} KB` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
