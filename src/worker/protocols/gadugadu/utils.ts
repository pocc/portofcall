/**
 * Gadu-Gadu Protocol Utilities
 */

import type { GaduGaduPacket } from './types';
import { GG_HASH_TYPE } from './types';

/**
 * Read a Gadu-Gadu packet from socket
 * All values are Little-Endian
 */
export async function readPacket(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeout = 10000
): Promise<GaduGaduPacket> {
	const startTime = Date.now();

	// Read 8-byte header (type + length)
	const header = await readBytes(reader, 8, timeout);
	const view = new DataView(header.buffer);

	const type = view.getUint32(0, true); // Little-endian
	const length = view.getUint32(4, true);

	// Validate length (max 64KB for safety)
	if (length > 65536) {
		throw new Error(`Invalid packet length: ${length}`);
	}

	// Read payload if present
	let payload: Uint8Array = new Uint8Array(0);
	if (length > 0) {
		const elapsed = Date.now() - startTime;
		const remaining = timeout - elapsed;
		if (remaining <= 0) {
			throw new Error('Timeout reading packet payload');
		}
		payload = await readBytes(reader, length, remaining);
	}

	return { type, length, payload };
}

/**
 * Write a Gadu-Gadu packet to socket
 */
export function writePacket(
	type: number,
	payload: Uint8Array = new Uint8Array(0)
): Uint8Array {
	const length = payload.length;
	const packet = new Uint8Array(8 + length);
	const view = new DataView(packet.buffer);

	// Write header (Little-Endian)
	view.setUint32(0, type, true);
	view.setUint32(4, length, true);

	// Write payload
	if (length > 0) {
		packet.set(payload, 8);
	}

	return packet;
}

/**
 * Read exact number of bytes with timeout
 */
async function readBytes(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	count: number,
	timeout: number
): Promise<Uint8Array> {
	const buffer = new Uint8Array(count);
	let offset = 0;

	const timeoutPromise = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error('Read timeout')), timeout)
	);

	while (offset < count) {
		const readPromise = reader.read();
		const result = await Promise.race([readPromise, timeoutPromise]);

		if (result.done) {
			throw new Error('Connection closed unexpectedly');
		}

		const chunk = result.value;
		const toCopy = Math.min(chunk.length, count - offset);
		buffer.set(chunk.subarray(0, toCopy), offset);
		offset += toCopy;
	}

	return buffer;
}

/**
 * Compute GG32 hash (legacy)
 * Hash = seed; for each char: hash = (hash * 0x41 + char) & 0xFFFFFFFF
 */
export function gg32Hash(password: string, seed: number): number {
	let hash = seed;
	for (let i = 0; i < password.length; i++) {
		hash = ((hash * 0x41) + password.charCodeAt(i)) & 0xffffffff;
	}
	return hash >>> 0; // Ensure unsigned
}

/**
 * Compute SHA-1 hash (modern)
 * SHA-1(password + seed_bytes)
 */
export async function sha1Hash(password: string, seed: number): Promise<Uint8Array> {
	// Convert seed to 4-byte Little-Endian
	const seedBytes = new Uint8Array(4);
	new DataView(seedBytes.buffer).setUint32(0, seed, true);

	// Concatenate password + seed
	const passwordBytes = new TextEncoder().encode(password);
	const combined = new Uint8Array(passwordBytes.length + seedBytes.length);
	combined.set(passwordBytes, 0);
	combined.set(seedBytes, passwordBytes.length);

	// Compute SHA-1
	const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
	return new Uint8Array(hashBuffer);
}

/**
 * Build GG_LOGIN80 packet payload
 */
export async function buildLoginPacket(
	uin: number,
	password: string,
	seed: number,
	hashType: 'gg32' | 'sha1' = 'sha1'
): Promise<Uint8Array> {
	// Packet structure (simplified for connection test)
	const buffer = new Uint8Array(128); // Fixed size for safety
	const view = new DataView(buffer.buffer);

	let offset = 0;

	// UIN (4 bytes)
	view.setUint32(offset, uin, true);
	offset += 4;

	// Language (2 bytes) - "pl"
	buffer[offset++] = 'p'.charCodeAt(0);
	buffer[offset++] = 'l'.charCodeAt(0);

	// Hash type (1 byte)
	const hashTypeCode = hashType === 'sha1' ? GG_HASH_TYPE.SHA1 : GG_HASH_TYPE.GG32;
	buffer[offset++] = hashTypeCode;

	// Status (1 byte) - Available
	buffer[offset++] = 0x02;

	// Features (4 bytes)
	view.setUint32(offset, 0x00000015, true); // Basic features
	offset += 4;

	// Local IP (4 bytes) - 0.0.0.0
	view.setUint32(offset, 0, true);
	offset += 4;

	// Local port (2 bytes) - 0
	view.setUint16(offset, 0, true);
	offset += 2;

	// External IP (4 bytes) - 0.0.0.0
	view.setUint32(offset, 0, true);
	offset += 4;

	// External port (2 bytes) - 0
	view.setUint16(offset, 0, true);
	offset += 2;

	// Image size (1 byte) - 0xFF (no avatar)
	buffer[offset++] = 0xff;

	// Unknown (1 byte)
	buffer[offset++] = 0xbe;

	// Hash (64 bytes max)
	if (hashType === 'sha1') {
		const hash = await sha1Hash(password, seed);
		buffer.set(hash, offset);
		offset += hash.length;
	} else {
		// GG32 hash (4 bytes)
		const hash = gg32Hash(password, seed);
		view.setUint32(offset, hash, true);
		offset += 4;
	}

	return buffer.subarray(0, offset);
}

/**
 * Validate UIN format (8-digit number)
 */
export function validateUIN(uin: number | string): boolean {
	const uinNum = typeof uin === 'string' ? parseInt(uin, 10) : uin;
	return !isNaN(uinNum) && uinNum > 0 && uinNum <= 99999999;
}

/**
 * Get packet type name for debugging
 */
export function getPacketTypeName(type: number): string {
	const names: Record<number, string> = {
		0x0001: 'GG_WELCOME',
		0x0007: 'GG_PONG',
		0x0008: 'GG_PING',
		0x002d: 'GG_SEND_MSG80',
		0x002e: 'GG_RECV_MSG80',
		0x0031: 'GG_LOGIN80',
		0x0035: 'GG_LOGIN80_OK',
		0x0038: 'GG_NEW_STATUS80',
		0x0043: 'GG_LOGIN80_FAILED',
	};
	return names[type] || `UNKNOWN(0x${type.toString(16).padStart(4, '0')})`;
}
