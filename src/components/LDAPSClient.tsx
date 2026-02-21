import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface LDAPSClientProps {
  onBack: () => void;
}

export default function LDAPSClient({ onBack }: LDAPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('636');
  const [bindDN, setBindDN] = useState('');
  const [password, setPassword] = useState('');
  const [baseDN, setBaseDN] = useState('');
  const [filter, setFilter] = useState('(objectClass=*)');
  const [connectLoading, setConnectLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setConnectLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ldaps/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          bindDN: bindDN || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tls?: boolean;
        rtt?: number;
        bindDN?: string;
        bindType?: string;
        resultCode?: number;
        serverResponse?: string;
        matchedDN?: string;
        note?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `LDAPS Connection (TLS) Successful`,
          '',
          `Host:        ${data.host}:${data.port}`,
          `TLS:         ${data.tls ? 'Yes (implicit)' : 'No'}`,
          `Bind DN:     ${data.bindDN}`,
          `Bind Type:   ${data.bindType}`,
          `Result Code: ${data.resultCode} (${data.serverResponse})`,
          `RTT:         ${data.rtt}ms`,
        ];

        if (data.matchedDN) {
          lines.push(`Matched DN:  ${data.matchedDN}`);
        }

        lines.push('');
        if (data.note) lines.push(data.note);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || data.serverResponse || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSearch = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!baseDN.trim()) {
      setError('Base DN is required for search');
      return;
    }

    setSearchLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ldaps/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          bindDN: bindDN || undefined,
          password: password || undefined,
          baseDN,
          filter: filter || '(objectClass=*)',
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        baseDN?: string;
        filter?: string;
        entries?: Array<{ dn: string; attributes: Record<string, string[]> }>;
        entryCount?: number;
        resultCode?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `LDAPS Search Results`,
          '',
          `Base DN:  ${data.baseDN}`,
          `Filter:   ${data.filter}`,
          `Entries:  ${data.entryCount}`,
          `RTT:      ${data.rtt}ms`,
        ];

        if (data.entries && data.entries.length > 0) {
          lines.push('');
          for (const entry of data.entries) {
            lines.push(`DN: ${entry.dn}`);
            for (const [attr, values] of Object.entries(entry.attributes)) {
              for (const val of values) {
                lines.push(`  ${attr}: ${val}`);
              }
            }
            lines.push('');
          }
        } else {
          lines.push('', '(no entries returned)');
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !connectLoading && !searchLoading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="LDAPS Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="LDAPS Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ldaps-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ldap.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="ldaps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 636 (LDAP over TLS)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Credentials (Optional)" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="md:col-span-2">
            <FormField
              id="ldaps-binddn"
              label="Bind DN"
              type="text"
              value={bindDN}
              onChange={setBindDN}
              onKeyDown={handleKeyDown}
              placeholder="cn=admin,dc=example,dc=com"
              helpText="Distinguished Name for authentication. Leave empty for anonymous bind."
            />
          </div>

          <div className="md:col-span-2">
            <FormField
              id="ldaps-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              onKeyDown={handleKeyDown}
              placeholder="password"
              helpText="Sent securely via LDAP simple bind over TLS"
            />
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={connectLoading || searchLoading || !host || !port}
          loading={connectLoading}
          ariaLabel="Test LDAPS connection"
        >
          Test Connection (Bind)
        </ActionButton>

        <div className="mt-8 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={3} title="Search" color="green" />

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="md:col-span-2">
              <FormField
                id="ldaps-basedn"
                label="Base DN"
                type="text"
                value={baseDN}
                onChange={setBaseDN}
                placeholder="dc=example,dc=com"
                helpText="Base distinguished name for the search (e.g., dc=example,dc=com)"
              />
            </div>

            <div className="md:col-span-2">
              <FormField
                id="ldaps-filter"
                label="Search Filter"
                type="text"
                value={filter}
                onChange={setFilter}
                placeholder="(objectClass=*)"
                helpText="LDAP search filter (e.g., (cn=admin), (objectClass=person))"
              />
            </div>
          </div>

          <ActionButton
            onClick={handleSearch}
            disabled={connectLoading || searchLoading || !host || !port || !baseDN.trim()}
            loading={searchLoading}
            variant="success"
            ariaLabel="Search LDAPS directory"
          >
            Search Directory
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About LDAPS (LDAP over TLS)"
          description="LDAPS wraps LDAP in TLS from the first byte of the connection, unlike STARTTLS which upgrades a plaintext LDAP connection. Port 636 is the standard LDAPS port. LDAPS is widely used in enterprise environments for secure access to Active Directory, OpenLDAP, and other directory services. All bind credentials and directory data are encrypted."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">LDAP vs LDAPS</h3>
          <div className="grid gap-2 text-sm">
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-yellow-400 font-mono">LDAP (389)</span>
              <span className="text-slate-400 ml-2">- Plaintext connection, optionally upgraded via STARTTLS</span>
            </div>
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-green-400 font-mono">LDAPS (636)</span>
              <span className="text-slate-400 ml-2">- TLS from connection start, recommended for production</span>
            </div>
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-blue-400 font-mono">GC (3268)</span>
              <span className="text-slate-400 ml-2">- Active Directory Global Catalog (plaintext)</span>
            </div>
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-purple-400 font-mono">GCS (3269)</span>
              <span className="text-slate-400 ml-2">- Active Directory Global Catalog over TLS</span>
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
