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

interface OpenFlowClientProps {
  onBack: () => void;
}

export default function OpenFlowClient({ onBack }: OpenFlowClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6653');
  const [version, setVersion] = useState('4');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/openflow/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          version: parseInt(version),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        serverVersion?: number;
        serverVersionName?: string;
        negotiatedVersion?: number;
        negotiatedVersionName?: string;
        features?: {
          datapathId?: string;
          nBuffers?: number;
          nTables?: number;
          auxiliaryId?: number;
          capabilities?: string[];
          capabilitiesRaw?: number;
        } | null;
        error_detail?: { type?: string; code?: number } | null;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `OpenFlow Switch Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `Connect Time: ${data.connectTime}ms\n`;

        if (data.serverVersionName) {
          resultText += `\nVersion Negotiation:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Server Version: ${data.serverVersionName} (0x${data.serverVersion?.toString(16).padStart(2, '0')})\n`;
          resultText += `  Negotiated:     ${data.negotiatedVersionName}\n`;
        }

        if (data.features) {
          resultText += `\nSwitch Features:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          if (data.features.datapathId) resultText += `  Datapath ID: ${data.features.datapathId}\n`;
          if (data.features.nBuffers !== undefined) resultText += `  Buffers:     ${data.features.nBuffers}\n`;
          if (data.features.nTables !== undefined) resultText += `  Tables:      ${data.features.nTables}\n`;
          if (data.features.auxiliaryId !== undefined) resultText += `  Auxiliary ID: ${data.features.auxiliaryId}\n`;

          if (data.features.capabilities && data.features.capabilities.length > 0) {
            resultText += `\nCapabilities:\n`;
            resultText += `${'-'.repeat(30)}\n`;
            for (const cap of data.features.capabilities) {
              resultText += `  - ${cap}\n`;
            }
          }

          if (data.features.capabilitiesRaw !== undefined) {
            resultText += `  Raw: 0x${data.features.capabilitiesRaw.toString(16).padStart(8, '0')}\n`;
          }
        }

        if (data.message) {
          resultText += `\n${data.message}\n`;
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

  const handleEcho = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/openflow/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          version: parseInt(version),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        echoRtt?: number;
        negotiatedVersionName?: string;
        echoReceived?: boolean;
        echoXid?: number | null;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `OpenFlow Echo Test\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `Total RTT: ${data.rtt}ms\n`;
        resultText += `Echo RTT: ${data.echoRtt}ms\n`;
        resultText += `Version: ${data.negotiatedVersionName}\n`;
        resultText += `Echo Reply: ${data.echoReceived ? 'Yes' : 'No'}\n`;
        if (data.echoXid !== null) resultText += `Echo XID: ${data.echoXid}\n`;
        if (data.message) resultText += `\n${data.message}\n`;

        setResult(resultText);
      } else {
        setError(data.error || 'Echo failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Echo failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="OpenFlow Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.OpenFlow || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Switch Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <FormField
            id="openflow-host"
            label="Switch / Controller Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="switch.example.com"
            required
            helpText="Hostname or IP of the OpenFlow switch/controller"
            error={errors.host}
          />

          <FormField
            id="openflow-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6653 (legacy: 6633)"
            error={errors.port}
          />

          <div>
            <label htmlFor="openflow-version" className="block text-sm font-medium text-slate-300 mb-2">
              OF Version
            </label>
            <select
              id="openflow-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">1.0 (0x01)</option>
              <option value="2">1.1 (0x02)</option>
              <option value="3">1.2 (0x03)</option>
              <option value="4">1.3 (0x04)</option>
              <option value="5">1.4 (0x05)</option>
              <option value="6">1.5 (0x06)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">Protocol version to advertise</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe OpenFlow switch for version and features"
          >
            Probe Switch
          </ActionButton>

          <button
            onClick={handleEcho}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Send OpenFlow echo request"
          >
            {loading ? 'Sending...' : 'Echo Test'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About OpenFlow"
          description="OpenFlow is the foundational protocol for Software-Defined Networking (SDN), defined by the Open Networking Foundation. It enables an SDN controller to manage switch forwarding tables over TCP port 6653 (legacy 6633). The probe performs a HELLO exchange to negotiate the protocol version, then sends a FEATURES_REQUEST to discover the switch's datapath ID, buffer count, table count, and supported capabilities."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
