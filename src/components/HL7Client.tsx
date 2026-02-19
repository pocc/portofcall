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

interface HL7ClientProps {
  onBack: () => void;
}

export default function HL7Client({ onBack }: HL7ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2575');
  const [messageType, setMessageType] = useState('ADT^A01');
  const [sendingApp, setSendingApp] = useState('PortOfCall');
  const [sendingFac, setSendingFac] = useState('TestFacility');
  const [receivingApp, setReceivingApp] = useState('');
  const [receivingFac, setReceivingFac] = useState('');
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
      const response = await fetch('/api/hl7/connect', {
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
        message?: string;
        protocol?: string;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `HL7/MLLP Connection Test\n`;
        output += `========================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `Protocol: ${data.protocol}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Status: ${data.message}\n`;
        setResult(output);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/hl7/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          messageType,
          sendingApplication: sendingApp,
          sendingFacility: sendingFac,
          receivingApplication: receivingApp || undefined,
          receivingFacility: receivingFac || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        sent?: {
          messageType: string;
          triggerEvent: string;
          controlId: string;
          version: string;
          segmentCount: number;
          rawMessage: string;
        };
        response?: {
          messageType: string;
          triggerEvent: string;
          controlId: string;
          ackCode?: string;
          ackText?: string;
          rawMessage: string;
        } | null;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `HL7 Message Exchange\n`;
        output += `=====================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;

        if (data.sent) {
          output += `--- Sent Message ---\n`;
          output += `Type: ${data.sent.messageType}^${data.sent.triggerEvent}\n`;
          output += `Control ID: ${data.sent.controlId}\n`;
          output += `Version: ${data.sent.version}\n`;
          output += `Segments: ${data.sent.segmentCount}\n\n`;
          output += `Raw:\n${data.sent.rawMessage}\n\n`;
        }

        if (data.response) {
          output += `--- Response (ACK) ---\n`;
          output += `Type: ${data.response.messageType}`;
          if (data.response.triggerEvent) output += `^${data.response.triggerEvent}`;
          output += `\n`;
          if (data.response.ackCode) {
            const ackDesc = data.response.ackCode === 'AA' ? 'Application Accept' :
              data.response.ackCode === 'AE' ? 'Application Error' :
              data.response.ackCode === 'AR' ? 'Application Reject' : data.response.ackCode;
            output += `ACK Status: ${data.response.ackCode} (${ackDesc})\n`;
          }
          if (data.response.ackText) output += `ACK Text: ${data.response.ackText}\n`;
          output += `\nRaw:\n${data.response.rawMessage}\n`;
        } else {
          output += `(No ACK response received)\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
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
    <ProtocolClientLayout title="HL7 v2.x Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.HL7 || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="hl7-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="hl7.hospital.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="hl7-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2575 (HL7/MLLP)"
            error={errors.port}
          />

          <FormField
            id="hl7-sending-app"
            label="Sending Application"
            type="text"
            value={sendingApp}
            onChange={setSendingApp}
            onKeyDown={handleKeyDown}
            placeholder="PortOfCall"
            optional
          />

          <FormField
            id="hl7-sending-fac"
            label="Sending Facility"
            type="text"
            value={sendingFac}
            onChange={setSendingFac}
            onKeyDown={handleKeyDown}
            placeholder="TestFacility"
            optional
          />

          <FormField
            id="hl7-receiving-app"
            label="Receiving Application"
            type="text"
            value={receivingApp}
            onChange={setReceivingApp}
            onKeyDown={handleKeyDown}
            placeholder="HIS"
            optional
          />

          <FormField
            id="hl7-receiving-fac"
            label="Receiving Facility"
            type="text"
            value={receivingFac}
            onChange={setReceivingFac}
            onKeyDown={handleKeyDown}
            placeholder="Hospital"
            optional
          />
        </div>

        <SectionHeader stepNumber={2} title="Message Type" />

        <div className="mb-6">
          <label htmlFor="hl7-message-type" className="block text-sm font-medium text-slate-300 mb-2">
            HL7 Message Type
          </label>
          <select
            id="hl7-message-type"
            value={messageType}
            onChange={(e) => setMessageType(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="ADT^A01">ADT^A01 - Patient Admission</option>
            <option value="ORU^R01">ORU^R01 - Lab Results (Unsolicited)</option>
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Select a sample HL7 message type to send
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Test MLLP connectivity"
          >
            Test Connection
          </ActionButton>

          <ActionButton
            onClick={handleSend}
            disabled={loading || !host || !port}
            loading={loading}
            variant="secondary"
            ariaLabel="Send HL7 message"
          >
            Send Message
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About HL7 v2.x"
          description="HL7 (Health Level Seven) v2.x is the most widely deployed healthcare data exchange standard. Messages use pipe-delimited segments (MSH, PID, OBR, OBX) wrapped in MLLP framing over TCP. Common message types include ADT (Admission/Discharge/Transfer), ORU (Lab Results), and ORM (Orders). Port 2575 is the standard MLLP port. HL7 v2.x has no built-in encryption — secure transmission requires VPN or TLS wrappers."
        />
      </div>
    </ProtocolClientLayout>
  );
}
