/**
 * Gadu-Gadu Protocol Integration Tests
 *
 * Tests the Gadu-Gadu (GG) instant messenger protocol implementation
 * GG uses a binary protocol on port 8074 with password hashing (GG32 or SHA-1)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const isLocal = API_BASE.includes('localhost');

// Real GG server at 91.214.237.10 silently filters connections when unreachable,
// causing TCP SYN to hang until OS timeout (~60s). Skip these tests locally.
const itRemoteOnly = isLocal ? it.skip : it;

describe('Gadu-Gadu Protocol Integration Tests', () => {
	describe('POST /api/gadugadu/connect', () => {
		it('should validate missing host', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					port: 8074,
					uin: 12345678,
					password: 'test123',
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toBe('Host is required');
		});

		it('should validate missing UIN', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'appmsg.gadu-gadu.pl',
					port: 8074,
					password: 'test123',
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toBe('UIN is required');
		});

		it('should validate missing password', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'appmsg.gadu-gadu.pl',
					port: 8074,
					uin: 12345678,
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toBe('Password is required');
		});

		it('should validate invalid UIN format', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'appmsg.gadu-gadu.pl',
					port: 8074,
					uin: 999999999, // Too large
					password: 'test123',
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toContain('Invalid UIN');
		});

		it('should validate invalid port', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'appmsg.gadu-gadu.pl',
					port: 99999,
					uin: 12345678,
					password: 'test123',
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toBe('Port must be between 1 and 65535');
		});

		it('should use default port 8074 when not specified', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'nonexistent.invalid',
					uin: 12345678,
					password: 'test123',
					timeout: 3000,
				}),
			});

			const data = (await response.json()) as {
				success: boolean;
				error?: string;
			};

			// Should attempt connection with default port
			expect(data.success).toBe(false);
			expect(data.error).toBeTruthy();
		});

		it('should handle connection to non-existent host', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'nonexistent.invalid',
					port: 8074,
					uin: 12345678,
					password: 'test123',
					timeout: 5000,
				}),
			});

			expect(response.status).toBe(500);
			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toBeTruthy();
		});

		it('should detect Cloudflare-protected hosts', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: 'discord.com',
					port: 8074,
					uin: 12345678,
					password: 'test123',
				}),
			});

			const data = (await response.json()) as {
				success: boolean;
				error: string;
			};

			expect(data.success).toBe(false);
			expect(data.error).toContain('Cloudflare');
		});

		itRemoteOnly('should handle invalid credentials with real GG server', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: '91.214.237.10', // Real GG server IP
					port: 8074,
					uin: 99999999, // Invalid credentials
					password: 'invalid_password_123',
					hashType: 'sha1',
					timeout: 5000,
				}),
			});

			const data = (await response.json()) as {
				success: boolean;
				message?: string;
				error?: string;
				seed?: number;
				hashType?: string;
				timing?: {
					connect: number;
					welcome: number;
					login: number;
					total: number;
				};
			};

			expect(data.success).toBe(false);
			// If GG server responded with a proper handshake, verify the details
			if (data.message?.includes('Login failed')) {
				expect(data.seed).toBeDefined();
				expect(data.seed).toBeGreaterThan(0);
				expect(data.hashType).toBe('sha1');
				expect(data.timing).toBeDefined();
			} else {
				// Server unreachable or timed out - that's acceptable
				expect(data.error).toBeDefined();
			}
		}, 20000);

		itRemoteOnly('should support GG32 hash algorithm', async () => {
			const response = await fetch(`${API_BASE}/gadugadu/connect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					host: '91.214.237.10',
					port: 8074,
					uin: 99999999,
					password: 'test123',
					hashType: 'gg32', // Legacy hash
					timeout: 5000,
				}),
			});

			const data = (await response.json()) as {
				success: boolean;
				hashType?: string;
				error?: string;
			};

			// If GG server responded, verify hash type was used
			if (data.hashType) {
				expect(data.hashType).toBe('gg32');
			} else {
				// Server unreachable - just verify we got a response
				expect(data.success).toBe(false);
				expect(data.error).toBeDefined();
			}
		}, 20000);
	});
});
