interface ProtocolSelectorProps {
  onSelect: (protocol: 'ftp' | 'ssh') => void;
}

const protocols = [
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
    features: ['Terminal emulation', 'Command execution', 'Encrypted connection'],
  },
];

export default function ProtocolSelector({ onSelect }: ProtocolSelectorProps) {
  return (
    <div className="max-w-6xl mx-auto">
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
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {protocols.map((protocol) => (
          <button
            key={protocol.id}
            onClick={() => onSelect(protocol.id)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl p-8 text-left transition-all duration-200 hover:scale-105 hover:shadow-2xl group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="text-6xl">{protocol.icon}</div>
              <div className="bg-slate-700 px-3 py-1 rounded-full text-sm text-slate-300">
                Port {protocol.port}
              </div>
            </div>

            <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">
              {protocol.name}
            </h3>

            <p className="text-slate-300 mb-4">
              {protocol.description}
            </p>

            <div className="space-y-2">
              {protocol.features.map((feature, idx) => (
                <div key={idx} className="flex items-center text-sm text-slate-400">
                  <span className="text-green-400 mr-2">✓</span>
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
          Select a protocol above to explore the planned interface design.
        </p>
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-xl">⚠️</span>
            <div>
              <p className="text-yellow-200 text-sm font-semibold mb-1">Demo Interface</p>
              <p className="text-yellow-100/80 text-xs leading-relaxed">
                The FTP and SSH client interfaces are UI demos. Full protocol implementations
                (FTP command parsing, SSH2 protocol, authentication) are coming soon. These
                demonstrate the planned user experience once backend handlers are complete.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
