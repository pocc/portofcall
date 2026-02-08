import { useState, useRef } from 'react';

interface FTPClientProps {
  onBack: () => void;
}

interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory';
  modified: string;
}

type CommandModal = 'upload' | 'download' | 'delete' | 'rename' | 'mkdir' | null;

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
  const [showCommands, setShowCommands] = useState(false);
  const [activeModal, setActiveModal] = useState<CommandModal>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File selection state
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [dirName, setDirName] = useState('');

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
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          path,
        }),
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
    addLog('🔌 Disconnected from server');
    setShowCommands(false);
  };

  const handleUpload = async (file: File) => {
    if (!file) return;

    setLoading(true);
    const uploadPath = `${currentPath === '/' ? '' : currentPath}/${file.name}`;
    addLog(`⬆️  Uploading ${file.name} to ${uploadPath}...`);

    try {
      const formData = new FormData();
      formData.append('host', host);
      formData.append('port', port);
      formData.append('username', username);
      formData.append('password', password);
      formData.append('remotePath', uploadPath);
      formData.append('file', file);

      const response = await fetch('/api/ftp/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json() as { error?: string; size?: number };

      if (response.ok) {
        addLog(`✅ Uploaded ${file.name} (${((data.size || 0) / 1024).toFixed(1)} KB)`);
        await handleListDirectory(currentPath);
      } else {
        addLog(`❌ Upload failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
      setActiveModal(null);
    }
  };

  const handleDownloadFiles = async () => {
    if (selectedFiles.length === 0) return;

    for (const fileName of selectedFiles) {
      await handleDownloadFile(fileName);
    }

    setSelectedFiles([]);
    setActiveModal(null);
  };

  const handleDownloadFile = async (fileName: string) => {
    setLoading(true);
    const downloadPath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;
    addLog(`⬇️  Downloading ${fileName}...`);

    try {
      const response = await fetch('/api/ftp/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          remotePath: downloadPath,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        const file = files.find(f => f.name === fileName);
        addLog(`✅ Downloaded ${fileName} (${((file?.size || 0) / 1024).toFixed(1)} KB)`);
      } else {
        const data = await response.json() as { error?: string };
        addLog(`❌ Download failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFiles = async () => {
    if (selectedFiles.length === 0) return;

    setLoading(true);
    addLog(`🗑️  Deleting ${selectedFiles.length} file(s)...`);

    for (const fileName of selectedFiles) {
      const remotePath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;

      try {
        const response = await fetch('/api/ftp/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            port: parseInt(port),
            username,
            password,
            remotePath,
          }),
        });

        const data = await response.json() as { error?: string };

        if (response.ok) {
          addLog(`✅ Deleted ${fileName}`);
        } else {
          addLog(`❌ Delete ${fileName} failed: ${data.error}`);
        }
      } catch (error) {
        addLog(`❌ Error deleting ${fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    setLoading(false);
    setSelectedFiles([]);
    setActiveModal(null);
    await handleListDirectory(currentPath);
  };

  const handleRename = async () => {
    if (!selectedFile || !newName) return;

    setLoading(true);
    const fromPath = `${currentPath === '/' ? '' : currentPath}/${selectedFile}`;
    const toPath = `${currentPath === '/' ? '' : currentPath}/${newName}`;
    addLog(`✏️  Renaming ${selectedFile} to ${newName}...`);

    try {
      const response = await fetch('/api/ftp/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          fromPath,
          toPath,
        }),
      });

      const data = await response.json() as { error?: string };

      if (response.ok) {
        addLog(`✅ Renamed ${selectedFile} to ${newName}`);
        await handleListDirectory(currentPath);
      } else {
        addLog(`❌ Rename failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
      setActiveModal(null);
      setSelectedFile('');
      setNewName('');
    }
  };

  const handleMkdir = async () => {
    if (!dirName) return;

    setLoading(true);
    const dirPath = `${currentPath === '/' ? '' : currentPath}/${dirName}`;
    addLog(`📁 Creating directory ${dirPath}...`);

    try {
      const response = await fetch('/api/ftp/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          dirPath,
        }),
      });

      const data = await response.json() as { error?: string };

      if (response.ok) {
        addLog(`✅ Created directory ${dirName}`);
        await handleListDirectory(currentPath);
      } else {
        addLog(`❌ Create directory failed: ${data.error}`);
      }
    } catch (error) {
      addLog(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
      setActiveModal(null);
      setDirName('');
    }
  };

  const openCommandModal = (command: CommandModal) => {
    setActiveModal(command);
    setShowCommands(false);
    setSelectedFiles([]);
    setSelectedFile('');
    setNewName('');
  };

  const toggleFileSelection = (fileName: string) => {
    setSelectedFiles(prev =>
      prev.includes(fileName)
        ? prev.filter(f => f !== fileName)
        : [...prev, fileName]
    );
  };

  const selectFileForRename = (fileName: string) => {
    setSelectedFile(fileName);
    setNewName(fileName);
  };

  // Get only files (not directories) for operations
  const filesOnly = files.filter(f => f.type === 'file');

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
                <div className="relative">
                  <button
                    onClick={() => setShowCommands(!showCommands)}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-between"
                  >
                    <span>Commands</span>
                    <span>{showCommands ? '▲' : '▼'}</span>
                  </button>

                  {showCommands && (
                    <div className="absolute top-full mt-2 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-lg z-10">
                      <button
                        onClick={() => openCommandModal('upload')}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors rounded-t-lg"
                      >
                        ⬆️  Upload File
                      </button>
                      <button
                        onClick={() => openCommandModal('download')}
                        disabled={filesOnly.length === 0}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ⬇️ Download Files
                      </button>
                      <button
                        onClick={() => openCommandModal('rename')}
                        disabled={filesOnly.length === 0}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ✏️  Rename File
                      </button>
                      <button
                        onClick={() => openCommandModal('delete')}
                        disabled={filesOnly.length === 0}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        🗑️  Delete Files
                      </button>
                      <button
                        onClick={() => openCommandModal('mkdir')}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors"
                      >
                        📁 Create Directory
                      </button>
                      <button
                        onClick={() => {
                          handleListDirectory(currentPath);
                          setShowCommands(false);
                        }}
                        className="w-full text-left px-4 py-2 text-white hover:bg-slate-600 transition-colors"
                      >
                        🔄 Refresh
                      </button>
                      <button
                        onClick={handleDisconnect}
                        className="w-full text-left px-4 py-2 text-red-400 hover:bg-slate-600 transition-colors rounded-b-lg"
                      >
                        🔌 Disconnect
                      </button>
                    </div>
                  )}
                </div>
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
                      className="flex items-center justify-between bg-slate-700 hover:bg-slate-600 rounded-lg p-3 transition-colors cursor-pointer"
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

      {/* Upload Modal */}
      {activeModal === 'upload' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-white mb-4">Upload File</h3>
            <p className="text-slate-400 text-sm mb-4">
              Choose a file to upload to {currentPath}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleUpload(file);
                }
              }}
              className="w-full mb-4 text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg"
              >
                Choose File
              </button>
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Modal - Multiple Selection with Checkboxes */}
      {activeModal === 'download' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-semibold text-white mb-2">Download Files</h3>
            <p className="text-slate-400 text-sm mb-4">
              Select files to download from {currentPath}
            </p>
            <div className="overflow-y-auto flex-1 mb-4">
              {filesOnly.length === 0 ? (
                <div className="text-slate-500 text-center py-8">No files in directory</div>
              ) : (
                <div className="space-y-2">
                  {filesOnly.map((file) => (
                    <label
                      key={file.name}
                      className="flex items-center gap-3 bg-slate-700 hover:bg-slate-600 rounded-lg p-3 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.name)}
                        onChange={() => toggleFileSelection(file.name)}
                        className="w-4 h-4"
                      />
                      <div className="text-2xl">📄</div>
                      <div className="flex-1">
                        <div className="text-white font-medium">{file.name}</div>
                        <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDownloadFiles}
                disabled={selectedFiles.length === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Download {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </button>
              <button
                onClick={() => {
                  setActiveModal(null);
                  setSelectedFiles([]);
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal - Multiple Selection with Checkboxes */}
      {activeModal === 'delete' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-semibold text-white mb-2">Delete Files</h3>
            <p className="text-slate-400 text-sm mb-4">
              Select files to delete from {currentPath}
            </p>
            <div className="overflow-y-auto flex-1 mb-4">
              {filesOnly.length === 0 ? (
                <div className="text-slate-500 text-center py-8">No files in directory</div>
              ) : (
                <div className="space-y-2">
                  {filesOnly.map((file) => (
                    <label
                      key={file.name}
                      className="flex items-center gap-3 bg-slate-700 hover:bg-slate-600 rounded-lg p-3 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.name)}
                        onChange={() => toggleFileSelection(file.name)}
                        className="w-4 h-4"
                      />
                      <div className="text-2xl">📄</div>
                      <div className="flex-1">
                        <div className="text-white font-medium">{file.name}</div>
                        <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteFiles}
                disabled={selectedFiles.length === 0}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </button>
              <button
                onClick={() => {
                  setActiveModal(null);
                  setSelectedFiles([]);
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal - Single Selection with Radio Buttons */}
      {activeModal === 'rename' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-semibold text-white mb-2">Rename File</h3>
            <p className="text-slate-400 text-sm mb-4">
              Select a file to rename from {currentPath}
            </p>
            <div className="overflow-y-auto flex-1 mb-4">
              {filesOnly.length === 0 ? (
                <div className="text-slate-500 text-center py-8">No files in directory</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {filesOnly.map((file) => (
                    <label
                      key={file.name}
                      className="flex items-center gap-3 bg-slate-700 hover:bg-slate-600 rounded-lg p-3 cursor-pointer transition-colors"
                    >
                      <input
                        type="radio"
                        name="renameFile"
                        checked={selectedFile === file.name}
                        onChange={() => selectFileForRename(file.name)}
                        className="w-4 h-4"
                      />
                      <div className="text-2xl">📄</div>
                      <div className="flex-1">
                        <div className="text-white font-medium">{file.name}</div>
                        <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {selectedFile && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    New name:
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New filename"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRename}
                disabled={!selectedFile || !newName || newName === selectedFile}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setActiveModal(null);
                  setSelectedFile('');
                  setNewName('');
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Directory Modal */}
      {activeModal === 'mkdir' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-white mb-4">Create Directory</h3>
            <input
              type="text"
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              placeholder="Directory name"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={handleMkdir}
                disabled={!dirName}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setActiveModal(null);
                  setDirName('');
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
