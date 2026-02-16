import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface AFPClientProps {
  onBack: () => void;
}

export default function AFPClient({ onBack }: AFPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('548');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [serverInfo, setServerInfo] = useState<{
    status: string;
    serverName?: string;
    machineType?: string;
    afpVersions?: string[];
    uams?: string[];
    flags?: number;
    flagDescriptions?: string[];
    connectTime?: number;
    rtt?: number;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setServerInfo(null);

    try {
      const response = await fetch('/api/afp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        status?: string;
        serverName?: string;
        machineType?: string;
        afpVersions?: string[];
        uams?: string[];
        flags?: number;
        flagDescriptions?: string[];
        connectTime?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let text = `AFP Server Status\n${'='.repeat(50)}\n\n`;
        text += `Server: ${data.host}:${data.port}\n`;
        if (data.serverName) text += `Name: ${data.serverName}\n`;
        if (data.machineType) text += `Machine: ${data.machineType}\n`;
        text += `Status: ${data.status}\n`;
        text += `Connect: ${data.connectTime}ms | Total: ${data.rtt}ms\n`;

        if (data.afpVersions && data.afpVersions.length > 0) {
          text += `\nAFP Versions: ${data.afpVersions.join(', ')}\n`;
        }
        if (data.uams && data.uams.length > 0) {
          text += `UAMs: ${data.uams.join(', ')}\n`;
        }
        if (data.flagDescriptions && data.flagDescriptions.length > 0) {
          text += `Flags: ${data.flagDescriptions.join(', ')}\n`;
        }

        setResult(text);
        setServerInfo({
          status: data.status || 'unknown',
          serverName: data.serverName,
          machineType: data.machineType,
          afpVersions: data.afpVersions,
          uams: data.uams,
          flags: data.flags,
          flagDescriptions: data.flagDescriptions,
          connectTime: data.connectTime,
          rtt: data.rtt,
        });
      } else {
        setError(data.error || 'AFP connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AFP connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) handleConnect();
  };

  return (
    <ProtocolClientLayout title="AFP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="AFP Server Configuration" />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="afp-host" label="AFP Server Host" type="text" value={host}
            onChange={setHost} onKeyDown={handleKeyDown} placeholder="fileserver.local"
            required helpText="AFP/Netatalk server address" error={errors.host} />
          <FormField id="afp-port" label="Port" type="number" value={port}
            onChange={setPort} onKeyDown={handleKeyDown} min="1" max="65535"
            helpText="Default: 548 (AFP over TCP)" error={errors.port} />
        </div>

        <ActionButton onClick={handleConnect} disabled={loading || !host || !port}
          loading={loading} ariaLabel="Probe AFP server">
          Get Server Info
        </ActionButton>

        <ResultDisplay result={result} error={!serverInfo ? error : undefined} />

        {serverInfo && serverInfo.status === 'connected' && (
          <div className="mt-4 space-y-4">
            {/* Server Identity */}
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
                <h3 className="text-sm font-semibold text-slate-300">Server Identity</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
                {serverInfo.serverName && (
                  <div><span className="font-semibold text-slate-300">Name:</span> {serverInfo.serverName}</div>
                )}
                {serverInfo.machineType && (
                  <div><span className="font-semibold text-slate-300">Machine:</span> {serverInfo.machineType}</div>
                )}
                <div>
                  <span className="font-semibold text-slate-300">Connect:</span> {serverInfo.connectTime}ms
                </div>
                <div>
                  <span className="font-semibold text-slate-300">Total RTT:</span> {serverInfo.rtt}ms
                </div>
              </div>
            </div>

            {/* AFP Versions */}
            {serverInfo.afpVersions && serverInfo.afpVersions.length > 0 && (
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">AFP Versions Supported</h3>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.afpVersions.map((version, idx) => (
                    <span key={idx} className="bg-blue-900/40 text-blue-300 px-2 py-1 rounded text-xs font-mono">
                      {version}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Authentication Methods */}
            {serverInfo.uams && serverInfo.uams.length > 0 && (
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">Authentication Methods (UAMs)</h3>
                <div className="space-y-1">
                  {serverInfo.uams.map((uam, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="text-green-400" aria-hidden="true">✓</span>
                      <span className="text-slate-300 font-mono">{uam}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Server Flags */}
            {serverInfo.flagDescriptions && serverInfo.flagDescriptions.length > 0 && (
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">
                  Server Capabilities
                  {serverInfo.flags !== undefined && (
                    <span className="text-slate-500 font-mono ml-2">(0x{serverInfo.flags.toString(16).padStart(4, '0')})</span>
                  )}
                </h3>
                <div className="grid grid-cols-2 gap-1">
                  {serverInfo.flagDescriptions.map((flag, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="text-yellow-400" aria-hidden="true">●</span>
                      <span className="text-slate-400">{flag}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {serverInfo && error && <ResultDisplay error={error} />}

        <HelpSection title="About AFP Protocol"
          description="AFP (Apple Filing Protocol) is Apple's file sharing protocol for macOS and classic Mac OS. It runs over DSI (Data Stream Interface) on TCP port 548. While supported in modern macOS, Apple now recommends SMB for new deployments. AFP provides file sharing, Time Machine backups, resource forks, and Spotlight search."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">DSI Connection Flow</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">1. DSIGetStatus</span> <span className="text-slate-400">→ Server info (no auth needed)</span></div>
            <div><span className="text-green-400">2. DSIOpenSession</span> <span className="text-slate-400">→ Establish DSI session</span></div>
            <div><span className="text-green-400">3. FPLogin</span> <span className="text-slate-400">→ Authenticate (UAM negotiation)</span></div>
            <div><span className="text-green-400">4. FPOpenVol</span> <span className="text-slate-400">→ Mount shared volume</span></div>
            <div><span className="text-yellow-400">5. FP*</span> <span className="text-slate-400">→ File operations (read/write/enumerate)</span></div>
            <div><span className="text-red-400">6. DSICloseSession</span> <span className="text-slate-400">→ Disconnect</span></div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common UAMs (Authentication)</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">No User Authent</span> - Guest access</div>
            <div><span className="font-mono text-blue-400">Cleartxt Passwrd</span> - Plain text (insecure)</div>
            <div><span className="font-mono text-blue-400">Randnum Exchange</span> - Random number challenge</div>
            <div><span className="font-mono text-blue-400">2-Way Randnum</span> - Mutual authentication</div>
            <div><span className="font-mono text-blue-400">DHCAST128</span> - Diffie-Hellman CAST-128</div>
            <div><span className="font-mono text-blue-400">DHX2</span> - Enhanced Diffie-Hellman</div>
            <div><span className="font-mono text-blue-400">Client Krb v2</span> - Kerberos v5</div>
            <div><span className="font-mono text-blue-400">Recon1</span> - Reconnect token</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">AFP Version History</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">AFP 3.4</span> <span className="text-slate-400">- macOS 10.7+ (latest)</span></div>
            <div><span className="text-green-400">AFP 3.3</span> <span className="text-slate-400">- macOS 10.5+</span></div>
            <div><span className="text-green-400">AFP 3.2</span> <span className="text-slate-400">- macOS 10.4+</span></div>
            <div><span className="text-green-400">AFP 3.1</span> <span className="text-slate-400">- macOS 10.2+</span></div>
            <div><span className="text-yellow-400">AFP 2.2</span> <span className="text-slate-400">- Mac OS 9 (legacy)</span></div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">AFP vs SMB</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">AFP</span> - Apple-native, resource forks, Spotlight</div>
            <div><span className="font-mono text-blue-400">SMB</span> - Cross-platform, default since macOS 10.9</div>
            <div><span className="font-mono text-blue-400">Time Machine</span> - AFP preferred (legacy)</div>
            <div><span className="font-mono text-blue-400">Netatalk</span> - Open-source AFP server for Linux</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
