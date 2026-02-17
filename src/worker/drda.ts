/**
 * DRDA (Distributed Relational Database Architecture) Protocol Implementation
 *
 * Implements DB2/Derby/Informix connectivity via the DRDA wire protocol.
 * DRDA is IBM's open standard for distributed database access.
 *
 * Protocol Structure (DDM — Distributed Data Management):
 * Every DRDA message uses a DSS (Data Stream Structure) envelope:
 *   - DSS Header (6 bytes): length(2) + magic(1=0xD0) + format(1) + correlId(2)
 *   - DDM Object: length(2) + codePoint(2) + [sub-objects or scalar data...]
 *
 * Full Protocol Flow:
 *   1. EXCSAT -> EXCSATRD  (exchange server attributes)
 *   2. ACCSEC -> ACCSECRD  (negotiate security)
 *   3. SECCHK -> SECCHKRM  (authenticate)
 *   4. ACCRDB -> ACCRDBRM  (open database)
 *   5a. EXCSQLIMM -> SQLCARD  (DDL/DML)
 *   5b. OPNQRY -> OPNQRYRM + QRYDSC + QRYDTA  (SELECT)
 *   6. FETCH -> QRYDTA  (more rows)
 *   7. CLSQRY -> CLSQRYRM  (close cursor)
 *   8. RDBCMM  (commit)
 *   9. PRPSQLSTT -> SQLDARD  (prepare statement)
 *  10. EXCSQLSTT/OPNQRY + SQLDTA  (execute prepared)
 *  11. EXCSQLIMM(CALL) -> RSLSETRM  (stored proc, multiple result sets)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// -- DSS header constants
const DSS_MAGIC           = 0xD0;
const DSS_TYPE_RQSDSS     = 0x01;
const DSS_CHAIN_SAME_CORR = 0x40;

// -- DDM Code Points: Attribute exchange
const CP_EXCSAT   = 0x1041;
const CP_EXCSATRD = 0x1443;
const CP_EXTNAM   = 0x115E;
const CP_SRVCLSNM = 0x1147;
const CP_SRVRLSLV = 0x115A;
const CP_SRVNAM   = 0x116D;
const CP_MGRLVLLS = 0x1404;
const CP_AGENT    = 0x1403;
const CP_SQLAM    = 0x2407;
const CP_RDB      = 0x240F;
const CP_SECMGR   = 0x1440;
const CP_CMNTCPIP = 0x1474;

// Authentication
const CP_ACCSEC   = 0x106D;
const CP_ACCSECRD = 0x14AC;
const CP_SECCHK   = 0x106E;
const CP_SECCHKRM = 0x1219;
const CP_SECMEC   = 0x11A2;
const CP_USRID    = 0x11A0;
const CP_PASSWORD = 0x11A1;
const CP_SVRCOD   = 0x1149;
const CP_SECCHKCD = 0x11A4;

// Database access
const CP_ACCRDB    = 0x2001;
const CP_RDBNAM    = 0x2110;
const CP_RDBCOLID  = 0x2111;
const CP_PKGNAM    = 0x2112;
const CP_PKGCNSTKN = 0x2125;
const CP_PKGSN     = 0x2124;
const CP_PKGNAMCSN = 0x2026;
const CP_RDBACCCL  = 0x210F;
const CP_TYPDEFNAM = 0x002F;
const CP_TYPDEFOVR = 0x0035;
const CP_CRRTKN    = 0x0012;
const CP_PRDID     = 0x112E;
const CP_RDBALWUPD = 0x211A;
const CP_CCSIDSBC  = 0x119C;
const CP_CCSIDDBC  = 0x119D;
const CP_CCSIDMBC  = 0x119E;

// SQL execution
const CP_EXCSQLIMM = 0x200A;
const CP_OPNQRY    = 0x200C;
const CP_OPNQRYRM  = 0x2205;
const CP_QRYDSC    = 0x241A;
const CP_QRYDTA    = 0x241B;
const CP_FETCH     = 0x200F;
const CP_CLSQRY    = 0x2006;
const CP_RDBCMM    = 0x200E;
const CP_RDBRLLBCK = 0x200D;
const CP_SQLSTT    = 0x2414;
const CP_SQLCARD   = 0x2245;
const CP_SQLDARD   = 0x227D;
const CP_ENDUOWRM  = 0x220C;
const CP_RDBUPDRM  = 0x2218;
const CP_QRYBLKSZ  = 0x2114;
const CP_QRYROWSET = 0x2132;

// FDOCA column type codes
const FDOCA_VARCHAR     = 0x30;
const FDOCA_CHAR        = 0x2C;
const FDOCA_LONGVARCHAR = 0x34;
const FDOCA_INTEGER     = 0x50;
const FDOCA_SMALLINT    = 0x52;
const FDOCA_REAL        = 0x44;
const FDOCA_DOUBLE      = 0x46;
const FDOCA_DECIMAL     = 0x3E;
const FDOCA_DATE        = 0x90;
const FDOCA_TIME        = 0x92;
const FDOCA_TIMESTAMP   = 0x94;
const FDOCA_BIGINT      = 0x16;
const FDOCA_BLOB        = 0x58;
const FDOCA_CLOB        = 0x5C;

// Prepared statements + multiple result sets
const CP_PRPSQLSTT = 0x200B;
const CP_EXCSQLSTT = 0x2012;
const CP_SQLDTA    = 0x2412;
const CP_SQLDTARD  = 0x2413;
const CP_RSLSETRM  = 0x220E;
const CP_NBRROW    = 0x2116;

// Security
const SECMEC_USRIDPWD = 0x0003;

// Derby defaults
const PKG_COLLECTION = 'NULLID';
const PKG_NAME       = 'SYSSH200';

// ── Low-level DDM builders ───────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function buildStringParam(codePoint: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + bytes.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 4 + bytes.length, false);
  v.setUint16(2, codePoint, false);
  out.set(bytes, 4);
  return out;
}

function buildUint16Param(codePoint: number, value: number): Uint8Array {
  const out = new Uint8Array(6);
  const v = new DataView(out.buffer);
  v.setUint16(0, 6, false);
  v.setUint16(2, codePoint, false);
  v.setUint16(4, value, false);
  return out;
}

function buildUint32Param(codePoint: number, value: number): Uint8Array {
  const out = new Uint8Array(8);
  const v = new DataView(out.buffer);
  v.setUint16(0, 8, false);
  v.setUint16(2, codePoint, false);
  v.setUint32(4, value, false);
  return out;
}

function buildByte1Param(codePoint: number, value: number): Uint8Array {
  const out = new Uint8Array(5);
  const v = new DataView(out.buffer);
  v.setUint16(0, 5, false);
  v.setUint16(2, codePoint, false);
  out[4] = value;
  return out;
}

function buildBytesParam(codePoint: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 4 + data.length, false);
  v.setUint16(2, codePoint, false);
  out.set(data, 4);
  return out;
}

function buildDSS(ddmCodePoint: number, params: Uint8Array[], correlId: number, chainNext = false): Uint8Array {
  const paramsTotal = params.reduce((n, p) => n + p.length, 0);
  const ddmLen = 4 + paramsTotal;
  const dssLen = 6 + ddmLen;
  const pkt = new Uint8Array(dssLen);
  const v = new DataView(pkt.buffer);
  v.setUint16(0, dssLen, false);
  pkt[2] = DSS_MAGIC;
  pkt[3] = DSS_TYPE_RQSDSS | (chainNext ? DSS_CHAIN_SAME_CORR : 0);
  v.setUint16(4, correlId, false);
  v.setUint16(6, ddmLen, false);
  v.setUint16(8, ddmCodePoint, false);
  let offset = 10;
  for (const p of params) { pkt.set(p, offset); offset += p.length; }
  return pkt;
}

function buildMgrLvlLs(): Uint8Array {
  const managers = [
    { cp: CP_AGENT, level: 7 }, { cp: CP_SQLAM, level: 7 },
    { cp: CP_RDB, level: 7 },   { cp: CP_SECMGR, level: 7 },
    { cp: CP_CMNTCPIP, level: 7 },
  ];
  const len = 4 + managers.length * 4;
  const out = new Uint8Array(len);
  const v = new DataView(out.buffer);
  v.setUint16(0, len, false);
  v.setUint16(2, CP_MGRLVLLS, false);
  let off = 4;
  for (const m of managers) { v.setUint16(off, m.cp, false); v.setUint16(off + 2, m.level, false); off += 4; }
  return out;
}

function buildTypdefovr(ccsid = 1208): Uint8Array {
  const subLen = 3 * 6;
  const len = 4 + subLen;
  const out = new Uint8Array(len);
  const v = new DataView(out.buffer);
  v.setUint16(0, len, false);
  v.setUint16(2, CP_TYPDEFOVR, false);
  let off = 4;
  for (const cp of [CP_CCSIDSBC, CP_CCSIDDBC, CP_CCSIDMBC]) {
    v.setUint16(off, 6, false); v.setUint16(off + 2, cp, false); v.setUint16(off + 4, ccsid, false); off += 6;
  }
  return out;
}

function buildPKGNAMCSN(database: string, pkgSn: number): Uint8Array {
  const inner = concat(
    buildStringParam(CP_RDBNAM, database),
    buildStringParam(CP_RDBCOLID, PKG_COLLECTION),
    buildStringParam(CP_PKGNAM, PKG_NAME),
    buildBytesParam(CP_PKGCNSTKN, new Uint8Array(8)),
    buildUint16Param(CP_PKGSN, pkgSn),
  );
  const out = new Uint8Array(4 + inner.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 4 + inner.length, false);
  v.setUint16(2, CP_PKGNAMCSN, false);
  out.set(inner, 4);
  return out;
}

// ── Protocol message builders ────────────────────────────────────────────────

function buildEXCSAT(): Uint8Array {
  return buildDSS(CP_EXCSAT, [
    buildStringParam(CP_EXTNAM, 'portofcall'),
    buildStringParam(CP_SRVCLSNM, 'DRDA/TCP'),
    buildStringParam(CP_SRVRLSLV, '01.00.0000'),
    buildStringParam(CP_SRVNAM, 'portofcall'),
    buildMgrLvlLs(),
  ], 1, true);
}

function buildACCSEC(database: string): Uint8Array {
  return buildDSS(CP_ACCSEC, [
    buildUint16Param(CP_SECMEC, SECMEC_USRIDPWD),
    buildStringParam(CP_RDBNAM, database),
  ], 1, false);
}

function buildSECCHK(database: string, username: string, password: string): Uint8Array {
  return buildDSS(CP_SECCHK, [
    buildUint16Param(CP_SECMEC, SECMEC_USRIDPWD),
    buildStringParam(CP_RDBNAM, database),
    buildStringParam(CP_USRID, username),
    buildStringParam(CP_PASSWORD, password),
  ], 2, true);
}

function buildACCRDB(database: string): Uint8Array {
  return buildDSS(CP_ACCRDB, [
    buildStringParam(CP_RDBNAM, database),
    buildUint16Param(CP_RDBACCCL, CP_SQLAM),
    buildStringParam(CP_TYPDEFNAM, 'QTDSQLXVSS'),
    buildTypdefovr(1208),
    buildStringParam(CP_PRDID, 'CSS01070'),
    buildBytesParam(CP_CRRTKN, new Uint8Array(8)),
    buildByte1Param(CP_RDBALWUPD, 0x01),
  ], 2, false);
}

function buildEXCSQLIMM(database: string, sql: string, pkgSn: number): Uint8Array {
  const sqlBytes = new TextEncoder().encode(sql);
  const sqlstt = new Uint8Array(4 + sqlBytes.length);
  const sv = new DataView(sqlstt.buffer);
  sv.setUint16(0, sqlstt.length, false);
  sv.setUint16(2, CP_SQLSTT, false);
  sqlstt.set(sqlBytes, 4);
  return buildDSS(CP_EXCSQLIMM, [buildPKGNAMCSN(database, pkgSn), buildByte1Param(0x211C, 0x01), sqlstt], 3, false);
}

function buildOPNQRY(database: string, sql: string, pkgSn: number): Uint8Array {
  const sqlBytes = new TextEncoder().encode(sql);
  const sqlstt = new Uint8Array(4 + sqlBytes.length);
  const sv = new DataView(sqlstt.buffer);
  sv.setUint16(0, sqlstt.length, false);
  sv.setUint16(2, CP_SQLSTT, false);
  sqlstt.set(sqlBytes, 4);
  return buildDSS(CP_OPNQRY, [buildPKGNAMCSN(database, pkgSn), buildUint32Param(CP_QRYBLKSZ, 32767), buildUint16Param(CP_QRYROWSET, 100), sqlstt], 3, false);
}

function buildFETCH(database: string, queryToken: Uint8Array, pkgSn: number): Uint8Array {
  return buildDSS(CP_FETCH, [buildPKGNAMCSN(database, pkgSn), buildUint32Param(CP_QRYBLKSZ, 32767), buildUint16Param(CP_QRYROWSET, 100), buildBytesParam(0x2135, queryToken)], 4, false);
}

function buildCLSQRY(database: string, queryToken: Uint8Array, pkgSn: number): Uint8Array {
  return buildDSS(CP_CLSQRY, [buildPKGNAMCSN(database, pkgSn), buildBytesParam(0x2135, queryToken)], 5, false);
}

function buildRDBCMM(): Uint8Array {
  return buildDSS(CP_RDBCMM, [], 6, false);
}

export function buildRDRLLBCK(): Uint8Array {
  return buildDSS(CP_RDBRLLBCK, [], 6, false);
}

// ── Prepared statement builders (exported to survive noUnusedLocals) ─────────

/** SQL parameter type for prepared statements */
export type SqldtaParam = string | number | bigint | boolean | null;

/**
 * Encode parameters as SQLDTA DDM object for prepared statement execution.
 * Each param: null→indicator(-1); string→indicator+len+bytes; int→indicator+int32;
 * bigint→indicator+int64; float→indicator+float64; bool→indicator+int16.
 */
export function buildSQLDTA(params: SqldtaParam[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const p of params) {
    if (p === null || p === undefined) {
      const ind = new Uint8Array(2); new DataView(ind.buffer).setInt16(0, -1, false); parts.push(ind); continue;
    }
    parts.push(new Uint8Array(2)); // null indicator = 0
    if (typeof p === 'string') {
      const strBytes = new TextEncoder().encode(p);
      const vlen = new Uint8Array(2); new DataView(vlen.buffer).setUint16(0, strBytes.length, false);
      parts.push(vlen, strBytes);
    } else if (typeof p === 'bigint') {
      const val = new Uint8Array(8); const dv = new DataView(val.buffer);
      dv.setInt32(0, Number(p >> 32n), false); dv.setInt32(4, Number(p & 0xFFFFFFFFn), false);
      parts.push(val);
    } else if (typeof p === 'boolean') {
      const val = new Uint8Array(2); new DataView(val.buffer).setInt16(0, p ? 1 : 0, false); parts.push(val);
    } else if (Number.isInteger(p) && (p as number) >= -2147483648 && (p as number) <= 2147483647) {
      const val = new Uint8Array(4); new DataView(val.buffer).setInt32(0, p as number, false); parts.push(val);
    } else {
      const val = new Uint8Array(8); new DataView(val.buffer).setFloat64(0, p as number, false); parts.push(val);
    }
  }
  const inner = concat(...parts);
  const out = new Uint8Array(4 + inner.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 4 + inner.length, false);
  v.setUint16(2, CP_SQLDTA, false);
  out.set(inner, 4);
  return out;
}

/** Prepare an SQL statement. Server returns SQLDARD with column/param types. */
export function buildPRPSQLSTT(database: string, sql: string, pkgSn: number): Uint8Array {
  const sqlBytes = new TextEncoder().encode(sql);
  const sqlstt = new Uint8Array(4 + sqlBytes.length);
  const sv = new DataView(sqlstt.buffer);
  sv.setUint16(0, sqlstt.length, false); sv.setUint16(2, CP_SQLSTT, false); sqlstt.set(sqlBytes, 4);
  return buildDSS(CP_PRPSQLSTT, [buildPKGNAMCSN(database, pkgSn), buildUint16Param(0x2104, 0x0000), sqlstt], 3, false);
}

/** Execute a prepared DML statement with SQLDTA parameters. */
export function buildEXCSQLSTT(database: string, params: SqldtaParam[], pkgSn: number): Uint8Array {
  return buildDSS(CP_EXCSQLSTT, [buildPKGNAMCSN(database, pkgSn), buildSQLDTA(params)], 4, false);
}

/** Open a prepared SELECT query with SQLDTA parameters. */
export function buildOPNQRYPrepared(database: string, params: SqldtaParam[], pkgSn: number): Uint8Array {
  return buildDSS(CP_OPNQRY, [buildPKGNAMCSN(database, pkgSn), buildUint32Param(CP_QRYBLKSZ, 32767), buildUint16Param(CP_QRYROWSET, 100), buildSQLDTA(params)], 4, false);
}

// ── SSL/TLS connect helper ────────────────────────────────────────────────────

async function openSocket(
  host: string, port: number, ssl: boolean, tp: Promise<never>,
): Promise<{ writer: WritableStreamDefaultWriter<Uint8Array>; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const socket = connect(`${host}:${port}`, ssl ? ({ secureTransport: 'on', allowHalfOpen: false } as SocketOptions) : undefined);
  await Promise.race([socket.opened, tp]);
  return { writer: socket.writable.getWriter(), reader: socket.readable.getReader() };
}

// ── Socket I/O ────────────────────────────────────────────────────────────────

async function readDSS(reader: ReadableStreamDefaultReader<Uint8Array>, tp: Promise<never>, maxBytes = 65536): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const result = await Promise.race([reader.read(), tp]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;
    if (isDSSChainComplete(concat(...chunks))) break;
  }
  return chunks.length === 0 ? new Uint8Array(0) : concat(...chunks);
}

function isDSSChainComplete(buf: Uint8Array): boolean {
  let off = 0;
  while (off + 6 <= buf.length) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = v.getUint16(off, false);
    if (len < 6 || off + len > buf.length) return false;
    const chained = (buf[off + 3] & 0x40) !== 0;
    off += len;
    if (!chained) return true;
  }
  return false;
}

// ── DDM Response Parser ───────────────────────────────────────────────────────

interface DDMObject { codePoint: number; data: Uint8Array; children: DDMObject[]; }

function parseDSSChain(buf: Uint8Array): DDMObject[] {
  const objects: DDMObject[] = [];
  let dssOff = 0;
  while (dssOff + 6 <= buf.length) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dssLen = v.getUint16(dssOff, false);
    if (dssLen < 6 || dssOff + dssLen > buf.length) break;
    if (buf[dssOff + 2] === DSS_MAGIC) parseDDMObjects(buf, dssOff + 6, dssOff + dssLen, objects);
    dssOff += dssLen;
  }
  return objects;
}

function parseDDMObjects(buf: Uint8Array, start: number, end: number, out: DDMObject[]): void {
  let off = start;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (off + 4 <= end) {
    const len = v.getUint16(off, false);
    if (len < 4 || off + len > end) break;
    const cp = v.getUint16(off + 2, false);
    const data = buf.slice(off + 4, off + len);
    const obj: DDMObject = { codePoint: cp, data, children: [] };
    parseDDMObjects(buf, off + 4, off + len, obj.children);
    out.push(obj);
    off += len;
  }
}

function findObject(objects: DDMObject[], cp: number): DDMObject | undefined {
  for (const obj of objects) {
    if (obj.codePoint === cp) return obj;
    const found = findObject(obj.children, cp);
    if (found) return found;
  }
  return undefined;
}

// ── EXCSATRD parser ───────────────────────────────────────────────────────────

interface EXCSATRDResult {
  isDRDA: boolean; serverName: string | null; serverClass: string | null;
  serverRelease: string | null; externalName: string | null;
  managers: Array<{ name: string; level: number }>;
}

function parseEXCSATRD(data: Uint8Array): EXCSATRDResult {
  const result: EXCSATRDResult = { isDRDA: false, serverName: null, serverClass: null, serverRelease: null, externalName: null, managers: [] };
  if (data.length < 10 || data[2] !== DSS_MAGIC) return result;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint16(8, false) !== CP_EXCSATRD) return result;
  result.isDRDA = true;
  const ddmEnd = 6 + v.getUint16(6, false);
  let off = 10;
  const dec = new TextDecoder();
  const mgrNames: Record<number, string> = { [CP_AGENT]: 'AGENT', [CP_SQLAM]: 'SQLAM', [CP_RDB]: 'RDB', [CP_SECMGR]: 'SECMGR', [CP_CMNTCPIP]: 'CMNTCPIP' };
  while (off + 4 <= ddmEnd && off + 4 <= data.length) {
    const plen = v.getUint16(off, false);
    if (plen < 4 || off + plen > data.length) break;
    const pcp = v.getUint16(off + 2, false);
    const pval = data.slice(off + 4, off + plen);
    switch (pcp) {
      case CP_SRVNAM:   result.serverName    = dec.decode(pval).trim(); break;
      case CP_SRVCLSNM: result.serverClass   = dec.decode(pval).trim(); break;
      case CP_SRVRLSLV: result.serverRelease = dec.decode(pval).trim(); break;
      case CP_EXTNAM:   result.externalName  = dec.decode(pval).trim(); break;
      case CP_MGRLVLLS: {
        const mv = new DataView(pval.buffer, pval.byteOffset, pval.byteLength);
        for (let i = 0; i + 3 < pval.length; i += 4) result.managers.push({ name: mgrNames[mv.getUint16(i, false)] || `0x${mv.getUint16(i, false).toString(16)}`, level: mv.getUint16(i + 2, false) });
        break;
      }
    }
    off += plen;
  }
  return result;
}

// ── SQL result parsers ────────────────────────────────────────────────────────

interface ColumnDescriptor { name: string; type: number; nullable: boolean; length: number; precision: number; scale: number; }

function parseSQLDARD(data: Uint8Array): ColumnDescriptor[] {
  const cols: ColumnDescriptor[] = [];
  if (data.length < 6) return cols;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = v.getUint16(0, false);
  let off = 4;
  for (let i = 0; i < count && off + 8 <= data.length; i++) {
    const sqlType = v.getUint16(off, false);
    const sqlLength = v.getUint16(off + 2, false);
    const precision = data[off + 4] ?? 0;
    const scale = data[off + 5] ?? 0;
    const nameLen = v.getUint16(off + 6, false);
    const nameEnd = Math.min(off + 8 + nameLen, data.length);
    const name = new TextDecoder().decode(data.slice(off + 8, nameEnd)).trim() || `col${i + 1}`;
    cols.push({ name, type: sqlType & 0xFFFE, nullable: (sqlType & 1) === 1, length: sqlLength, precision, scale });
    off += 8 + nameLen;
    if (off % 4 !== 0) off += 4 - (off % 4);
  }
  return cols;
}

type RowValue = string | number | null;

function parseQRYDTA(data: Uint8Array, cols: ColumnDescriptor[]): RowValue[][] {
  const rows: RowValue[][] = [];
  if (cols.length === 0) return rows;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  while (off < data.length) {
    if (data[off] === 0x00) break;
    if (data[off] === 0xFF) { off++; continue; }
    const row: RowValue[] = [];
    let ok = true;
    for (const col of cols) {
      if (off >= data.length) { ok = false; break; }
      if (col.nullable) {
        if (off + 2 > data.length) { ok = false; break; }
        const indicator = v.getInt16(off, false); off += 2;
        if (indicator === -1) { row.push(null); continue; }
      }
      const baseType = col.type & 0xFFFE;
      try {
        switch (baseType) {
          case FDOCA_VARCHAR: case FDOCA_LONGVARCHAR: {
            if (off + 2 > data.length) { ok = false; break; }
            const len = v.getUint16(off, false); off += 2;
            if (off + len > data.length) { ok = false; break; }
            row.push(new TextDecoder().decode(data.slice(off, off + len))); off += len; break;
          }
          case FDOCA_CHAR: {
            const len = col.length;
            if (off + len > data.length) { ok = false; break; }
            row.push(new TextDecoder().decode(data.slice(off, off + len)).trimEnd()); off += len; break;
          }
          case FDOCA_SMALLINT: { if (off + 2 > data.length) { ok = false; break; } row.push(v.getInt16(off, false)); off += 2; break; }
          case FDOCA_INTEGER:  { if (off + 4 > data.length) { ok = false; break; } row.push(v.getInt32(off, false)); off += 4; break; }
          case FDOCA_BIGINT: {
            if (off + 8 > data.length) { ok = false; break; }
            row.push(`${(BigInt(v.getUint32(off, false)) << 32n) | BigInt(v.getUint32(off + 4, false))}`); off += 8; break;
          }
          case FDOCA_REAL:   { if (off + 4 > data.length) { ok = false; break; } row.push(v.getFloat32(off, false)); off += 4; break; }
          case FDOCA_DOUBLE: { if (off + 8 > data.length) { ok = false; break; } row.push(v.getFloat64(off, false)); off += 8; break; }
          case FDOCA_DECIMAL: {
            const packedLen = Math.ceil((col.precision + 1) / 2);
            if (off + packedLen > data.length) { ok = false; break; }
            row.push(decodePackedDecimal(data, off, packedLen, col.scale)); off += packedLen; break;
          }
          case FDOCA_DATE: { if (off + 10 > data.length) { ok = false; break; } row.push(new TextDecoder().decode(data.slice(off, off + 10))); off += 10; break; }
          case FDOCA_TIME: { if (off + 8 > data.length) { ok = false; break; } row.push(new TextDecoder().decode(data.slice(off, off + 8))); off += 8; break; }
          case FDOCA_TIMESTAMP: { if (off + 26 > data.length) { ok = false; break; } row.push(new TextDecoder().decode(data.slice(off, off + 26))); off += 26; break; }
          case FDOCA_BLOB: case FDOCA_CLOB: {
            if (off + 4 > data.length) { ok = false; break; }
            const blobLen = v.getUint32(off, false); off += 4;
            row.push(`[LOB: ${blobLen} bytes]`); off = Math.min(off + blobLen, data.length); break;
          }
          default: {
            if (col.length > 0 && off + col.length <= data.length) { row.push(`[type 0x${baseType.toString(16)}: ${col.length}B]`); off += col.length; }
            else { ok = false; }
          }
        }
      } catch { ok = false; }
      if (!ok) break;
    }
    if (!ok) break;
    if (row.length === cols.length) rows.push(row);
  }
  return rows;
}

function decodePackedDecimal(buf: Uint8Array, off: number, len: number, scale: number): string {
  let digits = '';
  for (let i = 0; i < len - 1; i++) { digits += ((buf[off + i] >> 4) & 0xF).toString(); digits += (buf[off + i] & 0xF).toString(); }
  const lastByte = buf[off + len - 1];
  digits += ((lastByte >> 4) & 0xF).toString();
  const sign = (lastByte & 0xF) === 0xD ? '-' : '';
  return scale > 0 && digits.length > scale ? sign + digits.slice(0, -scale) + '.' + digits.slice(-scale) : sign + digits;
}

function parseSQLCARD(data: Uint8Array): { sqlCode: number; sqlState: string; message: string } {
  if (data.length < 6) return { sqlCode: 0, sqlState: '00000', message: '' };
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sqlCode = v.getInt32(0, false);
  const sqlState = new TextDecoder().decode(data.slice(4, 9));
  let message = '';
  if (data.length > 9) { const msgLen = v.getUint16(9, false); if (msgLen > 0 && 11 + msgLen <= data.length) message = new TextDecoder().decode(data.slice(11, 11 + msgLen)); }
  return { sqlCode, sqlState, message };
}

// ── Error helpers ────────────────────────────────────────────────────────────

function cfBlockedResponse(host: string, ip: string): Response {
  return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

function errResponse(msg: string, status = 500): Response {
  return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── Shared auth helper ────────────────────────────────────────────────────────

interface AuthParams { host: string; port: number; database: string; username: string; password: string; ssl: boolean; timeout: number; }

async function doAuth(params: AuthParams, tp: Promise<never>): Promise<
  | { ok: true; writer: WritableStreamDefaultWriter<Uint8Array>; reader: ReadableStreamDefaultReader<Uint8Array>; excsatrd: EXCSATRDResult }
  | { ok: false; response: Response }
> {
  const { host, port, database, username, password, ssl } = params;
  let writer: WritableStreamDefaultWriter<Uint8Array>;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { const sock = await openSocket(host, port, ssl, tp); writer = sock.writer; reader = sock.reader; }
  catch (e) { return { ok: false, response: errResponse(e instanceof Error ? e.message : 'Connection failed') }; }
  const close = () => { try { writer.releaseLock(); reader.releaseLock(); } catch { /* ignore */ } };
  try {
    await writer.write(buildEXCSAT());
    const r1 = await readDSS(reader, tp);
    const excsatrd = parseEXCSATRD(r1);
    if (!excsatrd.isDRDA) { close(); return { ok: false, response: errResponse('Server does not speak DRDA') }; }
    await writer.write(buildACCSEC(database));
    const r2 = await readDSS(reader, tp);
    const accsecObjs = parseDSSChain(r2);
    if (!findObject(accsecObjs, CP_ACCSECRD)) {
      close();
      const svrcod = findObject(accsecObjs, CP_SVRCOD);
      return { ok: false, response: errResponse(`ACCSEC rejected (svrcod=${svrcod ? new DataView(svrcod.data.buffer).getUint16(0, false) : '?'})`) };
    }
    await writer.write(buildSECCHK(database, username, password));
    const r3 = await readDSS(reader, tp);
    const secObjs = parseDSSChain(r3);
    const secchkrm = findObject(secObjs, CP_SECCHKRM);
    if (secchkrm) {
      const code = findObject(secObjs, CP_SECCHKCD)?.data[0] ?? 0;
      if (code !== 0) {
        close();
        const msgs: Record<number, string> = { 0x01: 'Security violation', 0x04: 'Invalid user ID or password', 0x0A: 'New password required', 0x0E: 'Auth failed' };
        return { ok: false, response: errResponse(`Auth failed: ${msgs[code] ?? `SECCHKCD=0x${code.toString(16)}`}`, 401) };
      }
    }
    await writer.write(buildACCRDB(database));
    await readDSS(reader, tp);
    return { ok: true, writer, reader, excsatrd };
  } catch (e) { close(); return { ok: false, response: errResponse(e instanceof Error ? e.message : 'Unknown error') }; }
}

// ── Public handlers ───────────────────────────────────────────────────────────

export async function handleDRDAConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; timeout?: number };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, timeout = 10000 } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (port < 1 || port > 65535) return errResponse('Port must be between 1 and 65535', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  try {
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
    await Promise.race([socket.opened, tp]);
    const connectTime = Date.now() - startTime;
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    await writer.write(buildEXCSAT());
    const resp = await readDSS(reader, tp);
    const rtt = Date.now() - startTime;
    const parsed = parseEXCSATRD(resp);
    writer.releaseLock(); reader.releaseLock(); socket.close();
    return new Response(JSON.stringify({
      success: true, host, port, rtt, connectTime, isDRDA: parsed.isDRDA,
      serverName: parsed.serverName, serverClass: parsed.serverClass, serverRelease: parsed.serverRelease,
      externalName: parsed.externalName, managers: parsed.managers, rawBytesReceived: resp.length,
      message: parsed.isDRDA ? `DRDA server detected. ${parsed.serverClass ? `Class: ${parsed.serverClass}` : ''}${parsed.serverRelease ? `, Release: ${parsed.serverRelease}` : ''}` : 'Server responded but does not appear to be a DRDA server.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}

export async function handleDRDAProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; timeout?: number };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, timeout = 10000 } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  try {
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
    await Promise.race([socket.opened, tp]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    await writer.write(buildEXCSAT());
    const resp = await readDSS(reader, tp);
    const rtt = Date.now() - startTime;
    const parsed = parseEXCSATRD(resp);
    writer.releaseLock(); reader.releaseLock(); socket.close();
    return new Response(JSON.stringify({ success: true, host, port, rtt, isDRDA: parsed.isDRDA, serverClass: parsed.serverClass, serverRelease: parsed.serverRelease, message: parsed.isDRDA ? `DRDA server detected (${parsed.serverClass || 'unknown class'}).` : 'Not a DRDA server.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}

export async function handleDRDALogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; database?: string; username?: string; password?: string; timeout?: number; ssl?: boolean };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, database = '', username = '', password = '', timeout = 10000, ssl = false } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (!database) return errResponse('Missing required parameter: database', 400);
  if (!username) return errResponse('Missing required parameter: username', 400);
  if (port < 1 || port > 65535) return errResponse('Port must be between 1 and 65535', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  const startTime = Date.now();
  const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
  const auth = await doAuth({ host, port, database, username, password, ssl, timeout }, tp);
  if (!auth.ok) return auth.response;
  const { writer, reader, excsatrd } = auth;
  writer.releaseLock(); reader.releaseLock();
  return new Response(JSON.stringify({ success: true, host, port, database, username, ssl, rtt: Date.now() - startTime, authenticated: true, serverClass: excsatrd.serverClass, serverRelease: excsatrd.serverRelease, serverName: excsatrd.serverName, managers: excsatrd.managers, message: `Authenticated as ${username} and opened database ${database}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function handleDRDAQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; database?: string; username?: string; password?: string; sql?: string; maxRows?: number; timeout?: number; ssl?: boolean; params?: SqldtaParam[] };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, database = '', username = '', password = '', sql = '', maxRows = 100, timeout = 30000, ssl = false, params } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (!database) return errResponse('Missing required parameter: database', 400);
  if (!username) return errResponse('Missing required parameter: username', 400);
  if (!sql) return errResponse('Missing required parameter: sql', 400);
  if (!/^\s*(select|with|explain|values)/i.test(sql)) return errResponse('Only SELECT/WITH/EXPLAIN/VALUES queries are supported by /query. Use /execute for DML.', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  const startTime = Date.now();
  const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
  const auth = await doAuth({ host, port, database, username, password, ssl, timeout }, tp);
  if (!auth.ok) return auth.response;
  const { writer, reader } = auth;
  const close = () => { try { writer.releaseLock(); reader.releaseLock(); } catch { /* ignore */ } };
  try {
    let opnqryMsg: Uint8Array;
    if (params && params.length > 0) {
      await writer.write(buildPRPSQLSTT(database, sql, 1));
      const prpObjs = parseDSSChain(await readDSS(reader, tp));
      const prpCard = findObject(prpObjs, CP_SQLCARD);
      if (prpCard) { const err = parseSQLCARD(prpCard.data); if (err.sqlCode < 0) { close(); return errResponse(`Prepare failed (SQLCODE=${err.sqlCode}): ${err.message || sql}`); } }
      opnqryMsg = buildOPNQRYPrepared(database, params, 2);
    } else { opnqryMsg = buildOPNQRY(database, sql, 1); }
    await writer.write(opnqryMsg);
    const r5 = await readDSS(reader, tp);
    const queryObjs = parseDSSChain(r5);
    const opnqryrm = findObject(queryObjs, CP_OPNQRYRM);
    const sqlcard = findObject(queryObjs, CP_SQLCARD);
    if (!opnqryrm) { close(); if (sqlcard) { const err = parseSQLCARD(sqlcard.data); return errResponse(`SQL error (SQLCODE=${err.sqlCode}, SQLSTATE=${err.sqlState}): ${err.message || sql}`); } return errResponse('OPNQRY failed'); }
    const queryToken = opnqryrm.data.slice(0, 8);
    let columns: ColumnDescriptor[] = [];
    const sqldard = findObject(queryObjs, CP_SQLDARD);
    if (sqldard) columns = parseSQLDARD(sqldard.data);
    const qrydsc = findObject(queryObjs, CP_QRYDSC);
    if (qrydsc && columns.length === 0) columns = parseSQLDARD(qrydsc.data);
    const allRows: RowValue[][] = [];
    let qrydtaObj = findObject(queryObjs, CP_QRYDTA);
    while (qrydtaObj && allRows.length < maxRows) {
      const newRows = parseQRYDTA(qrydtaObj.data, columns);
      allRows.push(...newRows);
      if (newRows.length === 0 || allRows.length >= maxRows) break;
      await writer.write(buildFETCH(database, queryToken, 1));
      const fetchObjs = parseDSSChain(await readDSS(reader, tp));
      qrydtaObj = findObject(fetchObjs, CP_QRYDTA);
      const fc = findObject(fetchObjs, CP_SQLCARD);
      if (fc && parseSQLCARD(fc.data).sqlCode === 100) break;
    }
    try { await writer.write(buildCLSQRY(database, queryToken, 1)); await readDSS(reader, tp); await writer.write(buildRDBCMM()); await readDSS(reader, tp); } catch { /* best-effort */ }
    close();
    return new Response(JSON.stringify({ success: true, host, port, database, sql, rtt: Date.now() - startTime, parameterized: !!(params && params.length > 0), columns: columns.map(c => ({ name: c.name, type: `0x${c.type.toString(16)}`, nullable: c.nullable, length: c.length })), rows: allRows, rowCount: allRows.length, truncated: allRows.length >= maxRows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { close(); return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}

export async function handleDRDAExecute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; database?: string; username?: string; password?: string; sql?: string; timeout?: number; ssl?: boolean; params?: SqldtaParam[] };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, database = '', username = '', password = '', sql = '', timeout = 30000, ssl = false, params } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (!database) return errResponse('Missing required parameter: database', 400);
  if (!username) return errResponse('Missing required parameter: username', 400);
  if (!sql) return errResponse('Missing required parameter: sql', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  const startTime = Date.now();
  const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
  const auth = await doAuth({ host, port, database, username, password, ssl, timeout }, tp);
  if (!auth.ok) return auth.response;
  const { writer, reader } = auth;
  const close = () => { try { writer.releaseLock(); reader.releaseLock(); } catch { /* ignore */ } };
  try {
    let execObjs: DDMObject[];
    if (params && params.length > 0) {
      await writer.write(buildPRPSQLSTT(database, sql, 1));
      const prpObjs = parseDSSChain(await readDSS(reader, tp));
      const prpCard = findObject(prpObjs, CP_SQLCARD);
      if (prpCard) { const err = parseSQLCARD(prpCard.data); if (err.sqlCode < 0) { close(); return errResponse(`Prepare failed (SQLCODE=${err.sqlCode}): ${err.message || sql}`); } }
      void findObject(prpObjs, CP_SQLDTARD); // acknowledged
      await writer.write(buildEXCSQLSTT(database, params, 1));
      execObjs = parseDSSChain(await readDSS(reader, tp));
    } else {
      await writer.write(buildEXCSQLIMM(database, sql, 1));
      execObjs = parseDSSChain(await readDSS(reader, tp));
    }
    try { await writer.write(buildRDBCMM()); await readDSS(reader, tp); } catch { /* best-effort */ }
    close();
    const rtt = Date.now() - startTime;
    const sqlcard = findObject(execObjs, CP_SQLCARD);
    const enduow = findObject(execObjs, CP_ENDUOWRM);
    const rdbupd = findObject(execObjs, CP_RDBUPDRM);
    let sqlCode = 0; let sqlState = '00000'; let errorMsg = '';
    if (sqlcard) { const sc = parseSQLCARD(sqlcard.data); sqlCode = sc.sqlCode; sqlState = sc.sqlState; errorMsg = sc.message; }
    if (sqlCode < 0) return new Response(JSON.stringify({ success: false, host, port, database, sql, rtt, sqlCode, sqlState, error: errorMsg || `SQL error SQLCODE=${sqlCode}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let rowsAffected: number | null = null;
    if (rdbupd && rdbupd.data.length >= 4) rowsAffected = new DataView(rdbupd.data.buffer, rdbupd.data.byteOffset).getInt32(0, false);
    return new Response(JSON.stringify({ success: true, host, port, database, sql, rtt, parameterized: !!(params && params.length > 0), sqlCode, sqlState, rowsAffected, committed: !!enduow, message: rowsAffected !== null ? `${rowsAffected} row(s) affected` : 'Statement executed successfully' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { close(); return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}

export async function handleDRDAPreparex(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; database?: string; username?: string; password?: string; sql?: string; timeout?: number; ssl?: boolean };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, database = '', username = '', password = '', sql = '', timeout = 15000, ssl = false } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (!database) return errResponse('Missing required parameter: database', 400);
  if (!username) return errResponse('Missing required parameter: username', 400);
  if (!sql) return errResponse('Missing required parameter: sql', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  const startTime = Date.now();
  const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
  const auth = await doAuth({ host, port, database, username, password, ssl, timeout }, tp);
  if (!auth.ok) return auth.response;
  const { writer, reader } = auth;
  const close = () => { try { writer.releaseLock(); reader.releaseLock(); } catch { /* ignore */ } };
  try {
    await writer.write(buildPRPSQLSTT(database, sql, 1));
    const objs = parseDSSChain(await readDSS(reader, tp));
    close();
    const rtt = Date.now() - startTime;
    const sqlcard = findObject(objs, CP_SQLCARD);
    if (sqlcard) { const err = parseSQLCARD(sqlcard.data); if (err.sqlCode < 0) return new Response(JSON.stringify({ success: false, host, port, database, sql, rtt, sqlCode: err.sqlCode, sqlState: err.sqlState, error: err.message || `Prepare failed SQLCODE=${err.sqlCode}` }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    const sqldard = findObject(objs, CP_SQLDARD);
    const sqldtard = findObject(objs, CP_SQLDTARD);
    const columns = sqldard ? parseSQLDARD(sqldard.data) : [];
    const parameters = sqldtard ? parseSQLDARD(sqldtard.data) : [];
    return new Response(JSON.stringify({ success: true, host, port, database, sql, rtt, columns: columns.map(c => ({ name: c.name, type: `0x${c.type.toString(16)}`, nullable: c.nullable, length: c.length, precision: c.precision, scale: c.scale })), parameters: parameters.map(p => ({ name: p.name, type: `0x${p.type.toString(16)}`, nullable: p.nullable, length: p.length })), parameterCount: parameters.length, columnCount: columns.length, message: `Statement prepared. ${columns.length} result column(s), ${parameters.length} parameter(s).` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { close(); return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}

export async function handleDRDACall(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { host?: string; port?: number; database?: string; username?: string; password?: string; procedure?: string; params?: SqldtaParam[]; timeout?: number; ssl?: boolean; maxRows?: number };
  try { body = await request.json() as typeof body; } catch { return errResponse('Invalid JSON body', 400); }
  const { host, port = 50000, database = '', username = '', password = '', procedure = '', params, timeout = 30000, ssl = false, maxRows = 100 } = body;
  if (!host) return errResponse('Missing required parameter: host', 400);
  if (!database) return errResponse('Missing required parameter: database', 400);
  if (!username) return errResponse('Missing required parameter: username', 400);
  if (!procedure) return errResponse('Missing required parameter: procedure', 400);
  if (!/^\s*call\s+/i.test(procedure)) return errResponse('procedure must be a CALL statement (e.g. "CALL schema.proc(?, ?)")', 400);
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return cfBlockedResponse(host, cfCheck.ip);
  const startTime = Date.now();
  const tp = new Promise<never>((_, rej) => setTimeout(rej, timeout, new Error('Connection timeout')));
  const auth = await doAuth({ host, port, database, username, password, ssl, timeout }, tp);
  if (!auth.ok) return auth.response;
  const { writer, reader } = auth;
  const close = () => { try { writer.releaseLock(); reader.releaseLock(); } catch { /* ignore */ } };
  try {
    let callObjs: DDMObject[];
    if (params && params.length > 0) {
      await writer.write(buildPRPSQLSTT(database, procedure, 1));
      const prpObjs = parseDSSChain(await readDSS(reader, tp));
      const prpCard = findObject(prpObjs, CP_SQLCARD);
      if (prpCard) { const err = parseSQLCARD(prpCard.data); if (err.sqlCode < 0) { close(); return errResponse(`Prepare failed (SQLCODE=${err.sqlCode}): ${err.message}`); } }
      await writer.write(buildEXCSQLSTT(database, params, 1));
      callObjs = parseDSSChain(await readDSS(reader, tp));
    } else {
      await writer.write(buildEXCSQLIMM(database, procedure, 1));
      callObjs = parseDSSChain(await readDSS(reader, tp));
    }
    const sqlcard = findObject(callObjs, CP_SQLCARD);
    if (sqlcard) { const err = parseSQLCARD(sqlcard.data); if (err.sqlCode < 0) { close(); return new Response(JSON.stringify({ success: false, host, port, database, procedure, rtt: Date.now() - startTime, sqlCode: err.sqlCode, sqlState: err.sqlState, error: err.message || `CALL failed SQLCODE=${err.sqlCode}` }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }
    const rslsetrm = findObject(callObjs, CP_RSLSETRM);
    let resultSetCount = 0;
    if (rslsetrm && rslsetrm.data.length >= 2) resultSetCount = new DataView(rslsetrm.data.buffer, rslsetrm.data.byteOffset).getUint16(0, false);
    const nbrrow = findObject(callObjs, CP_NBRROW);
    let rowsAffected: number | null = null;
    if (nbrrow && nbrrow.data.length >= 4) rowsAffected = new DataView(nbrrow.data.buffer, nbrrow.data.byteOffset).getInt32(0, false);
    const resultSets: Array<{ index: number; columns: Array<{ name: string; type: string; nullable: boolean; length: number }>; rows: RowValue[][]; rowCount: number }> = [];
    for (let rsIdx = 0; rsIdx < Math.max(resultSetCount, 1); rsIdx++) {
      const pkgSn = rsIdx + 2;
      try {
        await writer.write(buildDSS(CP_OPNQRY, [buildPKGNAMCSN(database, pkgSn), buildUint32Param(CP_QRYBLKSZ, 32767), buildUint16Param(CP_QRYROWSET, 100)], rsIdx + 10, false));
        const rsObjs = parseDSSChain(await readDSS(reader, tp));
        const rsOpnqryrm = findObject(rsObjs, CP_OPNQRYRM);
        if (!rsOpnqryrm) break;
        const rsToken = rsOpnqryrm.data.slice(0, 8);
        let rsCols: ColumnDescriptor[] = [];
        const rsSqldard = findObject(rsObjs, CP_SQLDARD);
        if (rsSqldard) rsCols = parseSQLDARD(rsSqldard.data);
        const rsQrydsc = findObject(rsObjs, CP_QRYDSC);
        if (rsQrydsc && rsCols.length === 0) rsCols = parseSQLDARD(rsQrydsc.data);
        const rsRows: RowValue[][] = [];
        let rsQrydta = findObject(rsObjs, CP_QRYDTA);
        while (rsQrydta && rsRows.length < maxRows) {
          const newRows = parseQRYDTA(rsQrydta.data, rsCols);
          rsRows.push(...newRows);
          if (newRows.length === 0 || rsRows.length >= maxRows) break;
          await writer.write(buildFETCH(database, rsToken, pkgSn));
          const fetchObjs = parseDSSChain(await readDSS(reader, tp));
          rsQrydta = findObject(fetchObjs, CP_QRYDTA);
          const fc = findObject(fetchObjs, CP_SQLCARD);
          if (fc && parseSQLCARD(fc.data).sqlCode === 100) break;
        }
        try { await writer.write(buildCLSQRY(database, rsToken, pkgSn)); await readDSS(reader, tp); } catch { /* best-effort */ }
        resultSets.push({ index: rsIdx, columns: rsCols.map(c => ({ name: c.name, type: `0x${c.type.toString(16)}`, nullable: c.nullable, length: c.length })), rows: rsRows, rowCount: rsRows.length });
      } catch { break; }
    }
    try { await writer.write(buildRDBCMM()); await readDSS(reader, tp); } catch { /* best-effort */ }
    close();
    return new Response(JSON.stringify({ success: true, host, port, database, procedure, rtt: Date.now() - startTime, resultSetCount, rowsAffected, resultSets, message: resultSets.length > 0 ? `${resultSets.length} result set(s) returned` : rowsAffected !== null ? `${rowsAffected} row(s) affected` : 'Stored procedure executed successfully' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { close(); return errResponse(e instanceof Error ? e.message : 'Unknown error'); }
}
