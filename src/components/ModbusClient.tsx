import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface ModbusClientProps {
  onBack: () => void;
}

const FUNCTION_CODE_OPTIONS = [
  { value: 1, label: '0x01 - Read Coils', maxQty: 2000 },
  { value: 2, label: '0x02 - Read Discrete Inputs', maxQty: 2000 },
  { value: 3, label: '0x03 - Read Holding Registers', maxQty: 125 },
  { value: 4, label: '0x04 - Read Input Registers', maxQty: 125 },
];

export default function ModbusClient({ onBack }: ModbusClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('502');
  const [unitId, setUnitId] = useState('1');
  const [functionCode, setFunctionCode] = useState('3');
  const [address, setAddress] = useState('0');
  const [quantity, setQuantity] = useState('10');
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
      const response = await fetch('/api/modbus/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          unitId: parseInt(unitId, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        host?: string;
        port?: number;
        unitId?: number;
        testRegister?: number;
        exception?: string;
      };

      if (response.ok && data.success) {
        let text = `Connected to Modbus TCP at ${data.host}:${data.port}\nUnit ID: ${data.unitId}\n\n${data.message}`;
        if (data.testRegister !== undefined) {
          text += `\nHolding Register 0: ${data.testRegister} (0x${data.testRegister.toString(16).padStart(4, '0')})`;
        }
        if (data.exception) {
          text += `\nNote: ${data.exception}`;
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
      const fc = parseInt(functionCode, 10);
      const response = await fetch('/api/modbus/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          unitId: parseInt(unitId, 10),
          functionCode: fc,
          address: parseInt(address, 10),
          quantity: parseInt(quantity, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        functionName?: string;
        address?: number;
        quantity?: number;
        format?: string;
        values?: (boolean | number)[];
      };

      if (response.ok && data.success) {
        const fcOption = FUNCTION_CODE_OPTIONS.find(o => o.value === fc);
        let text = `${fcOption?.label || `Function 0x${fc.toString(16)}`}\n`;
        text += `Address: ${data.address}, Quantity: ${data.quantity}\n\n`;

        if (data.format === 'coils' && data.values) {
          text += 'Address  | Value\n';
          text += '---------+-------\n';
          (data.values as boolean[]).forEach((val, i) => {
            text += `${String(data.address! + i).padStart(7)}  | ${val ? 'ON (1)' : 'OFF (0)'}\n`;
          });
        } else if (data.format === 'registers' && data.values) {
          text += 'Address  |   Dec  |  Hex   |     Binary\n';
          text += '---------+--------+--------+------------------\n';
          (data.values as number[]).forEach((val, i) => {
            text += `${String(data.address! + i).padStart(7)}  | ${String(val).padStart(6)} | 0x${val.toString(16).padStart(4, '0')} | ${val.toString(2).padStart(16, '0')}\n`;
          });
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
        <h1 className="text-3xl font-bold text-white">Modbus TCP Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Warning Banner */}
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-xl" aria-hidden="true">⚠</span>
            <div>
              <p className="text-yellow-200 text-sm font-semibold mb-1">Safety Warning</p>
              <p className="text-yellow-100/80 text-xs leading-relaxed">
                Modbus has no authentication or encryption. This client supports READ-ONLY operations.
                Only connect to devices you are authorized to access.
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

      <ApiExamples examples={apiExamples.Modbus || []} />
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="modbus-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="modbus-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="plc.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="modbus-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="modbus-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 502</p>
          </div>

          <div>
            <label htmlFor="modbus-unit-id" className="block text-sm font-medium text-slate-300 mb-1">
              Unit ID
            </label>
            <input
              id="modbus-unit-id"
              type="number"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              onKeyDown={handleKeyDown}
              min="0"
              max="255"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Slave address (0-255)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test Modbus connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection'
          )}
        </button>

        {/* Step 2: Read Registers */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Read Data</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="modbus-function" className="block text-sm font-medium text-slate-300 mb-1">
                Function Code
              </label>
              <select
                id="modbus-function"
                value={functionCode}
                onChange={(e) => setFunctionCode(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FUNCTION_CODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="modbus-address" className="block text-sm font-medium text-slate-300 mb-1">
                Start Address
              </label>
              <input
                id="modbus-address"
                type="number"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                min="0"
                max="65535"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">0-65535</p>
            </div>

            <div>
              <label htmlFor="modbus-quantity" className="block text-sm font-medium text-slate-300 mb-1">
                Quantity
              </label>
              <input
                id="modbus-quantity"
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                max="125"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">Number of registers/coils</p>
            </div>
          </div>

          <button
            onClick={handleRead}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Read Modbus registers"
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Modbus TCP</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Modbus TCP is an industrial protocol for monitoring and controlling PLCs, sensors, and SCADA systems.
            It uses a simple binary framing with a 7-byte MBAP header. Port 502 is the default.
            This client supports read-only operations for safety. Unit ID identifies the slave device (1-247).
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mt-3">
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">0x01</span>
              <span className="text-slate-300 ml-2">Read Coils (digital outputs)</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">0x02</span>
              <span className="text-slate-300 ml-2">Read Discrete Inputs</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">0x03</span>
              <span className="text-slate-300 ml-2">Read Holding Registers</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">0x04</span>
              <span className="text-slate-300 ml-2">Read Input Registers</span>
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
