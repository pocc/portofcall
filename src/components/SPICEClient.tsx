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

interface SPICEClientProps {
  onBack: () => void;
}

interface SPICEResponse {
  success: boolean;
  host: string;
  port: number;
  protocolVersion?: string;
  majorVersion?: number;
  minorVersion?: number;
  capabilities?: string[];
  channels?: string[];
  authMethods?: string[];
  error?: string;
  details?: string;
}

export default function SPICEClient({ onBack }: SPICEClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5900');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/spice/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          timeout: 15000,
        }),
      });

      const data = await response.json() as SPICEResponse;

      if (data.success) {
        let output = '✅ SPICE Server Connected\n\n';
        output += `📡 Connection Info:\n`;
        output += `  Host: ${data.host}\n`;
        output += `  Port: ${data.port}\n\n`;

        if (data.protocolVersion) {
          output += `📋 Protocol Info:\n`;
          output += `  Version: ${data.protocolVersion}\n`;
          output += `  Major: ${data.majorVersion}\n`;
          output += `  Minor: ${data.minorVersion}\n\n`;
        }

        if (data.capabilities && data.capabilities.length > 0) {
          output += `🔧 Capabilities:\n`;
          data.capabilities.forEach((cap: string) => {
            output += `  • ${cap}\n`;
          });
          output += '\n';
        }

        if (data.channels && data.channels.length > 0) {
          output += `📺 Channels:\n`;
          data.channels.forEach((channel: string) => {
            output += `  • ${channel}\n`;
          });
          output += '\n';
        }

        if (data.authMethods && data.authMethods.length > 0) {
          output += `🔐 Authentication Methods:\n`;
          data.authMethods.forEach((method: string) => {
            output += `  • ${method}\n`;
          });
          output += '\n';
        }

        if (data.details) {
          output += `ℹ️  Note: ${data.details}\n`;
        }

        setResult(output.trim());
      } else {
        setResult(`❌ Connection Failed\n\n${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Request failed'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="SPICE Protocol" onBack={onBack}>
      <ApiExamples examples={apiExamples.SPICE || []} />
      <SectionHeader stepNumber={1} title="Connection Settings" />

      <FormField
        id="host"
        label="Host"
        value={host}
        onChange={setHost}
        onKeyDown={handleKeyDown}
        placeholder="spice.example.com or IP address"
        error={errors.host}
      />

      <FormField
        id="port"
        label="Port"
        type="number"
        value={port}
        onChange={setPort}
        onKeyDown={handleKeyDown}
        placeholder="5900"
        helpText="Default SPICE port is 5900 (same as VNC)"
        error={errors.port}
      />

      <ActionButton onClick={handleConnect} disabled={loading} loading={loading}>
        Connect to SPICE Server
      </ActionButton>

      {result && <ResultDisplay result={result} />}

      <HelpSection
        title="About SPICE Protocol"
        description="SPICE (Simple Protocol for Independent Computing Environments) is a remote display protocol developed by Red Hat for virtual desktop infrastructure. It's used primarily with KVM/QEMU virtual machines and provides remote display rendering, audio/video streaming, USB redirection, and clipboard sharing. SPICE uses port 5900 by default (same as VNC) but has a different protocol handshake with 'REDQ' magic bytes. This tool probes a SPICE server and displays its protocol version, capabilities, and supported channels."
      />
    </ProtocolClientLayout>
  );
}
