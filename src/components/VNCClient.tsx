import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface VNCClientProps {
  onBack: () => void;
}

export default function VNCClient({ onBack }: VNCClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5900');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

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

    try {
      const response = await fetch('/api/vnc/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        connectTime?: number;
        rtt?: number;
        serverVersion?: string;
        serverMajor?: number;
        serverMinor?: number;
        negotiatedVersion?: string;
        securityTypes?: Array<{ id: number; name: string }>;
        authRequired?: boolean;
        securityError?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to VNC server at ${data.host}:${data.port}\n\n`;
        resultText += `Server Version: ${data.serverVersion}\n`;
        resultText += `Negotiated Version: ${data.negotiatedVersion}\n`;
        resultText += `Connect Time: ${data.connectTime}ms\n`;
        resultText += `Round Trip Time: ${data.rtt}ms\n\n`;

        if (data.securityTypes && data.securityTypes.length > 0) {
          resultText += `Security Types (${data.securityTypes.length}):\n`;
          for (const st of data.securityTypes) {
            resultText += `  [${st.id}] ${st.name}\n`;
          }
        }

        resultText += `\nAuthentication Required: ${data.authRequired ? 'Yes' : 'No'}`;

        if (data.securityError) {
          resultText += `\n\nServer Error: ${data.securityError}`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to connect to VNC server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to VNC server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="VNC (RFB) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="VNC Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="vnc-host"
            label="VNC Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="vnc.example.com"
            required
            helpText="VNC server address (port 5900+)"
            error={errors.host}
          />

          <FormField
            id="vnc-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5900 (display :0), 5901 (display :1)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to VNC server"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About VNC / RFB Protocol"
          description="VNC (Virtual Network Computing) uses the Remote Framebuffer (RFB) protocol (RFC 6143) for remote desktop access. This tool performs the RFB handshake to detect the server version, supported security types, and authentication requirements without establishing a full desktop session."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">RFB Handshake</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <pre className="text-slate-200">
{`Version Exchange:
  Server → Client: "RFB 003.008\\n" (12 bytes)
  Client → Server: "RFB 003.008\\n" (12 bytes)

Security Negotiation (RFB 3.7+):
  Server → Client: count(1) + types(count bytes)
  Client → Server: selected_type(1)

Security Types:
  1 = None (no authentication)
  2 = VNC Authentication (DES challenge)
  18 = TLS    19 = VeNCrypt`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">VNC Display Numbers</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Display</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">:0</td>
                  <td className="py-2 px-2 font-mono">5900</td>
                  <td className="py-2 px-2">Primary display (most common)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">:1</td>
                  <td className="py-2 px-2 font-mono">5901</td>
                  <td className="py-2 px-2">Secondary display</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">:2</td>
                  <td className="py-2 px-2 font-mono">5902</td>
                  <td className="py-2 px-2">Tertiary display</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">HTTP</td>
                  <td className="py-2 px-2 font-mono">5800</td>
                  <td className="py-2 px-2">VNC Java applet (legacy)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Remote Desktop Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Encryption</th>
                  <th className="text-left py-2 px-2 text-slate-300">Platform</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">VNC/RFB</td>
                  <td className="py-2 px-2 font-mono">5900</td>
                  <td className="py-2 px-2">Optional (VeNCrypt/TLS)</td>
                  <td className="py-2 px-2">Cross-platform</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">RDP</td>
                  <td className="py-2 px-2 font-mono">3389</td>
                  <td className="py-2 px-2">TLS (built-in)</td>
                  <td className="py-2 px-2">Windows</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">X11</td>
                  <td className="py-2 px-2 font-mono">6000</td>
                  <td className="py-2 px-2">Optional (SSH tunnel)</td>
                  <td className="py-2 px-2">Unix/Linux</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">SSH + X11</td>
                  <td className="py-2 px-2 font-mono">22</td>
                  <td className="py-2 px-2">Always (SSH)</td>
                  <td className="py-2 px-2">Cross-platform</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
