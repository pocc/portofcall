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
    if (arrayLen < 0 || arrayLen > 10000) {
      throw new Error(`Invalid Kafka array length: ${arrayLen}`);
    }

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
  if (brokerCount < 0 || brokerCount > 10000) {
    throw new Error(`Invalid Kafka array length: ${brokerCount}`);
  }

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
  if (topicCount < 0 || topicCount > 10000) {
    throw new Error(`Invalid Kafka array length: ${topicCount}`);
  }

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
    if (partitionCount < 0 || partitionCount > 10000) {
      throw new Error(`Invalid Kafka array length: ${partitionCount}`);
    }

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
      if (replicaCount < 0 || replicaCount > 10000) {
        throw new Error(`Invalid Kafka array length: ${replicaCount}`);
      }
      const replicas: number[] = [];
      for (let r = 0; r < replicaCount && offset + 4 <= view.byteLength; r++) {
        replicas.push(view.getInt32(offset));
        offset += 4;
      }

      // ISR
      const isrCount = view.getInt32(offset);
      offset += 4;
      if (isrCount < 0 || isrCount > 10000) {
        throw new Error(`Invalid Kafka array length: ${isrCount}`);
      }
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

// ---------------------------------------------------------------------------
// Kafka FetchRequest (consumer side)
// ---------------------------------------------------------------------------

interface KafkaRecord {
  offset: string;
  timestampMs: string;
  key: string | null;
  value: string | null;
}

/**
 * Decode a zigzag-encoded varint (used in Kafka RecordBatch records).
 * All variable-length fields in Record use zigzag encoding (same as protobuf SINT32/SINT64).
 */
function decodeVarint(data: Uint8Array, pos: number): { value: number; bytesRead: number } {
  let raw = 0;
  let shift = 0;
  let bytesRead = 0;
  while (pos + bytesRead < data.length) {
    const b = data[pos + bytesRead];
    bytesRead++;
    raw |= (b & 0x7F) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  // Zigzag decode: (raw >>> 1) XOR -(raw & 1)
  const value = (raw >>> 1) ^ -(raw & 1);
  return { value, bytesRead };
}

/**
 * Parse all RecordBatch entries from a raw record-set byte slice.
 * Handles magic=2 (RecordBatch, Kafka 0.11+). Stops after maxRecords records.
 */
function parseRecordBatches(data: Uint8Array, maxRecords: number): KafkaRecord[] {
  const records: KafkaRecord[] = [];
  const dec = new TextDecoder('utf-8', { fatal: false });
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  while (pos + 12 < data.length && records.length < maxRecords) {
    if (pos + 12 > data.length) break;
    const baseOffset = dv.getBigInt64(pos); pos += 8;
    const batchLength = dv.getInt32(pos); pos += 4;
    if (batchLength <= 0 || pos + batchLength > data.length) break;
    const batchEnd = pos + batchLength;

    if (pos + 9 > batchEnd) { pos = batchEnd; continue; }
    pos += 4; // partitionLeaderEpoch
    const magic = dv.getInt8(pos); pos += 1;
    pos += 4; // crc (skip validation)

    if (magic !== 2) { pos = batchEnd; continue; }

    if (pos + 30 > batchEnd) { pos = batchEnd; continue; }
    pos += 2; // attributes
    pos += 4; // lastOffsetDelta
    const baseTimestamp = dv.getBigInt64(pos); pos += 8;
    pos += 8; // maxTimestamp
    pos += 8; // producerId
    pos += 2; // producerEpoch
    pos += 4; // baseSequence
    const recordCount = dv.getInt32(pos); pos += 4;

    for (let i = 0; i < recordCount && records.length < maxRecords; i++) {
      if (pos >= batchEnd) break;
      const lenDec = decodeVarint(data, pos); pos += lenDec.bytesRead;
      const recordEnd = Math.min(pos + lenDec.value, batchEnd);
      if (lenDec.value <= 0 || pos >= recordEnd) break;

      pos += 1; // record attributes (INT8)
      const tsDelta = decodeVarint(data, pos); pos += tsDelta.bytesRead;
      const offDelta = decodeVarint(data, pos); pos += offDelta.bytesRead;

      // key
      const keyLen = decodeVarint(data, pos); pos += keyLen.bytesRead;
      let key: string | null = null;
      if (keyLen.value >= 0 && pos + keyLen.value <= recordEnd) {
        key = dec.decode(data.slice(pos, pos + keyLen.value));
        pos += keyLen.value;
      }

      // value
      const valLen = decodeVarint(data, pos); pos += valLen.bytesRead;
      let value: string | null = null;
      if (valLen.value >= 0 && pos + valLen.value <= recordEnd) {
        value = dec.decode(data.slice(pos, pos + valLen.value));
        pos += valLen.value;
      }

      // headers (skip)
      const hCount = decodeVarint(data, pos); pos += hCount.bytesRead;
      for (let h = 0; h < hCount.value && pos < recordEnd; h++) {
        const hkLen = decodeVarint(data, pos); pos += hkLen.bytesRead;
        if (hkLen.value > 0) pos += hkLen.value;
        const hvLen = decodeVarint(data, pos); pos += hvLen.bytesRead;
        if (hvLen.value > 0) pos += hvLen.value;
      }

      records.push({
        offset: (baseOffset + BigInt(offDelta.value)).toString(),
        timestampMs: (baseTimestamp + BigInt(tsDelta.value)).toString(),
        key,
        value,
      });

      pos = recordEnd;
    }

    pos = batchEnd;
  }

  return records;
}

/**
 * Build FetchRequest v4 (API key=1, version=4).
 * v4 adds isolation_level; supported by Kafka 0.11+.
 */
function buildFetchRequest(
  correlationId: number,
  clientId: string,
  topic: string,
  partition: number,
  fetchOffset: bigint,
  maxBytes: number,
  maxWaitMs: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const topicBytes = encoder.encode(topic);

  // replica_id(4) + max_wait_ms(4) + min_bytes(4) + max_bytes(4) + isolation_level(1)
  // + topics_len(4) + topic_name(2+N) + partitions_len(4) + partition(4) + fetch_offset(8) + part_max_bytes(4)
  const payloadSize = 4 + 4 + 4 + 4 + 1 + 4 + (2 + topicBytes.length) + 4 + 4 + 8 + 4;
  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);
  let off = 0;

  view.setInt32(off, -1); off += 4;               // replica_id = -1 (consumer)
  view.setInt32(off, maxWaitMs); off += 4;         // max_wait_ms
  view.setInt32(off, 1); off += 4;                 // min_bytes = 1
  view.setInt32(off, maxBytes); off += 4;          // max_bytes
  view.setInt8(off, 0); off += 1;                  // isolation_level = 0 (READ_UNCOMMITTED)
  view.setInt32(off, 1); off += 4;                 // topics array len = 1
  view.setInt16(off, topicBytes.length); off += 2;
  payload.set(topicBytes, off); off += topicBytes.length;
  view.setInt32(off, 1); off += 4;                 // partitions array len = 1
  view.setInt32(off, partition); off += 4;         // partition
  view.setBigInt64(off, fetchOffset); off += 8;    // fetch_offset
  view.setInt32(off, maxBytes);                     // partition_max_bytes

  return buildKafkaRequest(1, 4, correlationId, clientId, payload);
}

/**
 * Parse FetchResponse v4.
 */
function parseFetchResponse(view: DataView): {
  correlationId: number;
  throttleTimeMs: number;
  topicName: string;
  partition: number;
  errorCode: number;
  highWatermark: bigint;
  lastStableOffset: bigint;
  records: KafkaRecord[];
} {
  const dec = new TextDecoder();
  let off = 0;

  const correlationId = view.getInt32(off); off += 4;
  const throttleTimeMs = view.getInt32(off); off += 4;
  const topicCount = view.getInt32(off); off += 4;

  // We only inspect the first topic / first partition
  let topicName = '';
  let partition = 0;
  let errorCode = 0;
  let highWatermark = BigInt(0);
  let lastStableOffset = BigInt(0);
  let records: KafkaRecord[] = [];

  for (let t = 0; t < topicCount && off + 2 < view.byteLength; t++) {
    const nameLen = view.getInt16(off); off += 2;
    const name = dec.decode(new Uint8Array(view.buffer, view.byteOffset + off, nameLen));
    off += nameLen;
    if (t === 0) topicName = name;

    const partCount = view.getInt32(off); off += 4;
    for (let p = 0; p < partCount && off + 4 < view.byteLength; p++) {
      const partId = view.getInt32(off); off += 4;
      const ec = view.getInt16(off); off += 2;
      const hw = view.getBigInt64(off); off += 8;
      const lso = view.getBigInt64(off); off += 8;

      // aborted_transactions array (v4+): INT32 count, each: producerId(8) + firstOffset(8)
      const abortedCount = view.getInt32(off); off += 4;
      if (abortedCount > 0) off += abortedCount * 16;

      // record_set: INT32 size prefix
      const rsSize = view.getInt32(off); off += 4;
      let partRecords: KafkaRecord[] = [];
      if (rsSize > 0 && off + rsSize <= view.byteLength) {
        const slice = new Uint8Array(view.buffer, view.byteOffset + off, rsSize);
        partRecords = parseRecordBatches(slice, 100);
        off += rsSize;
      } else if (rsSize > 0) {
        off += rsSize;
      }

      if (t === 0 && p === 0) {
        partition = partId;
        errorCode = ec;
        highWatermark = hw;
        lastStableOffset = lso;
        records = partRecords;
      }
    }
  }

  return { correlationId, throttleTimeMs, topicName, partition, errorCode, highWatermark, lastStableOffset, records };
}

/**
 * Handle Kafka Fetch (consume) request.
 * Reads messages from a topic partition starting at a given offset.
 *
 * Body: { host, port=9092, topic, partition=0, offset=0, maxWaitMs=1000, maxBytes=1048576, timeout=15000, clientId='portofcall' }
 * Returns: { success, topic, partition, offset, highWatermark, lastStableOffset, records[], recordCount, throttleTimeMs, rtt }
 */
export async function handleKafkaFetch(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host: string; port?: number; topic: string; partition?: number;
      offset?: number; maxWaitMs?: number; maxBytes?: number;
      timeout?: number; clientId?: string;
    };

    const {
      host, port = 9092, topic, partition = 0,
      offset = 0, maxWaitMs = 1000, maxBytes = 1048576,
      timeout = 15000, clientId = 'portofcall',
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

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }),
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

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        const fetchReq = buildFetchRequest(1, clientId, topic, partition, BigInt(offset), maxBytes, maxWaitMs);
        await writer.write(fetchReq);

        const responseView = await readKafkaResponse(reader, timeout);
        const parsed = parseFetchResponse(responseView);
        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const errorMessage = parsed.errorCode !== 0
          ? (ERROR_CODES[parsed.errorCode] || `Error code ${parsed.errorCode}`)
          : undefined;

        return {
          success: parsed.errorCode === 0,
          host, port, topic,
          partition: parsed.partition,
          offset,
          errorCode: parsed.errorCode,
          errorMessage,
          highWatermark: parsed.highWatermark.toString(),
          lastStableOffset: parsed.lastStableOffset.toString(),
          records: parsed.records,
          recordCount: parsed.records.length,
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
        error: error instanceof Error ? error.message : 'Fetch failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─── Consumer Group APIs ─────────────────────────────────────────────────────

/** Read a Kafka STRING (INT16 length-prefixed, UTF-8) from a DataView at offset. */
function readKafkaString(view: DataView, offset: number): { value: string; newOffset: number } {
  const len = view.getInt16(offset);
  offset += 2;
  if (len < 0) return { value: '', newOffset: offset }; // null string
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  return { value: new TextDecoder().decode(bytes), newOffset: offset + len };
}

/** Read a Kafka BYTES (INT32 length-prefixed) from a DataView at offset. */
function readKafkaBytes(view: DataView, offset: number): { length: number; newOffset: number } {
  const len = view.getInt32(offset);
  offset += 4;
  if (len < 0) return { length: 0, newOffset: offset };
  return { length: len, newOffset: offset + len };
}

/**
 * Build a ListGroups v0 request (API key 16).
 * No payload — just the standard request header.
 */
function buildListGroupsRequest(correlationId: number, clientId: string): Uint8Array {
  return buildKafkaRequest(16, 0, correlationId, clientId);
}

/**
 * Parse ListGroups v0 response.
 * Format: correlationId(4) | error_code(2) | groups[]: group_id(STRING) + protocol_type(STRING)
 */
function parseListGroupsResponse(view: DataView): {
  correlationId: number;
  errorCode: number;
  errorName: string;
  groups: Array<{ groupId: string; protocolType: string }>;
} {
  let offset = 0;
  const correlationId = view.getInt32(offset); offset += 4;
  const errorCode = view.getInt16(offset);     offset += 2;
  const groupCount = view.getInt32(offset);    offset += 4;

  const groups: Array<{ groupId: string; protocolType: string }> = [];
  for (let i = 0; i < groupCount && offset < view.byteLength; i++) {
    const gid = readKafkaString(view, offset); offset = gid.newOffset;
    const pt  = readKafkaString(view, offset); offset = pt.newOffset;
    groups.push({ groupId: gid.value, protocolType: pt.value });
  }

  return { correlationId, errorCode, errorName: ERROR_CODES[errorCode] ?? 'NONE', groups };
}

/**
 * Build a DescribeGroups v0 request (API key 15).
 * Payload: INT32 count + STRING[] groupIds
 */
function buildDescribeGroupsRequest(correlationId: number, clientId: string, groupIds: string[]): Uint8Array {
  const enc = new TextEncoder();
  const encoded = groupIds.map(g => enc.encode(g));
  let payloadSize = 4; // array count
  for (const b of encoded) payloadSize += 2 + b.length;

  const payload = new Uint8Array(payloadSize);
  const dv = new DataView(payload.buffer);
  let off = 0;
  dv.setInt32(off, groupIds.length); off += 4;
  for (let i = 0; i < encoded.length; i++) {
    dv.setInt16(off, encoded[i].length); off += 2;
    payload.set(encoded[i], off);       off += encoded[i].length;
  }
  return buildKafkaRequest(15, 0, correlationId, clientId, payload);
}

/**
 * Parse DescribeGroups v0 response.
 * For each group: error_code(2) + group_id(STRING) + state(STRING) + protocol_type(STRING)
 *   + protocol(STRING) + members[]: member_id(STRING) + client_id(STRING) + client_host(STRING)
 *     + member_metadata(BYTES) + member_assignment(BYTES)
 */
function parseDescribeGroupsResponse(view: DataView): {
  correlationId: number;
  groups: Array<{
    errorCode: number;
    groupId: string;
    state: string;
    protocolType: string;
    protocol: string;
    memberCount: number;
    members: Array<{ memberId: string; clientId: string; clientHost: string }>;
  }>;
} {
  let off = 0;
  const correlationId = view.getInt32(off); off += 4;
  const groupCount    = view.getInt32(off); off += 4;

  const groups = [];
  for (let g = 0; g < groupCount && off < view.byteLength; g++) {
    const errorCode  = view.getInt16(off); off += 2;
    const gid        = readKafkaString(view, off); off = gid.newOffset;
    const state      = readKafkaString(view, off); off = state.newOffset;
    const protoType  = readKafkaString(view, off); off = protoType.newOffset;
    const proto      = readKafkaString(view, off); off = proto.newOffset;
    const memberCount = view.getInt32(off); off += 4;

    const members = [];
    for (let m = 0; m < memberCount && off < view.byteLength; m++) {
      const mid  = readKafkaString(view, off); off = mid.newOffset;
      const cid  = readKafkaString(view, off); off = cid.newOffset;
      const host = readKafkaString(view, off); off = host.newOffset;
      // Skip member_metadata BYTES
      const meta = readKafkaBytes(view, off); off = meta.newOffset;
      // Skip member_assignment BYTES
      const asgn = readKafkaBytes(view, off); off = asgn.newOffset;
      members.push({ memberId: mid.value, clientId: cid.value, clientHost: host.value });
    }

    groups.push({ errorCode, groupId: gid.value, state: state.value,
      protocolType: protoType.value, protocol: proto.value, memberCount, members });
  }

  return { correlationId, groups };
}

/**
 * List all consumer groups on a Kafka broker.
 * Uses ListGroups v0 (API key 16) — returns group ID and protocol type for each group.
 * The foundation for consumer lag monitoring: get the group list, then DescribeGroups.
 *
 * POST /api/kafka/groups
 * Body: { host, port=9092, timeout=15000, clientId="portofcall" }
 */
export async function handleKafkaListGroups(request: Request): Promise<Response> {
  try {
    const body = await request.json() as KafkaRequest;
    const { host, port = 9092, timeout = 15000, clientId = 'portofcall' } = body;
    if (!host) return Response.json({ success: false, error: 'host is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        await writer.write(buildListGroupsRequest(1, clientId));
        const view = await readKafkaResponse(reader, timeout);
        const parsed = parseListGroupsResponse(view);
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
        return { success: true, host, port, latencyMs: Date.now() - startTime, ...parsed };
      } catch (err) {
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, tp]);
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : 'ListGroups failed' }, { status: 500 });
  }
}

/**
 * Build a ListOffsets v1 request (API key 2).
 * v1 returns a single (timestamp, offset) pair per partition (unlike v0 which had an array).
 * timestamp: -1 = latest (end of log), -2 = earliest (start of log).
 */
function buildListOffsetsRequest(
  correlationId: number,
  clientId: string,
  topic: string,
  partition: number,
  timestamp: bigint
): Uint8Array {
  const enc = new TextEncoder();
  const topicBytes = enc.encode(topic);
  // replica_id(4) + isolation_level(1) + topics_len(4) + topic(2+N) + partitions_len(4) + partition(4) + timestamp(8)
  const payloadSize = 4 + 1 + 4 + (2 + topicBytes.length) + 4 + 4 + 8;
  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setInt32(off, -1); off += 4;               // replica_id = -1 (consumer)
  view.setInt8(off, 0); off += 1;                  // isolation_level = 0 (READ_UNCOMMITTED)
  view.setInt32(off, 1); off += 4;                 // topics array len = 1
  view.setInt16(off, topicBytes.length); off += 2;
  payload.set(topicBytes, off); off += topicBytes.length;
  view.setInt32(off, 1); off += 4;                 // partitions array len = 1
  view.setInt32(off, partition); off += 4;         // partition index
  view.setBigInt64(off, timestamp);                 // timestamp sentinel
  return buildKafkaRequest(2, 1, correlationId, clientId, payload);
}

/**
 * Parse ListOffsets v1 response.
 * Format: correlationId(4) + throttle(4) + topics[]: topic(STRING) + partitions[]: partition(4) + error(2) + timestamp(8) + offset(8)
 */
function parseListOffsetsResponse(view: DataView): {
  correlationId: number;
  throttleTimeMs: number;
  topicName: string;
  partition: number;
  errorCode: number;
  timestamp: string;
  offset: string;
} {
  const dec = new TextDecoder();
  let off = 0;
  const correlationId = view.getInt32(off); off += 4;
  const throttleTimeMs = view.getInt32(off); off += 4;
  const topicCount = view.getInt32(off); off += 4;

  let topicName = '';
  let partition = 0;
  let errorCode = 0;
  let timestamp = BigInt(0);
  let offset = BigInt(0);

  if (topicCount > 0 && off + 2 <= view.byteLength) {
    const nameLen = view.getInt16(off); off += 2;
    topicName = dec.decode(new Uint8Array(view.buffer, view.byteOffset + off, nameLen)); off += nameLen;
    const partCount = view.getInt32(off); off += 4;
    if (partCount > 0 && off + 4 <= view.byteLength) {
      partition = view.getInt32(off); off += 4;
      errorCode = view.getInt16(off); off += 2;
      if (off + 8 <= view.byteLength) { timestamp = view.getBigInt64(off); off += 8; }
      if (off + 8 <= view.byteLength) { offset = view.getBigInt64(off); }
    }
  }

  return { correlationId, throttleTimeMs, topicName, partition, errorCode,
    timestamp: timestamp.toString(), offset: offset.toString() };
}

/**
 * List partition offsets — earliest, latest, or at a specific timestamp.
 * This is the prerequisite for meaningful Fetch calls: without knowing the current
 * end offset you cannot compute consumer lag or start a targeted read.
 *
 * POST /api/kafka/offsets
 * Body: { host, port=9092, topic, partition=0, timestamp=-1, timeout=15000, clientId="portofcall" }
 *   timestamp: -1 = latest (high watermark), -2 = earliest (log start offset)
 *              Unix ms timestamp = first offset at/after that time
 * Returns: { success, topic, partition, offset, timestamp, errorCode }
 */
export async function handleKafkaListOffsets(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; topic: string; partition?: number;
      timestamp?: number; timeout?: number; clientId?: string;
    };
    const { host, port = 9092, topic, partition = 0,
      timestamp = -1, timeout = 15000, clientId = 'portofcall' } = body;

    if (!host) return Response.json({ success: false, error: 'host is required' }, { status: 400 });
    if (!topic) return Response.json({ success: false, error: 'topic is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        await writer.write(buildListOffsetsRequest(1, clientId, topic, partition, BigInt(timestamp)));
        const view = await readKafkaResponse(reader, timeout);
        const parsed = parseListOffsetsResponse(view);
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }

        const errorMessage = parsed.errorCode !== 0
          ? (ERROR_CODES[parsed.errorCode] || `Error code ${parsed.errorCode}`)
          : undefined;

        return {
          success: parsed.errorCode === 0,
          host, port,
          topic: parsed.topicName,
          partition: parsed.partition,
          errorCode: parsed.errorCode,
          errorMessage,
          timestamp: parsed.timestamp,
          offset: parsed.offset,
          latencyMs: Date.now() - startTime,
        };
      } catch (err) {
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, tp]);
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : 'ListOffsets failed' }, { status: 500 });
  }
}

/**
 * Describe one or more consumer groups on a Kafka broker.
 * Uses DescribeGroups v0 (API key 15) — returns group state, protocol, and member list.
 * Useful for understanding which consumers are active and which partitions they own.
 *
 * POST /api/kafka/group-describe
 * Body: { host, port=9092, timeout=15000, clientId="portofcall", groupIds: string[] }
 */
export async function handleKafkaDescribeGroups(request: Request): Promise<Response> {
  try {
    const body = await request.json() as KafkaRequest & { groupIds?: string[] };
    const { host, port = 9092, timeout = 15000, clientId = 'portofcall', groupIds = [] } = body;
    if (!host) return Response.json({ success: false, error: 'host is required' }, { status: 400 });
    if (groupIds.length === 0) return Response.json({ success: false, error: 'groupIds array is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        await writer.write(buildDescribeGroupsRequest(1, clientId, groupIds));
        const view = await readKafkaResponse(reader, timeout);
        const parsed = parseDescribeGroupsResponse(view);
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
        return { success: true, host, port, latencyMs: Date.now() - startTime, ...parsed };
      } catch (err) {
        writer.releaseLock(); reader.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, tp]);
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : 'DescribeGroups failed' }, { status: 500 });
  }
}
