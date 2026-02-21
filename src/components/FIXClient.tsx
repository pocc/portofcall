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

interface FIXClientProps {
  onBack: () => void;
}

export default function FIXClient({ onBack }: FIXClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9878');
  const [senderCompID, setSenderCompID] = useState('PORTOFCALL');
  const [targetCompID, setTargetCompID] = useState('TARGET');
  const [fixVersion, setFixVersion] = useState('FIX.4.4');
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
      const response = await fetch('/api/fix/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          senderCompID,
          targetCompID,
          fixVersion,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        fixVersion?: string;
        msgType?: string;
        msgTypeRaw?: string;
        senderCompID?: string;
        targetCompID?: string;
        heartBtInt?: number;
        rejectText?: string;
        isLogonAccepted?: boolean;
        isLogout?: boolean;
        isReject?: boolean;
        fields?: string[];
        rawResponse?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `FIX Engine Probe\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `FIX Version: ${data.fixVersion}\n\n`;

        if (data.isLogonAccepted) {
          resultText += `Status: LOGON ACCEPTED\n`;
        } else if (data.isLogout) {
          resultText += `Status: LOGOUT (${data.rejectText || 'session ended'})\n`;
        } else if (data.isReject) {
          resultText += `Status: REJECTED (${data.rejectText || 'unknown reason'})\n`;
        } else {
          resultText += `Status: ${data.msgType || 'Unknown'}\n`;
        }

        if (data.senderCompID) resultText += `Engine CompID: ${data.senderCompID}\n`;
        if (data.targetCompID) resultText += `Target CompID: ${data.targetCompID}\n`;
        if (data.heartBtInt) resultText += `Heartbeat Interval: ${data.heartBtInt}s\n`;

        if (data.fields && data.fields.length > 0) {
          resultText += `\nResponse Fields:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          for (const field of data.fields) {
            resultText += `${field}\n`;
          }
        }

        if (data.rawResponse) {
          resultText += `\nRaw Response:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += data.rawResponse;
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

  const handleHeartbeat = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/fix/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          senderCompID,
          targetCompID,
          fixVersion,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        fixVersion?: string;
        logonAccepted?: boolean;
        heartbeatReceived?: boolean;
        testReqID?: string;
        echoedTestReqID?: string;
        responseMsgType?: string;
        rawResponse?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `FIX Heartbeat Test\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `FIX Version: ${data.fixVersion}\n\n`;
        resultText += `Logon: ${data.logonAccepted ? 'Accepted' : 'Failed'}\n`;
        resultText += `Heartbeat: ${data.heartbeatReceived ? 'Received' : 'Not received'}\n`;
        if (data.testReqID) resultText += `TestReqID Sent: ${data.testReqID}\n`;
        if (data.echoedTestReqID) resultText += `TestReqID Echoed: ${data.echoedTestReqID}\n`;
        if (data.responseMsgType) resultText += `Response Type: ${data.responseMsgType}\n`;

        if (data.rawResponse) {
          resultText += `\nRaw Response:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += data.rawResponse;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Heartbeat test failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Heartbeat test failed');
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
    <ProtocolClientLayout title="FIX Protocol Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.FIX || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="FIX Engine Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="fix-host"
            label="FIX Engine Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="fix-engine.example.com"
            required
            helpText="Hostname or IP of the FIX engine/gateway"
            error={errors.host}
          />

          <FormField
            id="fix-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Common ports: 9878, 9010, 4500"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="fix-sender"
            label="SenderCompID"
            type="text"
            value={senderCompID}
            onChange={setSenderCompID}
            placeholder="PORTOFCALL"
            helpText="Your FIX CompID identifier"
          />

          <FormField
            id="fix-target"
            label="TargetCompID"
            type="text"
            value={targetCompID}
            onChange={setTargetCompID}
            placeholder="TARGET"
            helpText="Remote engine's CompID"
          />

          <div>
            <label htmlFor="fix-version" className="block text-sm font-medium text-slate-300 mb-1">
              FIX Version
            </label>
            <select
              id="fix-version"
              value={fixVersion}
              onChange={(e) => setFixVersion(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="FIX.4.0">FIX.4.0</option>
              <option value="FIX.4.1">FIX.4.1</option>
              <option value="FIX.4.2">FIX.4.2</option>
              <option value="FIX.4.3">FIX.4.3</option>
              <option value="FIX.4.4">FIX.4.4</option>
              <option value="FIXT.1.1">FIXT.1.1 (FIX5.0+)</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">Protocol version to negotiate</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe FIX engine with Logon message"
          >
            Probe (Logon)
          </ActionButton>

          <button
            onClick={handleHeartbeat}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Test FIX heartbeat"
          >
            {loading ? 'Testing...' : 'Heartbeat Test'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About FIX Protocol"
          description="FIX (Financial Information eXchange) is the standard TCP protocol for electronic trading. Used by exchanges, brokers, and trading firms worldwide. Messages use tag=value pairs with SOH (0x01) delimiters. Key message types: Logon (A), Heartbeat (0), Logout (5), NewOrderSingle (D), ExecutionReport (8). The probe sends a Logon and reads the engine's response to detect version, CompIDs, and capabilities."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
