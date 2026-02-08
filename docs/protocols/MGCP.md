# MGCP (Media Gateway Control Protocol)

## Overview

**MGCP** (Media Gateway Control Protocol) is a VoIP signaling protocol that implements a centralized call control architecture. Unlike SIP or H.323 where endpoints are intelligent, MGCP uses "dumb" gateways controlled by a centralized Call Agent (softswitch), making it popular for carrier-grade VoIP deployments.

**Port:** 2427 (UDP, gateway), 2727 (UDP, call agent)
**Transport:** UDP (primarily), TCP (optional)
**RFC:** 3435 (MGCP 1.0)

## Protocol Specification

### Architecture

```
+---------------+              +------------------+
|  Call Agent   |  <--MGCP-->  | Media Gateway    |
|  (Softswitch) |              | (Dumb endpoint)  |
+---------------+              +------------------+
        |                               |
        |                               |
    (Controls)                      (Executes)
```

**Components:**
- **Call Agent (CA)**: Intelligent call controller
- **Media Gateway (MG)**: Executes commands from CA
- **Endpoints**: Physical or virtual terminations (lines, trunks)

### Message Structure

MGCP is a text-based protocol with two message types:

**Commands** (Call Agent → Gateway):
```
VERB transaction-id endpoint@gateway MGCP version
Parameter: value
Parameter: value

SDP (optional)
```

**Responses** (Gateway → Call Agent):
```
response-code transaction-id comment
Parameter: value

SDP (optional)
```

### MGCP Commands (Verbs)

- **EPCF** - EndPoint ConFiguration
- **CRCX** - CReate ConneXion
- **MDCX** - MoDify ConneXion
- **DLCX** - DeLete ConneXion
- **RQNT** - ReQuest NoTification
- **NTFY** - NoTiFY (gateway → call agent)
- **AUEP** - AUdit EndPoint
- **AUCX** - AUdit ConneXion
- **RSIP** - ReStart In Progress

### Response Codes

**Success (2xx):**
- `200` - Success (command completed)
- `250` - Connection deleted

**Provisional (1xx):**
- `100` - Transaction being executed

**Failure (4xx, 5xx):**
- `400` - Bad request
- `401` - Protocol error
- `403` - Forbidden
- `404` - Endpoint not found
- `500` - Endpoint not ready
- `501` - Not implemented
- `502` - Gateway overloaded
- `510` - No endpoint available

### Example CRCX Command

```
CRCX 1234 aaln/1@rgw.example.com MGCP 1.0
C: A3C47F21456789F0
L: p:10, a:PCMU
M: recvonly

v=0
o=- 25678 753849 IN IP4 128.96.41.1
s=-
c=IN IP4 128.96.41.1
t=0 0
m=audio 3456 RTP/AVP 0
```

**Parameters:**
- **C:** Call ID
- **L:** Local connection options (packetization, codec)
- **M:** Connection mode (sendrecv, sendonly, recvonly, inactive)
- **SDP:** Session description for media

### Connection Modes

- **sendrecv**: Bidirectional audio
- **sendonly**: Send audio only
- **recvonly**: Receive audio only
- **confrnce**: Conference mode
- **inactive**: No media
- **loopback**: Echo test
- **netwloop**: Network loopback
- **netwtest**: Network test

### Event Packages

MGCP uses event packages for notifications:

- **L**: Line package (off-hook, on-hook)
- **D**: DTMF package (digit collection)
- **T**: Trunk package (T1/E1 events)
- **G**: Generic media package
- **R**: RTP package

**Example RQNT (Request Notification):**
```
RQNT 5678 aaln/1@rgw.example.com MGCP 1.0
X: 0123456789AB
R: L/hd, L/hu, D/[0-9#*]
S: L/dl
```

- **X:** Request identifier
- **R:** Requested Events (hook down, hook up, digits)
- **S:** Signals to apply (dial tone)

## Worker Implementation

```typescript
// workers/mgcp.ts
import { connect } from 'cloudflare:sockets';

interface MGCPConfig {
  gateway: string;
  port?: number;
  endpoint?: string;
}

interface MGCPResponse {
  success: boolean;
  responseCode?: number;
  transactionId?: string;
  comment?: string;
  connectionId?: string;
  error?: string;
}

const MGCPCommand = {
  EPCF: 'EPCF',
  CRCX: 'CRCX',
  MDCX: 'MDCX',
  DLCX: 'DLCX',
  RQNT: 'RQNT',
  NTFY: 'NTFY',
  AUEP: 'AUEP',
  AUCX: 'AUCX',
  RSIP: 'RSIP',
} as const;

class MGCPClient {
  private config: Required<MGCPConfig>;
  private socket: any = null;
  private transactionId: number = 1000;

  constructor(config: MGCPConfig) {
    this.config = {
      gateway: config.gateway,
      port: config.port || 2427,
      endpoint: config.endpoint || 'aaln/1',
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.gateway,
      port: this.config.port,
    });
  }

  async createConnection(): Promise<MGCPResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const txId = this.getNextTransactionId();
      const callId = this.generateCallId();

      // Build CRCX command
      const command = [
        `CRCX ${txId} ${this.config.endpoint}@${this.config.gateway} MGCP 1.0`,
        `C: ${callId}`,
        `L: p:20, a:PCMU`,
        `M: sendrecv`,
        '',
        'v=0',
        'o=- 25678 753849 IN IP4 0.0.0.0',
        's=-',
        'c=IN IP4 0.0.0.0',
        't=0 0',
        'm=audio 0 RTP/AVP 0',
        '',
      ].join('\r\n');

      await this.sendCommand(command);

      const response = await this.receiveResponse();

      if (!response) {
        return { success: false, error: 'No response from gateway' };
      }

      const parsed = this.parseResponse(response);

      if (parsed.responseCode >= 200 && parsed.responseCode < 300) {
        // Extract connection ID from response
        const connectionIdMatch = response.match(/I:\s*([A-F0-9]+)/i);
        const connectionId = connectionIdMatch ? connectionIdMatch[1] : undefined;

        return {
          success: true,
          responseCode: parsed.responseCode,
          transactionId: parsed.transactionId,
          comment: parsed.comment,
          connectionId,
        };
      } else {
        return {
          success: false,
          responseCode: parsed.responseCode,
          error: parsed.comment,
        };
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async deleteConnection(connectionId: string): Promise<MGCPResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const txId = this.getNextTransactionId();
      const callId = this.generateCallId();

      const command = [
        `DLCX ${txId} ${this.config.endpoint}@${this.config.gateway} MGCP 1.0`,
        `C: ${callId}`,
        `I: ${connectionId}`,
        '',
      ].join('\r\n');

      await this.sendCommand(command);

      const response = await this.receiveResponse();

      if (!response) {
        return { success: false, error: 'No response from gateway' };
      }

      const parsed = this.parseResponse(response);

      return {
        success: parsed.responseCode >= 200 && parsed.responseCode < 300,
        responseCode: parsed.responseCode,
        transactionId: parsed.transactionId,
        comment: parsed.comment,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async auditEndpoint(): Promise<MGCPResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const txId = this.getNextTransactionId();

      const command = [
        `AUEP ${txId} ${this.config.endpoint}@${this.config.gateway} MGCP 1.0`,
        '',
      ].join('\r\n');

      await this.sendCommand(command);

      const response = await this.receiveResponse();

      if (!response) {
        return { success: false, error: 'No response from gateway' };
      }

      const parsed = this.parseResponse(response);

      return {
        success: parsed.responseCode >= 200 && parsed.responseCode < 300,
        responseCode: parsed.responseCode,
        transactionId: parsed.transactionId,
        comment: parsed.comment,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private parseResponse(response: string): { responseCode: number; transactionId: string; comment: string } {
    const lines = response.split('\r\n');
    const firstLine = lines[0];

    // Response format: "code transaction-id comment"
    const match = firstLine.match(/^(\d{3})\s+(\S+)(?:\s+(.+))?$/);

    if (!match) {
      return {
        responseCode: 500,
        transactionId: '',
        comment: 'Failed to parse response',
      };
    }

    return {
      responseCode: parseInt(match[1], 10),
      transactionId: match[2],
      comment: match[3] || '',
    };
  }

  private getNextTransactionId(): string {
    return (this.transactionId++).toString();
  }

  private generateCallId(): string {
    // Generate random 32-character hex string
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  private async sendCommand(command: string): Promise<void> {
    const encoder = new TextEncoder();
    const data = encoder.encode(command);

    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receiveResponse(): Promise<string | null> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      return null;
    }

    const decoder = new TextDecoder();
    return decoder.decode(value);
  }

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
      this.socket = null;
    }
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/mgcp/create-connection') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as MGCPConfig;

        if (!config.gateway) {
          return new Response(JSON.stringify({ error: 'Gateway is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new MGCPClient(config);
        const response = await client.createConnection();
        await client.close();

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/api/mgcp/audit-endpoint') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as MGCPConfig;

        if (!config.gateway) {
          return new Response(JSON.stringify({ error: 'Gateway is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new MGCPClient(config);
        const response = await client.auditEndpoint();
        await client.close();

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
```

## Web UI Design

```typescript
// src/components/MGCPTester.tsx
import React, { useState } from 'react';

interface MGCPResponse {
  success: boolean;
  responseCode?: number;
  transactionId?: string;
  comment?: string;
  connectionId?: string;
  error?: string;
}

export default function MGCPTester() {
  const [gateway, setGateway] = useState('');
  const [port, setPort] = useState('2427');
  const [endpoint, setEndpoint] = useState('aaln/1');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<MGCPResponse | null>(null);

  const handleCreateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/mgcp/create-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway,
          port: parseInt(port, 10),
          endpoint,
        }),
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAuditEndpoint = async () => {
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/mgcp/audit-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway,
          port: parseInt(port, 10),
          endpoint,
        }),
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">MGCP Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>MGCP (Media Gateway Control Protocol)</strong> implements centralized call control
          where a Call Agent (softswitch) controls "dumb" Media Gateways, common in carrier VoIP networks.
        </p>
      </div>

      <form onSubmit={handleCreateConnection} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Media Gateway
          </label>
          <input
            type="text"
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="mgw.example.com"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="2427"
              min="1"
              max="65535"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Endpoint
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="aaln/1"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Examples: aaln/1 (analog), ds/ds1-1/1 (trunk)
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'Creating...' : 'Create Connection (CRCX)'}
          </button>

          <button
            type="button"
            onClick={handleAuditEndpoint}
            disabled={loading || !gateway}
            className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
          >
            Audit Endpoint (AUEP)
          </button>
        </div>
      </form>

      {/* Response display */}
      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Success' : '✗ Error'}
          </h2>

          {response.success ? (
            <div className="space-y-2 font-mono text-sm">
              {response.responseCode && (
                <div><strong>Response Code:</strong> {response.responseCode}</div>
              )}
              {response.transactionId && (
                <div><strong>Transaction ID:</strong> {response.transactionId}</div>
              )}
              {response.connectionId && (
                <div><strong>Connection ID:</strong> {response.connectionId}</div>
              )}
              {response.comment && (
                <div><strong>Comment:</strong> {response.comment}</div>
              )}
            </div>
          ) : (
            <div className="text-red-800">
              <p className="font-mono text-sm">{response.error}</p>
              {response.responseCode && (
                <p className="text-sm mt-2">Response Code: {response.responseCode}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Information boxes */}
      <div className="mt-8 space-y-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">MGCP Commands</h3>
          <ul className="text-sm space-y-1 text-gray-700">
            <li><strong>CRCX:</strong> Create Connection (setup media)</li>
            <li><strong>MDCX:</strong> Modify Connection (change codec, mode)</li>
            <li><strong>DLCX:</strong> Delete Connection (teardown)</li>
            <li><strong>RQNT:</strong> Request Notification (ask for events)</li>
            <li><strong>NTFY:</strong> Notify (report events to CA)</li>
            <li><strong>AUEP:</strong> Audit Endpoint (query state)</li>
            <li><strong>AUCX:</strong> Audit Connection (query connection)</li>
            <li><strong>RSIP:</strong> Restart In Progress (gateway restart)</li>
          </li>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">Endpoint Naming</h3>
          <ul className="text-sm space-y-1 text-gray-700 font-mono">
            <li><strong>aaln/1</strong> - Analog Access Line, port 1</li>
            <li><strong>ds/ds1-1/1</strong> - Digital trunk (T1/E1)</li>
            <li><strong>an/*</strong> - Announcement server</li>
            <li><strong>conf/*</strong> - Conference bridge</li>
          </ul>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">MGCP Use Cases</h3>
          <ul className="text-sm space-y-1 text-gray-700 list-disc ml-5">
            <li>Residential VoIP gateways (cable modems, FTTx)</li>
            <li>Carrier-grade softswitches</li>
            <li>PSTN-to-VoIP gateway control</li>
            <li>IMS (IP Multimedia Subsystem)</li>
            <li>PacketCable networks</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **No Built-in Security**: MGCP has no native encryption or authentication
2. **IPsec**: Typically secured using IPsec at network layer
3. **Access Control**: Restrict MGCP ports at firewall
4. **Endpoint Authentication**: Gateway authenticates to Call Agent
5. **SRTP**: Use Secure RTP for media encryption
6. **Network Isolation**: Keep MGCP on management VLAN
7. **DoS Protection**: Rate-limit command requests
8. **Audit Logs**: Monitor MGCP transactions

## Testing

```bash
# Monitor MGCP traffic
sudo tcpdump -i any port 2427 -A

# Wireshark filter
mgcp

# Test CRCX command
curl -X POST http://localhost:8787/api/mgcp/create-connection \
  -H "Content-Type: application/json" \
  -d '{
    "gateway": "mgw.example.com",
    "port": 2427,
    "endpoint": "aaln/1"
  }'

# Expected response:
{
  "success": true,
  "responseCode": 200,
  "transactionId": "1000",
  "connectionId": "A3C47F21456789F0"
}

# Use mgcptest tool (if available)
# Commercial gateways: Cisco, AudioCodes, Sonus
```

## Resources

- **RFC 3435**: Media Gateway Control Protocol (MGCP) Version 1.0
- **RFC 2705**: MGCP Version 0.1 (historical)
- **PacketCable**: CableLabs specifications for MGCP
- [IANA MGCP Parameters](https://www.iana.org/assignments/mgcp-packages/)
- [Asterisk MGCP](https://wiki.asterisk.org/wiki/display/AST/Asterisk+Manager+TCP+IP+API) - chan_mgcp
- [RFC 3525](https://www.rfc-editor.org/rfc/rfc3525) - Gateway Control Protocol (MEGACO/H.248)

## Notes

- **Centralized Control**: All intelligence in Call Agent, gateways are simple
- **Text-Based**: Human-readable protocol (unlike binary protocols)
- **UDP Primary**: Uses UDP for low latency, TCP optional
- **Transaction-based**: Each command/response has unique transaction ID
- **Event Packages**: Extensible event notification system
- **SDP Integration**: Uses SDP for media description
- **PacketCable**: MGCP is core protocol in cable VoIP (PacketCable)
- **Alternative: Megaco/H.248**: IETF/ITU-T equivalent to MGCP
- **Residential Gateways**: Common in cable modem voice services
- **Carrier Grade**: Used by telcos for large-scale VoIP deployments
- **versus SIP**: MGCP for carrier control, SIP for peer-to-peer/enterprise
