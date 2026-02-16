import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RDPClientProps {
  onBack: () => void;
}

export default function RDPClient({ onBack }: RDPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3389');
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
      const response = await fetch('/api/rdp/connect', {
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
        tpktVersion?: number;
        x224Type?: string;
        hasNegotiation?: boolean;
        selectedProtocol?: number;
        selectedProtocolNames?: string[];
        negotiationFlags?: number;
        nlaRequired?: boolean;
        failureCode?: number;
        failureMessage?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to RDP server at ${data.host}:${data.port}\n\n`;
        resultText += `TPKT Version: ${data.tpktVersion}\n`;
        resultText += `X.224 Response: ${data.x224Type}\n`;
        resultText += `Connect Time: ${data.connectTime}ms\n`;
        resultText += `Round Trip Time: ${data.rtt}ms\n\n`;

        if (data.hasNegotiation && data.selectedProtocolNames) {
          resultText += `Security Protocol: ${data.selectedProtocolNames.join(' + ')}\n`;
          resultText += `Protocol Flags: 0x${data.negotiationFlags?.toString(16).padStart(2, '0')}\n`;
        } else {
          resultText += `Security Protocol: Standard RDP Security (no negotiation)\n`;
        }

        resultText += `NLA Required: ${data.nlaRequired ? 'Yes' : 'No'}\n`;

        if (data.failureMessage) {
          resultText += `\nNegotiation Failure: ${data.failureMessage}`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to connect to RDP server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to RDP server');
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
    <ProtocolClientLayout title="RDP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="RDP Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rdp-host"
            label="RDP Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="windows-server.example.com"
            required
            helpText="Remote Desktop server address"
            error={errors.host}
          />

          <FormField
            id="rdp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 3389 (RDP)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to RDP server"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RDP Protocol"
          description="Remote Desktop Protocol (RDP) provides remote graphical desktop access to Windows systems. This tool performs the X.224 Connection Request/Confirm handshake to detect server availability, supported security protocols (Standard RDP, TLS, CredSSP/NLA), and negotiation capabilities."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">X.224/TPKT Handshake</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <pre className="text-slate-200">
{`TPKT Header (4 bytes):
  version(1)=3 | reserved(1)=0 | length(2, big-endian)

X.224 Connection Request:
  length(1) | type(1)=0xE0 | dst-ref(2) | src-ref(2) | class(1)

RDP Negotiation Request (8 bytes):
  type(1)=0x01 | flags(1) | length(2)=8 | protocols(4)

Requested Protocols:
  0x00 = Standard RDP    0x01 = TLS
  0x02 = CredSSP/NLA     0x08 = RDSTLS`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">RDP Security Levels</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Level</th>
                  <th className="text-left py-2 px-2 text-slate-300">Encryption</th>
                  <th className="text-left py-2 px-2 text-slate-300">Authentication</th>
                  <th className="text-left py-2 px-2 text-slate-300">Security</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Standard RDP</td>
                  <td className="py-2 px-2">RC4 (proprietary)</td>
                  <td className="py-2 px-2">After connection</td>
                  <td className="py-2 px-2 text-red-400">Weak</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">TLS</td>
                  <td className="py-2 px-2">TLS 1.2+</td>
                  <td className="py-2 px-2">After TLS handshake</td>
                  <td className="py-2 px-2 text-yellow-400">Moderate</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">CredSSP/NLA</td>
                  <td className="py-2 px-2">TLS + NTLM/Kerberos</td>
                  <td className="py-2 px-2">Before connection</td>
                  <td className="py-2 px-2 text-green-400">Strong</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">RDSTLS</td>
                  <td className="py-2 px-2">TLS (redirected)</td>
                  <td className="py-2 px-2">After redirect</td>
                  <td className="py-2 px-2 text-green-400">Strong</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
