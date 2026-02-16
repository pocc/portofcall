import { useState } from 'react';

interface OPCUAClientProps {
  onBack: () => void;
}

export default function OPCUAClient({ onBack }: OPCUAClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4840');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleHello = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/opcua/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          endpointUrl: endpointUrl || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        host?: string;
        port?: number;
        endpointUrl?: string;
        acknowledge?: {
          protocolVersion?: number;
          receiveBufferSize?: number;
          sendBufferSize?: number;
          maxMessageSize?: number;
          maxChunkCount?: number;
        };
        serverError?: {
          code?: number;
          name?: string;
          reason?: string;
        };
        response?: {
          messageType?: string;
          chunkType?: string;
          messageSize?: number;
        };
        rawHex?: string;
        rawLength?: number;
      };

      if (response.ok && data.success) {
        let text = `${data.message || 'Connected'}\n\n`;

        if (data.acknowledge) {
          const ack = data.acknowledge;
          text += `Server Acknowledge:\n`;
          text += `  Protocol Version:    ${ack.protocolVersion}\n`;
          text += `  Receive Buffer Size: ${ack.receiveBufferSize?.toLocaleString()} bytes\n`;
          text += `  Send Buffer Size:    ${ack.sendBufferSize?.toLocaleString()} bytes\n`;
          text += `  Max Message Size:    ${ack.maxMessageSize === 0 ? 'No limit' : ack.maxMessageSize?.toLocaleString() + ' bytes'}\n`;
          text += `  Max Chunk Count:     ${ack.maxChunkCount === 0 ? 'No limit' : ack.maxChunkCount}\n`;
        }

        if (data.serverError) {
          const err = data.serverError;
          text += `Server Error:\n`;
          text += `  Code:   0x${err.code?.toString(16).padStart(8, '0')}\n`;
          text += `  Name:   ${err.name}\n`;
          if (err.reason) {
            text += `  Reason: ${err.reason}\n`;
          }
        }

        if (data.endpointUrl) {
          text += `\nEndpoint URL: ${data.endpointUrl}`;
        }

        if (data.rawHex) {
          text += `\nRaw Hex: ${data.rawHex}`;
        }

        setResult(text);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEndpoints = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/opcua/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          endpointUrl: endpointUrl || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        endpointUrl?: string;
        phase?: string;
        acknowledge?: {
          protocolVersion?: number;
          receiveBufferSize?: number;
          sendBufferSize?: number;
          maxMessageSize?: number;
          maxChunkCount?: number;
        };
        secureChannel?: {
          status?: string;
          channelId?: number;
          payloadSize?: number;
          error?: {
            code?: number;
            name?: string;
            reason?: string;
          };
          messageType?: string;
        };
        serverError?: {
          code?: number;
          name?: string;
          reason?: string;
        };
        helloRawHex?: string;
        secureChannelRawHex?: string;
        rawHex?: string;
      };

      if (response.ok && data.success) {
        let text = `Endpoint Discovery: ${data.host}:${data.port}\n`;
        text += `Endpoint URL: ${data.endpointUrl}\n\n`;

        if (data.acknowledge) {
          const ack = data.acknowledge;
          text += `Step 1 - Hello/Acknowledge:\n`;
          text += `  Protocol Version:    ${ack.protocolVersion}\n`;
          text += `  Receive Buffer Size: ${ack.receiveBufferSize?.toLocaleString()} bytes\n`;
          text += `  Send Buffer Size:    ${ack.sendBufferSize?.toLocaleString()} bytes\n`;
          text += `  Max Message Size:    ${ack.maxMessageSize === 0 ? 'No limit' : ack.maxMessageSize?.toLocaleString() + ' bytes'}\n`;
          text += `  Max Chunk Count:     ${ack.maxChunkCount === 0 ? 'No limit' : ack.maxChunkCount}\n`;
        }

        if (data.secureChannel) {
          const sc = data.secureChannel;
          text += `\nStep 2 - Secure Channel:\n`;
          text += `  Status: ${sc.status}\n`;
          if (sc.channelId !== undefined) {
            text += `  Channel ID: ${sc.channelId}\n`;
          }
          if (sc.payloadSize !== undefined) {
            text += `  Payload Size: ${sc.payloadSize} bytes\n`;
          }
          if (sc.error) {
            text += `  Error Code: 0x${sc.error.code?.toString(16).padStart(8, '0')}\n`;
            text += `  Error Name: ${sc.error.name}\n`;
            if (sc.error.reason) {
              text += `  Error Reason: ${sc.error.reason}\n`;
            }
          }
        }

        if (data.serverError) {
          text += `\nServer Error (during ${data.phase || 'unknown'} phase):\n`;
          text += `  Code: 0x${data.serverError.code?.toString(16).padStart(8, '0')}\n`;
          text += `  Name: ${data.serverError.name}\n`;
          if (data.serverError.reason) {
            text += `  Reason: ${data.serverError.reason}\n`;
          }
        }

        if (data.helloRawHex) {
          text += `\nHello Raw: ${data.helloRawHex}`;
        }
        if (data.secureChannelRawHex) {
          text += `\nSecureChannel Raw: ${data.secureChannelRawHex}`;
        }

        setResult(text);
      } else {
        setError(data.error || 'Endpoint discovery failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Endpoint discovery failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHello();
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
        <h1 className="text-3xl font-bold text-white">OPC UA Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Warning Banner */}
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-xl" aria-hidden="true">&#x26A0;</span>
            <div>
              <p className="text-yellow-200 text-sm font-semibold mb-1">Industrial IoT Warning</p>
              <p className="text-yellow-100/80 text-xs leading-relaxed">
                OPC UA controls manufacturing equipment, energy systems, and building automation.
                This client supports READ-ONLY discovery operations. Only connect to servers you are authorized to access.
              </p>
            </div>
          </div>
        </div>

        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="opcua-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="opcua-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="opcua-server.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="opcua-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="opcua-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 4840</p>
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="opcua-endpoint" className="block text-sm font-medium text-slate-300 mb-1">
            Endpoint URL (optional)
          </label>
          <input
            id="opcua-endpoint"
            type="text"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`opc.tcp://${host || 'host'}:${port}/`}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-400 mt-1">Auto-generated from host:port if left empty</p>
        </div>

        <button
          onClick={handleHello}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Send OPC UA Hello probe"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Probing...
            </span>
          ) : (
            'Send Hello Probe'
          )}
        </button>

        {/* Step 2: Endpoint Discovery */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Endpoint Discovery</h2>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Sends Hello + OpenSecureChannel to discover server endpoints and security policies.
          </p>

          <button
            onClick={handleEndpoints}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Discover OPC UA endpoints"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Discovering...
              </span>
            ) : (
              'Discover Endpoints'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About OPC UA</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            OPC UA (Unified Architecture) is a machine-to-machine communication protocol for
            industrial automation developed by the OPC Foundation. It provides secure, reliable
            data exchange across platforms and is the successor to OPC Classic. Port 4840 is the
            default TCP port. The Hello/Acknowledge handshake establishes transport parameters.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mt-3">
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">HEL/ACK</span>
              <span className="text-slate-300 ml-2">Transport handshake</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">OPN</span>
              <span className="text-slate-300 ml-2">Open Secure Channel</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">MSG</span>
              <span className="text-slate-300 ml-2">Service Messages</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">ERR</span>
              <span className="text-slate-300 ml-2">Error response</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
