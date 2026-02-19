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

interface StompClientProps {
  onBack: () => void;
}

export default function StompClient({ onBack }: StompClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('61613');
  const [username, setUsername] = useState('guest');
  const [password, setPassword] = useState('guest');
  const [vhost, setVhost] = useState('');
  const [destination, setDestination] = useState('/queue/test');
  const [messageBody, setMessageBody] = useState('Hello, STOMP!');
  const [contentType, setContentType] = useState('text/plain');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'connect' | 'send'>('connect');

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
      const response = await fetch('/api/stomp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          vhost: vhost || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: string;
        server?: string;
        heartBeat?: string;
        sessionId?: string;
        headers?: Record<string, string>;
      };

      if (response.ok && data.success) {
        let resultText = 'STOMP Connection Successful\n';
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Protocol Version: ${data.version}\n`;
        resultText += `Server: ${data.server}\n`;
        resultText += `Heart-beat: ${data.heartBeat}\n`;
        if (data.sessionId) {
          resultText += `Session ID: ${data.sessionId}\n`;
        }
        if (data.headers) {
          resultText += `\nAll Headers:\n`;
          for (const [key, value] of Object.entries(data.headers)) {
            resultText += `  ${key}: ${value}\n`;
          }
        }
        setResult(resultText);
      } else {
        setError(data.error || 'STOMP connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STOMP connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!destination) {
      setError('Destination is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/stomp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          vhost: vhost || undefined,
          destination,
          body: messageBody,
          contentType,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        destination?: string;
        bodyLength?: number;
        receiptReceived?: boolean;
        brokerVersion?: string;
        brokerServer?: string;
      };

      if (response.ok && data.success) {
        let resultText = 'Message Sent Successfully\n';
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Destination: ${data.destination}\n`;
        resultText += `Body Length: ${data.bodyLength} bytes\n`;
        resultText += `Receipt: ${data.receiptReceived ? 'Confirmed' : 'Not received (may still be delivered)'}\n`;
        resultText += `Broker Version: ${data.brokerVersion}\n`;
        resultText += `Broker Server: ${data.brokerServer}\n`;
        setResult(resultText);
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
      if (activeTab === 'connect') {
        handleConnect();
      } else {
        handleSend();
      }
    }
  };

  return (
    <ProtocolClientLayout title="STOMP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.STOMP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Broker Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="stomp-host"
            label="STOMP Broker Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="broker.example.com"
            required
            helpText="RabbitMQ, ActiveMQ, or any STOMP broker"
            error={errors.host}
          />

          <FormField
            id="stomp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 61613 (STOMP), 61614 (STOMP+TLS)"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="stomp-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            optional
            helpText="STOMP login (default: guest)"
          />

          <FormField
            id="stomp-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            optional
            helpText="STOMP passcode"
          />

          <FormField
            id="stomp-vhost"
            label="Virtual Host"
            type="text"
            value={vhost}
            onChange={setVhost}
            onKeyDown={handleKeyDown}
            placeholder="/ (default)"
            optional
            helpText="RabbitMQ vhost (optional)"
          />
        </div>

        {/* Tab selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('connect')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'connect'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Test Connection
          </button>
          <button
            onClick={() => setActiveTab('send')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'send'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Send Message
          </button>
        </div>

        {activeTab === 'connect' ? (
          <>
            <SectionHeader stepNumber={2} title="Connection Test" color="green" />
            <p className="text-xs text-slate-400 mb-4">
              Sends a STOMP CONNECT frame and displays the broker's CONNECTED response.
            </p>
            <ActionButton
              onClick={handleConnect}
              disabled={loading || !host || !port}
              loading={loading}
              ariaLabel="Test STOMP connection"
            >
              Test STOMP Connection
            </ActionButton>
          </>
        ) : (
          <>
            <SectionHeader stepNumber={2} title="Send Message" color="green" />

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <FormField
                id="stomp-destination"
                label="Destination"
                type="text"
                value={destination}
                onChange={setDestination}
                onKeyDown={handleKeyDown}
                placeholder="/queue/test"
                required
                helpText="/queue/name (point-to-point) or /topic/name (pub/sub)"
              />

              <FormField
                id="stomp-content-type"
                label="Content Type"
                type="text"
                value={contentType}
                onChange={setContentType}
                onKeyDown={handleKeyDown}
                placeholder="text/plain"
                optional
                helpText="MIME type (default: text/plain)"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="stomp-body" className="block text-sm font-medium text-slate-300 mb-1">
                Message Body
              </label>
              <textarea
                id="stomp-body"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Enter message content..."
                rows={4}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </div>

            <ActionButton
              onClick={handleSend}
              disabled={loading || !host || !port || !destination}
              loading={loading}
              variant="success"
              ariaLabel="Send STOMP message"
            >
              Send Message
            </ActionButton>
          </>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About STOMP Protocol"
          description="STOMP (Simple Text Oriented Messaging Protocol) is a text-based messaging protocol for communication with message brokers like RabbitMQ, ActiveMQ, and Apollo. It supports queues (point-to-point) and topics (publish/subscribe) with a simple frame format."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Frame Format</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <pre className="text-slate-200 whitespace-pre-wrap">
{`COMMAND
header1:value1
header2:value2

Body\\0`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Client Commands</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              { cmd: 'CONNECT', desc: 'Establish session' },
              { cmd: 'SEND', desc: 'Send message' },
              { cmd: 'SUBSCRIBE', desc: 'Listen to destination' },
              { cmd: 'UNSUBSCRIBE', desc: 'Stop listening' },
              { cmd: 'ACK', desc: 'Acknowledge message' },
              { cmd: 'NACK', desc: 'Negative acknowledge' },
              { cmd: 'BEGIN', desc: 'Start transaction' },
              { cmd: 'DISCONNECT', desc: 'End session' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="bg-slate-700 rounded px-2 py-1">
                <span className="font-mono text-blue-400">{cmd}</span>
                <span className="text-slate-400 ml-1">- {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Destination Types</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex items-start gap-2">
              <span className="font-mono text-green-400 min-w-[120px]">/queue/name</span>
              <span>Point-to-point: one consumer receives each message</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-purple-400 min-w-[120px]">/topic/name</span>
              <span>Publish/subscribe: all subscribers receive messages</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-yellow-400 min-w-[120px]">/exchange/name</span>
              <span>RabbitMQ-specific: route via exchange</span>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Compatible Brokers</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div>RabbitMQ (port 61613)</div>
            <div>Apache ActiveMQ (port 61613)</div>
            <div>Apache Apollo</div>
            <div>Apache Artemis</div>
            <div>HornetQ</div>
            <div>StompConnect (JMS bridge)</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
