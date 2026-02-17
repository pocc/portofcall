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

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { connectGaduGadu } from './protocols/gadugadu/client';
import type { GaduGaduConfig } from './protocols/gadugadu/types';
import { GG_PACKET_TYPES } from './protocols/gadugadu/types';
import { readPacket, writePacket, buildLoginPacket, validateUIN, getPacketTypeName } from './protocols/gadugadu/utils';

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

// ─── Shared auth helper ───────────────────────────────────────────────────────

/**
 * Open a GG session (WELCOME + LOGIN) and return reader/writer/socket.
 * Caller must release reader/writer and close socket when done.
 */
async function openGGSession(
	host: string, port: number, uin: number, password: string,
	hashType: 'gg32' | 'sha1', timeoutMs: number,
): Promise<{
	reader: ReadableStreamDefaultReader<Uint8Array>;
	writer: WritableStreamDefaultWriter<Uint8Array>;
	close: () => void;
	seed: number;
}> {
	const socket = connect(`${host}:${port}`);
	const deadline = new Promise<never>((_, r) => setTimeout(() => r(new Error('Connection timeout')), timeoutMs));
	await Promise.race([socket.opened, deadline]);

	const reader = socket.readable.getReader();
	const writer = socket.writable.getWriter();

	const welcome = await Promise.race([readPacket(reader, 5000), deadline]);
	if (welcome.type !== GG_PACKET_TYPES.GG_WELCOME) {
		throw new Error(`Expected GG_WELCOME, got ${getPacketTypeName(welcome.type)}`);
	}
	const seed = new DataView(welcome.payload.buffer).getUint32(0, true);
	const loginPayload = await buildLoginPacket(uin, password, seed, hashType);
	await writer.write(writePacket(GG_PACKET_TYPES.GG_LOGIN80, loginPayload));
	const loginResp = await Promise.race([readPacket(reader, 5000), deadline]);
	if (loginResp.type !== GG_PACKET_TYPES.GG_LOGIN80_OK) {
		throw new Error(`Login failed: ${getPacketTypeName(loginResp.type)}`);
	}

	return { reader, writer, close: () => socket.close(), seed };
}

// ─── POST /api/gadugadu/send-message ─────────────────────────────────────────

/**
 * Send an instant message to a GG user after authentication.
 *
 * GG_SEND_MSG80 (0x002D) packet format (LE):
 *   recipient:    4 bytes  — target UIN
 *   seq:          4 bytes  — sequence number
 *   time:         4 bytes  — timestamp (epoch seconds)
 *   msgclass:     4 bytes  — 0x0004 = chat message
 *   offset_plain: 4 bytes  — 0 (plain text starts at offset 0)
 *   offset_attrs: 4 bytes  — 0 (no rich text)
 *   message:      variable — null-terminated UTF-8 text
 *
 * POST /api/gadugadu/send-message
 * Body: { host, port?, senderUin, senderPassword, recipientUin, message, hashType?, timeout? }
 */
export async function handleGaduGaduSendMessage(request: Request): Promise<Response> {
	try {
		const body = (await request.json()) as {
			host?: string;
			port?: number;
			senderUin?: number | string;
			senderPassword?: string;
			recipientUin?: number | string;
			message?: string;
			hashType?: 'gg32' | 'sha1';
			timeout?: number;
		};

		if (!body.host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
		if (!body.senderUin) return Response.json({ success: false, error: 'senderUin is required' }, { status: 400 });
		if (!body.senderPassword) return Response.json({ success: false, error: 'senderPassword is required' }, { status: 400 });
		if (!body.recipientUin) return Response.json({ success: false, error: 'recipientUin is required' }, { status: 400 });
		if (!body.message) return Response.json({ success: false, error: 'message is required' }, { status: 400 });

		const host = body.host;
		const port = body.port ?? 8074;
		const senderUin = typeof body.senderUin === 'string' ? parseInt(body.senderUin, 10) : body.senderUin;
		const recipientUin = typeof body.recipientUin === 'string' ? parseInt(body.recipientUin, 10) : body.recipientUin;
		const hashType = body.hashType ?? 'sha1';
		const timeout = Math.min(body.timeout ?? 15000, 30000);
		const messageText = body.message;

		if (!validateUIN(senderUin)) return Response.json({ success: false, error: 'Invalid senderUin' }, { status: 400 });
		if (!validateUIN(recipientUin)) return Response.json({ success: false, error: 'Invalid recipientUin' }, { status: 400 });

		const cfCheck = await checkIfCloudflare(host);
		if (cfCheck.isCloudflare && cfCheck.ip) {
			return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip) }, { status: 400 });
		}

		const startTime = Date.now();

		const { reader, writer, close } = await openGGSession(host, port, senderUin, body.senderPassword!, hashType, timeout);

		try {
			// Build GG_SEND_MSG80 payload
			const msgBytes = new TextEncoder().encode(messageText);
			const payload = new Uint8Array(4 + 4 + 4 + 4 + 4 + 4 + msgBytes.length + 1);
			const view = new DataView(payload.buffer);
			const now = Math.floor(Date.now() / 1000);
			const seq = now & 0xFFFF;

			let off = 0;
			view.setUint32(off, recipientUin, true); off += 4;
			view.setUint32(off, seq, true); off += 4;
			view.setUint32(off, now, true); off += 4;
			view.setUint32(off, 0x0004, true); off += 4;  // msgclass: chat
			view.setUint32(off, 0, true); off += 4;        // offset_plain: 0
			view.setUint32(off, 0, true); off += 4;        // offset_attrs: 0
			payload.set(msgBytes, off); off += msgBytes.length;
			payload[off] = 0; // null terminator

			await writer.write(writePacket(GG_PACKET_TYPES.GG_SEND_MSG80, payload));

			// Wait briefly for ACK or next server packet (optional)
			let ackType: string | undefined;
			try {
				const dl = new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true as const }), 2000));
				const pkt = await Promise.race([readPacket(reader, 2000), dl]);
				if ('type' in pkt) ackType = getPacketTypeName(pkt.type);
			} catch { /* no ack is fine */ }

			reader.releaseLock();
			writer.releaseLock();
			close();

			return Response.json({
				success: true,
				senderUin,
				recipientUin,
				seq,
				message: messageText,
				latencyMs: Date.now() - startTime,
				...(ackType ? { serverAck: ackType } : {}),
				note: 'Message packet sent. Delivery depends on recipient being online.',
			});
		} catch (err) {
			try { reader.releaseLock(); } catch { /* ignore */ }
			try { writer.releaseLock(); } catch { /* ignore */ }
			close();
			throw err;
		}
	} catch (error) {
		return Response.json({
			success: false,
			error: error instanceof Error ? error.message : 'Internal server error',
		}, { status: 500 });
	}
}

// ─── POST /api/gadugadu/contacts ─────────────────────────────────────────────

/**
 * Request the server-side contact list (buddy list) for an authenticated GG user.
 *
 * GG_USERLIST_REQUEST (0x0016): 1 byte — type 0x01 = GET_LIST
 * GG_USERLIST_REPLY (0x0041): 1 byte type + contact list as newline-separated records.
 * Each record is tab-separated: uin, visible_name, first_name, last_name, phone, group.
 *
 * POST /api/gadugadu/contacts
 * Body: { host, port?, uin, password, hashType?, timeout? }
 */
export async function handleGaduGaduContacts(request: Request): Promise<Response> {
	try {
		const body = (await request.json()) as {
			host?: string;
			port?: number;
			uin?: number | string;
			password?: string;
			hashType?: 'gg32' | 'sha1';
			timeout?: number;
		};

		if (!body.host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
		if (!body.uin) return Response.json({ success: false, error: 'uin is required' }, { status: 400 });
		if (!body.password) return Response.json({ success: false, error: 'password is required' }, { status: 400 });

		const host = body.host;
		const port = body.port ?? 8074;
		const uin = typeof body.uin === 'string' ? parseInt(body.uin, 10) : body.uin;
		const hashType = body.hashType ?? 'sha1';
		const timeout = Math.min(body.timeout ?? 15000, 30000);

		if (!validateUIN(uin)) return Response.json({ success: false, error: 'Invalid UIN' }, { status: 400 });

		const cfCheck = await checkIfCloudflare(host);
		if (cfCheck.isCloudflare && cfCheck.ip) {
			return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip) }, { status: 400 });
		}

		const startTime = Date.now();

		const { reader, writer, close } = await openGGSession(host, port, uin, body.password!, hashType, timeout);

		try {
			// GG_USERLIST_REQUEST with type=0x01 (GET_LIST)
			const req = new Uint8Array(1);
			req[0] = 0x01;
			await writer.write(writePacket(0x0016, req));

			// Collect GG_USERLIST_REPLY (0x0041) packets — may come in chunks
			const replyParts: string[] = [];
			const deadline = Date.now() + Math.min(timeout - (Date.now() - startTime), 5000);

			while (Date.now() < deadline) {
				const rem = deadline - Date.now();
				if (rem <= 0) break;
				const dl = new Promise<{ type: -1 }>((r) => setTimeout(() => r({ type: -1 }), rem));
				const pkt = await Promise.race([readPacket(reader, rem), dl]);
				if ('type' in pkt && pkt.type === -1) break;
				if (!('type' in pkt)) break;
				if (pkt.type === 0x0041 || pkt.type === 0x004E) { // GG_USERLIST_REPLY or GG_USERLIST100_REPLY
					// First byte is type/flags, rest is contact data
					if (pkt.payload.length > 1) {
						replyParts.push(new TextDecoder().decode(pkt.payload.slice(1)));
					}
					break; // Single reply packet expected
				}
			}

			reader.releaseLock();
			writer.releaseLock();
			close();

			const raw = replyParts.join('');
			// Parse contacts: each line is tab-separated record
			const contacts = raw
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.map((line) => {
					const parts = line.split('\t');
					return {
						uin: parts[0] ?? '',
						visibleName: parts[1] ?? '',
						firstName: parts[2] ?? '',
						lastName: parts[3] ?? '',
						phone: parts[4] ?? '',
						group: parts[5] ?? '',
					};
				});

			return Response.json({
				success: true,
				uin,
				contactCount: contacts.length,
				contacts,
				latencyMs: Date.now() - startTime,
				...(contacts.length === 0
					? { note: 'Empty contact list — the user list may be stored locally, not on server.' }
					: {}),
			});
		} catch (err) {
			try { reader.releaseLock(); } catch { /* ignore */ }
			try { writer.releaseLock(); } catch { /* ignore */ }
			close();
			throw err;
		}
	} catch (error) {
		return Response.json({
			success: false,
			error: error instanceof Error ? error.message : 'Internal server error',
		}, { status: 500 });
	}
}
