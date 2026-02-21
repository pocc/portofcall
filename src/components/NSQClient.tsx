import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface NSQClientProps {
  onBack: () => void;
}

export default function NSQClient({ onBack }: NSQClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4150');
  const [topic, setTopic] = useState('test');
  const [message, setMessage] = useState('Hello from Port of Call!');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nsq/connect', {
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
        rtt?: number;
        serverInfo?: {
          version?: string;
          maxRdyCount?: number;
          maxMsgTimeout?: number;
          msgTimeout?: number;
          tlsRequired?: boolean;
          deflate?: boolean;
          snappy?: boolean;
          authRequired?: boolean;
        };
      };

      if (response.ok && data.success) {
        const info = data.serverInfo;
        let output = `Connected to nsqd at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Version:        ${info?.version || 'Unknown'}\n`;
        output += `Max RDY Count:  ${info?.maxRdyCount ?? 'Unknown'}\n`;
        output += `Msg Timeout:    ${info?.msgTimeout ? `${info.msgTimeout / 1000000}ms` : 'Unknown'}\n`;
        output += `Max Msg Timeout:${info?.maxMsgTimeout ? ` ${info.maxMsgTimeout / 1000000}ms` : ' Unknown'}\n`;
        output += `TLS Required:   ${info?.tlsRequired ? 'Yes' : 'No'}\n`;
        output += `Deflate:        ${info?.deflate ? 'Supported' : 'No'}\n`;
        output += `Snappy:         ${info?.snappy ? 'Supported' : 'No'}\n`;
        output += `Auth Required:  ${info?.authRequired ? 'Yes' : 'No'}\n`;
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

  const handlePublish = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!topic.trim()) {
      setError('Topic is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nsq/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          topic: topic.trim(),
          message,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        topic?: string;
        messageSize?: number;
      };

      if (response.ok && data.success) {
        setResult(`Published to topic "${data.topic}"\nMessage size: ${data.messageSize} bytes`);
      } else {
        setError(data.error || 'Publish failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">NSQ Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.NSQ || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="nsq-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="nsq-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="nsqd.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="nsq-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="nsq-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 4150 (TCP), 4151 (HTTP)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test NSQ connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection'
          )}
        </button>

        {/* Step 2: Publish */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Publish Message</h2>
          </div>

          <div className="grid md:grid-cols-1 gap-4 mb-4">
            <div>
              <label htmlFor="nsq-topic" className="block text-sm font-medium text-slate-300 mb-1">
                Topic <span className="text-red-400" aria-label="required">*</span>
              </label>
              <input
                id="nsq-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="my_topic"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby="nsq-topic-help"
              />
              <p id="nsq-topic-help" className="text-xs text-slate-400 mt-1">
                1-64 characters: alphanumeric, dots, underscores, hyphens
              </p>
            </div>

            <div>
              <label htmlFor="nsq-message" className="block text-sm font-medium text-slate-300 mb-1">
                Message
              </label>
              <textarea
                id="nsq-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message payload"
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
          </div>

          <button
            onClick={handlePublish}
            disabled={loading || !host || !topic.trim()}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Publish NSQ message"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Publishing...
              </span>
            ) : (
              'Publish Message'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">&#x2715;</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">&#x2713;</span>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About NSQ</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            NSQ is a realtime distributed messaging platform designed for high-throughput,
            fault-tolerant message delivery. It decouples producers and consumers with an
            at-least-once delivery guarantee. Used by Docker, Stripe, Segment, and many others.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            The TCP protocol uses a binary V2 framing format. Port 4150 is the default TCP port,
            and 4151 is the HTTP API port. Topics are created on first publish. Messages are
            distributed to channels within topics for consumer groups.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
