/**
 * Gadu-Gadu Protocol Client
 * Port 8074 - Polish Instant Messenger
 */

import { connect } from 'cloudflare:sockets';
import type { GaduGaduConfig, GaduGaduConnectResult } from './types';
import { GG_PACKET_TYPES } from './types';
import {
	readPacket,
	writePacket,
	buildLoginPacket,
	validateUIN,
	getPacketTypeName,
} from './utils';

type Socket = Awaited<ReturnType<typeof connect>>;

export class GaduGaduClient {
	private socket: Socket | null = null;
	private config: GaduGaduConfig;

	constructor(config: GaduGaduConfig) {
		// Validate UIN
		if (!validateUIN(config.uin)) {
			throw new Error('Invalid UIN format (must be 1-99999999)');
		}

		this.config = {
			...config,
			hashType: config.hashType || 'sha1',
			timeout: config.timeout || 30000,
		};
	}

	/**
	 * Connect and authenticate
	 */
	async connect(): Promise<GaduGaduConnectResult> {
		const startTime = Date.now();
		const timing = {
			connect: 0,
			welcome: 0,
			login: 0,
			total: 0,
		};

		try {
			// Step 1: TCP Connect
			const connectStart = Date.now();
			this.socket = connect(`${this.config.host}:${this.config.port}`);

			// Wait for connection with timeout
			const connectTimeout = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('Connection timeout')),
					this.config.timeout || 30000
				)
			);

			await Promise.race([this.socket.opened, connectTimeout]);
			timing.connect = Date.now() - connectStart;

			const reader = this.socket.readable.getReader();
			const writer = this.socket.writable.getWriter();

			// Step 2: Read GG_WELCOME packet
			const welcomeStart = Date.now();
			const welcomePacket = await readPacket(reader, 5000);
			timing.welcome = Date.now() - welcomeStart;

			if (welcomePacket.type !== GG_PACKET_TYPES.GG_WELCOME) {
				throw new Error(
					`Expected GG_WELCOME (0x0001), got ${getPacketTypeName(welcomePacket.type)}`
				);
			}

			// Extract seed from welcome packet
			if (welcomePacket.length < 4) {
				throw new Error('Invalid GG_WELCOME packet: payload too short');
			}

			const seed = new DataView(welcomePacket.payload.buffer).getUint32(0, true);

			// Step 3: Build and send GG_LOGIN80 packet
			const loginStart = Date.now();
			const loginPayload = await buildLoginPacket(
				this.config.uin,
				this.config.password,
				seed,
				this.config.hashType
			);

			const loginPacket = writePacket(GG_PACKET_TYPES.GG_LOGIN80, loginPayload);
			await writer.write(loginPacket);

			// Step 4: Read response (GG_LOGIN80_OK or GG_LOGIN80_FAILED)
			const responsePacket = await readPacket(reader, 5000);
			timing.login = Date.now() - loginStart;
			timing.total = Date.now() - startTime;

			// Release reader/writer
			reader.releaseLock();
			writer.releaseLock();

			// Check response
			if (responsePacket.type === GG_PACKET_TYPES.GG_LOGIN80_OK) {
				return {
					success: true,
					uin: this.config.uin,
					message: 'Login successful',
					seed,
					hashType: this.config.hashType,
					serverResponse: getPacketTypeName(responsePacket.type),
					timing,
				};
			} else if (responsePacket.type === GG_PACKET_TYPES.GG_LOGIN80_FAILED) {
				return {
					success: false,
					message: 'Login failed - invalid credentials',
					seed,
					hashType: this.config.hashType,
					serverResponse: getPacketTypeName(responsePacket.type),
					error: 'Authentication failed',
					timing,
				};
			} else {
				return {
					success: false,
					message: `Unexpected response: ${getPacketTypeName(responsePacket.type)}`,
					seed,
					hashType: this.config.hashType,
					serverResponse: getPacketTypeName(responsePacket.type),
					error: 'Protocol error',
					timing,
				};
			}
		} catch (error) {
			timing.total = Date.now() - startTime;

			return {
				success: false,
				message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error: error instanceof Error ? error.message : 'Unknown error',
				timing,
			};
		} finally {
			await this.close();
		}
	}

	/**
	 * Close connection
	 */
	async close(): Promise<void> {
		if (this.socket) {
			try {
				await this.socket.close();
			} catch {
				// Ignore close errors
			}
			this.socket = null;
		}
	}
}

/**
 * Connect to Gadu-Gadu server (exported for Worker handler)
 */
export async function connectGaduGadu(
	config: GaduGaduConfig
): Promise<GaduGaduConnectResult> {
	const client = new GaduGaduClient(config);
	return await client.connect();
}
