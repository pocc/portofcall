import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface X11ClientProps {
  onBack: () => void;
}

export default function X11Client({ onBack }: X11ClientProps) {
  const [host, setHost] = useState('');
  const [display, setDisplay] = useState('0');
  const [authName, setAuthName] = useState('');
  const [authData, setAuthData] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [serverInfo, setServerInfo] = useState<{
    status: string;
    protocolVersion?: string;
    vendor?: string;
    releaseNumber?: number;
    numScreens?: number;
    numFormats?: number;
    imageByteOrder?: string;
    maxRequestLength?: number;
    screens?: Array<{
      screen: number;
      rootWindow: string;
      resolution: string;
      physicalSize: string;
      rootDepth: number;
    }>;
    reason?: string;
    connectTime?: number;
    rtt?: number;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setServerInfo(null);

    try {
      const response = await fetch('/api/x11/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          display: parseInt(display) || 0,
          authName: authName.trim() || undefined,
          authData: authData.trim() || undefined,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean; error?: string; host?: string; port?: number; display?: number;
        status?: string; protocolVersion?: string; vendor?: string; releaseNumber?: number;
        numScreens?: number; numFormats?: number; imageByteOrder?: string; bitmapBitOrder?: string;
        maxRequestLength?: number; minKeycode?: number; maxKeycode?: number;
        screens?: Array<{
          screen: number; rootWindow: string; resolution: string;
          physicalSize: string; rootDepth: number;
        }>;
        reason?: string; message?: string; connectTime?: number; rtt?: number;
      };

      if (response.ok && data.success) {
        if (data.status === 'connected') {
          let text = `X11 Server Connected\n${'='.repeat(50)}\n\n`;
          text += `Server: ${data.host}:${data.port} (display :${data.display})\n`;
          text += `Protocol: X${data.protocolVersion}\n`;
          text += `Vendor: ${data.vendor}\n`;
          if (data.releaseNumber) text += `Release: ${data.releaseNumber}\n`;
          text += `Screens: ${data.numScreens} | Formats: ${data.numFormats}\n`;
          text += `Byte Order: ${data.imageByteOrder}\n`;
          text += `Max Request: ${data.maxRequestLength} (4-byte units)\n`;
          text += `Keycodes: ${data.minKeycode}-${data.maxKeycode}\n`;
          text += `Connect: ${data.connectTime}ms | Total: ${data.rtt}ms\n`;
          setResult(text);
          setServerInfo({
            status: 'connected', protocolVersion: data.protocolVersion, vendor: data.vendor,
            releaseNumber: data.releaseNumber, numScreens: data.numScreens, numFormats: data.numFormats,
            imageByteOrder: data.imageByteOrder, maxRequestLength: data.maxRequestLength,
            screens: data.screens, connectTime: data.connectTime, rtt: data.rtt,
          });
        } else if (data.status === 'rejected') {
          setServerInfo({ status: 'rejected', protocolVersion: data.protocolVersion, reason: data.reason,
            connectTime: data.connectTime, rtt: data.rtt });
          setError(`X11 connection rejected: ${data.reason || 'Unknown reason'}`);
        } else if (data.status === 'authenticate') {
          setServerInfo({ status: 'authenticate', connectTime: data.connectTime, rtt: data.rtt });
          setError(`Server requires authentication: ${data.message || 'Provide MIT-MAGIC-COOKIE-1'}`);
        }
      } else {
        setError(data.error || 'X11 connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'X11 connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleConnect();
  };

  return (
    <ProtocolClientLayout title="X11 Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.X11 || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="X11 Server Configuration" />
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div className="md:col-span-2">
            <FormField id="x11-host" label="X Server Host" type="text" value={host}
              onChange={setHost} onKeyDown={handleKeyDown} placeholder="192.168.1.100"
              required helpText="X Window System server address" error={errors.host} />
          </div>
          <FormField id="x11-display" label="Display Number" type="number" value={display}
            onChange={setDisplay} onKeyDown={handleKeyDown} min="0" max="63"
            helpText="Display :N (port = 6000 + N)" />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="x11-auth-name" label="Auth Protocol" type="text" value={authName}
            onChange={setAuthName} onKeyDown={handleKeyDown} placeholder="MIT-MAGIC-COOKIE-1"
            optional helpText="Authentication protocol name" />
          <FormField id="x11-auth-data" label="Auth Data (hex)" type="text" value={authData}
            onChange={setAuthData} onKeyDown={handleKeyDown} placeholder="a1b2c3d4..."
            optional helpText="Cookie data in hexadecimal" />
        </div>

        <ActionButton onClick={handleConnect} disabled={loading || !host}
          loading={loading} ariaLabel="Test X11 connection">
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={!serverInfo ? error : undefined} />

        {serverInfo && serverInfo.screens && serverInfo.screens.length > 0 && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-slate-600">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Screen Information</h3>
            <div className="space-y-3">
              {serverInfo.screens.map((screen) => (
                <div key={screen.screen} className="bg-slate-800 rounded p-3 border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-400 font-semibold text-sm">Screen {screen.screen}</span>
                    <span className="text-slate-500 font-mono text-xs">{screen.rootWindow}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs text-slate-400">
                    <div><span className="font-semibold text-slate-300">Resolution:</span> {screen.resolution}</div>
                    <div><span className="font-semibold text-slate-300">Physical:</span> {screen.physicalSize}</div>
                    <div><span className="font-semibold text-slate-300">Depth:</span> {screen.rootDepth}-bit</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {serverInfo && serverInfo.status === 'rejected' && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-red-600/50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-400 text-xl" aria-hidden="true">✗</span>
              <h3 className="text-sm font-semibold text-red-300">Connection Rejected</h3>
            </div>
            {serverInfo.protocolVersion && (
              <div className="text-xs text-slate-400">Protocol: X{serverInfo.protocolVersion}</div>
            )}
            <div className="text-xs text-red-300 mt-1">{serverInfo.reason}</div>
          </div>
        )}

        {serverInfo && error && <ResultDisplay error={error} />}

        <HelpSection title="About X11 Protocol"
          description="X11 (X Window System, 1987) provides network-transparent graphical display on Unix/Linux systems. The server manages the display, keyboard, and mouse, while client applications render windows remotely. Port 6000 + display number. Largely superseded by Wayland on modern Linux but still widely used via XWayland and SSH X11 forwarding."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">X11 Architecture</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">X Server</span> - Manages display, input devices</div>
            <div><span className="font-mono text-blue-400">X Client</span> - Application requesting display</div>
            <div><span className="font-mono text-blue-400">Display :N</span> - Port 6000+N (e.g., :0 = 6000)</div>
            <div><span className="font-mono text-blue-400">Root Window</span> - Desktop background window</div>
            <div><span className="font-mono text-blue-400">GC</span> - Graphics Context for drawing</div>
            <div><span className="font-mono text-blue-400">Pixmap</span> - Off-screen drawing surface</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Authentication Methods</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">MIT-MAGIC-COOKIE-1</span> <span className="text-slate-400">- Shared secret (most common)</span></div>
            <div><span className="text-green-400">XDM-AUTHORIZATION-1</span> <span className="text-slate-400">- DES-based (legacy)</span></div>
            <div><span className="text-yellow-400">No auth</span> <span className="text-slate-400">- xhost + (insecure, open access)</span></div>
            <div><span className="text-green-400">SSH X11 Forwarding</span> <span className="text-slate-400">- ssh -X (secure tunnel)</span></div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common X11 Commands</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">xdpyinfo</span> <span className="text-slate-400">- Display server information</span></div>
            <div><span className="text-green-400">xhost +</span> <span className="text-slate-400">- Allow all connections (insecure)</span></div>
            <div><span className="text-green-400">xauth list</span> <span className="text-slate-400">- List auth cookies</span></div>
            <div><span className="text-green-400">DISPLAY=:0 xeyes</span> <span className="text-slate-400">- Test with xeyes app</span></div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
