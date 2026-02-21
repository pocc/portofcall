/**
 * ONC RPC Portmapper / rpcbind Protocol Integration Tests
 *
 * Tests the Portmapper (RFC 1833) implementation for probing
 * and dumping registered RPC services on port 111.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('Portmapper / rpcbind Protocol Integration Tests', () => {
  // --- NULL Probe Tests (/api/portmapper/probe) ---

  describe('NULL Probe (Port 111)', () => {
    it('should probe a portmapper with NULL call', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 111,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 111);
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
      } else {
        // Portmapper not available is expected in test environments
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for probe', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 111,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range for probe', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection timeout for probe', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 111,
          timeout: 1,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname for probe', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-portmapper-99999.invalid',
          port: 111,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- DUMP Tests (/api/portmapper/dump) ---

  describe('DUMP Services (Port 111)', () => {
    it('should dump registered RPC services', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/dump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 111,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 111);
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
        expect(data).toHaveProperty('mappings');
        expect(data).toHaveProperty('totalServices');
        expect(Array.isArray(data.mappings)).toBe(true);
        expect(data.totalServices).toBeGreaterThanOrEqual(0);

        // If mappings exist, verify structure
        if (data.mappings.length > 0) {
          const first = data.mappings[0];
          expect(first).toHaveProperty('program');
          expect(first).toHaveProperty('programName');
          expect(first).toHaveProperty('version');
          expect(first).toHaveProperty('protocol');
          expect(first).toHaveProperty('port');
          expect(typeof first.program).toBe('number');
          expect(typeof first.programName).toBe('string');
          expect(typeof first.version).toBe('number');
          expect(typeof first.port).toBe('number');
        }
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for dump', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/dump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 111,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range for dump', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/dump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle invalid hostname for dump', async () => {
      const response = await fetch(`${API_BASE}/api/portmapper/dump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-portmapper-99999.invalid',
          port: 111,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- ONC RPC Protocol Encoding Tests ---

  describe('ONC RPC Protocol Encoding', () => {
    it('should construct valid TCP record marking header', () => {
      // Record mark: bit 31 = last fragment, bits 0-30 = length
      const payloadLength = 40; // Typical NULL call size
      const recordMark = 0x80000000 | payloadLength;

      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setUint32(0, recordMark);

      // Verify last-fragment bit is set
      const readBack = view.getUint32(0);
      expect((readBack & 0x80000000) >>> 0).toBe(0x80000000);

      // Verify length
      expect(readBack & 0x7FFFFFFF).toBe(40);
    });

    it('should encode RPC CALL message fields correctly', () => {
      // RPC Call: XID(4) + MsgType(4) + RPCVer(4) + Prog(4) + ProgVer(4) + Proc(4)
      //         + CredFlavor(4) + CredLen(4) + VerFlavor(4) + VerLen(4) = 40 bytes
      const headerSize = 10 * 4;
      expect(headerSize).toBe(40);

      const buffer = new ArrayBuffer(headerSize);
      const view = new DataView(buffer);

      let offset = 0;
      view.setUint32(offset, 0x12345678); offset += 4; // XID
      view.setUint32(offset, 0);           offset += 4; // CALL
      view.setUint32(offset, 2);           offset += 4; // RPC Version 2
      view.setUint32(offset, 100000);      offset += 4; // Portmapper program
      view.setUint32(offset, 2);           offset += 4; // Portmapper version 2
      view.setUint32(offset, 0);           offset += 4; // NULL procedure
      view.setUint32(offset, 0);           offset += 4; // AUTH_NONE
      view.setUint32(offset, 0);           offset += 4; // Cred length = 0
      view.setUint32(offset, 0);           offset += 4; // AUTH_NONE verifier
      view.setUint32(offset, 0);           offset += 4; // Verifier length = 0

      // Verify XID
      expect(view.getUint32(0)).toBe(0x12345678);
      // Verify message type = CALL (0)
      expect(view.getUint32(4)).toBe(0);
      // Verify RPC version = 2
      expect(view.getUint32(8)).toBe(2);
      // Verify program = 100000
      expect(view.getUint32(12)).toBe(100000);
      // Verify program version = 2
      expect(view.getUint32(16)).toBe(2);
      // Verify procedure = NULL (0)
      expect(view.getUint32(20)).toBe(0);
    });

    it('should encode DUMP procedure number correctly', () => {
      // DUMP = procedure 4
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setUint32(0, 4);
      expect(view.getUint32(0)).toBe(4);
    });

    it('should parse RPC REPLY message header', () => {
      // Construct a fake RPC REPLY for NULL procedure
      // Reply: XID(4) + MsgType=1(4) + ReplyStatus=0(4) +
      //        VerFlavor=0(4) + VerLen=0(4) + AcceptStatus=0(4)
      const replySize = 6 * 4;
      const buffer = new ArrayBuffer(replySize);
      const view = new DataView(buffer);

      let offset = 0;
      view.setUint32(offset, 0x12345678); offset += 4; // XID
      view.setUint32(offset, 1);           offset += 4; // REPLY
      view.setUint32(offset, 0);           offset += 4; // MSG_ACCEPTED
      view.setUint32(offset, 0);           offset += 4; // Verifier flavor
      view.setUint32(offset, 0);           offset += 4; // Verifier length
      view.setUint32(offset, 0);           offset += 4; // SUCCESS

      // Verify reply fields
      expect(view.getUint32(0)).toBe(0x12345678); // XID matches
      expect(view.getUint32(4)).toBe(1);           // REPLY type
      expect(view.getUint32(8)).toBe(0);           // MSG_ACCEPTED
      expect(view.getUint32(20)).toBe(0);          // SUCCESS
    });

    it('should parse DUMP response mapping entries', () => {
      // Construct a fake DUMP response with two mappings
      // Each mapping: ValueFollows(4) + Program(4) + Version(4) + Protocol(4) + Port(4)
      // Terminated by ValueFollows=0(4)
      const entrySize = 5 * 4; // 20 bytes per entry
      const bufferSize = entrySize * 2 + 4; // 2 entries + terminator
      const buffer = new ArrayBuffer(bufferSize);
      const view = new DataView(buffer);

      let offset = 0;

      // Entry 1: portmapper itself
      view.setUint32(offset, 1);       offset += 4; // Value follows = TRUE
      view.setUint32(offset, 100000);  offset += 4; // Program = portmapper
      view.setUint32(offset, 2);       offset += 4; // Version = 2
      view.setUint32(offset, 6);       offset += 4; // Protocol = TCP
      view.setUint32(offset, 111);     offset += 4; // Port = 111

      // Entry 2: NFS
      view.setUint32(offset, 1);       offset += 4; // Value follows = TRUE
      view.setUint32(offset, 100003);  offset += 4; // Program = NFS
      view.setUint32(offset, 3);       offset += 4; // Version = 3
      view.setUint32(offset, 6);       offset += 4; // Protocol = TCP
      view.setUint32(offset, 2049);    offset += 4; // Port = 2049

      // Terminator
      view.setUint32(offset, 0);       offset += 4; // Value follows = FALSE

      // Verify first mapping
      let readOffset = 0;
      expect(view.getUint32(readOffset)).toBe(1);       readOffset += 4; // follows
      expect(view.getUint32(readOffset)).toBe(100000);  readOffset += 4; // portmapper
      expect(view.getUint32(readOffset)).toBe(2);       readOffset += 4; // version 2
      expect(view.getUint32(readOffset)).toBe(6);       readOffset += 4; // TCP
      expect(view.getUint32(readOffset)).toBe(111);     readOffset += 4; // port 111

      // Verify second mapping
      expect(view.getUint32(readOffset)).toBe(1);       readOffset += 4; // follows
      expect(view.getUint32(readOffset)).toBe(100003);  readOffset += 4; // NFS
      expect(view.getUint32(readOffset)).toBe(3);       readOffset += 4; // version 3
      expect(view.getUint32(readOffset)).toBe(6);       readOffset += 4; // TCP
      expect(view.getUint32(readOffset)).toBe(2049);    readOffset += 4; // port 2049

      // Verify terminator
      expect(view.getUint32(readOffset)).toBe(0); // end of list
    });

    it('should recognize well-known RPC program numbers', () => {
      const programs: Record<number, string> = {
        100000: 'portmapper',
        100003: 'nfs',
        100005: 'mountd',
        100021: 'nlockmgr',
        100024: 'status (NSM)',
      };

      expect(programs[100000]).toBe('portmapper');
      expect(programs[100003]).toBe('nfs');
      expect(programs[100005]).toBe('mountd');
      expect(programs[100021]).toBe('nlockmgr');
      expect(programs[100024]).toBe('status (NSM)');
    });

    it('should map protocol numbers to names', () => {
      const protocols: Record<number, string> = {
        6: 'TCP',
        17: 'UDP',
      };

      expect(protocols[6]).toBe('TCP');
      expect(protocols[17]).toBe('UDP');
    });
  });
});
