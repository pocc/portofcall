interface ProtocolSelectorProps {
  onSelect: (protocol: 'echo' | 'ftp' | 'ssh' | 'telnet' | 'smtp' | 'pop3' | 'imap' | 'mysql' | 'postgres' | 'redis' | 'mqtt' | 'ldap' | 'smb') => void;
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
];

export default function ProtocolSelector({ onSelect }: ProtocolSelectorProps) {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-white mb-4">
          Port of Call
        </h1>
        <p className="text-xl text-slate-300">
          TCP Protocol Client Testing Interface
        </p>
        <p className="text-sm text-slate-400 mt-2">
          Powered by Cloudflare Workers Sockets API
        </p>
        <div className="mt-4 inline-block bg-blue-600 px-4 py-2 rounded-full">
          <span className="text-white font-semibold text-sm">{protocols.length} Protocols Available</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {protocols.map((protocol) => (
          <button
            key={protocol.id}
            onClick={() => onSelect(protocol.id)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl p-6 text-left transition-all duration-200 hover:scale-105 hover:shadow-2xl group"
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
