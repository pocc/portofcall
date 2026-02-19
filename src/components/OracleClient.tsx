import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface OracleClientProps {
  onBack: () => void;
}

export default function OracleClient({ onBack }: OracleClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1521');
  const [serviceName, setServiceName] = useState('');
  const [sid, setSid] = useState('');
  const [connectionMode, setConnectionMode] = useState<'service' | 'sid'>('service');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    serviceName: connectionMode === 'service' ? [validationRules.required('Service name is required')] : [],
    sid: connectionMode === 'sid' ? [validationRules.required('SID is required')] : [],
  });

  const handleConnect = async () => {
    const validationData: Record<string, string> = { host, port };
    if (connectionMode === 'service') {
      validationData.serviceName = serviceName;
    } else {
      validationData.sid = sid;
    }

    const isValid = validateAll(validationData);
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const requestBody: Record<string, unknown> = {
        host,
        port: parseInt(port),
        timeout: 10000,
      };

      if (connectionMode === 'service') {
        requestBody.serviceName = serviceName;
      } else {
        requestBody.sid = sid;
      }

      const response = await fetch('/api/oracle/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        serviceName?: string;
        sid?: string;
        packetType?: string;
        protocol?: {
          version?: string;
          sduSize?: number;
          serviceOptions?: string;
        };
        note?: string;
        refuseCode?: number;
        refuseReason?: string;
      };

      if (response.ok && data.success) {
        let resultText = `${data.message}\n\nHost: ${host}:${port}\n`;

        if (data.serviceName) {
          resultText += `Service Name: ${data.serviceName}\n`;
        }
        if (data.sid) {
          resultText += `SID: ${data.sid}\n`;
        }

        if (data.packetType) {
          resultText += `\nTNS Packet Type: ${data.packetType}\n`;
        }

        if (data.protocol) {
          resultText += `\nProtocol Information:\n`;
          resultText += `  Version: ${data.protocol.version || 'Unknown'}\n`;
          resultText += `  SDU Size: ${data.protocol.sduSize || 'Unknown'} bytes\n`;
          resultText += `  Service Options: ${data.protocol.serviceOptions || 'Unknown'}\n`;
        }

        if (data.note) {
          resultText += `\n${data.note}`;
        }

        setResult(resultText);
      } else {
        let errorText = data.error || 'Connection failed';

        if (data.packetType) {
          errorText += `\n\nTNS Packet Type: ${data.packetType}`;
        }

        if (data.refuseCode !== undefined) {
          errorText += `\nRefuse Code: ${data.refuseCode}`;
        }

        if (data.refuseReason) {
          errorText += `\nReason: ${data.refuseReason}`;
        }

        setError(errorText);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      if (connectionMode === 'service' && serviceName) {
        handleConnect();
      } else if (connectionMode === 'sid' && sid) {
        handleConnect();
      }
    }
  };

  return (
    <ProtocolClientLayout title="Oracle Database (TNS)" onBack={onBack}>
      <ApiExamples examples={apiExamples.Oracle || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="oracle-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="oracle.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="oracle-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            placeholder="1521"
            required
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Database Identification" />

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-3">
            Connection Mode
          </label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                name="connectionMode"
                value="service"
                checked={connectionMode === 'service'}
                onChange={() => setConnectionMode('service')}
                className="mr-2"
              />
              <span className="text-sm text-slate-300">Service Name</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="connectionMode"
                value="sid"
                checked={connectionMode === 'sid'}
                onChange={() => setConnectionMode('sid')}
                className="mr-2"
              />
              <span className="text-sm text-slate-300">SID</span>
            </label>
          </div>
        </div>

        {connectionMode === 'service' ? (
          <FormField
            id="oracle-servicename"
            label="Service Name"
            type="text"
            value={serviceName}
            onChange={setServiceName}
            onKeyDown={handleKeyDown}
            placeholder="ORCL or XEPDB1"
            required
            error={errors.serviceName}
          />
        ) : (
          <FormField
            id="oracle-sid"
            label="SID (System Identifier)"
            type="text"
            value={sid}
            onChange={setSid}
            onKeyDown={handleKeyDown}
            placeholder="ORCL or XE"
            required
            error={errors.sid}
          />
        )}

        <ActionButton
          onClick={handleConnect}
          loading={loading}
          disabled={!host || !port || (connectionMode === 'service' ? !serviceName : !sid)}
        >
          {loading ? 'Connecting...' : 'Test Connection'}
        </ActionButton>

        {(result || error) && (
          <ResultDisplay result={result} error={error} />
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-slate-600">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Oracle TNS Protocol</h3>
        <div className="space-y-3 text-xs text-slate-400">
          <div>
            <h4 className="font-medium text-slate-300 mb-1">What is TNS?</h4>
            <p>
              TNS (Transparent Network Substrate) is Oracle's proprietary networking protocol
              that enables communication between Oracle clients and databases. Port 1521 is
              the default listener port.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-slate-300 mb-1">Service Name vs SID</h4>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>Service Name:</strong> Modern method (Oracle 8i+), supports multiple databases per instance</li>
              <li><strong>SID:</strong> Legacy method, unique system identifier for the instance</li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-slate-300 mb-1">Common Service Names</h4>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>ORCL:</strong> Default Oracle database service</li>
              <li><strong>XEPDB1:</strong> Oracle Express Edition pluggable database</li>
              <li><strong>XE:</strong> Oracle Express Edition</li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-slate-300 mb-1">Testing</h4>
            <p>
              This tool sends a TNS CONNECT packet to test basic connectivity and TNS listener
              availability. It does not perform authentication, but validates that the Oracle
              listener is responding.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-slate-300 mb-1">Response Types</h4>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>ACCEPT:</strong> Connection accepted, listener is available</li>
              <li><strong>REFUSE:</strong> Connection refused (service unavailable, incorrect SID/service name)</li>
              <li><strong>REDIRECT:</strong> Listener redirected to another address</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
