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

interface ActiveMQClientProps {
  onBack: () => void;
}

type Tab = 'probe' | 'connect' | 'send' | 'receive' | 'admin';

export default function ActiveMQClient({ onBack }: ActiveMQClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('probe');

  // ── Shared connection fields ──────────────────────────────────────────────
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // ── Probe ─────────────────────────────────────────────────────────────────
  const [probePort, setProbePort] = useState('61616');
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeResult, setProbeResult] = useState('');
  const [probeError, setProbeError] = useState('');

  // ── Connect ───────────────────────────────────────────────────────────────
  const [connectPort, setConnectPort] = useState('61613');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectResult, setConnectResult] = useState('');
  const [connectError, setConnectError] = useState('');

  // ── Send ──────────────────────────────────────────────────────────────────
  const [sendPort, setSendPort] = useState('61613');
  const [destination, setDestination] = useState('/queue/test');
  const [messageBody, setMessageBody] = useState('Hello from Port of Call!');
  const [persistent, setPersistent] = useState(true);
  const [priority, setPriority] = useState('4');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [sendError, setSendError] = useState('');

  // ── Receive ───────────────────────────────────────────────────────────────
  const [receivePort, setReceivePort] = useState('61613');
  const [receiveDest, setReceiveDest] = useState('/queue/test');
  const [maxMessages, setMaxMessages] = useState('10');
  const [selector, setSelector] = useState('');
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [receiveResult, setReceiveResult] = useState('');
  const [receiveError, setReceiveError] = useState('');

  // ── Admin ─────────────────────────────────────────────────────────────────
  const [adminPort, setAdminPort] = useState('8161');
  const [adminPassword, setAdminPassword] = useState('admin');
  const [brokerName, setBrokerName] = useState('localhost');
  const [adminAction, setAdminAction] = useState<'brokerInfo' | 'listQueues' | 'listTopics' | 'queueStats'>('brokerInfo');
  const [queueName, setQueueName] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminResult, setAdminResult] = useState('');
  const [adminError, setAdminError] = useState('');

  // ── Validation ────────────────────────────────────────────────────────────
  const { errors: probeErrors, validateAll: validateProbe } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });
  const { errors: connectErrors, validateAll: validateConnect } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });
  const { errors: sendErrors, validateAll: validateSend } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    destination: [validationRules.required('Destination is required')],
  });
  const { errors: receiveErrors, validateAll: validateReceive } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    destination: [validationRules.required('Destination is required')],
  });
  const { errors: adminErrors, validateAll: validateAdmin } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleProbe = async () => {
    if (!validateProbe({ host, port: probePort })) return;
    setProbeLoading(true); setProbeError(''); setProbeResult('');
    try {
      const res = await fetch('/api/activemq/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(probePort), timeout: 10000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string; tcpLatency?: number;
        isActiveMQ?: boolean; openWireVersion?: number; brokerName?: string;
        stackTraceEnabled?: boolean; cacheEnabled?: boolean; tightEncodingEnabled?: boolean;
        hasBrokerInfo?: boolean; receivedBytes?: number; note?: string;
      };
      if (data.success) {
        const lines = [
          `OpenWire Probe — ${host}:${probePort}`,
          '='.repeat(50),
          `TCP Latency:      ${data.tcpLatency}ms`,
          `ActiveMQ:         ${data.isActiveMQ ? '✓ Yes — OpenWire broker detected' : '✗ Not detected'}`,
        ];
        if (data.openWireVersion !== undefined) lines.push(`OpenWire Version: ${data.openWireVersion}`);
        if (data.brokerName) lines.push(`Broker Name:      ${data.brokerName}`);
        if (data.isActiveMQ) {
          lines.push('', '--- Broker Capabilities ---');
          if (data.stackTraceEnabled !== undefined) lines.push(`  Stack Traces:   ${data.stackTraceEnabled ? 'enabled' : 'disabled'}`);
          if (data.cacheEnabled !== undefined)      lines.push(`  Cache:          ${data.cacheEnabled ? 'enabled' : 'disabled'}`);
          if (data.tightEncodingEnabled !== undefined) lines.push(`  Tight Encoding: ${data.tightEncodingEnabled ? 'enabled' : 'disabled'}`);
          lines.push(`  BrokerInfo:     ${data.hasBrokerInfo ? '✓ received' : 'not received'}`);
        }
        lines.push(`Bytes Received:   ${data.receivedBytes ?? 0}`);
        if (data.note) lines.push('', data.note);
        setProbeResult(lines.join('\n'));
      } else {
        setProbeError(data.error ?? 'Probe failed');
      }
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setProbeLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!validateConnect({ host, port: connectPort })) return;
    setConnectLoading(true); setConnectError(''); setConnectResult('');
    try {
      const res = await fetch('/api/activemq/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(connectPort),
          username: username || undefined,
          password: password || undefined,
          timeout: 10000,
        }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string; latency?: number;
        stompVersion?: string; server?: string; heartBeat?: string; session?: string;
      };
      if (data.success) {
        const lines = [
          `STOMP Connect — ${host}:${connectPort}`,
          '='.repeat(50),
          `Status:        Connected ✓`,
          `Latency:       ${data.latency}ms`,
          `STOMP Version: ${data.stompVersion}`,
          `Server:        ${data.server}`,
          `Heart-Beat:    ${data.heartBeat}`,
        ];
        if (data.session) lines.push(`Session:       ${data.session}`);
        setConnectResult(lines.join('\n'));
      } else {
        setConnectError(data.error ?? 'Connect failed');
      }
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSend = async () => {
    if (!validateSend({ host, port: sendPort, destination })) return;
    setSendLoading(true); setSendError(''); setSendResult('');
    try {
      const res = await fetch('/api/activemq/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(sendPort),
          username: username || undefined,
          password: password || undefined,
          destination,
          body: messageBody,
          persistent,
          priority: parseInt(priority),
          timeout: 15000,
        }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string; elapsed?: number;
        destination?: string; bodyLength?: number; receiptReceived?: boolean;
        persistent?: boolean; priority?: number; server?: string;
      };
      if (data.success) {
        const lines = [
          `Message Sent ✓`,
          '='.repeat(50),
          `Destination:    ${data.destination}`,
          `Body Length:    ${data.bodyLength} bytes`,
          `Receipt:        ${data.receiptReceived ? '✓ confirmed by broker' : 'not confirmed (may still have been sent)'}`,
          `Persistent:     ${data.persistent ? 'yes (survives broker restart)' : 'no'}`,
          `Priority:       ${data.priority}/9`,
          `Server:         ${data.server}`,
          `Elapsed:        ${data.elapsed}ms`,
        ];
        setSendResult(lines.join('\n'));
      } else {
        setSendError(data.error ?? 'Send failed');
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSendLoading(false);
    }
  };

  const handleReceive = async () => {
    if (!validateReceive({ host, port: receivePort, destination: receiveDest })) return;
    setReceiveLoading(true); setReceiveError(''); setReceiveResult('');
    try {
      const res = await fetch('/api/activemq/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(receivePort),
          username: username || undefined,
          password: password || undefined,
          destination: receiveDest,
          maxMessages: parseInt(maxMessages),
          selector: selector || undefined,
          timeout: 15000,
        }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string; elapsed?: number;
        destination?: string; messageCount?: number; server?: string;
        messages?: Array<{
          messageId: string; destination: string; contentType: string;
          body: string; headers: Record<string, string>;
        }>;
      };
      if (data.success) {
        const lines = [
          `Subscribe — ${data.destination}`,
          '='.repeat(50),
          `Messages received: ${data.messageCount}`,
          `Server:            ${data.server}`,
          `Elapsed:           ${data.elapsed}ms`,
        ];
        if (data.messages && data.messages.length > 0) {
          lines.push('');
          data.messages.forEach((msg, i) => {
            lines.push(`── Message ${i + 1} ──────────────────────────────────`);
            lines.push(`  ID:           ${msg.messageId}`);
            lines.push(`  Destination:  ${msg.destination}`);
            lines.push(`  Content-Type: ${msg.contentType}`);
            lines.push(`  Body:         ${msg.body.substring(0, 500)}`);
          });
        } else {
          lines.push('', 'No messages received. The queue/topic may be empty.');
        }
        setReceiveResult(lines.join('\n'));
      } else {
        setReceiveError(data.error ?? 'Subscribe failed');
      }
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : 'Subscribe failed');
    } finally {
      setReceiveLoading(false);
    }
  };

  const handleAdmin = async () => {
    if (!validateAdmin({ host, port: adminPort })) return;
    setAdminLoading(true); setAdminError(''); setAdminResult('');
    try {
      const res = await fetch('/api/activemq/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(adminPort),
          username: 'admin',
          password: adminPassword,
          brokerName,
          action: adminAction,
          queueName: queueName || undefined,
          timeout: 10000,
        }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string; action?: string; hint?: string; detail?: string;
        data?: unknown;
      };
      if (data.success) {
        const formatted = JSON.stringify(data.data, null, 2);
        setAdminResult(`Action: ${data.action}\n${'='.repeat(50)}\n${formatted}`);
      } else {
        const msg = [data.error ?? 'Admin query failed'];
        if (data.hint) msg.push(`Hint: ${data.hint}`);
        if (data.detail) msg.push(`Detail: ${data.detail}`);
        setAdminError(msg.join('\n'));
      }
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Admin query failed');
    } finally {
      setAdminLoading(false);
    }
  };

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'probe', label: 'Probe' },
    { id: 'connect', label: 'Connect' },
    { id: 'send', label: 'Send' },
    { id: 'receive', label: 'Receive' },
    { id: 'admin', label: 'Admin' },
  ];

  // ── Shared connection card ────────────────────────────────────────────────
  const renderConnectionFields = (
    portValue: string,
    setPort: (v: string) => void,
    portError: string | undefined,
    hostError: string | undefined,
    showCredentials = true,
  ) => (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-4">
      <SectionHeader stepNumber={1} title="Broker Connection" />
      <div className="grid md:grid-cols-2 gap-4">
        <FormField
          id="amq-host"
          label="Host"
          value={host}
          onChange={setHost}
          placeholder="activemq.example.com"
          required
          error={hostError}
        />
        <FormField
          id="amq-port"
          label="Port"
          type="number"
          value={portValue}
          onChange={setPort}
          min="1"
          max="65535"
          error={portError}
        />
        {showCredentials && (
          <>
            <FormField
              id="amq-username"
              label="Username"
              value={username}
              onChange={setUsername}
              placeholder="admin"
              optional
            />
            <FormField
              id="amq-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              optional
            />
          </>
        )}
      </div>
    </div>
  );

  return (
    <ProtocolClientLayout title="ActiveMQ Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.ActiveMQ || []} />
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-slate-800 border border-slate-600 rounded-xl p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Probe tab ── */}
      {activeTab === 'probe' && (
        <>
          {renderConnectionFields(probePort, setProbePort, probeErrors.port, probeErrors.host, false)}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <SectionHeader stepNumber={2} title="OpenWire Probe" />
            <p className="text-sm text-slate-400 mb-4">
              Sends an OpenWire <code className="text-slate-300">WireFormatInfo</code> handshake
              and parses the broker's response for version and capability flags.
              Default port: <code className="text-slate-300">61616</code>
            </p>
            <ActionButton
              onClick={handleProbe}
              disabled={probeLoading || !host}
              loading={probeLoading}
              ariaLabel="Probe ActiveMQ broker"
            >
              Probe Broker
            </ActionButton>
            <ResultDisplay result={probeResult} error={probeError} />
          </div>
        </>
      )}

      {/* ── Connect tab ── */}
      {activeTab === 'connect' && (
        <>
          {renderConnectionFields(connectPort, setConnectPort, connectErrors.port, connectErrors.host)}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <SectionHeader stepNumber={2} title="Test Connection" />
            <p className="text-sm text-slate-400 mb-4">
              Connects via STOMP on port <code className="text-slate-300">61613</code> (default),
              verifies credentials, and returns broker metadata.
            </p>
            <ActionButton
              onClick={handleConnect}
              disabled={connectLoading || !host}
              loading={connectLoading}
              ariaLabel="Connect to ActiveMQ"
            >
              Connect
            </ActionButton>
            <ResultDisplay result={connectResult} error={connectError} />
            <HelpSection
              title="ActiveMQ STOMP Credentials"
              description="Default credentials are admin/admin. If authentication is disabled in your broker config (activemq.xml), leave username/password blank. STOMP connections use port 61613 by default."
            />
          </div>
        </>
      )}

      {/* ── Send tab ── */}
      {activeTab === 'send' && (
        <>
          {renderConnectionFields(sendPort, setSendPort, sendErrors.port, sendErrors.host)}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <SectionHeader stepNumber={2} title="Send Message" />
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2">
                <FormField
                  id="amq-destination"
                  label="Destination"
                  value={destination}
                  onChange={setDestination}
                  placeholder="/queue/test"
                  required
                  helpText="Queue: /queue/name or queue://name  ·  Topic: /topic/name or topic://name"
                  error={sendErrors.destination}
                />
              </div>
              <FormField
                id="amq-priority"
                label="Priority"
                type="number"
                value={priority}
                onChange={setPriority}
                min="0"
                max="9"
                helpText="0 (lowest) – 9 (highest), default 4"
              />
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-3 cursor-pointer py-2">
                  <input
                    type="checkbox"
                    checked={persistent}
                    onChange={e => setPersistent(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm text-slate-300">
                    Persistent delivery
                    <span className="block text-xs text-slate-500">Survives broker restart</span>
                  </span>
                </label>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="amq-body">
                Message Body
              </label>
              <textarea
                id="amq-body"
                value={messageBody}
                onChange={e => setMessageBody(e.target.value)}
                rows={4}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                placeholder='{"event":"test","timestamp":1234567890}'
              />
            </div>
            <ActionButton
              onClick={handleSend}
              disabled={sendLoading || !host || !destination}
              loading={sendLoading}
              ariaLabel="Send message"
            >
              Send Message
            </ActionButton>
            <ResultDisplay result={sendResult} error={sendError} />
          </div>
        </>
      )}

      {/* ── Receive tab ── */}
      {activeTab === 'receive' && (
        <>
          {renderConnectionFields(receivePort, setReceivePort, receiveErrors.port, receiveErrors.host)}
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <SectionHeader stepNumber={2} title="Receive Messages" />
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2">
                <FormField
                  id="amq-recv-dest"
                  label="Destination"
                  value={receiveDest}
                  onChange={setReceiveDest}
                  placeholder="/queue/test"
                  required
                  helpText="Queue: /queue/name  ·  Topic: /topic/name"
                  error={receiveErrors.destination}
                />
              </div>
              <FormField
                id="amq-max-messages"
                label="Max Messages"
                type="number"
                value={maxMessages}
                onChange={setMaxMessages}
                min="1"
                max="100"
                helpText="Stop after collecting this many messages"
              />
              <FormField
                id="amq-selector"
                label="JMS Selector"
                value={selector}
                onChange={setSelector}
                placeholder='priority > 3 AND type = "alert"'
                optional
                helpText="SQL-92 filter expression"
              />
            </div>
            <ActionButton
              onClick={handleReceive}
              disabled={receiveLoading || !host || !receiveDest}
              loading={receiveLoading}
              ariaLabel="Subscribe and receive messages"
            >
              Subscribe & Receive
            </ActionButton>
            <ResultDisplay result={receiveResult} error={receiveError} />
            <HelpSection
              title="How Receive Works"
              description="Subscribes to the destination, collects up to the specified number of messages, then unsubscribes. For queues, messages are consumed and removed. For topics, only messages published after subscribing are received. Waits up to 14 seconds for messages to arrive."
            />
          </div>
        </>
      )}

      {/* ── Admin tab ── */}
      {activeTab === 'admin' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="Admin / Jolokia REST API" />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField
              id="amq-admin-host"
              label="Host"
              value={host}
              onChange={setHost}
              placeholder="activemq.example.com"
              required
              error={adminErrors.host}
            />
            <FormField
              id="amq-admin-port"
              label="Admin Port"
              type="number"
              value={adminPort}
              onChange={setAdminPort}
              min="1"
              max="65535"
              helpText="Default: 8161 (Jolokia REST API)"
              error={adminErrors.port}
            />
            <FormField
              id="amq-admin-password"
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={setAdminPassword}
              placeholder="admin"
              helpText="Default: admin"
            />
            <FormField
              id="amq-broker-name"
              label="Broker Name"
              value={brokerName}
              onChange={setBrokerName}
              placeholder="localhost"
              helpText="The brokerName in activemq.xml"
            />
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Action</label>
              <select
                value={adminAction}
                onChange={e => setAdminAction(e.target.value as typeof adminAction)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="brokerInfo">Broker Info</option>
                <option value="listQueues">List Queues</option>
                <option value="listTopics">List Topics</option>
                <option value="queueStats">Queue Stats</option>
              </select>
            </div>
            {adminAction === 'queueStats' && (
              <FormField
                id="amq-queue-name"
                label="Queue Name"
                value={queueName}
                onChange={setQueueName}
                placeholder="myqueue"
                required
                helpText="Queue name (without /queue/ prefix)"
              />
            )}
          </div>
          <ActionButton
            onClick={handleAdmin}
            disabled={adminLoading || !host}
            loading={adminLoading}
            ariaLabel="Query ActiveMQ admin API"
          >
            Query
          </ActionButton>
          <ResultDisplay result={adminResult} error={adminError} />
          <HelpSection
            title="About the Jolokia REST API"
            description="ActiveMQ exposes management data via the Jolokia JMX-over-HTTP bridge at http://host:8161/api/jolokia. The web console and REST API use the same credentials (default: admin/admin). Ensure the admin console is enabled in activemq.xml. In ActiveMQ Classic ≥ 5.8 Jolokia is bundled by default."
          />
        </div>
      )}

      {/* Port reference */}
      <div className="mt-6 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">ActiveMQ Default Ports</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
          <div><code className="text-slate-300">61616</code> — OpenWire (native binary) — used by Probe tab</div>
          <div><code className="text-slate-300">61613</code> — STOMP — used by Connect / Send / Receive</div>
          <div><code className="text-slate-300">5672</code>  — AMQP 0-9-1</div>
          <div><code className="text-slate-300">1883</code>  — MQTT</div>
          <div><code className="text-slate-300">61614</code> — WebSocket / STOMP over WS</div>
          <div><code className="text-slate-300">8161</code>  — Web Admin Console + Jolokia REST — used by Admin tab</div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
