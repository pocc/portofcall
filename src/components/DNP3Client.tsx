import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface DNP3ClientProps {
  onBack: () => void;
}

const CLASS_OPTIONS = [
  { value: 0, label: 'Class 0 - Static Data' },
  { value: 1, label: 'Class 1 - High Priority Events' },
  { value: 2, label: 'Class 2 - Medium Priority Events' },
  { value: 3, label: 'Class 3 - Low Priority Events' },
];

export default function DNP3Client({ onBack }: DNP3ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('20000');
  const [destination, setDestination] = useState('1');
  const [source, setSource] = useState('3');
  const [classNum, setClassNum] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dnp3/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          destination: parseInt(destination, 10),
          source: parseInt(source, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        host?: string;
        port?: number;
        dataLink?: {
          valid?: boolean;
          headerCrcValid?: boolean;
          direction?: string;
          primary?: boolean;
          functionCode?: number;
          functionName?: string;
          sourceAddress?: number;
          destinationAddress?: number;
          length?: number;
        };
        rawHex?: string;
        rawLength?: number;
      };

      if (response.ok && data.success) {
        let text = `${data.message || 'Connected'}\n\n`;

        if (data.dataLink) {
          const dl = data.dataLink;
          text += `Data Link Layer:\n`;
          text += `  Header CRC Valid:  ${dl.headerCrcValid ? 'Yes' : 'No'}\n`;
          text += `  Direction:         ${dl.direction}\n`;
          text += `  Primary:           ${dl.primary ? 'Yes' : 'No'}\n`;
          text += `  Function:          ${dl.functionName} (0x${dl.functionCode?.toString(16).padStart(2, '0')})\n`;
          text += `  Source Address:     ${dl.sourceAddress}\n`;
          text += `  Dest Address:       ${dl.destinationAddress}\n`;
          text += `  Length:             ${dl.length}\n`;
        }

        if (data.rawHex) {
          text += `\nRaw Hex: ${data.rawHex}`;
        }

        setResult(text);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRead = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dnp3/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          destination: parseInt(destination, 10),
          source: parseInt(source, 10),
          classNum: parseInt(classNum, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        classNum?: number;
        dataLink?: {
          valid?: boolean;
          direction?: string;
          functionCode?: number;
          functionName?: string;
          sourceAddress?: number;
          destinationAddress?: number;
        };
        application?: {
          functionCode?: number;
          functionName?: string;
          sequence?: number;
          firstFragment?: boolean;
          finalFragment?: boolean;
          confirmation?: boolean;
          unsolicited?: boolean;
          iin?: string;
          iinFlags?: string[];
          objectDataLength?: number;
          objectDataHex?: string;
        };
        rawHex?: string;
      };

      if (response.ok && data.success) {
        const classLabel = CLASS_OPTIONS.find(o => o.value === data.classNum)?.label || `Class ${data.classNum}`;
        let text = `Read ${classLabel} from ${data.host}:${data.port}\n\n`;

        if (data.dataLink) {
          const dl = data.dataLink;
          text += `Data Link Layer:\n`;
          text += `  Valid:     ${dl.valid ? 'Yes' : 'No'}\n`;
          text += `  Direction: ${dl.direction}\n`;
          text += `  Function:  ${dl.functionName}\n`;
          text += `  Source:    ${dl.sourceAddress}\n`;
          text += `  Dest:      ${dl.destinationAddress}\n`;
        }

        if (data.application) {
          const app = data.application;
          text += `\nApplication Layer:\n`;
          text += `  Function:        ${app.functionName} (0x${app.functionCode?.toString(16).padStart(2, '0')})\n`;
          text += `  Sequence:        ${app.sequence}\n`;
          text += `  First Fragment:  ${app.firstFragment ? 'Yes' : 'No'}\n`;
          text += `  Final Fragment:  ${app.finalFragment ? 'Yes' : 'No'}\n`;
          text += `  Unsolicited:     ${app.unsolicited ? 'Yes' : 'No'}\n`;
          text += `  IIN:             ${app.iin}\n`;

          if (app.iinFlags && app.iinFlags.length > 0) {
            text += `  IIN Flags:       ${app.iinFlags.join(', ')}\n`;
          }

          if (app.objectDataLength !== undefined && app.objectDataLength > 0) {
            text += `\n  Object Data (${app.objectDataLength} bytes):\n`;
            text += `  ${app.objectDataHex}\n`;
          } else {
            text += `\n  No object data returned\n`;
          }
        }

        if (data.rawHex) {
          text += `\nRaw Frame: ${data.rawHex}`;
        }

        setResult(text);
      } else {
        setError(data.error || 'Read failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Read failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">DNP3 Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Warning Banner */}
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-xl" aria-hidden="true">⚠</span>
            <div>
              <p className="text-yellow-200 text-sm font-semibold mb-1">Critical Infrastructure Warning</p>
              <p className="text-yellow-100/80 text-xs leading-relaxed">
                DNP3 controls electric grids, water systems, and other critical infrastructure.
                This client supports READ-ONLY operations. Only connect to devices you are authorized to access.
              </p>
            </div>


          </div>
        </div>

        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.DNP3 || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="dnp3-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="dnp3-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="scada.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="dnp3-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="dnp3-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 20000</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="dnp3-dest" className="block text-sm font-medium text-slate-300 mb-1">
              Destination Address
            </label>
            <input
              id="dnp3-dest"
              type="number"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onKeyDown={handleKeyDown}
              min="0"
              max="65519"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Outstation address (0-65519)</p>
          </div>

          <div>
            <label htmlFor="dnp3-src" className="block text-sm font-medium text-slate-300 mb-1">
              Source Address
            </label>
            <input
              id="dnp3-src"
              type="number"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={handleKeyDown}
              min="0"
              max="65519"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Master station address (0-65519)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Probe DNP3 outstation"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Probing...
            </span>
          ) : (
            'Probe Link Status'
          )}
        </button>

        {/* Step 2: Read Data */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Read Class Data</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="dnp3-class" className="block text-sm font-medium text-slate-300 mb-1">
              Data Class
            </label>
            <select
              id="dnp3-class"
              value={classNum}
              onChange={(e) => setClassNum(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CLASS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleRead}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Read DNP3 class data"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Reading...
              </span>
            ) : (
              'Read Data'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About DNP3</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            DNP3 (IEEE 1815) is a SCADA protocol used in electric utilities, water treatment, and oil/gas systems.
            It uses a layered architecture with CRC-16 integrity checks per data block. Port 20000 is the standard TCP port.
            The master (source) polls outstations (destinations) for data using class-based polling.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mt-3">
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">Class 0</span>
              <span className="text-slate-300 ml-2">Static data (current values)</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">Class 1</span>
              <span className="text-slate-300 ml-2">High priority events</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">Class 2</span>
              <span className="text-slate-300 ml-2">Medium priority events</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">Class 3</span>
              <span className="text-slate-300 ml-2">Low priority events</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
