/**
 * Apache Kafka Protocol Implementation
 * Binary wire protocol for distributed event streaming
 * Port: 9092 (plaintext), 9093 (SSL)
 *
 * Protocol Format:
 * - All messages framed with 4-byte big-endian size prefix
 * - Request: Size | API Key (2) | API Version (2) | Correlation ID (4) | Client ID (string)
 * - Response: Size | Correlation ID (4) | Response body
 *
 * Implements two key requests:
 * 1. ApiVersions (API Key 18) - Discover supported API versions
 * 2. Metadata (API Key 3) - Get cluster/topic information
 *
 * Use Cases:
 * - Kafka broker connectivity testing
 * - API version discovery
 * - Topic and partition inspection
 * - Cluster health checking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** Kafka API Keys */
const API_KEYS: Record<number, string> = {
  0: 'Produce',
  1: 'Fetch',
  2: 'ListOffsets',
  3: 'Metadata',
  4: 'LeaderAndIsr',
  5: 'StopReplica',
  6: 'UpdateMetadata',
  7: 'ControlledShutdown',
  8: 'OffsetCommit',
  9: 'OffsetFetch',
  10: 'FindCoordinator',
  11: 'JoinGroup',
  12: 'Heartbeat',
  13: 'LeaveGroup',
  14: 'SyncGroup',
  15: 'DescribeGroups',
  16: 'ListGroups',
  17: 'SaslHandshake',
  18: 'ApiVersions',
  19: 'CreateTopics',
  20: 'DeleteTopics',
  21: 'DeleteRecords',
  22: 'InitProducerId',
  23: 'OffsetForLeaderEpoch',
  24: 'AddPartitionsToTxn',
  25: 'AddOffsetsToTxn',
  26: 'EndTxn',
  27: 'WriteTxnMarkers',
  28: 'TxnOffsetCommit',
  29: 'DescribeAcls',
  30: 'CreateAcls',
  31: 'DeleteAcls',
  32: 'DescribeConfigs',
  33: 'AlterConfigs',
  34: 'AlterReplicaLogDirs',
  35: 'DescribeLogDirs',
  36: 'SaslAuthenticate',
  37: 'CreatePartitions',
  38: 'CreateDelegationToken',
  39: 'RenewDelegationToken',
  40: 'ExpireDelegationToken',
  41: 'DescribeDelegationToken',
  42: 'DeleteGroups',
  43: 'ElectLeaders',
  44: 'IncrementalAlterConfigs',
  45: 'AlterPartitionReassignments',
  46: 'ListPartitionReassignments',
  47: 'OffsetDelete',
  48: 'DescribeClientQuotas',
  49: 'AlterClientQuotas',
  50: 'DescribeUserScramCredentials',
  51: 'AlterUserScramCredentials',
  56: 'AllocateProducerIds',
  60: 'DescribeQuorum',
  65: 'DescribeProducers',
  67: 'GetTelemetrySubscriptions',
  68: 'PushTelemetry',
};

/** Kafka error codes */
const ERROR_CODES: Record<number, string> = {
  0: 'NONE',
  '-1': 'UNKNOWN_SERVER_ERROR',
  1: 'OFFSET_OUT_OF_RANGE',
  2: 'CORRUPT_MESSAGE',
  3: 'UNKNOWN_TOPIC_OR_PARTITION',
  5: 'LEADER_NOT_AVAILABLE',
  6: 'NOT_LEADER_OR_FOLLOWER',
  9: 'REPLICA_NOT_AVAILABLE',
  35: 'UNSUPPORTED_VERSION',
  87: 'CORRUPT_MESSAGE', // CRC mismatch — expected when CRC=0
};

interface KafkaRequest {
  host: string;
  port?: number;
  timeout?: number;
  clientId?: string;
}

interface KafkaMetadataRequest extends KafkaRequest {
  topics?: string[];
}

interface ApiVersionEntry {
  apiKey: number;
  apiName: string;
  minVersion: number;
  maxVersion: number;
}

/**
 * Build a Kafka request with proper framing
 * Format: Size(4) | API Key(2) | API Version(2) | Correlation ID(4) | Client ID(string)
 */
function buildKafkaRequest(
  apiKey: number,
  apiVersion: number,
  correlationId: number,
  clientId: string,
  payload?: Uint8Array
): Uint8Array {
  const encoder = new TextEncoder();
  const clientIdBytes = encoder.encode(clientId);

  // Calculate size: header + client ID + optional payload
  // Header: API Key(2) + API Version(2) + Correlation ID(4) + Client ID length(2) + Client ID bytes
  const headerSize = 2 + 2 + 4 + 2 + clientIdBytes.length;
  const payloadSize = payload ? payload.length : 0;
  const totalSize = headerSize + payloadSize;

  const buffer = new ArrayBuffer(4 + totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Size prefix (4 bytes, big-endian)
  view.setInt32(offset, totalSize);
  offset += 4;

  // API Key (2 bytes)
  view.setInt16(offset, apiKey);
  offset += 2;

  // API Version (2 bytes)
  view.setInt16(offset, apiVersion);
  offset += 2;

  // Correlation ID (4 bytes)
  view.setInt32(offset, correlationId);
  offset += 4;

  // Client ID (nullable string: 2 bytes length + data)
  view.setInt16(offset, clientIdBytes.length);
  offset += 2;
  new Uint8Array(buffer, offset, clientIdBytes.length).set(clientIdBytes);
  offset += clientIdBytes.length;

  // Optional payload
  if (payload) {
    new Uint8Array(buffer, offset, payload.length).set(payload);
  }

  return new Uint8Array(buffer);
}

/**
 * Build ApiVersions request (API Key 18, Version 0)
 * This is the simplest Kafka request - no additional payload needed
 */
function buildApiVersionsRequest(correlationId: number, clientId: string): Uint8Array {
  return buildKafkaRequest(18, 0, correlationId, clientId);
}

/**
 * Build Metadata request (API Key 3, Version 0)
 * Payload: topic array (null = all topics)
 */
function buildMetadataRequest(
  correlationId: number,
  clientId: string,
  topics: string[] | null
): Uint8Array {
  const encoder = new TextEncoder();

  if (topics === null) {
    // Null array = request all topics: -1 as int32
    // Actually for Metadata v0, empty array [] means all topics
    // Let's send empty array: count = 0
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setInt32(0, 0);
    return buildKafkaRequest(3, 0, correlationId, clientId, payload);
  }

  // Calculate payload size
  let payloadSize = 4; // array length
  for (const topic of topics) {
    payloadSize += 2 + encoder.encode(topic).length; // string length + data
  }

  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);
  let offset = 0;

  // Array length
  view.setInt32(offset, topics.length);
  offset += 4;

  // Topics
  for (const topic of topics) {
    const topicBytes = encoder.encode(topic);
    view.setInt16(offset, topicBytes.length);
    offset += 2;
    payload.set(topicBytes, offset);
    offset += topicBytes.length;
  }

  return buildKafkaRequest(3, 0, correlationId, clientId, payload);
}

/**
 * Read a full Kafka response (size-prefixed)
 */
async function readKafkaResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<DataView> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeout)
  );

  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let expectedSize = -1;

  while (true) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) throw new Error('Connection closed before response received');

    chunks.push(value);
    totalRead += value.length;

    // Once we have at least 4 bytes, read the size
    if (expectedSize === -1 && totalRead >= 4) {
      const combined = concatenateChunks(chunks, totalRead);
      expectedSize = new DataView(combined.buffer).getInt32(0);
    }

    // Check if we have the full response
    if (expectedSize >= 0 && totalRead >= expectedSize + 4) {
      break;
    }
  }

  const fullResponse = concatenateChunks(chunks, totalRead);
  // Return view starting after the 4-byte size prefix
  return new DataView(fullResponse.buffer, 4, expectedSize);
}

function concatenateChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Parse ApiVersions response
 */
function parseApiVersionsResponse(view: DataView): {
  correlationId: number;
  errorCode: number;
  errorName: string;
  apiVersions: ApiVersionEntry[];
} {
  let offset = 0;

  // Correlation ID (4 bytes)
  const correlationId = view.getInt32(offset);
  offset += 4;

  // Error Code (2 bytes)
  const errorCode = view.getInt16(offset);
  offset += 2;

  const errorName = ERROR_CODES[errorCode] || `UNKNOWN_ERROR(${errorCode})`;

  // API Versions array
  const apiVersions: ApiVersionEntry[] = [];

  if (errorCode === 0 && offset + 4 <= view.byteLength) {
    const arrayLen = view.getInt32(offset);
    offset += 4;

    for (let i = 0; i < arrayLen && offset + 6 <= view.byteLength; i++) {
      const apiKey = view.getInt16(offset);
      offset += 2;
      const minVersion = view.getInt16(offset);
      offset += 2;
      const maxVersion = view.getInt16(offset);
      offset += 2;

      apiVersions.push({
        apiKey,
        apiName: API_KEYS[apiKey] || `Unknown(${apiKey})`,
        minVersion,
        maxVersion,
      });
    }
  }

  return { correlationId, errorCode, errorName, apiVersions };
}

/**
 * Parse Metadata response (v0)
 */
function parseMetadataResponse(view: DataView): {
  correlationId: number;
  brokers: Array<{ nodeId: number; host: string; port: number }>;
  topics: Array<{
    errorCode: number;
    name: string;
    partitions: Array<{
      errorCode: number;
      partitionId: number;
      leader: number;
      replicas: number[];
      isr: number[];
    }>;
  }>;
} {
  const decoder = new TextDecoder();
  let offset = 0;

  // Correlation ID
  const correlationId = view.getInt32(offset);
  offset += 4;

  // Brokers array
  const brokerCount = view.getInt32(offset);
  offset += 4;

  const brokers: Array<{ nodeId: number; host: string; port: number }> = [];
  for (let i = 0; i < brokerCount && offset + 4 <= view.byteLength; i++) {
    const nodeId = view.getInt32(offset);
    offset += 4;

    const hostLen = view.getInt16(offset);
    offset += 2;
    const host = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset, hostLen));
    offset += hostLen;

    const port = view.getInt32(offset);
    offset += 4;

    brokers.push({ nodeId, host, port });
  }

  // Topics array
  const topicCount = view.getInt32(offset);
  offset += 4;

  const topics: Array<{
    errorCode: number;
    name: string;
    partitions: Array<{
      errorCode: number;
      partitionId: number;
      leader: number;
      replicas: number[];
      isr: number[];
    }>;
  }> = [];

  for (let t = 0; t < topicCount && offset + 2 <= view.byteLength; t++) {
    const topicErrorCode = view.getInt16(offset);
    offset += 2;

    const topicNameLen = view.getInt16(offset);
    offset += 2;
    const topicName = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + offset, topicNameLen)
    );
    offset += topicNameLen;

    // Partitions
    const partitionCount = view.getInt32(offset);
    offset += 4;

    const partitions: Array<{
      errorCode: number;
      partitionId: number;
      leader: number;
      replicas: number[];
      isr: number[];
    }> = [];

    for (let p = 0; p < partitionCount && offset + 2 <= view.byteLength; p++) {
      const partErrorCode = view.getInt16(offset);
      offset += 2;

      const partitionId = view.getInt32(offset);
      offset += 4;

      const leader = view.getInt32(offset);
      offset += 4;

      // Replicas
      const replicaCount = view.getInt32(offset);
      offset += 4;
      const replicas: number[] = [];
      for (let r = 0; r < replicaCount && offset + 4 <= view.byteLength; r++) {
        replicas.push(view.getInt32(offset));
        offset += 4;
      }

      // ISR
      const isrCount = view.getInt32(offset);
      offset += 4;
      const isr: number[] = [];
      for (let r = 0; r < isrCount && offset + 4 <= view.byteLength; r++) {
        isr.push(view.getInt32(offset));
        offset += 4;
      }

      partitions.push({ errorCode: partErrorCode, partitionId, leader, replicas, isr });
    }

    topics.push({ errorCode: topicErrorCode, name: topicName, partitions });
  }

  return { correlationId, brokers, topics };
}

/**
 * Handle Kafka ApiVersions request
 * Returns supported API versions from the broker
 */
export async function handleKafkaApiVersions(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as KafkaRequest;
    const { host, port = 9092, timeout = 15000, clientId = 'portofcall' } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Send ApiVersions request
        const request = buildApiVersionsRequest(1, clientId);
        await writer.write(request);

        // Read response
        const responseView = await readKafkaResponse(reader, timeout);
        const parsed = parseApiVersionsResponse(responseView);

        const totalTime = Date.now() - startTime;

        // Cleanup
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          correlationId: parsed.correlationId,
          errorCode: parsed.errorCode,
          errorName: parsed.errorName,
          apiVersions: parsed.apiVersions,
          apiCount: parsed.apiVersions.length,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ---------------------------------------------------------------------------
// Varint encoding (signed zigzag, used in RecordBatch Record fields)
// ---------------------------------------------------------------------------

/**
 * Encode a signed integer as a zigzag varint (used in Kafka record batch records).
 * Zigzag: n >= 0 -> (n * 2), n < 0 -> ((-n) * 2 - 1)
 * Then encode as unsigned LEB128.
 */
function encodeVarint(n: number): number[] {
  const zigzag = n >= 0 ? (n * 2) : ((-n) * 2 - 1);
  const result: number[] = [];
  let v = zigzag;
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    result.push(byte);
  } while (v !== 0);
  return result;
}

/**
 * Build a Produce request (apiKey=0, apiVersion=3)
 * Note: CRC32C is zeroed out — brokers may return errorCode=2 (CORRUPT_MESSAGE) for CRC mismatch.
 */
function buildProduceRequest(
  correlationId: number,
  clientId: string,
  topic: string,
  partition: number,
  key: Uint8Array | null,
  value: Uint8Array,
  acks: number,
  timeoutMs: number
): Uint8Array {
  const encoder = new TextEncoder();

  // Build the Record body
  const recordAttributes = [0x00]; // int8 attributes = 0
  const timestampDelta = encodeVarint(0);
  const offsetDelta = encodeVarint(0);

  const keyBytes: number[] = key
    ? [...encodeVarint(key.length), ...Array.from(key)]
    : encodeVarint(-1); // null key

  const valueBytes: number[] = [
    ...encodeVarint(value.length),
    ...Array.from(value),
  ];

  const headersCount = encodeVarint(0);

  const recordBody = [
    ...recordAttributes,
    ...timestampDelta,
    ...offsetDelta,
    ...keyBytes,
    ...valueBytes,
    ...headersCount,
  ];

  const recordLengthVarint = encodeVarint(recordBody.length);
  const record = [...recordLengthVarint, ...recordBody];

  // Build RecordBatch fields starting from attributes (CRC covers these)
  const now = BigInt(Date.now());
  const batchFieldsBuffer = new ArrayBuffer(
    2 + // attributes int16
    4 + // lastOffsetDelta int32
    8 + // baseTimestamp int64
    8 + // maxTimestamp int64
    8 + // producerId int64
    2 + // producerEpoch int16
    4 + // baseSequence int32
    4 + // numRecords int32
    record.length
  );
  const bfView = new DataView(batchFieldsBuffer);
  const bfArr = new Uint8Array(batchFieldsBuffer);
  let bfOff = 0;
  bfView.setInt16(bfOff, 0); bfOff += 2;             // attributes
  bfView.setInt32(bfOff, 0); bfOff += 4;             // lastOffsetDelta
  bfView.setBigInt64(bfOff, now); bfOff += 8;        // baseTimestamp
  bfView.setBigInt64(bfOff, now); bfOff += 8;        // maxTimestamp
  bfView.setBigInt64(bfOff, BigInt(-1)); bfOff += 8; // producerId = -1
  bfView.setInt16(bfOff, -1); bfOff += 2;            // producerEpoch = -1
  bfView.setInt32(bfOff, -1); bfOff += 4;            // baseSequence = -1
  bfView.setInt32(bfOff, 1); bfOff += 4;             // numRecords = 1
  bfArr.set(record, bfOff);

  const batchFields = new Uint8Array(batchFieldsBuffer);

  // batchLength = partitionLeaderEpoch(4) + magic(1) + crc(4) + batchFields
  const batchLength = 4 + 1 + 4 + batchFields.length;

  const recordBatchBuffer = new ArrayBuffer(8 + 4 + 4 + 1 + 4 + batchFields.length);
  const rbView = new DataView(recordBatchBuffer);
  const rbArr = new Uint8Array(recordBatchBuffer);
  let rbOff = 0;
  rbView.setBigInt64(rbOff, BigInt(0)); rbOff += 8;  // baseOffset
  rbView.setInt32(rbOff, batchLength); rbOff += 4;   // batchLength
  rbView.setInt32(rbOff, 0); rbOff += 4;             // partitionLeaderEpoch
  rbView.setInt8(rbOff, 2); rbOff += 1;              // magic = 2
  rbView.setInt32(rbOff, 0); rbOff += 4;             // crc = 0 (CRC32C unavailable)
  rbArr.set(batchFields, rbOff);

  const recordBatch = new Uint8Array(recordBatchBuffer);

  // Build ProduceRequest v3 payload
  const topicBytes = encoder.encode(topic);
  const recordSetSize = recordBatch.length;

  const payloadSize =
    2 +                           // transactionalId null (-1)
    2 +                           // acks
    4 +                           // timeoutMs
    4 +                           // topicData array len (1)
    2 + topicBytes.length +       // topic name
    4 +                           // partitionData array len (1)
    4 +                           // partition
    4 + recordSetSize;            // recordSet (int32 size + data)

  const payloadBuf = new ArrayBuffer(payloadSize);
  const pView = new DataView(payloadBuf);
  const pArr = new Uint8Array(payloadBuf);
  let pOff = 0;

  pView.setInt16(pOff, -1); pOff += 2;               // transactionalId = null
  pView.setInt16(pOff, acks); pOff += 2;             // acks
  pView.setInt32(pOff, timeoutMs); pOff += 4;        // timeout
  pView.setInt32(pOff, 1); pOff += 4;                // topicData array len = 1
  pView.setInt16(pOff, topicBytes.length); pOff += 2;
  pArr.set(topicBytes, pOff); pOff += topicBytes.length;
  pView.setInt32(pOff, 1); pOff += 4;                // partitionData array len = 1
  pView.setInt32(pOff, partition); pOff += 4;        // partition
  pView.setInt32(pOff, recordSetSize); pOff += 4;    // recordSet size prefix
  pArr.set(recordBatch, pOff);

  return buildKafkaRequest(0, 3, correlationId, clientId, new Uint8Array(payloadBuf));
}

/**
 * Parse Produce response v3
 */
function parseProduceResponse(view: DataView): {
  correlationId: number;
  throttleTimeMs: number;
  topicName: string;
  partition: number;
  errorCode: number;
  baseOffset: bigint;
} {
  const decoder = new TextDecoder();
  let offset = 0;

  const correlationId = view.getInt32(offset); offset += 4;
  const throttleTimeMs = view.getInt32(offset); offset += 4;

  const respCount = view.getInt32(offset); offset += 4;

  let topicName = '';
  let partition = 0;
  let errorCode = 0;
  let baseOffset = BigInt(0);

  for (let i = 0; i < respCount && offset + 2 <= view.byteLength; i++) {
    const nameLen = view.getInt16(offset); offset += 2;
    topicName = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset, nameLen));
    offset += nameLen;

    const partCount = view.getInt32(offset); offset += 4;
    for (let p = 0; p < partCount && offset + 2 <= view.byteLength; p++) {
      partition = view.getInt32(offset); offset += 4;
      errorCode = view.getInt16(offset); offset += 2;
      if (offset + 8 <= view.byteLength) { baseOffset = view.getBigInt64(offset); offset += 8; }
      if (offset + 8 <= view.byteLength) { offset += 8; } // logAppendTimeMs
      if (offset + 8 <= view.byteLength) { offset += 8; } // logStartOffset
    }
  }

  return { correlationId, throttleTimeMs, topicName, partition, errorCode, baseOffset };
}

/**
 * Handle Kafka Produce request
 * Publishes a single message to a topic partition using ProduceRequest v3.
 *
 * Known limitation: CRC32C is set to 0. Brokers that validate CRC will return
 * errorCode=2 (CORRUPT_MESSAGE). This is acceptable for connectivity testing.
 */
export async function handleKafkaProduceMessage(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host: string; port?: number; topic: string; partition?: number;
      key?: string; value: string; acks?: number; timeoutMs?: number;
      timeout?: number; clientId?: string;
    };

    const {
      host, port = 9092, topic, partition = 0,
      key, value, acks = 1, timeoutMs = 5000,
      timeout = 10000, clientId = 'portofcall',
    } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!topic) {
      return new Response(
        JSON.stringify({ success: false, error: 'Topic is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (value === undefined || value === null) {
      return new Response(
        JSON.stringify({ success: false, error: 'Value is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const enc = new TextEncoder();
    const valueBytes = enc.encode(value);
    const keyBytesArr = key ? enc.encode(key) : null;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        const produceReq = buildProduceRequest(
          3, clientId, topic, partition, keyBytesArr, valueBytes, acks, timeoutMs
        );
        await writer.write(produceReq);

        if (acks === 0) {
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();
          return {
            success: true, host, port, topic, partition,
            errorCode: 0, baseOffset: '0',
            rtt: Date.now() - startTime,
            note: 'acks=0: no response expected from broker',
          };
        }

        const responseView = await readKafkaResponse(reader, timeout);
        const parsed = parseProduceResponse(responseView);
        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const errorMessage = parsed.errorCode !== 0
          ? (ERROR_CODES[parsed.errorCode] || `Unknown error code ${parsed.errorCode}`)
          : undefined;

        return {
          success: parsed.errorCode === 0,
          host, port, topic,
          partition: parsed.partition,
          errorCode: parsed.errorCode,
          errorMessage,
          baseOffset: parsed.baseOffset.toString(),
          throttleTimeMs: parsed.throttleTimeMs,
          rtt,
        };
      } catch (err) {
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Produce failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Kafka Metadata request
 * Returns broker and topic information from the cluster
 */
export async function handleKafkaMetadata(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as KafkaMetadataRequest;
    const { host, port = 9092, timeout = 15000, clientId = 'portofcall', topics } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Send Metadata request
        const metadataReq = buildMetadataRequest(2, clientId, topics || null);
        await writer.write(metadataReq);

        // Read response
        const responseView = await readKafkaResponse(reader, timeout);
        const parsed = parseMetadataResponse(responseView);

        const totalTime = Date.now() - startTime;

        // Cleanup
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          correlationId: parsed.correlationId,
          brokers: parsed.brokers,
          brokerCount: parsed.brokers.length,
          topics: parsed.topics,
          topicCount: parsed.topics.length,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
