/**
 * Gadu-Gadu Protocol Utilities
 */

import type { GaduGaduPacket } from './types';
import { GG_HASH_TYPE } from './types';

/**
 * Buffered reader that prevents data loss when the stream delivers
 * more bytes than requested in a single chunk.
 */
class BufferedReader {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private leftover: Uint8Array | null = null;

	constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
		this.reader = reader;
	}

	async readBytes(count: number, timeout: number): Promise<Uint8Array> {
		const buffer = new Uint8Array(count);
		let offset = 0;

		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Read timeout')), timeout)
		);

		// Drain leftover bytes from previous read first
		if (this.leftover && this.leftover.length > 0) {
			const toCopy = Math.min(this.leftover.length, count - offset);
			buffer.set(this.leftover.subarray(0, toCopy), offset);
			offset += toCopy;
			if (toCopy < this.leftover.length) {
				this.leftover = this.leftover.subarray(toCopy);
			} else {
				this.leftover = null;
			}
		}

		while (offset < count) {
			const readPromise = this.reader.read();
			const result = await Promise.race([readPromise, timeoutPromise]);

			if (result.done) {
				throw new Error('Connection closed unexpectedly');
			}

			const chunk = result.value;
			const toCopy = Math.min(chunk.length, count - offset);
			buffer.set(chunk.subarray(0, toCopy), offset);
			offset += toCopy;

			// Preserve excess bytes for the next read instead of discarding them
			if (toCopy < chunk.length) {
				this.leftover = chunk.subarray(toCopy);
			}
		}

		return buffer;
	}

	releaseLock(): void {
		this.reader.releaseLock();
	}
}

// Keep a WeakMap so callers that pass the same raw reader get the same buffer
const readerBuffers = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, BufferedReader>();

/**
 * Obtain (or create) a BufferedReader wrapper for a raw stream reader.
 * Export so that callers who hold a raw reader can share the buffer.
 */
export function getBufferedReader(reader: ReadableStreamDefaultReader<Uint8Array>): BufferedReader {
	let buf = readerBuffers.get(reader);
	if (!buf) {
		buf = new BufferedReader(reader);
		readerBuffers.set(reader, buf);
	}
	return buf;
}

/**
 * Read a Gadu-Gadu packet from socket
 * All values are Little-Endian
 */
export async function readPacket(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeout = 10000
): Promise<GaduGaduPacket> {
	const startTime = Date.now();
	const buf = getBufferedReader(reader);

	// Read 8-byte header (type + length)
	const header = await buf.readBytes(8, timeout);
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

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
		payload = await buf.readBytes(length, remaining);
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
 *
 * Correct GG_LOGIN80 (0x0031) field order per protocol specification:
 *   uin:            uint32  — User Identification Number
 *   language:       char[2] — Two-letter language code (e.g. "pl")
 *   hash_type:      uint8   — 0x01 = GG32, 0x02 = SHA1
 *   hash:           variable — 4 bytes (GG32) or 20 bytes (SHA1)
 *   status:         uint32  — Initial status (e.g. 0x0002 = Available)
 *   flags:          uint32  — Protocol flags
 *   features:       uint32  — Feature bitmask
 *   local_ip:       uint32  — Local IP address
 *   local_port:     uint16  — Local port
 *   external_ip:    uint32  — External IP address
 *   external_port:  uint16  — External port
 *   image_size:     uint8   — Max avatar size (0xFF = none)
 *   unknown:        uint8   — Padding / unknown (0x64)
 */
export async function buildLoginPacket(
	uin: number,
	password: string,
	seed: number,
	hashType: 'gg32' | 'sha1' = 'sha1'
): Promise<Uint8Array> {
	const buffer = new Uint8Array(128); // Fixed size for safety
	const view = new DataView(buffer.buffer);

	let offset = 0;

	// UIN (4 bytes, LE)
	view.setUint32(offset, uin, true);
	offset += 4;

	// Language (2 bytes) — "pl"
	buffer[offset++] = 'p'.charCodeAt(0);
	buffer[offset++] = 'l'.charCodeAt(0);

	// Hash type (1 byte)
	const hashTypeCode = hashType === 'sha1' ? GG_HASH_TYPE.SHA1 : GG_HASH_TYPE.GG32;
	buffer[offset++] = hashTypeCode;

	// Hash — placed immediately after hash_type per protocol spec
	if (hashType === 'sha1') {
		const hash = await sha1Hash(password, seed);
		buffer.set(hash, offset);
		offset += hash.length; // 20 bytes
	} else {
		// GG32 hash (4 bytes, LE)
		const hash = gg32Hash(password, seed);
		view.setUint32(offset, hash, true);
		offset += 4;
	}

	// Status (4 bytes, LE) — 0x0002 = Available
	view.setUint32(offset, 0x00000002, true);
	offset += 4;

	// Flags (4 bytes, LE) — basic protocol flags
	view.setUint32(offset, 0x00000001, true);
	offset += 4;

	// Features (4 bytes, LE) — feature bitmask
	view.setUint32(offset, 0x00000007, true);
	offset += 4;

	// Local IP (4 bytes) — 0.0.0.0
	view.setUint32(offset, 0, true);
	offset += 4;

	// Local port (2 bytes) — 0
	view.setUint16(offset, 0, true);
	offset += 2;

	// External IP (4 bytes) — 0.0.0.0
	view.setUint32(offset, 0, true);
	offset += 4;

	// External port (2 bytes) — 0
	view.setUint16(offset, 0, true);
	offset += 2;

	// Image size (1 byte) — 0xFF = no avatar
	buffer[offset++] = 0xff;

	// Unknown / padding (1 byte)
	buffer[offset++] = 0x64;

	return buffer.subarray(0, offset);
}

/**
 * Validate UIN format.
 * GG UINs are uint32 values; production UINs commonly exceed 8 digits.
 */
export function validateUIN(uin: number | string): boolean {
	const uinNum = typeof uin === 'string' ? parseInt(uin, 10) : uin;
	return !isNaN(uinNum) && Number.isInteger(uinNum) && uinNum > 0 && uinNum <= 4294967295;
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
