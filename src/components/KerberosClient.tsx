import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface KerberosClientProps {
  onBack: () => void;
}

export default function KerberosClient({ onBack }: KerberosClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('88');
  const [realm, setRealm] = useState('EXAMPLE.COM');
  const [principal, setPrincipal] = useState('user');
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
      const response = await fetch('/api/kerberos/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          realm: realm.toUpperCase(),
          principal,
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
        response?: {
          msgType?: number;
          msgTypeName?: string;
          pvno?: number;
          realm?: string;
          errorCode?: number;
          errorName?: string;
          errorText?: string;
          serverTime?: string;
          supportedEtypes?: number[];
          etypeNames?: string[];
        } | null;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to Kerberos KDC!\n\n`;
        resultText += `Host:              ${data.host}:${data.port}\n`;
        resultText += `RTT:               ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;

        if (data.response) {
          resultText += `\n--- KDC Response ---\n`;
          resultText += `Message Type:      ${data.response.msgTypeName} (${data.response.msgType})\n`;
          if (data.response.pvno) {
            resultText += `Protocol Version:  ${data.response.pvno}\n`;
          }
          if (data.response.realm) {
            resultText += `Realm:             ${data.response.realm}\n`;
          }
          if (data.response.serverTime) {
            resultText += `Server Time:       ${data.response.serverTime}\n`;
          }

          if (data.response.errorCode !== undefined) {
            resultText += `\n--- Error Info ---\n`;
            resultText += `Error Code:        ${data.response.errorCode}\n`;
            resultText += `Error Name:        ${data.response.errorName}\n`;
            if (data.response.errorText) {
              resultText += `Error Text:        ${data.response.errorText}\n`;
            }
            if (data.response.errorCode === 25) {
              resultText += `Note:              This is expected — KDC requires pre-authentication\n`;
            }
          }

          if (data.response.etypeNames && data.response.etypeNames.length > 0) {
            resultText += `\n--- Supported Encryption Types ---\n`;
            for (let i = 0; i < data.response.etypeNames.length; i++) {
              const etype = data.response.supportedEtypes?.[i] || '?';
              resultText += `  [${etype}] ${data.response.etypeNames[i]}\n`;
            }
          }
        } else {
          resultText += `\nNo Kerberos response received.\n`;
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
    <ProtocolClientLayout title="Kerberos Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="KDC Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="kerberos-host"
            label="KDC Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="kdc.example.com"
            required
            helpText="Kerberos KDC hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="kerberos-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 88 (standard Kerberos port)"
            error={errors.port}
          />

          <FormField
            id="kerberos-realm"
            label="Realm"
            type="text"
            value={realm}
            onChange={(v) => setRealm(v.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="EXAMPLE.COM"
            helpText="Kerberos realm (uppercase domain name)"
          />

          <FormField
            id="kerberos-principal"
            label="Principal"
            type="text"
            value={principal}
            onChange={setPrincipal}
            onKeyDown={handleKeyDown}
            placeholder="user"
            helpText="Principal name for AS-REQ probe"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Kerberos KDC connection"
        >
          Test Connection (AS-REQ Probe)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About Kerberos Protocol"
          description="Kerberos (RFC 4120) is the standard network authentication protocol, widely used in Active Directory environments. It uses ticket-based authentication with symmetric key cryptography. This client sends an AS-REQ probe to discover the KDC's supported encryption types, realm, and version."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('88');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:88</span>
              <span className="ml-2 text-slate-400">- Local KDC (MIT/Heimdal Kerberos)</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start with Docker:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 88:88 gcavalcante8808/krb5-server</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">Kerberos v5 (ASN.1 DER encoding)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">88</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">RFC:</td>
                  <td className="py-2 px-2">RFC 4120 (Kerberos v5)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">TCP Framing:</td>
                  <td className="py-2 px-2">4-byte big-endian length prefix</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">Ticket-based (TGT + Service Tickets)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Used By:</td>
                  <td className="py-2 px-2">Active Directory, LDAP, SSH, NFS, HTTP (SPNEGO)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Kerberos Message Types</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Type</th>
                  <th className="text-left py-2 px-2 text-slate-300">Name</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">10</td>
                  <td className="py-2 px-2">AS-REQ</td>
                  <td className="py-2 px-2">Request TGT from Authentication Server</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">11</td>
                  <td className="py-2 px-2">AS-REP</td>
                  <td className="py-2 px-2">TGT response with encrypted session key</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">12</td>
                  <td className="py-2 px-2">TGS-REQ</td>
                  <td className="py-2 px-2">Request service ticket using TGT</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">13</td>
                  <td className="py-2 px-2">TGS-REP</td>
                  <td className="py-2 px-2">Service ticket response</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-red-400">30</td>
                  <td className="py-2 px-2">KRB-ERROR</td>
                  <td className="py-2 px-2">Error with realm/etype info</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Encryption Types</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">ID</th>
                  <th className="text-left py-2 px-2 text-slate-300">Name</th>
                  <th className="text-left py-2 px-2 text-slate-300">Security</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">18</td>
                  <td className="py-2 px-2">aes256-cts-hmac-sha1-96</td>
                  <td className="py-2 px-2 text-green-400">Strong</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">17</td>
                  <td className="py-2 px-2">aes128-cts-hmac-sha1-96</td>
                  <td className="py-2 px-2 text-green-400">Strong</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-yellow-400">23</td>
                  <td className="py-2 px-2">rc4-hmac</td>
                  <td className="py-2 px-2 text-yellow-400">Weak (NT Hash)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-red-400">3</td>
                  <td className="py-2 px-2">des-cbc-md5</td>
                  <td className="py-2 px-2 text-red-400">Deprecated</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> This tool sends an unauthenticated AS-REQ probe to detect KDC capabilities.
              It does <strong>not</strong> perform actual authentication or obtain tickets.
              The typical response is KRB-ERROR 25 (PREAUTH_REQUIRED), which reveals supported encryption types.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
