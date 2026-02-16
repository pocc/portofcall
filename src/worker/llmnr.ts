/**
 * LLMNR Protocol Implementation (RFC 4795)
 *
 * Link-Local Multicast Name Resolution - Windows' equivalent of mDNS.
 * Used for local network name resolution without DNS server.
 *
 * Protocol Overview:
 * - Port 5353 (UDP multicast 224.0.0.252, or TCP unicast)
 * - DNS-like binary packet format
 * - Primarily for A and AAAA record queries
 * - No service discovery (simpler than mDNS)
 *
 * Use Cases:
 * - Windows workgroup name resolution
 * - Local network device discovery
 * - Fallback when DNS fails
 * - Corporate Windows networks
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const DNS_TYPE = {
  A: 1,
  AAAA: 28,
  ANY: 255,
} as const;

const DNS_CLASS = {
  IN: 1,
} as const;

interface LLMNRRequest {
  host: string;
  port?: number;
  name: string;
  type?: number;
  timeout?: number;
}

interface LLMNRRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  address: string;
}

/**
 * Encode DNS domain name
 */
function encodeDomainName(name: string): Uint8Array {
  const labels = name.split('.');
  const bytes: number[] = [];

  for (const label of labels) {
    if (!label) continue;
    const labelBytes = new TextEncoder().encode(label);
    bytes.push(labelBytes.length, ...labelBytes);
  }
  bytes.push(0);

  return new Uint8Array(bytes);
}

/**
 * Decode DNS domain name
 */
function decodeDomainName(data: Uint8Array, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let currentOffset = offset;

  while (currentOffset < data.length) {
    const length = data[currentOffset];
    if (length === 0) {
      currentOffset++;
      break;
    }

    // Compression pointer
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | data[currentOffset + 1];
      const { name: pointedName } = decodeDomainName(data, pointer);
      labels.push(pointedName);
      currentOffset += 2;
      break;
    }

    // Regular label
    const label = new TextDecoder().decode(data.slice(currentOffset + 1, currentOffset + 1 + length));
    labels.push(label);
    currentOffset += 1 + length;
  }

  return { name: labels.join('.'), nextOffset: currentOffset };
}

/**
 * Build LLMNR query
 */
function buildLLMNRQuery(name: string, type: number): Uint8Array {
  const parts: number[] = [];
  const id = Math.floor(Math.random() * 0x10000);

  // Header (12 bytes)
  parts.push((id >> 8) & 0xff, id & 0xff);  // ID
  parts.push(0, 0);                         // Flags (standard query)
  parts.push(0, 1);                         // QDCOUNT
  parts.push(0, 0);                         // ANCOUNT
  parts.push(0, 0);                         // NSCOUNT
  parts.push(0, 0);                         // ARCOUNT

  // Question
  const nameBytes = encodeDomainName(name);
  parts.push(...nameBytes);
  parts.push((type >> 8) & 0xff, type & 0xff);              // QTYPE
  parts.push((DNS_CLASS.IN >> 8) & 0xff, DNS_CLASS.IN & 0xff); // QCLASS

  return new Uint8Array(parts);
}

/**
 * Parse LLMNR response
 */
function parseLLMNRResponse(data: Uint8Array) {
  if (data.length < 12) throw new Error('LLMNR response too short');

  const ancount = (data[6] << 8) | data[7];
  let offset = 12;

  // Skip question
  const { nextOffset } = decodeDomainName(data, offset);
  offset = nextOffset + 4; // Skip QTYPE and QCLASS

  const answers: LLMNRRecord[] = [];

  for (let i = 0; i < ancount; i++) {
    const { name, nextOffset: nameEnd } = decodeDomainName(data, offset);
    if (nameEnd + 10 > data.length) break;

    const type = (data[nameEnd] << 8) | data[nameEnd + 1];
    const recordClass = (data[nameEnd + 2] << 8) | data[nameEnd + 3];
    const ttl = (data[nameEnd + 4] << 24) | (data[nameEnd + 5] << 16) |
                (data[nameEnd + 6] << 8) | data[nameEnd + 7];
    const rdlength = (data[nameEnd + 8] << 8) | data[nameEnd + 9];
    const rdata = data.slice(nameEnd + 10, nameEnd + 10 + rdlength);

    let address = '';

    if (type === DNS_TYPE.A && rdata.length === 4) {
      address = `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
    } else if (type === DNS_TYPE.AAAA && rdata.length === 16) {
      const parts: string[] = [];
      for (let j = 0; j < 16; j += 2) {
        parts.push(((rdata[j] << 8) | rdata[j + 1]).toString(16));
      }
      address = parts.join(':');
    }

    if (address) {
      answers.push({ name, type, class: recordClass, ttl, address });
    }

    offset = nameEnd + 10 + rdlength;
  }

  return { answers };
}

/**
 * Handle LLMNR query
 */
export async function handleLLMNRQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as LLMNRRequest;
    const { host, port = 5355, name, type = DNS_TYPE.A, timeout = 10000 } = body;

    if (!host || !name) {
      return new Response(JSON.stringify({ success: false, error: 'Host and name required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const queryPacket = buildLLMNRQuery(name, type);
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(queryPacket);
      const { value: responseData } = await Promise.race([reader.read(), timeoutPromise]);

      if (!responseData) throw new Error('No response');

      const result = parseLLMNRResponse(responseData);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
