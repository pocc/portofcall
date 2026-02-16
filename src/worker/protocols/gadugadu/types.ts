/**
 * Gadu-Gadu Protocol Types
 * Port 8074 - Polish Instant Messenger
 */

export interface GaduGaduConfig {
	host: string;
	port: number;
	uin: number; // User Identification Number
	password: string;
	hashType?: 'gg32' | 'sha1'; // Default: sha1
	timeout?: number; // Default: 30000ms
}

export interface GaduGaduConnectResult {
	success: boolean;
	uin?: number;
	message: string;
	seed?: number;
	hashType?: string;
	serverResponse?: string;
	error?: string;
	timing?: {
		connect: number;
		welcome: number;
		login: number;
		total: number;
	};
}

// Packet type constants
export const GG_PACKET_TYPES = {
	GG_WELCOME: 0x0001, // Server welcome with seed
	GG_PONG: 0x0007, // Keep-alive pong
	GG_PING: 0x0008, // Keep-alive ping
	GG_SEND_MSG80: 0x002d, // Send message
	GG_RECV_MSG80: 0x002e, // Receive message
	GG_LOGIN80: 0x0031, // Login (protocol 8.0)
	GG_LOGIN80_OK: 0x0035, // Login success
	GG_NEW_STATUS80: 0x0038, // Status change
	GG_LOGIN80_FAILED: 0x0043, // Login failed
} as const;

// Status codes
export const GG_STATUS = {
	OFFLINE: 0x0001,
	AVAILABLE: 0x0002,
	BUSY: 0x0003,
	AWAY: 0x0004,
	INVISIBLE: 0x0014,
} as const;

// Hash types
export const GG_HASH_TYPE = {
	GG32: 0x01,
	SHA1: 0x02,
} as const;

export interface GaduGaduPacket {
	type: number;
	length: number;
	payload: Uint8Array;
}
