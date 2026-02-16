import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface H323ClientProps {
  onBack: () => void;
}

interface CallMessage {
  type: string;
  messageType: number;
  messageTypeName: string;
  cause?: { value: number; description: string };
  display?: string;
  ieCount: number;
  timestamp: number;
}

export default function H323Client({ onBack }: H323ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1720');
  const [callingNumber, setCallingNumber] = useState('1000');
  const [calledNumber, setCalledNumber] = useState('2000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [callInfo, setCallInfo] = useState<{
    status: string;
    messages: CallMessage[];
    protocol?: string;
    protocolVersion?: string;
    connectTime?: number;
    rtt?: number;
  } | null>(null);

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
    setCallInfo(null);

    try {
      const response = await fetch('/api/h323/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          callingNumber: callingNumber.trim() || '1000',
          calledNumber: calledNumber.trim() || '2000',
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        callingNumber?: string;
        calledNumber?: string;
        status?: string;
        messages?: CallMessage[];
        protocol?: string;
        protocolVersion?: string;
        connectTime?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let text = `H.323 Call Signaling Probe\n${'='.repeat(50)}\n\n`;
        text += `Gateway: ${data.host}:${data.port}\n`;
        text += `Protocol: ${data.protocol} (${data.protocolVersion})\n`;
        text += `Calling: ${data.callingNumber} → Called: ${data.calledNumber}\n`;
        text += `Status: ${data.status?.replace(/_/g, ' ').toUpperCase()}\n`;
        text += `Connect: ${data.connectTime}ms | Total: ${data.rtt}ms\n`;

        if (data.messages && data.messages.length > 0) {
          text += `\nCall Flow:\n`;
          text += `  → SETUP (sent)\n`;
          for (const msg of data.messages) {
            text += `  ← ${msg.messageTypeName}`;
            if (msg.cause) text += ` [${msg.cause.description}]`;
            if (msg.display) text += ` "${msg.display}"`;
            text += ` (${msg.timestamp}ms, ${msg.ieCount} IEs)\n`;
          }
        } else {
          text += `\nNo Q.931 response received (server may not be H.323)\n`;
        }

        setResult(text);
        setCallInfo({
          status: data.status || 'unknown',
          messages: data.messages || [],
          protocol: data.protocol,
          protocolVersion: data.protocolVersion,
          connectTime: data.connectTime,
          rtt: data.rtt,
        });
      } else {
        setError(data.error || 'H.323 connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'H.323 connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) handleConnect();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-400';
      case 'alerting':
      case 'call_proceeding':
      case 'progress': return 'text-yellow-400';
      case 'release_complete': return 'text-blue-400';
      default: return 'text-red-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return '✓';
      case 'alerting': return '🔔';
      case 'call_proceeding': return '→';
      case 'release_complete': return '✗';
      default: return '?';
    }
  };

  return (
    <ProtocolClientLayout title="H.323 Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="H.323 Gateway Configuration" />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField id="h323-host" label="H.323 Gateway / Terminal" type="text" value={host}
            onChange={setHost} onKeyDown={handleKeyDown} placeholder="pbx.example.com"
            required helpText="H.323 gateway, gatekeeper, or terminal address" error={errors.host} />
          <FormField id="h323-port" label="Port" type="number" value={port}
            onChange={setPort} onKeyDown={handleKeyDown} min="1" max="65535"
            helpText="Default: 1720 (H.225 Call Signaling)" error={errors.port} />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="h323-calling" label="Calling Number (From)" type="text" value={callingNumber}
            onChange={setCallingNumber} onKeyDown={handleKeyDown} placeholder="1000"
            optional helpText="Originating extension or phone number" />
          <FormField id="h323-called" label="Called Number (To)" type="text" value={calledNumber}
            onChange={setCalledNumber} onKeyDown={handleKeyDown} placeholder="2000"
            optional helpText="Destination extension or phone number" />
        </div>

        <ActionButton onClick={handleConnect} disabled={loading || !host || !port}
          loading={loading} ariaLabel="Probe H.323 gateway">
          Send SETUP Probe
        </ActionButton>

        <ResultDisplay result={result} error={!callInfo ? error : undefined} />

        {callInfo && callInfo.messages.length > 0 && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-slate-600">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Call Signaling Flow</h3>
            <div className="space-y-2">
              {/* Sent SETUP */}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-blue-400 font-mono text-xs w-16 text-right">0ms</span>
                <span className="text-green-400">→</span>
                <span className="text-white font-semibold">SETUP</span>
                <span className="text-slate-400 text-xs">(sent to gateway)</span>
              </div>

              {/* Received messages */}
              {callInfo.messages.map((msg, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm">
                  <span className="text-blue-400 font-mono text-xs w-16 text-right">{msg.timestamp}ms</span>
                  <span className={getStatusColor(callInfo.status)}>←</span>
                  <span className="text-white font-semibold">{msg.messageTypeName}</span>
                  {msg.cause && (
                    <span className="text-red-300 text-xs bg-red-900/30 px-2 py-0.5 rounded">
                      {msg.cause.description}
                    </span>
                  )}
                  {msg.display && (
                    <span className="text-slate-400 text-xs italic">"{msg.display}"</span>
                  )}
                  <span className="text-slate-500 text-xs">{msg.ieCount} IEs</span>
                </div>
              ))}
            </div>

            {/* Status summary */}
            <div className="mt-4 pt-3 border-t border-slate-700 flex items-center gap-2">
              <span className={`text-xl ${getStatusColor(callInfo.status)}`} aria-hidden="true">
                {getStatusIcon(callInfo.status)}
              </span>
              <span className={`text-sm font-semibold ${getStatusColor(callInfo.status)}`}>
                {callInfo.status.replace(/_/g, ' ').toUpperCase()}
              </span>
              {callInfo.protocol && (
                <span className="text-xs text-slate-400 ml-2">
                  {callInfo.protocol} ({callInfo.protocolVersion})
                </span>
              )}
            </div>
          </div>
        )}

        {callInfo && error && <ResultDisplay error={error} />}

        <HelpSection title="About H.323 Protocol"
          description="H.323 (ITU-T, 1996) is a suite of protocols for multimedia communication over packet-switched networks. It was one of the first VoIP standards, using Q.931-based signaling on port 1720 for call setup. While largely superseded by SIP, H.323 remains in enterprise video conferencing, legacy PBX systems, and PSTN gateway interworking."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">H.323 Call Flow</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">1. SETUP</span> <span className="text-slate-400">→ Caller initiates call (H.225)</span></div>
            <div><span className="text-green-400">2. CALL PROCEEDING</span> <span className="text-slate-400">← Gateway acknowledges</span></div>
            <div><span className="text-green-400">3. ALERTING</span> <span className="text-slate-400">← Destination ringing</span></div>
            <div><span className="text-green-400">4. CONNECT</span> <span className="text-slate-400">← Call answered</span></div>
            <div><span className="text-yellow-400">5. H.245 Channel</span> <span className="text-slate-400">← Capability exchange & media setup</span></div>
            <div><span className="text-yellow-400">6. RTP/RTCP</span> <span className="text-slate-400">← Audio/video media streams</span></div>
            <div><span className="text-red-400">7. RELEASE COMPLETE</span> <span className="text-slate-400">→ Hang up</span></div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">H.323 Protocol Suite</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">H.225 Signaling</span> - Call setup/teardown (port 1720)</div>
            <div><span className="font-mono text-blue-400">H.225 RAS</span> - Gatekeeper registration (port 1719)</div>
            <div><span className="font-mono text-blue-400">H.245</span> - Media control channel (dynamic port)</div>
            <div><span className="font-mono text-blue-400">RTP/RTCP</span> - Real-time media transport</div>
            <div><span className="font-mono text-blue-400">H.235</span> - Security and encryption</div>
            <div><span className="font-mono text-blue-400">H.460</span> - NAT/firewall traversal</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">H.323 Components</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">Terminal</span> - Endpoint (phone, softphone, video)</div>
            <div><span className="font-mono text-blue-400">Gateway</span> - Connects H.323 to PSTN/SIP</div>
            <div><span className="font-mono text-blue-400">Gatekeeper</span> - Central admission & routing</div>
            <div><span className="font-mono text-blue-400">MCU</span> - Multi-party conference controller</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Q.931 Message Types</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">0x05 SETUP</span> <span className="text-slate-400">- Initiate call</span></div>
            <div><span className="text-green-400">0x02 CALL PROCEEDING</span> <span className="text-slate-400">- Call being processed</span></div>
            <div><span className="text-green-400">0x01 ALERTING</span> <span className="text-slate-400">- Destination ringing</span></div>
            <div><span className="text-green-400">0x07 CONNECT</span> <span className="text-slate-400">- Call answered</span></div>
            <div><span className="text-red-400">0x5A RELEASE COMPLETE</span> <span className="text-slate-400">- Call terminated</span></div>
            <div><span className="text-yellow-400">0x62 FACILITY</span> <span className="text-slate-400">- Supplementary services</span></div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
