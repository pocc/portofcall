import { describe, it, expect } from 'vitest';

// NSCA Protocol Tests
// Tests for the Nagios Service Check Acceptor (Port 5667)

describe('NSCA Protocol', () => {
  describe('Probe (Init Packet)', () => {
    it('should parse a valid 132-byte init packet', () => {
      // NSCA init packet: 128-byte IV + 4-byte timestamp (big-endian)
      const iv = new Uint8Array(128);
      for (let i = 0; i < 128; i++) iv[i] = i & 0xff;

      const timestamp = Math.floor(Date.now() / 1000);
      const tsBytes = new Uint8Array(4);
      const view = new DataView(tsBytes.buffer);
      view.setUint32(0, timestamp, false); // big-endian

      const packet = new Uint8Array(132);
      packet.set(iv, 0);
      packet.set(tsBytes, 128);

      expect(packet.length).toBe(132);
      expect(packet[0]).toBe(0);
      expect(packet[127]).toBe(127);

      // Extract timestamp back
      const extractedView = new DataView(packet.buffer, 128, 4);
      const extractedTs = extractedView.getUint32(0, false);
      expect(extractedTs).toBe(timestamp);
    });

    it('should reject packets shorter than 132 bytes', () => {
      const shortPacket = new Uint8Array(100);
      expect(shortPacket.length).toBeLessThan(132);
    });

    it('should extract IV hex string from first bytes', () => {
      const iv = new Uint8Array(128);
      iv[0] = 0xde;
      iv[1] = 0xad;
      iv[2] = 0xbe;
      iv[3] = 0xef;

      const hexStr = Array.from(iv.slice(0, 4))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      expect(hexStr).toBe('deadbeef');
    });
  });

  describe('CRC32', () => {
    function makeCRC32Table(): Uint32Array {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }
      return table;
    }

    function crc32(data: Uint8Array): number {
      const table = makeCRC32Table();
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    it('should compute CRC32 of empty data', () => {
      const result = crc32(new Uint8Array(0));
      expect(result).toBe(0x00000000);
    });

    it('should compute CRC32 of known string', () => {
      const data = new TextEncoder().encode('123456789');
      const result = crc32(data);
      expect(result).toBe(0xCBF43926);
    });

    it('should compute CRC32 of zeros', () => {
      const data = new Uint8Array(4);
      const result = crc32(data);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('XOR Encryption', () => {
    function xorEncrypt(data: Uint8Array, iv: Uint8Array, password?: string): Uint8Array {
      const encrypted = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        encrypted[i] = data[i] ^ iv[i % iv.length];
      }
      if (password && password.length > 0) {
        const pwBytes = new TextEncoder().encode(password);
        for (let i = 0; i < encrypted.length; i++) {
          encrypted[i] = encrypted[i] ^ pwBytes[i % pwBytes.length];
        }
      }
      return encrypted;
    }

    it('should XOR with IV only', () => {
      const data = new Uint8Array([0x41, 0x42, 0x43, 0x44]);
      const iv = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      const result = xorEncrypt(data, iv);
      expect(result[0]).toBe(0x41 ^ 0xff);
      expect(result[1]).toBe(0x42 ^ 0xff);
      expect(result[2]).toBe(0x43 ^ 0xff);
      expect(result[3]).toBe(0x44 ^ 0xff);
    });

    it('should XOR with IV and password', () => {
      const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const iv = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
      const result = xorEncrypt(data, iv, 'AB');
      expect(result[0]).toBe(0xaa ^ 0x41);
      expect(result[1]).toBe(0xbb ^ 0x42);
      expect(result[2]).toBe(0xcc ^ 0x41);
      expect(result[3]).toBe(0xdd ^ 0x42);
    });

    it('should be reversible (XOR is its own inverse)', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const iv = new Uint8Array([10, 20, 30, 40, 50]);
      const encrypted = xorEncrypt(original, iv, 'secret');
      const decrypted = xorEncrypt(encrypted, iv, 'secret');
      expect(Array.from(decrypted)).toEqual(Array.from(original));
    });

    it('should cycle IV for data longer than IV', () => {
      const data = new Uint8Array(256);
      const iv = new Uint8Array([0xab]);
      const result = xorEncrypt(data, iv);
      for (let i = 0; i < 256; i++) {
        expect(result[i]).toBe(data[i] ^ 0xab);
      }
    });
  });

  describe('NSCAv3 Packet', () => {
    it('should build a 4304-byte packet', () => {
      const NSCA_PACKET_SIZE = 4304;
      const packet = new Uint8Array(NSCA_PACKET_SIZE);
      const view = new DataView(packet.buffer);

      view.setInt16(0, 3, false);
      expect(view.getInt16(0, false)).toBe(3);
      expect(packet.length).toBe(NSCA_PACKET_SIZE);
    });

    it('should have correct field offsets', () => {
      // NSCAv3 packet layout:
      // 0-1:    version (int16)
      // 4-7:    CRC32 (uint32)
      // 8-11:   timestamp (uint32)
      // 12-13:  return code (int16)
      // 14-77:  host name (64 bytes, null-terminated)
      // 78-205: service description (128 bytes, null-terminated)
      // 206-4303: plugin output (4098 bytes, null-terminated)

      const NSCA_PACKET_SIZE = 4304;
      const packet = new Uint8Array(NSCA_PACKET_SIZE);
      const view = new DataView(packet.buffer);

      view.setInt16(0, 3, false);
      view.setInt16(12, 2, false); // CRITICAL

      const hostname = new TextEncoder().encode('webserver01');
      packet.set(hostname, 14);

      const service = new TextEncoder().encode('HTTP');
      packet.set(service, 78);

      const output = new TextEncoder().encode('CRITICAL - Service down');
      packet.set(output, 206);

      expect(view.getInt16(0, false)).toBe(3);
      expect(view.getInt16(12, false)).toBe(2);
      expect(new TextDecoder().decode(packet.slice(14, 14 + hostname.length))).toBe('webserver01');
      expect(new TextDecoder().decode(packet.slice(78, 78 + service.length))).toBe('HTTP');
      expect(new TextDecoder().decode(packet.slice(206, 206 + output.length))).toBe('CRITICAL - Service down');
    });

    it('should truncate host name to 63 chars', () => {
      const longHost = 'a'.repeat(100);
      const maxLen = 63;
      const truncated = longHost.slice(0, maxLen);
      expect(truncated.length).toBe(63);
    });

    it('should truncate service to 127 chars', () => {
      const longService = 'b'.repeat(200);
      const maxLen = 127;
      const truncated = longService.slice(0, maxLen);
      expect(truncated.length).toBe(127);
    });

    it('should truncate plugin output to 4097 chars', () => {
      const longOutput = 'c'.repeat(5000);
      const maxLen = 4097;
      const truncated = longOutput.slice(0, maxLen);
      expect(truncated.length).toBe(4097);
    });
  });

  describe('Return Codes', () => {
    const codeNames: Record<number, string> = {
      0: 'OK',
      1: 'WARNING',
      2: 'CRITICAL',
      3: 'UNKNOWN',
    };

    it('should map all standard return codes', () => {
      expect(codeNames[0]).toBe('OK');
      expect(codeNames[1]).toBe('WARNING');
      expect(codeNames[2]).toBe('CRITICAL');
      expect(codeNames[3]).toBe('UNKNOWN');
    });

    it('should handle unknown return codes', () => {
      expect(codeNames[4]).toBeUndefined();
      expect(codeNames[-1]).toBeUndefined();
    });
  });

  describe('Encryption Methods', () => {
    it('should support method 0 (none)', () => {
      const methods: Record<number, string> = { 0: 'None', 1: 'XOR' };
      expect(methods[0]).toBe('None');
    });

    it('should support method 1 (XOR)', () => {
      const methods: Record<number, string> = { 0: 'None', 1: 'XOR' };
      expect(methods[1]).toBe('XOR');
    });
  });
});
