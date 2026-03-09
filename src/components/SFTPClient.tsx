import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface SFTPClientProps {
  onBack: () => void;
}

export default function SFTPClient({ onBack }: SFTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string[]>([]);

  const addOutput = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    const prefix = {
      info: '💡 ',
      error: '❌ ',
      success: '✅ ',
    }[type];
    setOutput(prev => {
      const next = [...prev, `${prefix}${text}`];
      return next.length > 500 ? next.slice(-500) : next;
    });
  };

  const handleConnect = async () => {
    if (!host) {
      addOutput('Error: Host is required', 'error');
      return;
    }

    setLoading(true);
    addOutput(`Testing SFTP connectivity to ${host}:${port}...`, 'info');

    try {
      const testResponse = await fetch('/api/sftp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const testData = await testResponse.json() as { success?: boolean; error?: string; sshBanner?: string; software?: string; sshVersion?: string };

      if (!testResponse.ok || !testData.success) {
        addOutput(`Connection test failed: ${testData.error}`, 'error');
        setLoading(false);
        return;
      }

      addOutput(`SSH banner: ${testData.sshBanner || 'Unknown'}`, 'success');
      if (testData.software) {
        addOutput(`Software: ${testData.software}`, 'info');
      }
      if (testData.sshVersion) {
        addOutput(`SSH version: ${testData.sshVersion}`, 'info');
      }
      addOutput('SFTP subsystem is available on this server', 'success');
      addOutput('File operations (list, upload, download, etc.) are not yet implemented — they require a WebSocket-based SFTP session', 'info');
    } catch (error) {
      addOutput(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
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

      <ApiExamples examples={apiExamples.SFTP || []} />

      <div className="info-box" style={{ marginBottom: '1rem', borderColor: '#f59e0b', background: 'rgba(245,158,11,0.08)', color: '#fcd34d' }}>
        <strong>Connectivity test only.</strong> Tests TCP reachability and reads the SSH banner to verify SFTP availability. File operations (list, upload, download, delete, mkdir, rename) are not yet implemented — they require a WebSocket-based SFTP session.
      </div>

      <div className="connection-form">
        <h3>Test SFTP Server Connectivity</h3>

        <div className="form-row">
          <div className="form-group" style={{ flex: 3 }}>
            <label htmlFor="sftp-host">Host</label>
            <input
              id="sftp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="test.rebex.net"
              disabled={loading}
            />
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="sftp-port">Port</label>
            <input
              id="sftp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="connect-button"
        >
          {loading ? 'Testing...' : 'Test Connection'}
        </button>

        <div className="help-text">
          <p>Tests whether an SSH server is reachable and reports the SSH banner.</p>
          <p>Test server: test.rebex.net:22</p>
        </div>
      </div>

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
          <button
            onClick={() => setOutput([])}
            className="secondary-button"
            style={{ marginTop: '0.5rem' }}
          >
            Clear Log
          </button>
        </div>
      )}
    </div>
  );
}
