import { useState, useRef, useEffect } from 'react';

const DEMO_HOST = '157.230.147.115';

interface DemoExample {
  protocol: string;
  title: string;
  description: string;
  command: string;
  shortCommand?: string;
  port: number;
}

const examples: DemoExample[] = [
  {
    protocol: 'TCP Ping',
    title: 'Check if a port is open',
    description: 'SYN-level TCP connectivity test with RTT measurement',
    command: `curl -s -X POST 'https://l4.fyi/api/ping' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":6379,"timeout":3000}'`,
    shortCommand: `curl l4.fyi/synping/${DEMO_HOST}:6379`,
    port: 6379,
  },
  {
    protocol: 'Redis',
    title: 'Connect to Redis and get server info',
    description: 'Connects to Redis, sends PING, returns version and server details',
    command: `curl -s -X POST 'https://l4.fyi/api/redis/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":6379}'`,
    shortCommand: `curl l4.fyi/redis/${DEMO_HOST}`,
    port: 6379,
  },
  {
    protocol: 'MySQL',
    title: 'Run a SQL query on MySQL',
    description: 'Full MySQL wire protocol: auth handshake + query execution',
    command: `curl -s -X POST 'https://l4.fyi/api/mysql/query' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":3306,"username":"testuser","password":"testpass123","database":"testdb","query":"SELECT NOW(), @@version"}'`,
    shortCommand: `curl l4.fyi/mysql/${DEMO_HOST}`,
    port: 3306,
  },
  {
    protocol: 'MongoDB',
    title: 'Connect and authenticate to MongoDB',
    description: 'SCRAM-SHA-256 auth against MongoDB 7, returns server build info',
    command: `curl -s -X POST 'https://l4.fyi/api/mongodb/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":27017,"username":"testuser","password":"testpass123","database":"testdb"}'`,
    port: 27017,
  },
  {
    protocol: 'SSH',
    title: 'Execute a command over SSH',
    description: 'Full SSH2 handshake, key exchange, auth, and command execution',
    command: `curl -s -X POST 'https://l4.fyi/api/ssh/exec' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":2222,"username":"testuser","password":"testpass123","command":"whoami && hostname && uptime"}'`,
    shortCommand: `curl l4.fyi/ssh/${DEMO_HOST}:2222`,
    port: 2222,
  },
  {
    protocol: 'IRC',
    title: 'Connect to an IRC server',
    description: 'IRC protocol negotiation, nick registration, and MOTD retrieval',
    command: `curl -s -X POST 'https://l4.fyi/api/irc/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":6667,"nickname":"visitor","timeout":5000}'`,
    port: 6667,
  },
  {
    protocol: 'MQTT',
    title: 'Connect to an MQTT broker',
    description: 'MQTT 3.1.1 CONNECT/CONNACK handshake with Mosquitto',
    command: `curl -s -X POST 'https://l4.fyi/api/mqtt/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":1883,"clientId":"demo-client"}'`,
    port: 1883,
  },
  {
    protocol: 'FTP',
    title: 'Connect and authenticate to FTP',
    description: 'FTP control channel login with USER/PASS commands',
    command: `curl -s -X POST 'https://l4.fyi/api/ftp/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":21,"username":"testuser","password":"testpass123"}'`,
    shortCommand: `curl l4.fyi/ftp/${DEMO_HOST}`,
    port: 21,
  },
  {
    protocol: 'Telnet',
    title: 'Connect to a Telnet server',
    description: 'Telnet option negotiation and banner capture',
    command: `curl -s -X POST 'https://l4.fyi/api/telnet/connect' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":23,"timeout":5000}'`,
    port: 23,
  },
  {
    protocol: 'Memcached',
    title: 'Get Memcached server stats',
    description: 'Memcached text protocol: stats command with parsed key-value response',
    command: `curl -s -X POST 'https://l4.fyi/api/memcached/stats' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":11211}'`,
    port: 11211,
  },
  {
    protocol: 'Echo',
    title: 'RFC 862 Echo Protocol',
    description: 'Sends a message, receives the exact same bytes back',
    command: `curl -s -X POST 'https://l4.fyi/api/echo/test' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":7,"message":"hello world"}'`,
    port: 7,
  },
  {
    protocol: 'Daytime',
    title: 'RFC 867 Daytime Protocol',
    description: 'Returns current date/time as human-readable string with clock offset',
    command: `curl -s -X POST 'https://l4.fyi/api/daytime/get' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":13}'`,
    port: 13,
  },
  {
    protocol: 'Time',
    title: 'RFC 868 Time Protocol',
    description: 'Returns 32-bit timestamp (seconds since 1900-01-01) with NTP-style offset',
    command: `curl -s -X POST 'https://l4.fyi/api/time/get' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":37}'`,
    port: 37,
  },
  {
    protocol: 'Finger',
    title: 'RFC 1288 Finger Protocol',
    description: 'Queries user information from the Finger daemon',
    command: `curl -s -X POST 'https://l4.fyi/api/finger/query' \\
  -H 'Content-Type: application/json' \\
  -d '{"host":"${DEMO_HOST}","port":79,"query":"testuser"}'`,
    port: 79,
  },
];

interface LiveDemoProps {
  onBack: () => void;
}

export default function LiveDemo({ onBack }: LiveDemoProps) {
  const [results, setResults] = useState<Record<number, { loading: boolean; data?: string; error?: string }>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => { clearTimeout(copyTimerRef.current); };
  }, []);

  const handleCopy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 2000);
    } catch { /* fallback */ }
  };

  const handleRun = async (index: number) => {
    const example = examples[index];
    setResults(r => ({ ...r, [index]: { loading: true } }));

    try {
      // Parse the curl command to extract URL and body
      const urlMatch = example.command.match(/'(https:\/\/[^']+)'/);
      const bodyMatch = example.command.match(/-d '({[^}]+})'/s) || example.command.match(/-d '(.+?)'/s);
      if (!urlMatch) throw new Error('Could not parse URL');

      const res = await fetch(urlMatch[1], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyMatch ? bodyMatch[1] : undefined,
      });
      const data = await res.json();
      setResults(r => ({ ...r, [index]: { loading: false, data: JSON.stringify(data, null, 2) } }));
    } catch (err) {
      setResults(r => ({ ...r, [index]: { loading: false, error: err instanceof Error ? err.message : 'Unknown error' } }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-700"
          aria-label="Back to protocol selector"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Live Protocol Demo</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real services running on <code className="text-blue-400">{DEMO_HOST}</code> — try them from your browser or terminal
          </p>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-8">
        <p className="text-slate-300 text-sm">
          Each example below sends a real TCP connection through the Cloudflare Worker at{' '}
          <code className="text-blue-400">l4.fyi</code> to Docker containers on a DigitalOcean droplet.
          Click <strong>Run</strong> to execute in-browser, or <strong>Copy</strong> to paste into your terminal.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {['Databases', 'Messaging', 'Remote Access', 'Classic RFC'].map(tag => (
            <span key={tag} className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {examples.map((example, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded">
                      {example.protocol}
                    </span>
                    <span className="text-xs text-slate-500">port {example.port}</span>
                  </div>
                  <h3 className="text-white font-medium mt-1">{example.title}</h3>
                  <p className="text-slate-400 text-sm mt-0.5">{example.description}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(example.command, i)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copiedIndex === i ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleRun(i)}
                    disabled={results[i]?.loading}
                    className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    {results[i]?.loading ? 'Running...' : 'Run'}
                  </button>
                </div>
              </div>

              {example.shortCommand && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-slate-500">Short:</span>
                  <code className="text-xs text-cyan-400 bg-slate-950 rounded px-2 py-1 font-mono">
                    {example.shortCommand}
                  </code>
                </div>
              )}

              <pre className="text-xs text-green-400 bg-slate-950 rounded-lg p-3 mt-2 overflow-x-auto font-mono whitespace-pre-wrap break-all">
                {example.command}
              </pre>

              {results[i] && !results[i].loading && (
                <div className="mt-3">
                  <span className="text-xs text-slate-500 font-medium">Response:</span>
                  <pre className={`text-xs rounded-lg p-3 mt-1 overflow-x-auto font-mono whitespace-pre-wrap break-all ${
                    results[i].error ? 'bg-red-950/50 text-red-400' : 'bg-slate-900 text-amber-300'
                  }`}>
                    {results[i].error || results[i].data}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center text-slate-500 text-sm">
        <p>
          These are {examples.length} of 244+ protocols supported by L4.FYI.{' '}
          <button onClick={onBack} className="text-blue-400 hover:text-blue-300 underline">
            Browse all protocols
          </button>
        </p>
      </div>
    </div>
  );
}
