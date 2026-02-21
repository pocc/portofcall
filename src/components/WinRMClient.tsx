import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface WinRMClientProps {
  onBack: () => void;
}

interface IdentifyInfo {
  rtt?: number;
  server?: string;
  isWinRM?: boolean;
  productVendor?: string;
  productVersion?: string;
  protocolVersion?: string;
  securityProfiles?: string[];
  authMethods?: string[];
  statusCode?: number;
}

export default function WinRMClient({ onBack }: WinRMClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5985');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [identifyInfo, setIdentifyInfo] = useState<IdentifyInfo | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleIdentify = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setIdentifyInfo(null);

    try {
      const response = await fetch('/api/winrm/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        server?: string;
        isWinRM?: boolean;
        productVendor?: string;
        productVersion?: string;
        protocolVersion?: string;
        securityProfiles?: string[];
        authMethods?: string[];
        statusCode?: number;
      };

      if (response.ok && data.success) {
        const info: IdentifyInfo = {
          rtt: data.rtt,
          server: data.server,
          isWinRM: data.isWinRM,
          productVendor: data.productVendor,
          productVersion: data.productVersion,
          protocolVersion: data.protocolVersion,
          securityProfiles: data.securityProfiles,
          authMethods: data.authMethods,
          statusCode: data.statusCode,
        };
        setIdentifyInfo(info);

        if (data.isWinRM) {
          if (data.productVendor) {
            setResult(`WinRM detected: ${data.productVendor} ${data.productVersion || ''}`);
          } else if (data.authMethods && data.authMethods.length > 0) {
            setResult(`WinRM detected (requires auth): ${data.authMethods.join(', ')}`);
          } else {
            setResult('WinRM endpoint detected');
          }
        } else {
          setResult('Connection succeeded but WinRM not detected');
        }
      } else {
        setError(data.error || 'Failed to connect to WinRM server');
        if (data.rtt) {
          setIdentifyInfo({
            rtt: data.rtt,
            server: data.server,
            isWinRM: data.isWinRM,
            statusCode: data.statusCode,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to WinRM server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleIdentify();
    }
  };

  return (
    <ProtocolClientLayout title="WinRM (Windows Remote Management) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="WinRM Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="winrm-host"
            label="WinRM Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="windows-server.example.com"
            required
            helpText="Windows host with WinRM enabled"
            error={errors.host}
          />

          <FormField
            id="winrm-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5985 (HTTP), 5986 (HTTPS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleIdentify}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Identify WinRM server"
        >
          Identify Server
        </ActionButton>

        {identifyInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Server Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {identifyInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{identifyInfo.rtt}ms</div>
                </div>
              )}
              {identifyInfo.isWinRM !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">WinRM Server</div>
                  <div className={`text-lg font-bold ${identifyInfo.isWinRM ? 'text-green-400' : 'text-orange-400'}`}>
                    {identifyInfo.isWinRM ? 'Yes' : 'No'}
                  </div>
                </div>
              )}
              {identifyInfo.statusCode !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">HTTP Status</div>
                  <div className={`text-lg font-bold ${identifyInfo.statusCode === 200 ? 'text-green-400' : identifyInfo.statusCode === 401 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {identifyInfo.statusCode}
                  </div>
                </div>
              )}
              {identifyInfo.protocolVersion && (
                <div>
                  <div className="text-xs text-slate-400">Protocol Version</div>
                  <div className="text-lg font-bold text-blue-400">{identifyInfo.protocolVersion}</div>
                </div>
              )}
            </div>

            {identifyInfo.productVendor && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-slate-400">Product Vendor</div>
                    <div className="text-sm font-mono text-slate-300">{identifyInfo.productVendor}</div>
                  </div>
                  {identifyInfo.productVersion && (
                    <div>
                      <div className="text-xs text-slate-400">Product Version</div>
                      <div className="text-sm font-mono text-slate-300">{identifyInfo.productVersion}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {identifyInfo.server && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400">HTTP Server</div>
                <div className="text-sm font-mono text-slate-300">{identifyInfo.server}</div>
              </div>
            )}

            {identifyInfo.authMethods && identifyInfo.authMethods.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400 mb-2">Authentication Methods</div>
                <div className="flex flex-wrap gap-2">
                  {identifyInfo.authMethods.map((method, idx) => (
                    <span key={idx} className="bg-slate-800 text-blue-400 px-3 py-1 rounded-full text-xs font-mono">
                      {method}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {identifyInfo.securityProfiles && identifyInfo.securityProfiles.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400 mb-2">Security Profiles</div>
                <div className="space-y-1">
                  {identifyInfo.securityProfiles.map((profile, idx) => (
                    <div key={idx} className="text-xs font-mono text-slate-300 break-all">{profile}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About WinRM Protocol"
          description="WinRM (Windows Remote Management) is Microsoft's implementation of the WS-Management (DMTF) standard. It enables remote management of Windows systems over HTTP/HTTPS using SOAP XML envelopes. WinRM is used by PowerShell Remoting, Ansible (for Windows targets), and enterprise management tools. The WSMAN Identify operation is an anonymous probe that reveals server vendor, version, and protocol capabilities without authentication."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">HTTP/1.1 + SOAP XML (WS-Management)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Ports:</td>
                  <td className="py-2 px-2">5985 (HTTP), 5986 (HTTPS)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Identify Endpoint:</td>
                  <td className="py-2 px-2 font-mono">/wsman-anon/identify</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Management Endpoint:</td>
                  <td className="py-2 px-2 font-mono">/wsman</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">Basic, Negotiate (NTLM/Kerberos), CredSSP</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Standards:</td>
                  <td className="py-2 px-2">DMTF DSP0226 (WS-Management), MS-WSMV</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Architecture</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`┌─────────────┐    HTTP POST     ┌─────────────┐
│   Client    │ ── SOAP XML ──> │   WinRM     │
│ (PowerShell │                  │   Service   │
│  / Ansible) │                  │  (:5985)    │
└─────────────┘                  └──────┬──────┘
                                        │
                    ┌───────────────────┤
                    │                   │
               ┌────▼────┐        ┌────▼────┐
               │ Identify│        │  Shell  │
               │ (anon)  │        │ (auth)  │
               │ /wsman- │        │ /wsman  │
               │  anon/  │        │         │
               └─────────┘        └─────────┘
                    │                   │
               ┌────▼────┐        ┌────▼────┐
               │ Vendor  │        │ cmd.exe │
               │ Version │        │ PS      │
               │ Proto   │        │ WMI     │
               └─────────┘        └─────────┘`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('localhost'); setPort('5985'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:5985</span>
              <span className="ml-2 text-slate-400">- Local WinRM (HTTP)</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('5986'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:5986</span>
              <span className="ml-2 text-slate-400">- Local WinRM (HTTPS)</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
