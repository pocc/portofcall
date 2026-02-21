import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface TcpClientProps {
  onBack: () => void;
}

interface TcpResult {
  success: boolean;
  host?: string;
  port?: number;
  sent?: string;
  sentBytes?: number;
  received?: string;
  receivedHex?: string;
  receivedUtf8?: string;
  bytesReceived?: number;
  rtt?: number;
  connectMs?: number;
  encoding?: string;
  error?: string;
}

interface Preset {
  label: string;
  description: string;
  host: string;
  port: string;
  data: string;
  encoding: 'utf8' | 'hex';
  notes: string;
}

const PRESETS: Preset[] = [
  {
    label: 'HTTP GET',
    description: 'Send a raw HTTP/1.0 GET request',
    host: 'example.com',
    port: '80',
    data: 'GET / HTTP/1.0\r\nHost: example.com\r\n\r\n',
    encoding: 'utf8',
    notes: 'The \\r\\n\\r\\n at the end signals end of HTTP headers. The server should reply with HTTP/1.x 200 OK + headers + body.',
  },
  {
    label: 'SMTP EHLO',
    description: 'Grab the SMTP server banner and capabilities',
    host: '',
    port: '25',
    data: 'EHLO probe.test\r\n',
    encoding: 'utf8',
    notes: 'Connect first — the SMTP server sends a 220 banner. EHLO asks for supported extensions (AUTH, TLS, SIZE, etc.).',
  },
  {
    label: 'FTP Banner',
    description: 'Receive the FTP server greeting',
    host: '',
    port: '21',
    data: '',
    encoding: 'utf8',
    notes: 'FTP speaks first with a 220 banner. Leave data empty to just read it. The banner often reveals server software and version.',
  },
  {
    label: 'SSH Banner',
    description: 'Read the SSH identification string',
    host: '',
    port: '22',
    data: '',
    encoding: 'utf8',
    notes: 'SSH speaks first: "SSH-2.0-OpenSSH_8.9p1" etc. The format is SSH-protoversion-softwareversion. No data needed to read it.',
  },
  {
    label: 'POP3 Greeting',
    description: 'Receive the POP3 server banner',
    host: '',
    port: '110',
    data: '',
    encoding: 'utf8',
    notes: 'POP3 greets with +OK followed by server info. You can then send USER <name> and PASS <pw> to authenticate.',
  },
  {
    label: 'Redis PING',
    description: 'Send a Redis inline PING command',
    host: '',
    port: '6379',
    data: 'PING\r\n',
    encoding: 'utf8',
    notes: 'Redis inline commands are just text. PING → +PONG. You can also send RESP protocol: *1\\r\\n$4\\r\\nPING\\r\\n',
  },
  {
    label: 'HTTP CONNECT (proxy)',
    description: 'Ask an HTTP proxy to tunnel a connection',
    host: '',
    port: '8080',
    data: 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n',
    encoding: 'utf8',
    notes: 'CONNECT tells an HTTP proxy to open a TCP tunnel. A compliant proxy replies 200 Connection established and then forwards raw bytes.',
  },
  {
    label: 'Hex: Modbus Read',
    description: 'Modbus TCP Function Code 03 — Read Holding Registers',
    host: '',
    port: '502',
    data: '0001 0000 0006 01 03 0000 0001',
    encoding: 'hex',
    notes: 'Bytes: Transaction ID (0001) | Protocol (0000) | Length (0006) | Unit ID (01) | FC 03 (Read Holding Registers) | Start addr (0000) | Quantity (0001). Response FC+03 means success; FC+83 means exception.',
  },
];

// Format hex with spaces every 2 chars and newlines every 16 bytes
function formatHex(hex: string): string {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 16) {
    const row = pairs.slice(i, i + 16);
    const offset = i.toString(16).padStart(4, '0');
    const hexPart = row.join(' ').padEnd(47, ' ');
    const asciiPart = row
      .map((b) => {
        const code = parseInt(b, 16);
        return code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
      })
      .join('');
    lines.push(`${offset}  ${hexPart}  ${asciiPart}`);
  }
  return lines.join('\n');
}

export default function TcpClient({ onBack }: TcpClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [data, setData] = useState('');
  const [encoding, setEncoding] = useState<'utf8' | 'hex'>('utf8');
  const [timeout, setTimeout_] = useState('10000');
  const [maxBytes, setMaxBytes] = useState('4096');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TcpResult | null>(null);
  const [error, setError] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showHexDump, setShowHexDump] = useState(false);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const applyPreset = (preset: Preset) => {
    if (preset.host) setHost(preset.host);
    setPort(preset.port);
    setData(preset.data);
    setEncoding(preset.encoding);
    setActivePreset(preset.label);
    setResult(null);
    setError('');
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/tcp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          data: data || undefined,
          encoding,
          timeout: parseInt(timeout, 10) || 10000,
          maxBytes: parseInt(maxBytes, 10) || 4096,
        }),
      });

      const json = (await response.json()) as TcpResult;

      if (response.ok && json.success) {
        setResult(json);
      } else {
        setError(json.error || 'TCP connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleSend();
    }
  };

  const activePresetData = PRESETS.find((p) => p.label === activePreset);

  return (
    <ProtocolClientLayout title="Raw TCP Client" onBack={onBack}>
      {/* Presets */}
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-4">
        <SectionHeader stepNumber={1} title="Protocol Presets" />
        <p className="text-sm text-slate-400 mb-4">
          Choose a preset to load a ready-made request. Each one demonstrates a different protocol's
          opening handshake so you can see exactly what bytes servers expect and return.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className={`text-left text-xs rounded-lg p-3 border transition-colors ${
                activePreset === preset.label
                  ? 'bg-indigo-900/60 border-indigo-500 text-indigo-200'
                  : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600 hover:border-slate-500'
              }`}
            >
              <div className="font-mono font-semibold mb-1">{preset.label}</div>
              <div className="text-slate-400 leading-tight">{preset.description}</div>
            </button>
          ))}
        </div>

        {activePresetData && (
          <div className="mt-4 bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-300">
            <span className="text-yellow-400 font-semibold">What this does: </span>
            {activePresetData.notes}
          </div>
        )}
      </div>

      {/* Connection + Data */}
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-4">
        <SectionHeader stepNumber={2} title="Connection & Payload" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="tcp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="example.com or 1.2.3.4"
            required
            error={errors.host}
          />
          <FormField
            id="tcp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            placeholder="e.g. 80, 22, 25"
            error={errors.port}
          />
        </div>

        {/* Encoding selector */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Encoding
            <span className="ml-2 text-xs text-slate-500 font-normal">
              — how your payload is interpreted
            </span>
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => setEncoding('utf8')}
              className={`px-4 py-2 rounded-lg text-sm font-mono border transition-colors ${
                encoding === 'utf8'
                  ? 'bg-indigo-700 border-indigo-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600'
              }`}
            >
              UTF-8 text
            </button>
            <button
              onClick={() => setEncoding('hex')}
              className={`px-4 py-2 rounded-lg text-sm font-mono border transition-colors ${
                encoding === 'hex'
                  ? 'bg-indigo-700 border-indigo-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600'
              }`}
            >
              Hex bytes
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {encoding === 'utf8'
              ? 'Plain text. Use \\r\\n for carriage-return + newline (required by many text protocols like HTTP, SMTP, FTP).'
              : 'Hex pairs, spaces optional. E.g. "01 03 00 00 00 01" — lets you craft binary protocol headers byte-by-byte.'}
          </p>
        </div>

        {/* Data payload */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="tcp-data">
            Data to Send
            <span className="ml-2 text-xs text-slate-500 font-normal">
              — leave empty to just read the server's banner
            </span>
          </label>
          <textarea
            id="tcp-data"
            value={data}
            onChange={(e) => setData(e.target.value)}
            rows={3}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 resize-y"
            placeholder={
              encoding === 'utf8'
                ? 'GET / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n'
                : 'e.g.  00 01 00 00 00 06 01 03 00 00 00 01'
            }
          />
        </div>

        {/* Advanced options */}
        <details className="group mb-4">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300 select-none">
            Advanced options (timeout, maxBytes)
          </summary>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <FormField
              id="tcp-timeout"
              label="Timeout (ms)"
              type="number"
              value={timeout}
              onChange={setTimeout_}
              min="500"
              max="30000"
              helpText="How long to wait for data. Default: 10000"
            />
            <FormField
              id="tcp-maxbytes"
              label="Max bytes"
              type="number"
              value={maxBytes}
              onChange={setMaxBytes}
              min="1"
              max="65536"
              helpText="Stop reading after this many bytes. Default: 4096"
            />
          </div>
        </details>

        <ActionButton
          onClick={handleSend}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Send TCP request"
        >
          Connect & Send
        </ActionButton>
      </div>

      {/* Results */}
      {(result || error) && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={3} title="Response" />

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 font-mono text-sm">
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Timing */}
              <div className="flex gap-4 mb-4 text-xs font-mono">
                <span className="text-slate-400">
                  connect: <span className="text-green-400">{result.connectMs}ms</span>
                </span>
                <span className="text-slate-400">
                  total RTT: <span className="text-blue-400">{result.rtt}ms</span>
                </span>
                <span className="text-slate-400">
                  sent: <span className="text-yellow-400">{result.sentBytes ?? 0}B</span>
                </span>
                <span className="text-slate-400">
                  received: <span className="text-purple-400">{result.bytesReceived}B</span>
                </span>
              </div>

              {/* What was sent */}
              {result.sent && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 mb-1 font-mono uppercase tracking-wider">
                    Sent
                  </div>
                  <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-yellow-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {result.sent}
                  </pre>
                </div>
              )}

              {/* Received — UTF-8 */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-slate-500 font-mono uppercase tracking-wider">
                    Received (UTF-8)
                  </div>
                  {result.receivedHex && (
                    <button
                      onClick={() => setShowHexDump((v) => !v)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-mono"
                    >
                      {showHexDump ? 'Hide hex dump' : 'Show hex dump'}
                    </button>
                  )}
                </div>
                <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-green-300 overflow-x-auto whitespace-pre-wrap break-all">
                  {result.receivedUtf8 || '(no data received)'}
                </pre>
              </div>

              {/* Hex dump */}
              {showHexDump && result.receivedHex && (
                <div>
                  <div className="text-xs text-slate-500 mb-1 font-mono uppercase tracking-wider">
                    Hex Dump
                  </div>
                  <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
                    <span className="text-slate-600">{'offset  00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f  ASCII\n'}</span>
                    <span className="text-slate-600">{'------  -----------------------------------------------  ----------------\n'}</span>
                    {formatHex(result.receivedHex)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <HelpSection
        title="About Raw TCP"
        description="This client connects to any TCP port and lets you send arbitrary bytes — text or hex — then shows you exactly what the server sends back. Useful for banner grabbing, exploring binary protocols, testing firewall rules, and understanding how protocols work at the wire level."
        showKeyboardShortcut={false}
      />

      <div className="mt-4 bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-xs text-slate-400">
        <h4 className="text-slate-300 font-semibold mb-2">Tips</h4>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            <strong className="text-slate-300">UTF-8 mode:</strong> type <code className="bg-slate-700 px-1 rounded">{'\\r\\n'}</code> to
            insert CR+LF — most text protocols require this as a line terminator, not just <code className="bg-slate-700 px-1 rounded">{'\\n'}</code>.
          </li>
          <li>
            <strong className="text-slate-300">Hex mode:</strong> craft binary headers byte-by-byte. Spaces are stripped. Useful for Modbus, BACnet, custom protocols.
          </li>
          <li>
            <strong className="text-slate-300">Empty payload:</strong> many protocols (SSH, FTP, SMTP, POP3) speak first — leave data blank and just read the banner.
          </li>
          <li>
            <strong className="text-slate-300">Hex dump:</strong> toggle it on to inspect every byte with its ASCII representation — helps spot protocol flags and field boundaries.
          </li>
        </ul>
      </div>
    </ProtocolClientLayout>
  );
}
