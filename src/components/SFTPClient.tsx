import { useState, useRef } from 'react';

interface SFTPClientProps {
  onBack: () => void;
}

type AuthMethod = 'password' | 'privateKey';

export default function SFTPClient({ onBack }: SFTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [connected, setConnected] = useState(false);
  const [currentPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addOutput = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    const prefix = {
      info: '💡 ',
      error: '❌ ',
      success: '✅ ',
    }[type];
    setOutput(prev => [...prev, `${prefix}${text}`]);
  };

  const handleConnect = async () => {
    if (!host || !username) {
      addOutput('Error: Host and username are required', 'error');
      return;
    }

    if (authMethod === 'password' && !password) {
      addOutput('Error: Password is required', 'error');
      return;
    }

    if (authMethod === 'privateKey' && !privateKey) {
      addOutput('Error: Private key is required', 'error');
      return;
    }

    setLoading(true);
    addOutput(`Testing connection to ${username}@${host}:${port}...`, 'info');

    try {
      // Test connectivity first
      const testResponse = await fetch('/api/sftp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
        }),
      });

      const testData = await testResponse.json() as { success?: boolean; error?: string; sshBanner?: string };

      if (!testResponse.ok || !testData.success) {
        addOutput(`Connection test failed: ${testData.error}`, 'error');
        setLoading(false);
        return;
      }

      addOutput(`SSH server detected: ${testData.sshBanner || 'Unknown'}`, 'success');
      addOutput('SFTP WebSocket tunnel requires client-side SSH library implementation', 'info');
      addOutput('For file operations, please use a native SFTP client or command-line tools', 'info');

      setConnected(true);
    } catch (error) {
      addOutput(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    addOutput('Disconnected from SFTP server', 'info');
  };

  const handleKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setPrivateKey(content);
        addOutput(`Private key loaded: ${file.name}`, 'success');
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="sftp-client">
      <div className="client-header">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <h2>SFTP Client</h2>
        <div className="protocol-info">Port 22 - SSH File Transfer Protocol</div>
      </div>

      {!connected ? (
        <div className="connection-form">
          <h3>Connect to SFTP Server</h3>

          <div className="form-group">
            <label htmlFor="host">Host *</label>
            <input
              id="host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="test.rebex.net"
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="port">Port *</label>
              <input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="demo"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Authentication Method</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  value="password"
                  checked={authMethod === 'password'}
                  onChange={() => setAuthMethod('password')}
                  disabled={loading}
                />
                Password
              </label>
              <label>
                <input
                  type="radio"
                  value="privateKey"
                  checked={authMethod === 'privateKey'}
                  onChange={() => setAuthMethod('privateKey')}
                  disabled={loading}
                />
                Private Key
              </label>
            </div>
          </div>

          {authMethod === 'password' ? (
            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                disabled={loading}
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="privateKey">Private Key * (PEM format)</label>
                <textarea
                  id="privateKey"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  rows={8}
                  disabled={loading}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pem,.key,.txt"
                  onChange={handleKeyUpload}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="secondary-button"
                  disabled={loading}
                >
                  📂 Load from file
                </button>
              </div>

              {privateKey && (
                <div className="form-group">
                  <label htmlFor="passphrase">Passphrase (optional)</label>
                  <input
                    id="passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter passphrase if key is encrypted"
                    disabled={loading}
                  />
                </div>
              )}
            </>
          )}

          <button
            onClick={handleConnect}
            disabled={loading}
            className="connect-button"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>

          <div className="help-text">
            <p>💡 SFTP runs over SSH on port 22</p>
            <p>🔒 All file transfers are encrypted</p>
            <p>📝 Test server: test.rebex.net (user: demo, pass: password)</p>
          </div>
        </div>
      ) : (
        <div className="sftp-browser">
          <div className="browser-toolbar">
            <div className="current-path">
              <strong>Path:</strong> {currentPath}
            </div>
            <div className="toolbar-actions">
              <button onClick={handleDisconnect} className="disconnect-button">
                Disconnect
              </button>
            </div>
          </div>

          <div className="file-list">
            <div className="info-box">
              <h4>SFTP File Operations</h4>
              <p>
                This is a connectivity test interface. For full SFTP file operations
                (list, upload, download, delete), you need:
              </p>
              <ul>
                <li>Client-side SSH library (e.g., ssh2.js)</li>
                <li>SFTP subsystem support</li>
                <li>Binary packet handling for SFTP protocol</li>
              </ul>
              <p>
                The worker provides the TCP tunnel over WebSocket. The SSH protocol
                negotiation, authentication, and SFTP subsystem must be implemented
                client-side.
              </p>
              <div className="code-example">
                <strong>Example usage:</strong>
                <pre>{`const ws = new WebSocket('wss://api/sftp/connect?host=...&username=...');
// Implement SSH handshake
// Request SFTP subsystem
// Send SFTP protocol packets`}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {output.length > 0 && (
        <div className="output-panel">
          <h4>Connection Log</h4>
          <div className="output-content">
            {output.map((line, i) => (
              <div key={i} className="output-line">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
