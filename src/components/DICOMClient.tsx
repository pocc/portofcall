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

interface DICOMClientProps {
  onBack: () => void;
}

export default function DICOMClient({ onBack }: DICOMClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('104');
  const [callingAE, setCallingAE] = useState('PORTOFCALL');
  const [calledAE, setCalledAE] = useState('ANY-SCP');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [associationInfo, setAssociationInfo] = useState<{
    associationAccepted: boolean;
    calledAE?: string;
    callingAE?: string;
    maxPDULength?: number;
    implementationClassUID?: string;
    implementationVersion?: string;
    verificationAccepted?: boolean;
    acceptedContexts?: Array<{ id: number; accepted: boolean; resultText: string; transferSyntax: string }>;
    rejectionResult?: string;
    rejectionSource?: string;
    rejectionReason?: string;
    connectTime?: number;
    rtt?: number;
  } | null>(null);

  const [echoResult, setEchoResult] = useState<{
    echoSuccess: boolean;
    echoStatusText: string;
    associateTime: number;
    echoTime: number;
    totalTime: number;
    implementationVersion?: string;
    maxPDULength?: number;
    transferSyntax?: string;
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
    setAssociationInfo(null);
    setEchoResult(null);

    try {
      const response = await fetch('/api/dicom/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(port, 10), callingAE: callingAE.trim(), calledAE: calledAE.trim(), timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean; error?: string; host?: string; port?: number;
        associationAccepted?: boolean; calledAE?: string; callingAE?: string;
        connectTime?: number; rtt?: number; maxPDULength?: number;
        implementationClassUID?: string; implementationVersion?: string;
        verificationAccepted?: boolean;
        acceptedContexts?: Array<{ id: number; accepted: boolean; resultText: string; transferSyntax: string }>;
        rejectionResult?: string; rejectionSource?: string; rejectionReason?: string;
        aborted?: boolean; abortSource?: string;
      };

      if (response.ok && data.success) {
        if (data.associationAccepted) {
          let text = `DICOM Association Established\n${'='.repeat(50)}\n\n`;
          text += `Server: ${data.host}:${data.port}\n`;
          text += `Called AE: ${data.calledAE}\n`;
          text += `Calling AE: ${data.callingAE}\n`;
          text += `Connect: ${data.connectTime}ms | Total: ${data.rtt}ms\n`;
          if (data.implementationVersion) text += `Implementation: ${data.implementationVersion}\n`;
          if (data.implementationClassUID) text += `Class UID: ${data.implementationClassUID}\n`;
          if (data.maxPDULength) text += `Max PDU: ${data.maxPDULength} bytes\n`;
          text += `Verification SOP: ${data.verificationAccepted ? 'Accepted' : 'Not accepted'}\n`;
          setResult(text);
          setAssociationInfo({
            associationAccepted: true, calledAE: data.calledAE, callingAE: data.callingAE,
            maxPDULength: data.maxPDULength, implementationClassUID: data.implementationClassUID,
            implementationVersion: data.implementationVersion, verificationAccepted: data.verificationAccepted,
            acceptedContexts: data.acceptedContexts, connectTime: data.connectTime, rtt: data.rtt,
          });
        } else if (data.aborted) {
          setError(`Association aborted by ${data.abortSource || 'server'}`);
        } else {
          setAssociationInfo({
            associationAccepted: false, rejectionResult: data.rejectionResult,
            rejectionSource: data.rejectionSource, rejectionReason: data.rejectionReason,
            connectTime: data.connectTime, rtt: data.rtt,
          });
          setError(`Association rejected: ${data.rejectionReason || 'Unknown reason'} (${data.rejectionSource || 'unknown source'})`);
        }
      } else {
        setError(data.error || 'DICOM connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DICOM connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEcho = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setEchoResult(null);

    try {
      const response = await fetch('/api/dicom/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host, port: parseInt(port, 10), callingAE: callingAE.trim(), calledAE: calledAE.trim(), timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean; error?: string; echoSuccess?: boolean; echoStatusText?: string;
        associateTime?: number; echoTime?: number; totalTime?: number;
        implementationVersion?: string; maxPDULength?: number; transferSyntax?: string;
      };

      if (response.ok && data.success) {
        setEchoResult({
          echoSuccess: data.echoSuccess || false, echoStatusText: data.echoStatusText || 'Unknown',
          associateTime: data.associateTime || 0, echoTime: data.echoTime || 0,
          totalTime: data.totalTime || 0, implementationVersion: data.implementationVersion,
          maxPDULength: data.maxPDULength, transferSyntax: data.transferSyntax,
        });
      } else {
        setError(data.error || 'C-ECHO failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'C-ECHO failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) handleConnect();
  };

  return (
    <ProtocolClientLayout title="DICOM Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.DICOM || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="DICOM Server Configuration" />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField id="dicom-host" label="DICOM Server Host" type="text" value={host}
            onChange={setHost} onKeyDown={handleKeyDown} placeholder="pacs.hospital.org"
            required helpText="PACS or DICOM SCP server address" error={errors.host} />
          <FormField id="dicom-port" label="Port" type="number" value={port}
            onChange={setPort} onKeyDown={handleKeyDown} min="1" max="65535"
            helpText="Default: 104 (DICOM), 11112 (alt)" error={errors.port} />
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="dicom-calling-ae" label="Calling AE Title" type="text" value={callingAE}
            onChange={setCallingAE} onKeyDown={handleKeyDown} placeholder="PORTOFCALL"
            optional helpText="Your Application Entity (max 16 chars)" />
          <FormField id="dicom-called-ae" label="Called AE Title" type="text" value={calledAE}
            onChange={setCalledAE} onKeyDown={handleKeyDown} placeholder="ANY-SCP"
            optional helpText="Server's Application Entity (max 16 chars)" />
        </div>

        <div className="flex gap-3 mb-4">
          <ActionButton onClick={handleConnect} disabled={loading || !host || !port}
            loading={loading} ariaLabel="Test DICOM association">
            Test Association
          </ActionButton>
          <ActionButton onClick={handleEcho} disabled={loading || !host || !port}
            loading={loading} variant="success" ariaLabel="Run DICOM C-ECHO verification">
            C-ECHO (Ping)
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={!associationInfo && !echoResult ? error : undefined} />

        {associationInfo && associationInfo.acceptedContexts && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-slate-600">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Presentation Contexts</h3>
            <div className="space-y-2">
              {associationInfo.acceptedContexts.map((ctx) => (
                <div key={ctx.id} className="flex items-center gap-2 text-xs">
                  <span className={ctx.accepted ? 'text-green-400' : 'text-red-400'} aria-hidden="true">
                    {ctx.accepted ? '✓' : '✗'}
                  </span>
                  <span className="text-slate-300">PC #{ctx.id}:</span>
                  <span className={ctx.accepted ? 'text-green-300' : 'text-red-300'}>{ctx.resultText}</span>
                  {ctx.transferSyntax && (
                    <span className="text-slate-500 font-mono text-xs ml-2">({ctx.transferSyntax})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {echoResult && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-green-600/50">
            <div className="flex items-center gap-2 mb-3">
              <span className={echoResult.echoSuccess ? 'text-green-400 text-xl' : 'text-red-400 text-xl'} aria-hidden="true">
                {echoResult.echoSuccess ? '✓' : '✗'}
              </span>
              <h3 className="text-sm font-semibold text-slate-300">
                C-ECHO {echoResult.echoSuccess ? 'Success' : 'Failed'}: {echoResult.echoStatusText}
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs text-slate-400">
              <div><span className="font-semibold text-slate-300">Associate:</span> {echoResult.associateTime}ms</div>
              <div><span className="font-semibold text-slate-300">Echo:</span> {echoResult.echoTime}ms</div>
              <div><span className="font-semibold text-slate-300">Total:</span> {echoResult.totalTime}ms</div>
            </div>
            {echoResult.implementationVersion && (
              <div className="mt-2 text-xs text-slate-500">
                Implementation: {echoResult.implementationVersion}
              </div>
            )}
            {echoResult.transferSyntax && (
              <div className="text-xs text-slate-500 font-mono">
                Transfer Syntax: {echoResult.transferSyntax}
              </div>
            )}
          </div>
        )}

        {(associationInfo || echoResult) && error && <ResultDisplay error={error} />}

        <HelpSection title="About DICOM Protocol"
          description="DICOM (Digital Imaging and Communications in Medicine) is the global standard for medical imaging communication. It defines how medical images (CT, MRI, X-ray, ultrasound) are stored, transmitted, and displayed. The C-ECHO service (DICOM 'ping') verifies end-to-end connectivity between DICOM nodes."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">DICOM Terminology</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">AE Title</span> - Application Entity identifier (max 16 chars)</div>
            <div><span className="font-mono text-blue-400">SCP</span> - Service Class Provider (server)</div>
            <div><span className="font-mono text-blue-400">SCU</span> - Service Class User (client)</div>
            <div><span className="font-mono text-blue-400">PACS</span> - Picture Archiving & Communication System</div>
            <div><span className="font-mono text-blue-400">C-ECHO</span> - Verification service (DICOM ping)</div>
            <div><span className="font-mono text-blue-400">C-STORE</span> - Image storage service</div>
            <div><span className="font-mono text-blue-400">C-FIND</span> - Query service</div>
            <div><span className="font-mono text-blue-400">C-MOVE</span> - Retrieval service</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">DICOM PDU Types</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
            <div><span className="text-green-400">A-ASSOCIATE-RQ</span> <span className="text-slate-400">- Association request (0x01)</span></div>
            <div><span className="text-green-400">A-ASSOCIATE-AC</span> <span className="text-slate-400">- Association accept (0x02)</span></div>
            <div><span className="text-red-400">A-ASSOCIATE-RJ</span> <span className="text-slate-400">- Association reject (0x03)</span></div>
            <div><span className="text-green-400">P-DATA-TF</span> <span className="text-slate-400">- Data transfer (0x04)</span></div>
            <div><span className="text-yellow-400">A-RELEASE-RQ/RP</span> <span className="text-slate-400">- Graceful release (0x05/0x06)</span></div>
            <div><span className="text-red-400">A-ABORT</span> <span className="text-slate-400">- Abort association (0x07)</span></div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common AE Titles</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-400">ANY-SCP</span> - Generic server AE title</div>
            <div><span className="font-mono text-blue-400">ORTHANC</span> - Orthanc open-source DICOM server</div>
            <div><span className="font-mono text-blue-400">DCM4CHEE</span> - dcm4chee PACS archive</div>
            <div><span className="font-mono text-blue-400">STORESCP</span> - DCMTK storage SCP</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
