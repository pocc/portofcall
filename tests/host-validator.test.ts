/**
 * Unit tests for host-validator SSRF prevention logic.
 *
 * These test the isBlockedHost function directly without network calls.
 */

import { describe, it, expect } from 'vitest';
import { isBlockedHost } from '../src/worker/host-validator';

describe('isBlockedHost', () => {
  describe('IPv4 — blocked ranges', () => {
    it('blocks loopback 127.0.0.0/8', () => {
      expect(isBlockedHost('127.0.0.1')).toBe(true);
      expect(isBlockedHost('127.255.255.255')).toBe(true);
      expect(isBlockedHost('127.0.0.0')).toBe(true);
    });

    it('blocks RFC 1918 10.0.0.0/8', () => {
      expect(isBlockedHost('10.0.0.1')).toBe(true);
      expect(isBlockedHost('10.255.255.255')).toBe(true);
    });

    it('blocks RFC 1918 172.16.0.0/12', () => {
      expect(isBlockedHost('172.16.0.1')).toBe(true);
      expect(isBlockedHost('172.31.255.255')).toBe(true);
      // 172.32.x.x is NOT private
      expect(isBlockedHost('172.32.0.1')).toBe(false);
    });

    it('blocks RFC 1918 192.168.0.0/16', () => {
      expect(isBlockedHost('192.168.0.1')).toBe(true);
      expect(isBlockedHost('192.168.255.255')).toBe(true);
    });

    it('blocks link-local 169.254.0.0/16 (cloud metadata)', () => {
      expect(isBlockedHost('169.254.169.254')).toBe(true);
      expect(isBlockedHost('169.254.0.1')).toBe(true);
    });

    it('blocks CGN 100.64.0.0/10', () => {
      expect(isBlockedHost('100.64.0.1')).toBe(true);
      expect(isBlockedHost('100.127.255.255')).toBe(true);
      // 100.128.x.x is NOT CGN
      expect(isBlockedHost('100.128.0.1')).toBe(false);
    });

    it('blocks 0.0.0.0 and 255.255.255.255', () => {
      expect(isBlockedHost('0.0.0.0')).toBe(true);
      expect(isBlockedHost('255.255.255.255')).toBe(true);
    });

    it('blocks IANA special 192.0.0.0/29', () => {
      expect(isBlockedHost('192.0.0.1')).toBe(true);
      expect(isBlockedHost('192.0.0.7')).toBe(true);
      expect(isBlockedHost('192.0.0.8')).toBe(false);
    });
  });

  describe('IPv4 — new blocked ranges', () => {
    it('blocks TEST-NET-1 192.0.2.0/24 (RFC 5737)', () => {
      expect(isBlockedHost('192.0.2.1')).toBe(true);
      expect(isBlockedHost('192.0.2.255')).toBe(true);
    });

    it('blocks TEST-NET-2 198.51.100.0/24 (RFC 5737)', () => {
      expect(isBlockedHost('198.51.100.1')).toBe(true);
      expect(isBlockedHost('198.51.100.255')).toBe(true);
    });

    it('blocks TEST-NET-3 203.0.113.0/24 (RFC 5737)', () => {
      expect(isBlockedHost('203.0.113.1')).toBe(true);
      expect(isBlockedHost('203.0.113.255')).toBe(true);
    });

    it('blocks benchmarking 198.18.0.0/15 (RFC 2544)', () => {
      expect(isBlockedHost('198.18.0.1')).toBe(true);
      expect(isBlockedHost('198.19.255.255')).toBe(true);
      expect(isBlockedHost('198.20.0.1')).toBe(false);
    });

    it('blocks reserved/Class E 240.0.0.0/4', () => {
      expect(isBlockedHost('240.0.0.1')).toBe(true);
      expect(isBlockedHost('250.1.2.3')).toBe(true);
    });

    it('blocks 0.0.0.0/8 "this network"', () => {
      expect(isBlockedHost('0.0.0.0')).toBe(true);
      expect(isBlockedHost('0.1.2.3')).toBe(true);
      expect(isBlockedHost('0.255.255.255')).toBe(true);
    });
  });

  describe('IPv4 — alternate representations', () => {
    it('blocks decimal integer IPs', () => {
      expect(isBlockedHost('2130706433')).toBe(true); // 127.0.0.1
      expect(isBlockedHost('3232235521')).toBe(true); // 192.168.0.1
    });

    it('blocks hex integer IPs', () => {
      expect(isBlockedHost('0x7f000001')).toBe(true); // 127.0.0.1
      expect(isBlockedHost('0xC0A80001')).toBe(true); // 192.168.0.1
    });

    it('blocks octal-prefixed IPs', () => {
      expect(isBlockedHost('0177.0.0.1')).toBe(true); // 127.0.0.1
    });

    it('blocks shortened dotted-decimal', () => {
      expect(isBlockedHost('127.1')).toBe(true); // 127.0.0.1
      expect(isBlockedHost('10.1.1')).toBe(true); // 10.1.0.1
    });
  });

  describe('IPv4 — allowed ranges', () => {
    it('allows public IPs', () => {
      expect(isBlockedHost('8.8.8.8')).toBe(false);
      expect(isBlockedHost('1.1.1.1')).toBe(false);
      expect(isBlockedHost('93.184.216.34')).toBe(false);
      expect(isBlockedHost('151.101.1.69')).toBe(false);
    });
  });

  describe('IPv6 — blocked addresses', () => {
    it('blocks loopback ::1', () => {
      expect(isBlockedHost('::1')).toBe(true);
      expect(isBlockedHost('[::1]')).toBe(true);
    });

    it('blocks unspecified ::', () => {
      expect(isBlockedHost('::')).toBe(true);
    });

    it('blocks ULA fc00::/7', () => {
      expect(isBlockedHost('fc00::1')).toBe(true);
      expect(isBlockedHost('fdff::1')).toBe(true);
    });

    it('blocks link-local fe80::/10', () => {
      expect(isBlockedHost('fe80::1')).toBe(true);
    });

    it('blocks IPv4-mapped ::ffff:127.0.0.1', () => {
      expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
      expect(isBlockedHost('::ffff:169.254.169.254')).toBe(true);
      expect(isBlockedHost('::ffff:10.0.0.1')).toBe(true);
    });

    it('blocks IPv4-compatible ::10.0.0.1', () => {
      expect(isBlockedHost('::10.0.0.1')).toBe(true);
    });

    it('allows public IPv6', () => {
      expect(isBlockedHost('2606:4700::1')).toBe(false);
      expect(isBlockedHost('2001:db8::1')).toBe(false);
    });
  });

  describe('Hostnames', () => {
    it('blocks localhost', () => {
      expect(isBlockedHost('localhost')).toBe(true);
      expect(isBlockedHost('LOCALHOST')).toBe(true);
    });

    it('blocks metadata.google.internal', () => {
      expect(isBlockedHost('metadata.google.internal')).toBe(true);
    });

    it('blocks .internal and .local suffixes', () => {
      expect(isBlockedHost('my-service.internal')).toBe(true);
      expect(isBlockedHost('printer.local')).toBe(true);
    });

    it('blocks .localhost suffix', () => {
      expect(isBlockedHost('anything.localhost')).toBe(true);
    });

    it('allows public hostnames', () => {
      expect(isBlockedHost('example.com')).toBe(false);
      expect(isBlockedHost('google.com')).toBe(false);
      expect(isBlockedHost('ssh.example.org')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('blocks empty/whitespace strings', () => {
      expect(isBlockedHost('')).toBe(true);
      expect(isBlockedHost('  ')).toBe(true);
    });

    it('trims whitespace before checking', () => {
      expect(isBlockedHost('  127.0.0.1  ')).toBe(true);
      expect(isBlockedHost('  8.8.8.8  ')).toBe(false);
    });
  });
});
