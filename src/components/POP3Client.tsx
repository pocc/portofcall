import { useState } from 'react';
import { FormField, ActionButton, HelpSection } from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface POP3ClientProps {
  onBack: () => void;
}

interface POP3Message {
  id: number;
  size: number;
}

export default function POP3Client({ onBack }: POP3ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('110');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<POP3Message[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
    password: [validationRules.required('Password is required')],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port, username, password });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/pop3/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        greeting?: string;
        authenticated?: boolean;
      };

      if (response.ok && data.success && data.authenticated) {
        setConnected(true);
        setResult(`Connected to ${host}:${port}\n\nGreeting: ${data.greeting || 'N/A'}\n\nAuthentication: Success`);
        // Auto-load messages
        loadMessages();
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    if (!host || !username || !password) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/pop3/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        messages?: POP3Message[];
        totalMessages?: number;
        totalSize?: number;
      };

      if (response.ok && data.success) {
        setMessages(data.messages || []);
        setTotalMessages(data.totalMessages || 0);
        setTotalSize(data.totalSize || 0);
        setResult(`Found ${data.totalMessages || 0} message(s) (${formatBytes(data.totalSize || 0)})`);
      } else {
        setError(data.error || 'Failed to list messages');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list messages');
    } finally {
      setLoading(false);
    }
  };

  const handleRetrieveMessage = async (messageId: number) => {
    if (!host || !username || !password) return;

    setLoading(true);
    setError('');
    setSelectedMessage('');

    try {
      const response = await fetch('/api/pop3/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          messageId,
          timeout: 30000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        setSelectedMessage(data.message || '');
        setResult(`Retrieved message #${messageId}`);
      } else {
        setError(data.error || 'Failed to retrieve message');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve message');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setMessages([]);
    setTotalMessages(0);
    setTotalSize(0);
    setSelectedMessage('');
    setResult('');
    setError('');
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && !connected && host && port && username && password) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            aria-label="Go back to protocol selector"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">POP3 Client</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" aria-hidden="true"></div>
            <span className="text-green-400 text-sm">
              Connected to {host}:{port}
            </span>
          </div>
        )}
      </div>

      <ApiExamples examples={apiExamples.POP3 || []} />

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Connection Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">1</span>
              </div>
              <h2 className="text-xl font-semibold text-white">Server</h2>
            </div>

            <div className="space-y-4">
              <FormField
                id="pop3-host"
                label="Host"
                type="text"
                value={host}
                onChange={setHost}
                onKeyDown={handleKeyDown}
                placeholder="pop.example.com"
                required
                error={errors.host}
              />

              <div>
                <label htmlFor="pop3-port" className="block text-sm font-medium text-slate-300 mb-1">
                  Port
                </label>
                <select
                  id="pop3-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  aria-required="true"
                >
                  <option value="110">110 (POP3)</option>
                  <option value="995">995 (POP3S)</option>
                </select>
                {errors.port && (
                  <p className="text-red-400 text-xs mt-1" role="alert">{errors.port}</p>
                )}
              </div>

              <FormField
                id="pop3-username"
                label="Username"
                type="text"
                value={username}
                onChange={setUsername}
                onKeyDown={handleKeyDown}
                placeholder="username"
                required
                error={errors.username}
              />

              <FormField
                id="pop3-password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                onKeyDown={handleKeyDown}
                placeholder="password"
                required
                error={errors.password}
              />

              {!connected ? (
                <ActionButton
                  onClick={handleConnect}
                  disabled={loading || !host || !port || !username || !password}
                  loading={loading}
                  ariaLabel="Connect to POP3 server"
                >
                  Connect
                </ActionButton>
              ) : (
                <>
                  <ActionButton
                    onClick={loadMessages}
                    disabled={loading}
                    loading={loading}
                    variant="primary"
                    ariaLabel="Refresh message list"
                  >
                    Refresh Messages
                  </ActionButton>
                  <button
                    onClick={handleDisconnect}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label="Disconnect from POP3 server"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>

            <HelpSection
              title="About POP3"
              description="Post Office Protocol v3 for retrieving emails. Port 110 (plain) or 995 (SSL/TLS). Downloads emails from server for offline access."
              showKeyboardShortcut={true}
            />

            {connected && totalMessages > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-600">
                <div className="text-sm text-slate-300">
                  <div className="flex justify-between mb-1">
                    <span>Messages:</span>
                    <span className="font-semibold">{totalMessages}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Size:</span>
                    <span className="font-semibold">{formatBytes(totalSize)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Message List & Viewer */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">2</span>
              </div>
              <h2 className="text-xl font-semibold text-white">
                {selectedMessage ? 'Message Content' : 'Mailbox'}
              </h2>
            </div>

            {!connected ? (
              <div className="text-center py-12 text-slate-500">
                Connect to a POP3 server to view your mailbox
              </div>
            ) : selectedMessage ? (
              <div>
                <button
                  onClick={() => setSelectedMessage('')}
                  className="mb-4 text-blue-400 hover:text-blue-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                  aria-label="Back to message list"
                >
                  ← Back to message list
                </button>
                <div className="bg-black rounded-lg p-4 overflow-auto max-h-96">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                    {selectedMessage}
                  </pre>
                </div>
              </div>
            ) : (
              <div>
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    {loading ? 'Loading messages...' : 'No messages in mailbox'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className="bg-slate-700 border border-slate-600 rounded-lg p-4 hover:bg-slate-600 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={() => handleRetrieveMessage(msg.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRetrieveMessage(msg.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View message ${msg.id}, ${formatBytes(msg.size)}`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <span className="text-blue-400 font-mono text-sm">
                              #{msg.id}
                            </span>
                            <span className="text-slate-300">
                              Message {msg.id}
                            </span>
                          </div>
                          <span className="text-slate-400 text-sm">
                            {formatBytes(msg.size)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Result/Error Display */}
            {(result || error) && !selectedMessage && (
              <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-slate-600">
                <pre className={`text-sm whitespace-pre-wrap font-mono ${
                  error ? 'text-red-400' : 'text-green-400'
                }`}>
                  {error || result}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
