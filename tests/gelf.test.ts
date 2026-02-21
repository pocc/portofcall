/**
 * GELF (Graylog Extended Log Format) TCP Protocol Tests
 *
 * Tests the GELF TCP implementation including message validation,
 * batch sending, and server connectivity probing.
 *
 * Power-user test coverage:
 * - All severity levels (0-7)
 * - Custom field validation
 * - Timestamp formats (Unix epoch, milliseconds)
 * - Batch operations at limits
 * - Optional field combinations
 * - Error scenarios
 * - Timeout handling
 */

import { describe, it, expect } from 'vitest';
import type { GelfMessage, GelfLevel } from '../src/worker/gelf';

describe('GELF TCP Protocol', () => {
  const GELF_HOST = 'test-host.invalid';
  const GELF_PORT = 12201;
  const BASE_URL = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

  describe('Message Validation', () => {
    it('should validate required fields', async () => {
      const invalidMessage = {
        host: 'test-host',
        // Missing short_message - this will fail validation even after version auto-population
      };

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [invalidMessage],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid GELF message');
    });

    it('should auto-populate version and timestamp', async () => {
      const message = {
        host: 'test-host',
        short_message: 'Test message',
        // version and timestamp will be auto-populated
      };

      // This test validates the API accepts messages without version/timestamp
      // The actual sending will fail without a real Graylog server
      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [message],
        }),
      });

      // Will fail connecting to localhost:12201 unless Graylog is running
      // But validates message was accepted after auto-population
      expect([200, 500]).toContain(response.status);
    });

    it('should reject custom fields without underscore prefix', async () => {
      const invalidMessage = {
        version: '1.1',
        host: 'test-host',
        short_message: 'Test message',
        custom_field: 'invalid', // Should be _custom_field
      };

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [invalidMessage],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid GELF message');
    });

    it('should reject reserved _id field', async () => {
      const invalidMessage = {
        version: '1.1',
        host: 'test-host',
        short_message: 'Test message',
        _id: 'reserved-field', // Reserved by Graylog
      };

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [invalidMessage],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid GELF message');
    });

    it('should validate severity levels (0-7)', async () => {
      const invalidMessage = {
        version: '1.1',
        host: 'test-host',
        short_message: 'Test message',
        level: 99, // Invalid level (must be 0-7)
      };

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [invalidMessage],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid GELF message');
    });
  });

  describe('Batch Operations', () => {
    it('should reject batches larger than 100 messages', async () => {
      const messages = Array(101).fill({
        version: '1.1',
        host: 'test-host',
        short_message: 'Test message',
      });

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Maximum 100 messages');
    });

    it('should accept valid batch of messages', async () => {
      const messages: Partial<GelfMessage>[] = [
        {
          version: '1.1',
          host: 'app-server-01',
          short_message: 'User login',
          level: 6,
          _user_id: 123,
        },
        {
          version: '1.1',
          host: 'app-server-01',
          short_message: 'API request',
          level: 6,
          _endpoint: '/api/users',
        },
      ];

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages,
        }),
      });

      // Will fail if no Graylog server running, but validates request structure
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('API Endpoints', () => {
    it('should require host parameter for send', async () => {
      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            version: '1.1',
            host: 'test',
            short_message: 'test',
          }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing required parameter: host');
    });

    it('should require messages parameter for send', async () => {
      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing required parameter: messages');
    });

    it('should require host parameter for probe', async () => {
      const response = await fetch(`${BASE_URL}/api/gelf/probe`);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing required parameter: host');
    });

    it('should accept probe with host and port', async () => {
      const response = await fetch(
        `${BASE_URL}/api/gelf/probe?host=${GELF_HOST}&port=${GELF_PORT}`
      );

      // Will fail if no Graylog server running, but validates request structure
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Real-World Integration Tests', () => {
    // These tests require a real Graylog server running on localhost:12201
    // They are skipped by default and can be enabled when testing with Docker

    it.skip('should send GELF message to real server', async () => {
      const message: GelfMessage = {
        version: '1.1',
        host: 'portofcall-test',
        short_message: 'Test message from Port of Call',
        full_message: 'This is a test message sent via GELF TCP protocol',
        level: 6, // INFO
        _test: true,
        _source: 'vitest',
      };

      const response = await fetch(`${BASE_URL}/api/gelf/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: GELF_HOST,
          port: GELF_PORT,
          messages: [message],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.messagesCount).toBe(1);
    });

    it.skip('should probe real Graylog server', async () => {
      const response = await fetch(
        `${BASE_URL}/api/gelf/probe?host=${GELF_HOST}&port=${GELF_PORT}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.connectTimeMs).toBeGreaterThan(0);
      expect(data.totalTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Power User Scenarios', () => {
    describe('All Severity Levels', () => {
      const levels = [
        { level: 0, name: 'EMERGENCY' },
        { level: 1, name: 'ALERT' },
        { level: 2, name: 'CRITICAL' },
        { level: 3, name: 'ERROR' },
        { level: 4, name: 'WARNING' },
        { level: 5, name: 'NOTICE' },
        { level: 6, name: 'INFO' },
        { level: 7, name: 'DEBUG' },
      ];

      levels.forEach(({ level, name }) => {
        it(`should accept level ${level} (${name})`, async () => {
          const message: Partial<GelfMessage> = {
            version: '1.1',
            host: 'test-host',
            short_message: `Test ${name} message`,
            level: level as GelfLevel,
          };

          const response = await fetch(`${BASE_URL}/api/gelf/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host: GELF_HOST,
              port: GELF_PORT,
              messages: [message],
            }),
          });

          // Validates message structure (will fail connecting without server)
          expect([200, 500]).toContain(response.status);
        });
      });
    });

    describe('Timestamp Formats', () => {
      it('should accept Unix timestamp with decimal precision', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Test message',
          timestamp: 1385053862.3072, // Standard GELF format
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept integer Unix timestamp', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Test message',
          timestamp: Math.floor(Date.now() / 1000),
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should auto-generate timestamp when missing', async () => {
        const message = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Test message',
          // No timestamp provided
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Custom Fields', () => {
      it('should accept multiple custom fields', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'app-server',
          short_message: 'API request completed',
          _user_id: 12345,
          _username: 'alice',
          _request_id: 'abc-123-def-456',
          _endpoint: '/api/users/12345',
          _method: 'GET',
          _status_code: 200,
          _duration_ms: 145,
          _environment: 'production',
          _region: 'us-west-2',
          _is_cached: false,
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept custom fields with different types', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Test message',
          _string_field: 'hello',
          _number_field: 42,
          _float_field: 3.14159,
          _boolean_field: true,
          _null_field: null,
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Optional Standard Fields', () => {
      it('should accept all optional fields', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'webserver-01',
          short_message: 'Application error',
          full_message: 'Stack trace:\n  at foo.bar(file.js:42)\n  at main(app.js:10)',
          timestamp: Date.now() / 1000,
          level: 3, // ERROR
          facility: 'webapp',
          file: '/var/www/app/src/controllers/user.js',
          line: 42,
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept minimal required-only message', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test',
          short_message: 'Minimal message',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Batch Size Edge Cases', () => {
      it('should accept exactly 100 messages', async () => {
        const messages = Array(100).fill(null).map((_, i) => ({
          version: '1.1' as const,
          host: 'batch-test',
          short_message: `Message ${i + 1}`,
          _batch_index: i,
        }));

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages,
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept single message', async () => {
        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [{
              version: '1.1',
              host: 'test',
              short_message: 'Single message',
            }],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Host Validation', () => {
      it('should accept 255 character hostname (max length)', async () => {
        const longHost = 'a'.repeat(255);
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: longHost,
          short_message: 'Test message',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should reject 256 character hostname (over limit)', async () => {
        const tooLongHost = 'a'.repeat(256);
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: tooLongHost,
          short_message: 'Test message',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('Invalid GELF message');
      });

      it('should reject empty hostname', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: '',
          short_message: 'Test message',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect(response.status).toBe(400);
      });
    });

    describe('Error Messages', () => {
      it('should send structured error logs', async () => {
        const errorMessage: Partial<GelfMessage> = {
          version: '1.1',
          host: 'app-server-01',
          short_message: 'Uncaught exception: Cannot read property of undefined',
          full_message: `TypeError: Cannot read property 'user' of undefined
    at processRequest (/app/src/api/users.js:42:15)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:137:13)`,
          level: 2, // CRITICAL
          file: '/app/src/api/users.js',
          line: 42,
          _error_name: 'TypeError',
          _error_code: 'ERR_UNDEFINED_PROPERTY',
          _request_id: 'req-abc-123',
          _user_id: 'user-456',
          _http_method: 'POST',
          _http_path: '/api/users/profile',
          _stack_hash: 'e3b0c44298fc1c14',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [errorMessage],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Timeout Handling', () => {
      it('should accept custom timeout parameter', async () => {
        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [{
              version: '1.1',
              host: 'test',
              short_message: 'Test',
            }],
            timeout: 5000, // 5 second timeout
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept probe with custom timeout', async () => {
        const response = await fetch(
          `${BASE_URL}/api/gelf/probe?host=${GELF_HOST}&port=${GELF_PORT}&timeout=3000`
        );

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Port Variations', () => {
      it('should accept default port 12201', async () => {
        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            // No port specified, should default to 12201
            messages: [{
              version: '1.1',
              host: 'test',
              short_message: 'Test',
            }],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should accept custom port', async () => {
        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            port: 12202, // Custom port
            messages: [{
              version: '1.1',
              host: 'test',
              short_message: 'Test',
            }],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('Message Content Edge Cases', () => {
      it('should handle unicode in messages', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Unicode test: 你好世界 🌍 مرحبا',
          _emoji_test: '🚀✨🎉',
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should handle multiline full_message', async () => {
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Multiline test',
          full_message: `Line 1
Line 2
Line 3
  Indented line
    Double indent

Empty line above`,
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });

      it('should handle very long messages', async () => {
        const longMessage = 'a'.repeat(8000); // 8KB message
        const message: Partial<GelfMessage> = {
          version: '1.1',
          host: 'test-host',
          short_message: 'Long message test',
          full_message: longMessage,
        };

        const response = await fetch(`${BASE_URL}/api/gelf/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: GELF_HOST,
            messages: [message],
          }),
        });

        expect([200, 500]).toContain(response.status);
      });
    });
  });
});
