import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

type Action = 'connect' | 'probe' | 'login' | 'query' | 'execute' | 'prepare' | 'call';

interface ColumnMeta { name: string; type: string; nullable: boolean; length: number; precision?: number; scale?: number; }
interface ResultSet { index: number; columns: ColumnMeta[]; rows: Array<Array<string | number | null>>; rowCount: number; }

interface DrResult {
  success: boolean;
  error?: string;
  isCloudflare?: boolean;
  rtt?: number;
  connectTime?: number;
  message?: string;
  // connect/probe
  isDRDA?: boolean;
  serverName?: string | null;
  serverClass?: string | null;
  serverRelease?: string | null;
  externalName?: string | null;
  managers?: Array<{ name: string; level: number }>;
  rawBytesReceived?: number;
  // login
  authenticated?: boolean;
  // query
  columns?: ColumnMeta[];
  rows?: Array<Array<string | number | null>>;
  rowCount?: number;
  truncated?: boolean;
  parameterized?: boolean;
  // execute
  sqlCode?: number;
  sqlState?: string;
  rowsAffected?: number | null;
  committed?: boolean;
  // prepare
  parameters?: ColumnMeta[];
  parameterCount?: number;
  columnCount?: number;
  // call
  resultSetCount?: number;
  resultSets?: ResultSet[];
}

export default function DRDAClient({ onBack }: { onBack: () => void }) {
  const [host, setHost]             = useState('');
  const [port, setPort]             = useState('50000');
  const [database, setDatabase]     = useState('');
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [sql, setSql]               = useState('SELECT * FROM SYS.SYSTABLES FETCH FIRST 10 ROWS ONLY');
  const [procedure, setProcedure]   = useState('CALL myschema.myproc(?, ?)');
  const [params, setParams]         = useState('');   // JSON array string e.g. [42, "hello"]
  const [maxRows, setMaxRows]       = useState('100');
  const [timeout, setTimeout_]      = useState('10000');
  const [ssl, setSsl]               = useState(false);
  const [loading, setLoading]       = useState(false);
  const [action, setAction]         = useState<Action>('connect');
  const [result, setResult]         = useState<DrResult | null>(null);

  const parseParams = () => {
    if (!params.trim()) return undefined;
    try { return JSON.parse(params); } catch { return undefined; }
  };

  const handleSubmit = async (e: React.FormEvent, a: Action) => {
    e.preventDefault();
    setAction(a);
    setLoading(true);
    setResult(null);

    try {
      let body: Record<string, unknown>;
      const p = parseInt(port) || 50000;
      const t = parseInt(timeout) || 10000;
      const parsedParams = parseParams();

      switch (a) {
        case 'connect':
          body = { host, port: p, timeout: t };
          break;
        case 'probe':
          body = { host, port: p, timeout: t };
          break;
        case 'login':
          body = { host, port: p, database, username, password, timeout: t, ssl };
          break;
        case 'query':
          body = { host, port: p, database, username, password, sql, maxRows: parseInt(maxRows) || 100, timeout: parseInt(timeout) || 30000, ssl, ...(parsedParams ? { params: parsedParams } : {}) };
          break;
        case 'execute':
          body = { host, port: p, database, username, password, sql, timeout: parseInt(timeout) || 30000, ssl, ...(parsedParams ? { params: parsedParams } : {}) };
          break;
        case 'prepare':
          body = { host, port: p, database, username, password, sql, timeout: t, ssl };
          break;
        case 'call':
          body = { host, port: p, database, username, password, procedure, maxRows: parseInt(maxRows) || 100, timeout: parseInt(timeout) || 30000, ssl, ...(parsedParams ? { params: parsedParams } : {}) };
          break;
      }

      const endpoint = a === 'prepare' ? 'prepare' : a === 'call' ? 'call' : a;
      const response = await fetch(`${API_BASE}/drda/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json() as DrResult;
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const inp = 'w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-400';
  const lbl = 'block text-sm font-medium text-slate-300 mb-1';
  const btn = (color: string) =>
    `${color} disabled:bg-slate-600 text-white font-medium py-2 px-5 rounded-lg transition-colors text-sm`;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">&larr; Back</button>
        <div className="flex items-center gap-3">
          <span className="text-4xl">🗄️</span>
          <div>
            <h1 className="text-2xl font-bold text-white">DRDA / IBM DB2</h1>
            <p className="text-slate-400 text-sm">Distributed Relational Database Architecture — Port 50000</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-6">
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {/* Connection row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className={lbl}>Host</label>
              <input type="text" value={host} onChange={e => setHost(e.target.value)}
                placeholder="db2.example.com" className={inp} />
            </div>
            <div>
              <label className={lbl}>Port</label>
              <input type="number" value={port} onChange={e => setPort(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Timeout (ms)</label>
              <input type="number" value={timeout} onChange={e => setTimeout_(e.target.value)} className={inp} />
            </div>
          </div>

          {/* Auth row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Database</label>
              <input type="text" value={database} onChange={e => setDatabase(e.target.value)}
                placeholder="MYDB" className={inp} />
            </div>
            <div>
              <label className={lbl}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="db2inst1" className={inp} autoComplete="off" />
            </div>
            <div>
              <label className={lbl}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" className={inp} autoComplete="off" />
            </div>
          </div>

          {/* SSL toggle */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="ssl" checked={ssl} onChange={e => setSsl(e.target.checked)}
              className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500" />
            <label htmlFor="ssl" className="text-slate-300 text-sm cursor-pointer">Use TLS/SSL</label>
          </div>

          {/* SQL input */}
          <div>
            <label className={lbl}>SQL Statement <span className="text-slate-500">(SELECT/DDL/DML)</span></label>
            <textarea value={sql} onChange={e => setSql(e.target.value)} rows={3}
              className={`${inp} font-mono text-sm resize-y`}
              placeholder="SELECT * FROM SYS.SYSTABLES FETCH FIRST 10 ROWS ONLY" />
          </div>

          {/* Procedure input */}
          <div>
            <label className={lbl}>Stored Procedure <span className="text-slate-500">(for CALL)</span></label>
            <input type="text" value={procedure} onChange={e => setProcedure(e.target.value)}
              placeholder="CALL myschema.myproc(?, ?)" className={`${inp} font-mono text-sm`} />
          </div>

          {/* Params + Max Rows */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Parameters <span className="text-slate-500">(JSON array for ? placeholders)</span></label>
              <input type="text" value={params} onChange={e => setParams(e.target.value)}
                placeholder='[42, "hello", null]' className={`${inp} font-mono text-sm`} />
            </div>
            <div>
              <label className={lbl}>Max Rows</label>
              <input type="number" value={maxRows} onChange={e => setMaxRows(e.target.value)} className={inp} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={e => handleSubmit(e, 'connect')} disabled={loading || !host}
              className={btn('bg-slate-600 hover:bg-slate-500')}>
              {loading && action === 'connect' ? '...' : 'EXCSAT Handshake'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'probe')} disabled={loading || !host}
              className={btn('bg-slate-600 hover:bg-slate-500')}>
              {loading && action === 'probe' ? '...' : 'Probe'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'login')} disabled={loading || !host || !database || !username}
              className={btn('bg-blue-600 hover:bg-blue-700')}>
              {loading && action === 'login' ? 'Authenticating...' : 'Test Login'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'query')} disabled={loading || !host || !database || !username || !sql}
              className={btn('bg-green-600 hover:bg-green-700')}>
              {loading && action === 'query' ? 'Querying...' : 'Execute SELECT'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'execute')} disabled={loading || !host || !database || !username || !sql}
              className={btn('bg-orange-600 hover:bg-orange-700')}>
              {loading && action === 'execute' ? 'Executing...' : 'Execute DDL/DML'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'prepare')} disabled={loading || !host || !database || !username || !sql}
              className={btn('bg-purple-600 hover:bg-purple-700')}>
              {loading && action === 'prepare' ? 'Preparing...' : 'Prepare Statement'}
            </button>
            <button type="button" onClick={e => handleSubmit(e, 'call')} disabled={loading || !host || !database || !username || !procedure}
              className={btn('bg-teal-600 hover:bg-teal-700')}>
              {loading && action === 'call' ? 'Calling...' : 'Call Procedure'}
            </button>
          </div>
        </form>
      </div>

      {/* Result */}
      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 mb-6 ${result.success ? 'border-blue-500' : 'border-red-500'}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-lg ${result.success ? 'text-green-400' : 'text-red-400'}`}>
              {result.success ? '✓' : '✗'}
            </span>
            <h3 className="text-lg font-semibold text-white">{result.success ? 'Success' : 'Failed'}</h3>
            {result.rtt !== undefined && <span className="ml-auto text-slate-400 text-sm">{result.rtt}ms</span>}
          </div>

          {result.error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4">
              <p className="text-red-300 text-sm font-mono">{result.error}</p>
            </div>
          )}
          {result.isCloudflare && (
            <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-3 mb-4">
              <p className="text-orange-300 text-sm">Target is behind Cloudflare protection.</p>
            </div>
          )}

          {result.success && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {result.isDRDA !== undefined && <Chip label="DRDA" value={result.isDRDA ? 'Yes' : 'No'} color={result.isDRDA ? 'green' : 'red'} />}
                {result.connectTime !== undefined && <Chip label="Connect" value={`${result.connectTime}ms`} color="cyan" />}
                {result.authenticated !== undefined && <Chip label="Auth" value={result.authenticated ? 'OK' : 'Fail'} color={result.authenticated ? 'green' : 'red'} />}
                {result.rowCount !== undefined && <Chip label="Rows" value={`${result.rowCount}${result.truncated ? '+' : ''}`} color="blue" />}
                {result.rowsAffected !== null && result.rowsAffected !== undefined && <Chip label="Affected" value={String(result.rowsAffected)} color="orange" />}
                {result.columnCount !== undefined && <Chip label="Columns" value={String(result.columnCount)} color="blue" />}
                {result.parameterCount !== undefined && <Chip label="Params" value={String(result.parameterCount)} color="purple" />}
                {result.resultSetCount !== undefined && <Chip label="Result Sets" value={String(result.resultSetCount)} color="teal" />}
                {result.sqlCode !== undefined && result.sqlCode !== 0 && <Chip label="SQLCODE" value={String(result.sqlCode)} color={result.sqlCode < 0 ? 'red' : 'yellow'} />}
                {result.sqlState && result.sqlState !== '00000' && <Chip label="SQLSTATE" value={result.sqlState} color="yellow" />}
                {result.rawBytesReceived !== undefined && <Chip label="Bytes" value={String(result.rawBytesReceived)} color="slate" />}
                {result.parameterized && <Chip label="Mode" value="Parameterized" color="purple" />}
              </div>

              {(result.serverClass || result.serverRelease || result.serverName) && (
                <div className="bg-slate-700/50 rounded-lg p-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                  {result.serverClass && <Info label="Server Class" value={result.serverClass} />}
                  {result.serverRelease && <Info label="Release" value={result.serverRelease} />}
                  {result.serverName && <Info label="Server Name" value={result.serverName} />}
                </div>
              )}

              {result.managers && result.managers.length > 0 && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-2">Manager Levels</p>
                  <div className="flex flex-wrap gap-3">
                    {result.managers.map((m, i) => (
                      <span key={i} className="text-sm">
                        <span className="text-blue-400 font-mono">{m.name}</span>
                        <span className="text-slate-400 ml-1">lv{m.level}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.message && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-200 text-sm">{result.message}</p>
                </div>
              )}

              {/* Prepare result: show descriptor tables */}
              {result.parameters && result.parameters.length > 0 && (
                <div>
                  <p className="text-slate-400 text-xs uppercase mb-2">Parameter Descriptors</p>
                  <ColumnTable cols={result.parameters} />
                </div>
              )}
              {result.columns && result.columns.length > 0 && action === 'prepare' && (
                <div>
                  <p className="text-slate-400 text-xs uppercase mb-2">Result Column Descriptors</p>
                  <ColumnTable cols={result.columns} />
                </div>
              )}

              {/* Query result table */}
              {result.columns && result.columns.length > 0 && action !== 'prepare' && result.rows && (
                <div>
                  {result.truncated && <p className="text-yellow-400 text-xs mb-2">Truncated at {result.rowCount} rows</p>}
                  <RowTable columns={result.columns} rows={result.rows} />
                </div>
              )}

              {/* Call: multiple result sets */}
              {result.resultSets && result.resultSets.map(rs => (
                <div key={rs.index} className="border border-slate-600 rounded-lg overflow-hidden">
                  <div className="bg-slate-700 px-3 py-2 text-sm text-slate-300 font-medium">
                    Result Set {rs.index + 1} — {rs.rowCount} row(s)
                  </div>
                  {rs.columns.length > 0
                    ? <RowTable columns={rs.columns} rows={rs.rows} />
                    : <p className="px-3 py-2 text-slate-500 text-sm">No rows</p>
                  }
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* About */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About DRDA Protocol</h3>
        <div className="text-slate-300 text-sm space-y-2">
          <p>
            <strong>DRDA</strong> (Distributed Relational Database Architecture) is IBM's open
            standard for accessing relational databases over a network using the DDM
            (Distributed Data Management) wire format.
          </p>
          <p>
            Supported servers: <strong>IBM DB2</strong> (port 50000),{' '}
            <strong>Apache Derby / JavaDB</strong> (port 1527),{' '}
            <strong>IBM Informix</strong> (port 9088).
          </p>
          <p className="text-slate-400">
            <strong>EXCSAT</strong> — fingerprint server without credentials.{' '}
            <strong>Login</strong> — full auth (EXCSAT→ACCSEC→SECCHK→ACCRDB).{' '}
            <strong>SELECT</strong> — OPNQRY→QRYDSC→QRYDTA with parameterized support.{' '}
            <strong>DDL/DML</strong> — EXCSQLIMM or PRPSQLSTT+EXCSQLSTT with params.{' '}
            <strong>Prepare</strong> — PRPSQLSTT, returns SQLDARD descriptors.{' '}
            <strong>Call</strong> — CALL proc, fetches multiple result sets via RSLSETRM.{' '}
            TLS connections supported via the SSL checkbox.
          </p>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'text-green-400', red: 'text-red-400', blue: 'text-blue-400',
    cyan: 'text-cyan-400', yellow: 'text-yellow-400', orange: 'text-orange-400',
    slate: 'text-slate-300', purple: 'text-purple-400', teal: 'text-teal-400',
  };
  return (
    <div className="bg-slate-700/50 rounded-lg p-3">
      <p className="text-slate-400 text-xs uppercase">{label}</p>
      <p className={`text-lg font-bold ${colors[color] ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase mb-0.5">{label}</p>
      <p className="text-white font-mono text-sm">{value}</p>
    </div>
  );
}

function ColumnTable({ cols }: { cols: Array<{ name: string; type: string; nullable: boolean; length: number }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-600">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-700">
            <th className="px-3 py-2 text-left text-slate-300 text-xs">Name</th>
            <th className="px-3 py-2 text-left text-slate-300 text-xs">Type</th>
            <th className="px-3 py-2 text-left text-slate-300 text-xs">Length</th>
            <th className="px-3 py-2 text-left text-slate-300 text-xs">Nullable</th>
          </tr>
        </thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-750'}>
              <td className="px-3 py-1.5 text-slate-200 font-mono text-xs">{c.name}</td>
              <td className="px-3 py-1.5 text-blue-400 font-mono text-xs">{c.type}</td>
              <td className="px-3 py-1.5 text-slate-400 text-xs">{c.length}</td>
              <td className="px-3 py-1.5 text-xs">{c.nullable ? <span className="text-yellow-400">Y</span> : <span className="text-slate-500">N</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowTable({ columns, rows }: { columns: Array<{ name: string; type: string; nullable: boolean; length: number }>; rows: Array<Array<string | number | null>> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-600">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-700">
            {columns.map((c, i) => (
              <th key={i} className="px-3 py-2 text-left text-slate-300 font-mono text-xs whitespace-nowrap">
                {c.name} <span className="text-slate-500">{c.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-3 py-4 text-center text-slate-500">No rows returned</td></tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-800' : 'bg-slate-750'}>
                {row.map((val, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-slate-200 font-mono text-xs whitespace-nowrap max-w-xs truncate">
                    {val === null ? <span className="text-slate-500 italic">NULL</span> : String(val)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
