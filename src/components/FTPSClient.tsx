import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface FTPSClientProps {
  onBack: () => void;
}

export default function FTPSClient({ onBack }: FTPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('990');
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
      const response = await fetch('/api/ftps/connect', {
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
        rtt?: number;
        connectTime?: number;
        encrypted?: boolean;
        protocol?: string;
        banner?: {
          code?: number;
          message?: string;
          raw?: string;
        };
        systemType?: string;
        features?: string[];
        tlsFeatures?: {
          authTls?: boolean;
          pbsz?: boolean;
          prot?: boolean;
          utf8?: boolean;
          mlst?: boolean;
          epsv?: boolean;
        };
      };

      if (response.ok && data.success) {
        let resultText = `FTPS Connection Successful!\n`;
        resultText += `${'─'.repeat(40)}\n\n`;
        resultText += `🔒 Encrypted:      Yes (Implicit TLS)\n`;
        resultText += `Host:              ${data.host}:${data.port}\n`;
        resultText += `RTT:               ${data.rtt}ms (TLS connect: ${data.connectTime}ms)\n`;

        if (data.banner) {
          resultText += `\n--- Server Banner ---\n`;
          resultText += `Response Code:     ${data.banner.code}\n`;
          resultText += `Message:           ${data.banner.message}\n`;
        }

        if (data.systemType) {
          resultText += `System Type:       ${data.systemType}\n`;
        }

        if (data.tlsFeatures) {
          resultText += `\n--- TLS Features ---\n`;
          resultText += `  AUTH TLS:  ${data.tlsFeatures.authTls ? 'Yes' : 'No'}\n`;
          resultText += `  PBSZ:      ${data.tlsFeatures.pbsz ? 'Yes' : 'No'}\n`;
          resultText += `  PROT:      ${data.tlsFeatures.prot ? 'Yes' : 'No'}\n`;
          resultText += `  UTF8:      ${data.tlsFeatures.utf8 ? 'Yes' : 'No'}\n`;
          resultText += `  MLST:      ${data.tlsFeatures.mlst ? 'Yes' : 'No'}\n`;
          resultText += `  EPSV:      ${data.tlsFeatures.epsv ? 'Yes' : 'No'}\n`;
        }

        if (data.features && data.features.length > 0) {
          resultText += `\n--- All Features (FEAT) ---\n`;
          for (const feat of data.features) {
            resultText += `  ${feat}\n`;
          }
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
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
    <ProtocolClientLayout title="FTPS Client (FTP over TLS)" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="FTPS Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ftps-host"
            label="FTPS Server"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ftp.example.com"
            required
            helpText="FTPS server hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="ftps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 990 (implicit FTPS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test FTPS connection"
        >
          Connect (Implicit TLS)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About FTPS (FTP over TLS)"
          description="FTPS (RFC 4217) adds TLS/SSL encryption to the FTP protocol, protecting credentials and file transfers from eavesdropping. Implicit FTPS uses port 990 with TLS from the start, while explicit FTPS upgrades a plain connection on port 21 using AUTH TLS. This client tests implicit FTPS connections."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">FTPS / FTP over TLS (RFC 4217)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Port (Implicit):</td>
                  <td className="py-2 px-2 font-mono">990</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Port (Explicit):</td>
                  <td className="py-2 px-2 font-mono">21 (AUTH TLS upgrade)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Transport:</td>
                  <td className="py-2 px-2">TCP + TLS 1.2/1.3</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">USER/PASS over encrypted channel</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">vs SFTP:</td>
                  <td className="py-2 px-2">FTPS = FTP+TLS (port 990), SFTP = SSH (port 22)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">FTPS vs FTP vs SFTP</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Feature</th>
                  <th className="text-left py-2 px-2 text-slate-300">FTP</th>
                  <th className="text-left py-2 px-2 text-slate-300">FTPS</th>
                  <th className="text-left py-2 px-2 text-slate-300">SFTP</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Port</td>
                  <td className="py-2 px-2 font-mono">21</td>
                  <td className="py-2 px-2 font-mono text-green-400">990 / 21</td>
                  <td className="py-2 px-2 font-mono">22</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encryption</td>
                  <td className="py-2 px-2 text-red-400">None</td>
                  <td className="py-2 px-2 text-green-400">TLS/SSL</td>
                  <td className="py-2 px-2 text-green-400">SSH</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol</td>
                  <td className="py-2 px-2">FTP (RFC 959)</td>
                  <td className="py-2 px-2">FTP + TLS (RFC 4217)</td>
                  <td className="py-2 px-2">SSH subsystem</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Firewall</td>
                  <td className="py-2 px-2 text-yellow-400">Complex (2 channels)</td>
                  <td className="py-2 px-2 text-yellow-400">Complex (2 channels + TLS)</td>
                  <td className="py-2 px-2 text-green-400">Simple (1 port)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Connection Modes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Mode</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Method</th>
                  <th className="text-left py-2 px-2 text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Implicit FTPS</td>
                  <td className="py-2 px-2 font-mono text-blue-400">990</td>
                  <td className="py-2 px-2">TLS from the start</td>
                  <td className="py-2 px-2 text-green-400">Tested here</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Explicit FTPS</td>
                  <td className="py-2 px-2 font-mono text-blue-400">21</td>
                  <td className="py-2 px-2">AUTH TLS upgrade</td>
                  <td className="py-2 px-2 text-yellow-400">More common</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-3">
            <p className="text-xs text-green-200">
              <strong>Security Note:</strong> This tool connects via implicit TLS — the entire
              session is encrypted from the first byte. No credentials are sent; only the server
              banner and feature list are retrieved. For explicit FTPS, use the standard FTP
              client on port 21 with AUTH TLS.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
