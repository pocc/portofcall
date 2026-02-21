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

  describe('IPv4 — allowed ranges', () => {
    it('allows public IPs', () => {
      expect(isBlockedHost('8.8.8.8')).toBe(false);
      expect(isBlockedHost('1.1.1.1')).toBe(false);
      expect(isBlockedHost('93.184.216.34')).toBe(false);
      expect(isBlockedHost('203.0.113.1')).toBe(false);
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
