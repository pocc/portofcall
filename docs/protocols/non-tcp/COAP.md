# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**Protocol:** CoAP (Constrained Application Protocol)
**Port:** 5683 (UDP), 5684 (DTLS), 5683 (TCP - RFC 8323)
**RFC:** [RFC 7252](https://tools.ietf.org/html/rfc7252) (CoAP), [RFC 8323](https://tools.ietf.org/html/rfc8323) (CoAP over TCP)
**Complexity:** Medium
**Purpose:** IoT and M2M communication

CoAP provides **RESTful IoT protocol** - HTTP-like request/response for constrained devices and networks, with UDP (or TCP) transport, low overhead, and resource discovery.

### Use Cases
- IoT sensor data collection
- Smart home device control
- Industrial IoT (IIoT)
- M2M (Machine-to-Machine) communication
- Low-power wide-area networks (LPWAN)
- Embedded systems communication

## Protocol Specification

### CoAP over UDP (Primary)

```
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|Ver| T |  TKL  |      Code     |          Message ID           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Token (if any, TKL bytes) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Options (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|1 1 1 1 1 1 1 1|    Payload (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### CoAP over TCP (RFC 8323)

```
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Len  |  TKL  | Extended Length (if any, as chosen by Len) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Code     |   Token (if any, TKL bytes) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Options (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|1 1 1 1 1 1 1 1|    Payload (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Message Types (UDP only)

```
0 - Confirmable (CON)
1 - Non-confirmable (NON)
2 - Acknowledgement (ACK)
3 - Reset (RST)
```

### Method Codes

```
0.01 - GET
0.02 - POST
0.03 - PUT
0.04 - DELETE
```

### Response Codes

```
2.01 - Created
2.02 - Deleted
2.03 - Valid
2.04 - Changed
2.05 - Content
4.00 - Bad Request
4.04 - Not Found
5.00 - Internal Server Error
```

### Common Options

```
3  - Uri-Host
7  - Uri-Port
11 - Uri-Path
12 - Content-Format
14 - Max-Age
15 - Uri-Query
17 - Accept
20 - Location-Path
35 - Proxy-Uri
39 - Proxy-Scheme
60 - Size1
```

## Worker Implementation

```typescript
// src/worker/protocols/coap/client.ts

import { connect } from 'cloudflare:sockets';

export interface CoAPConfig {
  host: string;
  port?: number;
  useTCP?: boolean; // Use TCP instead of UDP
}

// Message Types (UDP only)
export enum MessageType {
  Confirmable = 0,
  NonConfirmable = 1,
  Acknowledgement = 2,
  Reset = 3,
}

// Method Codes
export enum MethodCode {
  Empty = 0x00,
  GET = 0x01,
  POST = 0x02,
  PUT = 0x03,
  DELETE = 0x04,
}

// Response Codes
export enum ResponseCode {
  Created = 0x41,      // 2.01
  Deleted = 0x42,      // 2.02
  Valid = 0x43,        // 2.03
  Changed = 0x44,      // 2.04
  Content = 0x45,      // 2.05
  BadRequest = 0x80,   // 4.00
  NotFound = 0x84,     // 4.04
  InternalError = 0xA0,// 5.00
}

// Option Numbers
export enum OptionNumber {
  IfMatch = 1,
  UriHost = 3,
  ETag = 4,
  IfNoneMatch = 5,
  UriPort = 7,
  LocationPath = 8,
  UriPath = 11,
  ContentFormat = 12,
  MaxAge = 14,
  UriQuery = 15,
  Accept = 17,
  LocationQuery = 20,
  ProxyUri = 35,
  ProxyScheme = 39,
  Size1 = 60,
}

// Content Formats
export enum ContentFormat {
  TextPlain = 0,
  ApplicationLinkFormat = 40,
  ApplicationXML = 41,
  ApplicationOctetStream = 42,
  ApplicationEXI = 47,
  ApplicationJSON = 50,
  ApplicationCBOR = 60,
}

export interface CoAPOption {
  number: number;
  value: Uint8Array;
}

export interface CoAPMessage {
  type?: MessageType;      // Only for UDP
  code: number;
  messageId?: number;      // Only for UDP
  token: Uint8Array;
  options: CoAPOption[];
  payload?: Uint8Array;
}

export class CoAPClient {
  private socket: any;
  private messageId: number = 0;
  private useTCP: boolean;

  constructor(private config: CoAPConfig) {
    this.useTCP = config.useTCP || false;
    if (!config.port) {
      config.port = this.useTCP ? 5683 : 5683;
    }
  }

  async connect(): Promise<void> {
    if (!this.useTCP) {
      throw new Error('CoAP over UDP requires proxy - use useTCP: true');
    }

    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async get(path: string, options?: { accept?: ContentFormat }): Promise<{
    code: number;
    payload?: Uint8Array;
    contentFormat?: ContentFormat;
  }> {
    const message: CoAPMessage = {
      type: MessageType.Confirmable,
      code: MethodCode.GET,
      messageId: this.nextMessageId(),
      token: this.generateToken(),
      options: this.buildPathOptions(path),
      payload: undefined,
    };

    if (options?.accept !== undefined) {
      message.options.push({
        number: OptionNumber.Accept,
        value: this.encodeInt(options.accept),
      });
    }

    const response = await this.sendRequest(message);

    const contentFormat = this.getOption(response, OptionNumber.ContentFormat);

    return {
      code: response.code,
      payload: response.payload,
      contentFormat: contentFormat ? this.decodeInt(contentFormat.value) : undefined,
    };
  }

  async post(path: string, payload: Uint8Array, contentFormat: ContentFormat = ContentFormat.ApplicationOctetStream): Promise<{
    code: number;
    payload?: Uint8Array;
  }> {
    const message: CoAPMessage = {
      type: MessageType.Confirmable,
      code: MethodCode.POST,
      messageId: this.nextMessageId(),
      token: this.generateToken(),
      options: [
        ...this.buildPathOptions(path),
        {
          number: OptionNumber.ContentFormat,
          value: this.encodeInt(contentFormat),
        },
      ],
      payload,
    };

    const response = await this.sendRequest(message);

    return {
      code: response.code,
      payload: response.payload,
    };
  }

  async put(path: string, payload: Uint8Array, contentFormat: ContentFormat = ContentFormat.ApplicationOctetStream): Promise<{
    code: number;
  }> {
    const message: CoAPMessage = {
      type: MessageType.Confirmable,
      code: MethodCode.PUT,
      messageId: this.nextMessageId(),
      token: this.generateToken(),
      options: [
        ...this.buildPathOptions(path),
        {
          number: OptionNumber.ContentFormat,
          value: this.encodeInt(contentFormat),
        },
      ],
      payload,
    };

    const response = await this.sendRequest(message);

    return { code: response.code };
  }

  async delete(path: string): Promise<{ code: number }> {
    const message: CoAPMessage = {
      type: MessageType.Confirmable,
      code: MethodCode.DELETE,
      messageId: this.nextMessageId(),
      token: this.generateToken(),
      options: this.buildPathOptions(path),
    };

    const response = await this.sendRequest(message);

    return { code: response.code };
  }

  async discover(): Promise<string[]> {
    // GET /.well-known/core
    const result = await this.get('/.well-known/core', {
      accept: ContentFormat.ApplicationLinkFormat,
    });

    if (result.payload) {
      const linkFormat = new TextDecoder().decode(result.payload);
      return this.parseLinkFormat(linkFormat);
    }

    return [];
  }

  private async sendRequest(message: CoAPMessage): Promise<CoAPMessage> {
    const encoded = this.useTCP
      ? this.encodeTCP(message)
      : this.encodeUDP(message);

    await this.send(encoded);

    const response = await this.receive();

    return this.useTCP
      ? this.decodeTCP(response)
      : this.decodeUDP(response);
  }

  private encodeUDP(message: CoAPMessage): Uint8Array {
    const optionsEncoded = this.encodeOptions(message.options);
    const totalLength = 4 + message.token.length + optionsEncoded.length +
      (message.payload ? 1 + message.payload.length : 0);

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    let offset = 0;

    // Version (2 bits) + Type (2 bits) + Token Length (4 bits)
    const byte0 = (1 << 6) | ((message.type || 0) << 4) | message.token.length;
    view.setUint8(offset++, byte0);

    // Code
    view.setUint8(offset++, message.code);

    // Message ID
    view.setUint16(offset, message.messageId || 0, false);
    offset += 2;

    // Token
    new Uint8Array(buffer).set(message.token, offset);
    offset += message.token.length;

    // Options
    new Uint8Array(buffer).set(optionsEncoded, offset);
    offset += optionsEncoded.length;

    // Payload marker and payload
    if (message.payload && message.payload.length > 0) {
      view.setUint8(offset++, 0xFF); // Payload marker
      new Uint8Array(buffer).set(message.payload, offset);
    }

    return new Uint8Array(buffer);
  }

  private encodeTCP(message: CoAPMessage): Uint8Array {
    const optionsEncoded = this.encodeOptions(message.options);
    const payloadLength = message.payload ? message.payload.length : 0;
    const messageLength = 1 + message.token.length + optionsEncoded.length +
      (payloadLength > 0 ? 1 + payloadLength : 0);

    // Determine length encoding
    let lenField: number;
    let extendedLen: Uint8Array = new Uint8Array(0);

    if (messageLength < 13) {
      lenField = messageLength;
    } else if (messageLength < 269) {
      lenField = 13;
      extendedLen = new Uint8Array([messageLength - 13]);
    } else if (messageLength < 65805) {
      lenField = 14;
      const val = messageLength - 269;
      extendedLen = new Uint8Array([(val >> 8) & 0xFF, val & 0xFF]);
    } else {
      lenField = 15;
      const val = messageLength - 65805;
      extendedLen = new Uint8Array([
        (val >> 24) & 0xFF,
        (val >> 16) & 0xFF,
        (val >> 8) & 0xFF,
        val & 0xFF,
      ]);
    }

    const totalLength = 1 + extendedLen.length + messageLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    let offset = 0;

    // Len (4 bits) + TKL (4 bits)
    view.setUint8(offset++, (lenField << 4) | message.token.length);

    // Extended length
    new Uint8Array(buffer).set(extendedLen, offset);
    offset += extendedLen.length;

    // Code
    view.setUint8(offset++, message.code);

    // Token
    new Uint8Array(buffer).set(message.token, offset);
    offset += message.token.length;

    // Options
    new Uint8Array(buffer).set(optionsEncoded, offset);
    offset += optionsEncoded.length;

    // Payload
    if (message.payload && message.payload.length > 0) {
      view.setUint8(offset++, 0xFF);
      new Uint8Array(buffer).set(message.payload, offset);
    }

    return new Uint8Array(buffer);
  }

  private decodeUDP(data: Uint8Array): CoAPMessage {
    const view = new DataView(data.buffer);
    let offset = 0;

    const byte0 = view.getUint8(offset++);
    const version = (byte0 >> 6) & 0x03;
    const type = ((byte0 >> 4) & 0x03) as MessageType;
    const tkl = byte0 & 0x0F;

    const code = view.getUint8(offset++);
    const messageId = view.getUint16(offset, false);
    offset += 2;

    const token = data.slice(offset, offset + tkl);
    offset += tkl;

    const { options, offset: newOffset } = this.decodeOptions(data, offset);
    offset = newOffset;

    let payload: Uint8Array | undefined;
    if (offset < data.length && data[offset] === 0xFF) {
      offset++; // Skip payload marker
      payload = data.slice(offset);
    }

    return { type, code, messageId, token, options, payload };
  }

  private decodeTCP(data: Uint8Array): CoAPMessage {
    const view = new DataView(data.buffer);
    let offset = 0;

    const byte0 = view.getUint8(offset++);
    const lenField = (byte0 >> 4) & 0x0F;
    const tkl = byte0 & 0x0F;

    // Read extended length if needed
    if (lenField >= 13) {
      if (lenField === 13) {
        offset += 1;
      } else if (lenField === 14) {
        offset += 2;
      } else {
        offset += 4;
      }
    }

    const code = view.getUint8(offset++);

    const token = data.slice(offset, offset + tkl);
    offset += tkl;

    const { options, offset: newOffset } = this.decodeOptions(data, offset);
    offset = newOffset;

    let payload: Uint8Array | undefined;
    if (offset < data.length && data[offset] === 0xFF) {
      offset++;
      payload = data.slice(offset);
    }

    return { code, token, options, payload };
  }

  private encodeOptions(options: CoAPOption[]): Uint8Array {
    // Sort options by number
    const sorted = [...options].sort((a, b) => a.number - b.number);

    const chunks: Uint8Array[] = [];
    let prevOptionNumber = 0;

    for (const option of sorted) {
      const delta = option.number - prevOptionNumber;
      const length = option.value.length;

      const { deltaValue, deltaExt } = this.encodeOptionDelta(delta);
      const { lengthValue, lengthExt } = this.encodeOptionDelta(length);

      // Option header
      const header = new Uint8Array([((deltaValue & 0x0F) << 4) | (lengthValue & 0x0F)]);
      chunks.push(header);

      // Delta extended
      if (deltaExt.length > 0) chunks.push(deltaExt);

      // Length extended
      if (lengthExt.length > 0) chunks.push(lengthExt);

      // Value
      chunks.push(option.value);

      prevOptionNumber = option.number;
    }

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  private encodeOptionDelta(value: number): { deltaValue: number; deltaExt: Uint8Array } {
    if (value < 13) {
      return { deltaValue: value, deltaExt: new Uint8Array(0) };
    } else if (value < 269) {
      return { deltaValue: 13, deltaExt: new Uint8Array([value - 13]) };
    } else {
      const ext = value - 269;
      return { deltaValue: 14, deltaExt: new Uint8Array([(ext >> 8) & 0xFF, ext & 0xFF]) };
    }
  }

  private decodeOptions(data: Uint8Array, offset: number): { options: CoAPOption[]; offset: number } {
    const options: CoAPOption[] = [];
    let prevOptionNumber = 0;

    while (offset < data.length && data[offset] !== 0xFF) {
      const header = data[offset++];
      let delta = (header >> 4) & 0x0F;
      let length = header & 0x0F;

      // Decode delta
      if (delta === 13) {
        delta = data[offset++] + 13;
      } else if (delta === 14) {
        delta = ((data[offset] << 8) | data[offset + 1]) + 269;
        offset += 2;
      }

      // Decode length
      if (length === 13) {
        length = data[offset++] + 13;
      } else if (length === 14) {
        length = ((data[offset] << 8) | data[offset + 1]) + 269;
        offset += 2;
      }

      const optionNumber = prevOptionNumber + delta;
      const value = data.slice(offset, offset + length);
      offset += length;

      options.push({ number: optionNumber, value });
      prevOptionNumber = optionNumber;
    }

    return { options, offset };
  }

  private buildPathOptions(path: string): CoAPOption[] {
    const options: CoAPOption[] = [];
    const segments = path.split('/').filter(s => s.length > 0);

    for (const segment of segments) {
      options.push({
        number: OptionNumber.UriPath,
        value: new TextEncoder().encode(segment),
      });
    }

    return options;
  }

  private getOption(message: CoAPMessage, number: OptionNumber): CoAPOption | undefined {
    return message.options.find(opt => opt.number === number);
  }

  private encodeInt(value: number): Uint8Array {
    if (value === 0) return new Uint8Array(0);

    const bytes: number[] = [];
    while (value > 0) {
      bytes.unshift(value & 0xFF);
      value >>= 8;
    }

    return new Uint8Array(bytes);
  }

  private decodeInt(value: Uint8Array): number {
    let result = 0;
    for (const byte of value) {
      result = (result << 8) | byte;
    }
    return result;
  }

  private parseLinkFormat(linkFormat: string): string[] {
    // Parse RFC 6690 link format
    // Example: </sensors/temp>;ct=0,</sensors/light>;ct=0

    const resources: string[] = [];
    const links = linkFormat.split(',');

    for (const link of links) {
      const match = link.match(/<([^>]+)>/);
      if (match) {
        resources.push(match[1]);
      }
    }

    return resources;
  }

  private generateToken(): Uint8Array {
    const length = 4;
    const token = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      token[i] = Math.floor(Math.random() * 256);
    }
    return token;
  }

  private nextMessageId(): number {
    this.messageId = (this.messageId + 1) % 65536;
    return this.messageId;
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      throw new Error('No response');
    }

    return value;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/CoAPClient.tsx

export function CoAPClient() {
  const [host, setHost] = useState('');
  const [path, setPath] = useState('/sensors/temperature');
  const [resources, setResources] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);

  const discover = async () => {
    const response = await fetch('/api/coap/discover', {
      method: 'POST',
      body: JSON.stringify({ host }),
    });

    const data = await response.json();
    setResources(data.resources);
  };

  const get = async () => {
    const response = await fetch('/api/coap/get', {
      method: 'POST',
      body: JSON.stringify({ host, path }),
    });

    const data = await response.json();
    setResult(data);
  };

  return (
    <div className="coap-client">
      <h2>CoAP Client (IoT Protocol)</h2>

      <div className="config">
        <input
          placeholder="CoAP Server Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          placeholder="Path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button onClick={discover}>Discover Resources</button>
        <button onClick={get}>GET</button>
      </div>

      {resources.length > 0 && (
        <div className="resources">
          <h3>Available Resources:</h3>
          <ul>
            {resources.map((resource, i) => (
              <li key={i} onClick={() => setPath(resource)}>
                {resource}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="result">
          <h3>Response Code: {result.code}</h3>
          {result.payload && (
            <pre>{new TextDecoder().decode(result.payload)}</pre>
          )}
        </div>
      )}

      <div className="info">
        <h3>About CoAP</h3>
        <ul>
          <li>RFC 7252 - Constrained Application Protocol</li>
          <li>RESTful protocol for IoT</li>
          <li>UDP (primarily) or TCP transport</li>
          <li>Low overhead, suitable for constrained devices</li>
          <li>Resource discovery via /.well-known/core</li>
          <li>Observe pattern for pub/sub</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### DTLS (CoAP over DTLS)

```typescript
// Port 5684 for DTLS-secured CoAP
const client = new CoAPClient({
  host: 'coap-server.example.com',
  port: 5684,
  useDTLS: true,
});
```

## Testing

```bash
# Install libcoap tools
apt-get install libcoap2-bin

# GET request
coap-client -m get coap://coap.me/test

# POST request
coap-client -m post coap://coap.me/test -e "data"

# Discover resources
coap-client -m get coap://coap.me/.well-known/core

# Observe (pub/sub)
coap-client -m get coap://coap.me/obs -s 60
```

## Resources

- **RFC 7252**: [CoAP Protocol](https://tools.ietf.org/html/rfc7252)
- **RFC 8323**: [CoAP over TCP/TLS/WebSockets](https://tools.ietf.org/html/rfc8323)
- **libcoap**: [C implementation](https://libcoap.net/)
- **CoAP.me**: [Public test server](http://coap.me/)

## Notes

- **UDP primary** - requires proxy for Workers (use TCP variant)
- **RESTful** - GET/POST/PUT/DELETE like HTTP
- **Low overhead** - 4-byte header minimum
- **Resource discovery** - /.well-known/core
- **Observe** - Pub/sub pattern with notifications
- **Block transfer** - For large payloads
- **Multicast support** - Group communication
- **Content formats** - JSON, CBOR, XML, etc.
- **Designed for IoT** - low power, lossy networks
- **DTLS security** - Encrypted UDP transport
