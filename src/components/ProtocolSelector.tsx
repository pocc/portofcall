interface ProtocolSelectorProps {
  onSelect: (protocol: 'echo' | 'whois' | 'syslog' | 'socks4' | 'daytime' | 'finger' | 'time' | 'chargen' | 'gemini' | 'ftp' | 'ssh' | 'telnet' | 'smtp' | 'pop3' | 'imap' | 'mysql' | 'postgres' | 'redis' | 'mqtt' | 'ldap' | 'smb' | 'irc' | 'gopher' | 'memcached' | 'dns' | 'stomp' | 'socks5' | 'modbus' | 'mongodb' | 'graphite' | 'git' | 'zookeeper' | 'amqp' | 'cassandra' | 'kafka' | 'rtsp' | 'rsync' | 'tds' | 'vnc') => void;
}

const protocols = [
  {
    id: 'echo' as const,
    name: 'ECHO',
    description: 'ECHO Protocol (RFC 862) - The simplest TCP test protocol',
    port: 7,
    icon: '🔊',
    features: ['Network testing', 'Latency measurement', 'Connectivity verification'],
  },
  {
    id: 'whois' as const,
    name: 'WHOIS',
    description: 'WHOIS Protocol (RFC 3912) - Domain registration information lookup',
    port: 43,
    icon: '🔍',
    features: ['Domain registration info', 'Auto-detect WHOIS server', 'IP/ASN lookup'],
  },
  {
    id: 'syslog' as const,
    name: 'Syslog',
    description: 'Syslog Protocol (RFC 5424/3164) - Centralized logging and event forwarding',
    port: 514,
    icon: '📝',
    features: ['8 severity levels', 'RFC 5424 & 3164 formats', 'SIEM integration'],
  },
  {
    id: 'socks4' as const,
    name: 'SOCKS4',
    description: 'SOCKS4 Protocol - TCP connection proxying through firewalls',
    port: 1080,
    icon: '🔀',
    features: ['Proxy testing', 'SOCKS4a hostname support', 'SSH tunneling'],
  },
  {
    id: 'daytime' as const,
    name: 'Daytime',
    description: 'Daytime Protocol (RFC 867) - Human-readable time from remote servers',
    port: 13,
    icon: '🕐',
    features: ['Simplest time protocol', 'Educational', 'Clock synchronization check'],
  },
  {
    id: 'finger' as const,
    name: 'Finger',
    description: 'Finger Protocol (RFC 1288) - Legacy user information lookup',
    port: 79,
    icon: '👤',
    features: ['User information', 'Educational', 'Internet archaeology'],
  },
  {
    id: 'time' as const,
    name: 'TIME',
    description: 'TIME Protocol (RFC 868) - Binary time synchronization since 1900',
    port: 37,
    icon: '⏰',
    features: ['32-bit binary time', 'Clock synchronization', 'Y2K36 problem demonstration'],
  },
  {
    id: 'chargen' as const,
    name: 'CHARGEN',
    description: 'CHARGEN Protocol (RFC 864) - Continuous ASCII character stream',
    port: 19,
    icon: '🔤',
    features: ['Bandwidth testing', '72-char rotating pattern', 'Network testing'],
  },
  {
    id: 'gemini' as const,
    name: 'Gemini',
    description: 'Gemini Protocol - Modern privacy-focused alternative to HTTP/HTML',
    port: 1965,
    icon: '💎',
    features: ['TLS mandatory', 'Simple Gemtext markup', 'No tracking/cookies'],
  },
  {
    id: 'ftp' as const,
    name: 'FTP (Passive Mode)',
    description: 'File Transfer Protocol - Transfer files to/from FTP servers',
    port: 21,
    icon: '📁',
    features: ['Directory listing', 'File upload/download', 'Passive mode support'],
  },
  {
    id: 'ssh' as const,
    name: 'SSH',
    description: 'Secure Shell - Execute commands on remote servers',
    port: 22,
    icon: '🔐',
    features: ['Private key authentication', 'Password authentication', 'Encrypted connection'],
  },
  {
    id: 'telnet' as const,
    name: 'Telnet',
    description: 'Telnet Protocol - Unencrypted text-based terminal protocol',
    port: 23,
    icon: '📟',
    features: ['Interactive terminal', 'Command execution', 'WebSocket tunnel'],
  },
  {
    id: 'smtp' as const,
    name: 'SMTP',
    description: 'Simple Mail Transfer Protocol - Send emails via SMTP servers',
    port: 587,
    icon: '📧',
    features: ['Email sending', 'AUTH LOGIN support', 'Multiple ports (25/587/465)'],
  },
  {
    id: 'pop3' as const,
    name: 'POP3',
    description: 'Post Office Protocol v3 - Retrieve emails from mail servers',
    port: 110,
    icon: '📬',
    features: ['Email retrieval', 'Message listing', 'Mailbox management'],
  },
  {
    id: 'imap' as const,
    name: 'IMAP',
    description: 'Internet Message Access Protocol - Advanced email management',
    port: 143,
    icon: '📮',
    features: ['Multiple folders', 'Server-side organization', 'Message flags'],
  },
  {
    id: 'mysql' as const,
    name: 'MySQL',
    description: 'MySQL Database - Connectivity testing for MySQL servers',
    port: 3306,
    icon: '🗄️',
    features: ['Server handshake', 'Version detection', 'Connection testing'],
  },
  {
    id: 'postgres' as const,
    name: 'PostgreSQL',
    description: 'PostgreSQL Database - Connectivity testing for PostgreSQL servers',
    port: 5432,
    icon: '🐘',
    features: ['Startup message', 'Authentication check', 'Connection testing'],
  },
  {
    id: 'redis' as const,
    name: 'Redis',
    description: 'Redis In-Memory Store - Key-value store and cache server',
    port: 6379,
    icon: '⚡',
    features: ['RESP protocol', 'Command execution', 'AUTH & database selection'],
  },
  {
    id: 'mqtt' as const,
    name: 'MQTT',
    description: 'MQTT Protocol - Lightweight IoT messaging protocol',
    port: 1883,
    icon: '📡',
    features: ['Publish/subscribe', 'MQTT 3.1.1', 'Username/password auth'],
  },
  {
    id: 'ldap' as const,
    name: 'LDAP',
    description: 'LDAP Protocol - Directory services and authentication',
    port: 389,
    icon: '📂',
    features: ['BIND operation', 'Anonymous/authenticated bind', 'ASN.1/BER encoding'],
  },
  {
    id: 'smb' as const,
    name: 'SMB',
    description: 'SMB Protocol - Windows file sharing and network communication',
    port: 445,
    icon: '💾',
    features: ['SMB2/SMB3 negotiation', 'Protocol dialect detection', 'Connectivity testing'],
  },
  {
    id: 'irc' as const,
    name: 'IRC',
    description: 'IRC Protocol (RFC 2812) - Real-time internet relay chat',
    port: 6667,
    icon: '💬',
    features: ['Channel chat', 'Private messaging', 'Interactive WebSocket session'],
  },
  {
    id: 'gopher' as const,
    name: 'Gopher',
    description: 'Gopher Protocol (RFC 1436) - Pre-Web hypertext browsing from 1991',
    port: 70,
    icon: '🐿️',
    features: ['Menu browsing', 'Search servers', 'Internet archaeology'],
  },
  {
    id: 'memcached' as const,
    name: 'Memcached',
    description: 'Memcached Protocol - Distributed memory caching system',
    port: 11211,
    icon: '🧊',
    features: ['Cache inspection', 'Key-value operations', 'Stats monitoring'],
  },
  {
    id: 'dns' as const,
    name: 'DNS',
    description: 'DNS over TCP (RFC 1035) - Domain name resolution and debugging',
    port: 53,
    icon: '🌐',
    features: ['A/AAAA/MX/NS/TXT records', 'Multiple DNS servers', 'Raw response parsing'],
  },
  {
    id: 'stomp' as const,
    name: 'STOMP',
    description: 'STOMP Protocol (v1.2) - Simple text messaging for brokers',
    port: 61613,
    icon: '📨',
    features: ['Queue & topic messaging', 'RabbitMQ/ActiveMQ support', 'Text-based framing'],
  },
  {
    id: 'socks5' as const,
    name: 'SOCKS5',
    description: 'SOCKS5 Protocol (RFC 1928) - Authenticated TCP proxy with IPv6 support',
    port: 1080,
    icon: '🛡️',
    features: ['Username/password auth', 'Domain name resolution', 'IPv6 & IPv4 support'],
  },
  {
    id: 'modbus' as const,
    name: 'Modbus TCP',
    description: 'Modbus TCP Protocol - Industrial automation and SCADA monitoring',
    port: 502,
    icon: '🏭',
    features: ['Read registers & coils', 'PLC/sensor monitoring', 'Read-only safety mode'],
  },
  {
    id: 'mongodb' as const,
    name: 'MongoDB',
    description: 'MongoDB Wire Protocol - NoSQL document database connectivity testing',
    port: 27017,
    icon: '🍃',
    features: ['BSON wire protocol', 'Server version detection', 'Wire version & status check'],
  },
  {
    id: 'graphite' as const,
    name: 'Graphite',
    description: 'Graphite Plaintext Protocol - Time-series metrics collection and monitoring',
    port: 2003,
    icon: '📊',
    features: ['Metric batch sending', 'Dot-separated naming', 'Fire-and-forget protocol'],
  },
  {
    id: 'git' as const,
    name: 'Git Protocol',
    description: 'Git Protocol (git://) - Read-only repository browsing via native protocol',
    port: 9418,
    icon: '🔀',
    features: ['Branch & tag listing', 'Pkt-line format', 'Server capabilities'],
  },
  {
    id: 'zookeeper' as const,
    name: 'ZooKeeper',
    description: 'Apache ZooKeeper - Distributed coordination service health checking',
    port: 2181,
    icon: '🐘',
    features: ['Four-letter word commands', 'Health check (ruok/imok)', 'Server stats & monitoring'],
  },
  {
    id: 'amqp' as const,
    name: 'AMQP',
    description: 'AMQP 0-9-1 Protocol - Message broker connectivity (RabbitMQ)',
    port: 5672,
    icon: '🐇',
    features: ['Broker detection', 'Version & platform info', 'Auth mechanism discovery'],
  },
  {
    id: 'cassandra' as const,
    name: 'Cassandra',
    description: 'Apache Cassandra CQL Protocol - Wide-column NoSQL database connectivity',
    port: 9042,
    icon: '👁️',
    features: ['CQL Binary Protocol v4', 'Version & compression detection', 'Auth requirement check'],
  },
  {
    id: 'kafka' as const,
    name: 'Kafka',
    description: 'Apache Kafka Protocol - Distributed event streaming and message broker',
    port: 9092,
    icon: '📊',
    features: ['API version discovery', 'Cluster metadata', 'Topic & partition inspection'],
  },
  {
    id: 'rtsp' as const,
    name: 'RTSP',
    description: 'RTSP Protocol (RFC 2326) - Streaming media server control and IP cameras',
    port: 554,
    icon: '🎥',
    features: ['OPTIONS capability discovery', 'SDP stream description', 'IP camera & surveillance'],
  },
  {
    id: 'rsync' as const,
    name: 'Rsync',
    description: 'Rsync Daemon Protocol - File synchronization and module discovery',
    port: 873,
    icon: '🔄',
    features: ['Version detection', 'Module listing', 'Auth requirement check'],
  },
  {
    id: 'tds' as const,
    name: 'TDS / SQL Server',
    description: 'TDS Protocol (MS-TDS) - Microsoft SQL Server connectivity testing',
    port: 1433,
    icon: '🗃️',
    features: ['Pre-Login handshake', 'Version & encryption detection', 'MARS capability check'],
  },
  {
    id: 'vnc' as const,
    name: 'VNC',
    description: 'VNC / RFB Protocol (RFC 6143) - Remote desktop server discovery and testing',
    port: 5900,
    icon: '🖥️',
    features: ['RFB version detection', 'Security type enumeration', 'Auth requirement check'],
  },
];

import { useTheme } from '../contexts/ThemeContext';

export default function ProtocolSelector({ onSelect }: ProtocolSelectorProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  return (
    <div className="max-w-7xl mx-auto">
      <div className={`text-center mb-12 ${isRetro ? 'retro-box' : ''}`}>
        <h1 className={`text-5xl font-bold mb-4 ${isRetro ? 'retro-text retro-typewriter' : 'text-white'}`}>
          {isRetro ? '╔═══════════════════════╗' : ''}
          {isRetro && <br />}
          {isRetro ? '║ ' : ''}PORT OF CALL{isRetro ? ' ║' : ''}
          {isRetro && <br />}
          {isRetro ? '╚═══════════════════════╝' : ''}
        </h1>
        <p className={`text-xl ${isRetro ? 'retro-text' : 'text-slate-300'}`}>
          {isRetro ? '> ' : ''}TCP PROTOCOL CLIENT TESTING INTERFACE
        </p>
        <p className={`text-sm mt-2 ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
          {isRetro ? '[ ' : ''}POWERED BY CLOUDFLARE WORKERS SOCKETS API{isRetro ? ' ]' : ''}
        </p>
        <div className={`mt-4 inline-block px-4 py-2 ${isRetro ? 'retro-box' : 'bg-blue-600 rounded-full'}`}>
          <span className={`font-semibold text-sm ${isRetro ? 'retro-text' : 'text-white'}`}>
            {isRetro ? '>> ' : ''}{protocols.length} PROTOCOLS AVAILABLE{isRetro ? ' <<' : ''}
          </span>
        </div>
      </div>

      <div className={isRetro ? 'retro-grid' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'}>
        {protocols.map((protocol) => (
          <button
            key={protocol.id}
            onClick={() => onSelect(protocol.id)}
            className={isRetro ? 'retro-card retro-button text-left' : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl p-6 text-left transition-all duration-200 hover:scale-105 hover:shadow-2xl group'}
            aria-label={`Connect to ${protocol.name} on port ${protocol.port}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="text-5xl" aria-hidden="true">{protocol.icon}</div>
              <div className="bg-slate-700 px-3 py-1 rounded-full text-xs text-slate-300">
                Port {protocol.port}
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">
              {protocol.name}
            </h3>

            <p className="text-slate-300 text-sm mb-4">
              {protocol.description}
            </p>

            <div className="space-y-1">
              {protocol.features.map((feature, idx) => (
                <div key={idx} className="flex items-center text-xs text-slate-400">
                  <span className="text-green-400 mr-2" aria-hidden="true">✓</span>
                  {feature}
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-12 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About This Tool</h3>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">
          This interface demonstrates TCP protocol implementations using Cloudflare Workers'
          <code className="bg-slate-700 px-2 py-1 rounded mx-1">connect()</code> API.
          Select a protocol above to establish connections and interact with remote servers.
        </p>
        <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
            <div>
              <p className="text-green-200 text-sm font-semibold mb-1">Live Implementation</p>
              <p className="text-green-100/80 text-xs leading-relaxed">
                All {protocols.length} protocols are fully functional with comprehensive testing.
                Connect to remote servers directly from your browser. All connections
                are proxied through Cloudflare's global network with Smart Placement for low latency.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
