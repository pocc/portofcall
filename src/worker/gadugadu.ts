/**
 * Gadu-Gadu Protocol Implementation
 *
 * Implements connectivity testing and authentication for Gadu-Gadu (GG)
 * Polish instant messenger using a proprietary binary protocol.
 *
 * Protocol Flow:
 * 1. Client connects to server port 8074 (or 443)
 * 2. Server sends GG_WELCOME (0x0001) with random seed
 * 3. Client hashes password using GG32 or SHA-1 with seed
 * 4. Client sends GG_LOGIN80 (0x0031) with UIN and hash
 * 5. Server responds with GG_LOGIN80_OK (0x0035) or GG_LOGIN80_FAILED (0x0043)
 *
 * Packet Format (Little-Endian):
 *   type(4 bytes) | length(4 bytes) | payload(variable)
 *
 * Use Cases:
 * - GG server connectivity testing
 * - Protocol version detection
 * - Authentication testing
 * - Historical IM protocol research
 */

import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { connectGaduGadu } from './protocols/gadugadu/client';
import type { GaduGaduConfig } from './protocols/gadugadu/types';
import { validateUIN } from './protocols/gadugadu/utils';

/**
 * Handle Gadu-Gadu connection request
 * POST /api/gadugadu/connect
 */
export async function handleGaduGaduConnect(request: Request): Promise<Response> {
	try {
		const body = (await request.json()) as {
			host?: string;
			port?: number;
			uin?: number | string;
			password?: string;
			hashType?: 'gg32' | 'sha1';
			timeout?: number;
		};

		// Validate required fields
		if (!body.host) {
			return Response.json(
				{ success: false, error: 'Host is required' },
				{ status: 400 }
			);
		}

		if (!body.uin) {
			return Response.json(
				{ success: false, error: 'UIN is required' },
				{ status: 400 }
			);
		}

		if (!body.password) {
			return Response.json(
				{ success: false, error: 'Password is required' },
				{ status: 400 }
			);
		}

		// Validate port
		const port = body.port || 8074;
		if (port < 1 || port > 65535) {
			return Response.json(
				{ success: false, error: 'Port must be between 1 and 65535' },
				{ status: 400 }
			);
		}

		// Parse and validate UIN
		const uin = typeof body.uin === 'string' ? parseInt(body.uin, 10) : body.uin;
		if (!validateUIN(uin)) {
			return Response.json(
				{
					success: false,
					error: 'Invalid UIN format (must be 1-99999999)',
				},
				{ status: 400 }
			);
		}

		// Validate hash type
		const hashType = body.hashType || 'sha1';
		if (hashType !== 'gg32' && hashType !== 'sha1') {
			return Response.json(
				{ success: false, error: 'Hash type must be "gg32" or "sha1"' },
				{ status: 400 }
			);
		}

		// Check for Cloudflare protection
		const cloudflareCheck = await checkIfCloudflare(body.host);
		if (cloudflareCheck.isCloudflare) {
			return Response.json(
				{
					success: false,
					error: getCloudflareErrorMessage(body.host, cloudflareCheck.ip || 'unknown'),
				},
				{ status: 400 }
			);
		}

		// Build config
		const config: GaduGaduConfig = {
			host: body.host,
			port,
			uin,
			password: body.password,
			hashType,
			timeout: body.timeout || 30000,
		};

		// Attempt connection
		const result = await connectGaduGadu(config);

		if (result.success) {
			return Response.json(result, { status: 200 });
		} else {
			return Response.json(result, { status: 500 });
		}
	} catch (error) {
		console.error('Gadu-Gadu connection error:', error);
		return Response.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Internal server error',
			},
			{ status: 500 }
		);
	}
}
