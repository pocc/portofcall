import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface ThriftClientProps {
  onBack: () => void;
}

export default function ThriftClient({ onBack }: ThriftClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9090');
  const [method, setMethod] = useState('getName');
  const [transport, setTransport] = useState<'framed' | 'buffered'>('framed');
  const [args, setArgs] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/thrift/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          method,
          transport,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        host?: string;
        port?: number;
        transport?: string;
        protocol?: string;
        response?: {
          messageType: string;
          method: string;
          seqId: number;
          isException: boolean;
          exceptionMessage?: string;
          fieldCount: number;
          fields: Array<{
            id: number;
            type: number;
            typeName: string;
            value: string;
          }>;
        };
      };

      if (response.ok && data.success) {
        let output = `Thrift RPC probe to ${host}:${port}\n\n`;
        output += `Method: ${data.response?.method || method}()\n`;
        output += `Transport: ${data.transport || transport}\n`;
        output += `Protocol: ${data.protocol || 'binary'}\n`;
        output += `Message Type: ${data.response?.messageType}\n`;
        output += `Sequence ID: ${data.response?.seqId}\n`;

        if (data.response?.isException) {
          output += `\nException: ${data.response.exceptionMessage}\n`;
        }

        if (data.response?.fields && data.response.fields.length > 0) {
          output += `\nResult Fields (${data.response.fieldCount}):\n`;
          for (const field of data.response.fields) {
            output += `  Field ${field.id} (${field.typeName}): ${field.value}\n`;
          }
        }

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

  const handleCall = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    if (!method) {
      setError('Method name is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      // Parse args from text format: "1:i32:42, 2:string:hello"
      const parsedArgs: Array<{ id: number; type: string; value: string }> = [];
      if (args.trim()) {
        for (const arg of args.split(',')) {
          const parts = arg.trim().split(':');
          if (parts.length >= 3) {
            parsedArgs.push({
              id: parseInt(parts[0]),
              type: parts[1],
              value: parts.slice(2).join(':'),
            });
          }
        }
      }

      const response = await fetch('/api/thrift/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          method,
          args: parsedArgs,
          transport,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        response?: {
          messageType: string;
          method: string;
          seqId: number;
          isException: boolean;
          exceptionMessage?: string;
          fieldCount: number;
          fields: Array<{
            id: number;
            type: number;
            typeName: string;
            value: string;
          }>;
        };
      };

      if (response.ok && data.success) {
        let output = `Thrift RPC: ${method}() → ${data.response?.messageType}\n\n`;

        if (data.response?.isException) {
          output += `Exception: ${data.response.exceptionMessage}\n`;
        }

        if (data.response?.fields && data.response.fields.length > 0) {
          output += `Result Fields (${data.response.fieldCount}):\n`;
          for (const field of data.response.fields) {
            output += `  Field ${field.id} (${field.typeName}): ${field.value}\n`;
          }
        } else {
          output += 'No return fields (void method)\n';
        }

        setResult(output);
      } else {
        setError(data.error || 'RPC call failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RPC call failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
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
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Thrift Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.Thrift || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="thrift-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="thrift-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="thrift.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="thrift-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="thrift-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 9090</p>
          </div>

          <div>
            <label htmlFor="thrift-transport" className="block text-sm font-medium text-slate-300 mb-1">
              Transport
            </label>
            <select
              id="thrift-transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value as 'framed' | 'buffered')}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="framed">Framed (default)</option>
              <option value="buffered">Buffered</option>
            </select>
          </div>

          <div>
            <label htmlFor="thrift-method" className="block text-sm font-medium text-slate-300 mb-1">
              Method Name
            </label>
            <input
              id="thrift-method"
              type="text"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="getName"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleProbe}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 mb-6"
          aria-label="Probe Thrift server with empty args"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Probing...
            </span>
          ) : (
            'Probe Server (empty args)'
          )}
        </button>

        {/* Step 2: RPC Call */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">RPC Call</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="thrift-args" className="block text-sm font-medium text-slate-300 mb-1">
              Arguments
            </label>
            <input
              id="thrift-args"
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="1:i32:42, 2:string:hello"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Format: field_id:type:value (types: bool, byte, i16, i32, i64, double, string)
            </p>
          </div>

          <button
            onClick={handleCall}
            disabled={loading || !host || !method}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Execute Thrift RPC call"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Calling...
              </span>
            ) : (
              `Call ${method}()`
            )}
          </button>
        </div>

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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Apache Thrift</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Apache Thrift is a cross-language RPC framework originally developed at Facebook.
            It uses an Interface Definition Language (IDL) to define services, and supports
            multiple serialization formats (Binary, Compact, JSON) and transport layers
            (Framed, Buffered, HTTP). Thrift is widely used in microservices architectures
            and big data systems like Cassandra and HBase.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
