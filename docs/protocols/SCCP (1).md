# SCCP (Skinny Client Control Protocol)

## Overview

**SCCP** (Skinny Client Control Protocol), also known as **Skinny**, is Cisco's proprietary VoIP protocol used for communication between Cisco IP phones and Cisco Unified Communications Manager (CUCM). It provides call control, registration, and media setup for Cisco telephony devices.

**Port:** 2000 (TCP), 2443 (TLS)
**Transport:** TCP
**Alternative:** SIP (open standard)

## Protocol Specification

### Message Structure

All SCCP messages follow a simple TLV-style format:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Message Length                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Reserved (0x00000000)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Message ID                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Message Data                            |
|                       (variable length)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Message Length**: Total length in bytes (includes header)
- **Reserved**: Always 0x00000000
- **Message ID**: Identifies the message type
- **Message Data**: Variable-length payload

### Common Message IDs

**Station → CallManager:**
- `0x0000` - Station Keep Alive
- `0x0001` - Station Register
- `0x0002` - Station IP Port
- `0x0003` - Station Key Pad Button
- `0x0004` - Station Enbloc Call
- `0x0005` - Station Stimulus
- `0x0006` - Station Off Hook
- `0x0007` - Station On Hook
- `0x0020` - Station Capabilities Response

**CallManager → Station:**
- `0x0081` - Station Register Ack
- `0x0082` - Station Register Reject
- `0x0088` - Station Set Lamp
- `0x0089` - Station Set Ringer
- `0x008A` - Station Set Speaker Mode
- `0x008F` - Station Call State
- `0x0091` - Station Display Text
- `0x0095` - Station Clear Display
- `0x0097` - Station Capabilities Request
- `0x0105` - Station Start Media Transmission
- `0x0106` - Station Stop Media Transmission
- `0x0110` - Station Open Receive Channel
- `0x0111` - Station Close Receive Channel
- `0x0113` - Station Start Tone

### Station Register Message

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Device Name (16 bytes)                  |
|                       (null-terminated string)                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       User ID (4 bytes)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Instance (4 bytes)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       IP Address (4 bytes)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Device Type (4 bytes)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Max Streams (4 bytes)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Call States

- `1` - Off Hook
- `2` - On Hook
- `3` - Ring Out
- `4` - Ring In
- `5` - Connected
- `6` - Busy
- `7` - Line In Use
- `8` - Hold
- `9` - Call Waiting
- `10` - Call Transfer
- `11` - Call Park
- `12` - Proceed
- `13` - Remote In Use

### Device Types

- `1` - Cisco 30 SP+
- `2` - Cisco 12 SP+
- `3` - Cisco 12 SP
- `4` - Cisco 12 S
- `5` - Cisco 30 VIP
- `6` - Cisco Telecaster
- `7` - Cisco 7910
- `8` - Cisco 7960
- `9` - Cisco 7940
- `12` - Cisco 7935
- `20` - Cisco 7920
- `30008` - Cisco 7941
- `30007` - Cisco 7961

## Worker Implementation

```typescript
// workers/sccp.ts
import { connect } from 'cloudflare:sockets';

interface SCCPConfig {
  server: string;
  port?: number;
  deviceName?: string;
  deviceType?: number;
}

interface SCCPMessage {
  messageId: number;
  data: Uint8Array;
}

interface SCCPResponse {
  success: boolean;
  registered?: boolean;
  error?: string;
  messages?: string[];
}

const MessageId = {
  // Station → CallManager
  KEEP_ALIVE: 0x0000,
  REGISTER: 0x0001,
  IP_PORT: 0x0002,
  KEYPAD_BUTTON: 0x0003,
  OFF_HOOK: 0x0006,
  ON_HOOK: 0x0007,
  CAPABILITIES_RES: 0x0020,

  // CallManager → Station
  REGISTER_ACK: 0x0081,
  REGISTER_REJECT: 0x0082,
  SET_LAMP: 0x0088,
  SET_RINGER: 0x0089,
  SET_SPEAKER_MODE: 0x008A,
  CALL_STATE: 0x008F,
  DISPLAY_TEXT: 0x0091,
  CLEAR_DISPLAY: 0x0095,
  CAPABILITIES_REQ: 0x0097,
  START_MEDIA_TX: 0x0105,
  STOP_MEDIA_TX: 0x0106,
  OPEN_RX_CHANNEL: 0x0110,
  CLOSE_RX_CHANNEL: 0x0111,
  START_TONE: 0x0113,
} as const;

const DeviceType = {
  CISCO_7910: 7,
  CISCO_7960: 8,
  CISCO_7940: 9,
  CISCO_7941: 30008,
  CISCO_7961: 30007,
} as const;

class SCCPClient {
  private config: Required<SCCPConfig>;
  private socket: any = null;
  private registered: boolean = false;
  private messages: string[] = [];

  constructor(config: SCCPConfig) {
    this.config = {
      server: config.server,
      port: config.port || 2000,
      deviceName: config.deviceName || 'SEP001122334455',
      deviceType: config.deviceType || DeviceType.CISCO_7960,
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.server,
      port: this.config.port,
    });
  }

  async register(): Promise<SCCPResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      // Send registration message
      const registerMsg = this.buildRegisterMessage();
      await this.sendMessage(registerMsg);

      // Wait for response
      const response = await this.receiveMessage();

      if (!response) {
        return { success: false, error: 'No response from server' };
      }

      if (response.messageId === MessageId.REGISTER_ACK) {
        this.registered = true;
        this.messages.push('Registration successful');

        // Send capabilities response if requested
        const capReq = await this.receiveMessage();
        if (capReq && capReq.messageId === MessageId.CAPABILITIES_REQ) {
          const capRes = this.buildCapabilitiesResponse();
          await this.sendMessage(capRes);
        }

        return {
          success: true,
          registered: true,
          messages: this.messages,
        };

      } else if (response.messageId === MessageId.REGISTER_REJECT) {
        return {
          success: false,
          registered: false,
          error: 'Registration rejected by server',
        };
      }

      return {
        success: false,
        error: `Unexpected response: 0x${response.messageId.toString(16)}`,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async sendKeepAlive(): Promise<void> {
    const keepAlive = this.encodeMessage(MessageId.KEEP_ALIVE, new Uint8Array(0));
    await this.sendMessage(keepAlive);
  }

  private buildRegisterMessage(): Uint8Array {
    const data = new ArrayBuffer(28);
    const view = new DataView(data);
    const array = new Uint8Array(data);

    // Device Name (16 bytes, null-terminated)
    const deviceName = this.config.deviceName.substring(0, 15);
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode(deviceName);
    array.set(nameBytes, 0);

    // User ID (4 bytes) - typically 0
    view.setUint32(16, 0, true);

    // Instance (4 bytes) - typically 1
    view.setUint32(20, 1, true);

    // Device Type (4 bytes)
    view.setUint32(24, this.config.deviceType, true);

    return this.encodeMessage(MessageId.REGISTER, array);
  }

  private buildCapabilitiesResponse(): Uint8Array {
    // Simplified capabilities - just report G.711 μ-law
    const data = new ArrayBuffer(16);
    const view = new DataView(data);

    // Payload capability count
    view.setUint32(0, 1, true);

    // G.711 μ-law
    view.setUint32(4, 4, true);   // Codec: G.711 μ-law
    view.setUint32(8, 20, true);  // Max frames per packet
    view.setUint32(12, 0, true);  // Reserved

    return this.encodeMessage(MessageId.CAPABILITIES_RES, new Uint8Array(data));
  }

  private encodeMessage(messageId: number, data: Uint8Array): Uint8Array {
    const headerSize = 12;
    const totalLength = headerSize + data.length;

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);

    // Message Length (includes header)
    view.setUint32(0, totalLength, true);

    // Reserved
    view.setUint32(4, 0, true);

    // Message ID
    view.setUint32(8, messageId, true);

    // Data
    array.set(data, headerSize);

    return array;
  }

  private decodeMessage(data: Uint8Array): SCCPMessage {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const messageLength = view.getUint32(0, true);
    const reserved = view.getUint32(4, true);
    const messageId = view.getUint32(8, true);
    const messageData = data.slice(12);

    return { messageId, data: messageData };
  }

  private async sendMessage(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receiveMessage(): Promise<SCCPMessage | null> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      return null;
    }

    return this.decodeMessage(value);
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

    if (url.pathname === '/api/sccp/register') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as SCCPConfig;

        if (!config.server) {
          return new Response(JSON.stringify({ error: 'Server is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new SCCPClient(config);
        const response = await client.register();
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
// src/components/SCCPTester.tsx
import React, { useState } from 'react';

interface SCCPResponse {
  success: boolean;
  registered?: boolean;
  error?: string;
  messages?: string[];
}

export default function SCCPTester() {
  const [server, setServer] = useState('');
  const [port, setPort] = useState('2000');
  const [deviceName, setDeviceName] = useState('SEP001122334455');
  const [deviceType, setDeviceType] = useState('8');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SCCPResponse | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/sccp/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          port: parseInt(port, 10),
          deviceName,
          deviceType: parseInt(deviceType, 10),
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

  const deviceTypes = [
    { value: '7', label: 'Cisco 7910' },
    { value: '8', label: 'Cisco 7960' },
    { value: '9', label: 'Cisco 7940' },
    { value: '30008', label: 'Cisco 7941' },
    { value: '30007', label: 'Cisco 7961' },
  ];

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">SCCP (Skinny) Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>SCCP (Skinny Client Control Protocol)</strong> is Cisco's proprietary VoIP signaling
          protocol used by Cisco IP phones to communicate with Cisco Unified Communications Manager (CUCM).
        </p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            CUCM Server
          </label>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="cucm.example.com"
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
              placeholder="2000"
              min="1"
              max="65535"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Device Type
            </label>
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              {deviceTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Device Name (MAC-based)
          </label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg font-mono"
            placeholder="SEP001122334455"
            pattern="SEP[0-9A-Fa-f]{12}"
            title="Format: SEP followed by 12 hex digits (MAC address)"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Format: SEP + MAC address (e.g., SEP001122334455)
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Registering...' : 'Register Device'}
        </button>
      </form>

      {/* Response display */}
      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Success' : '✗ Error'}
          </h2>

          {response.success && response.registered ? (
            <div className="space-y-2">
              <p className="text-green-800">Device registered successfully with CUCM server.</p>
              {response.messages && response.messages.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-semibold">Messages:</p>
                  <ul className="list-disc ml-5 text-sm">
                    {response.messages.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-800">
              <p className="font-mono text-sm">{response.error}</p>
            </div>
          )}
        </div>
      )}

      {/* Information boxes */}
      <div className="mt-8 space-y-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">SCCP vs SIP</h3>
          <div className="text-sm space-y-2 text-gray-700">
            <div>
              <strong>SCCP (Skinny):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Cisco proprietary protocol</li>
                <li>Simpler, more centralized control</li>
                <li>Lower overhead on phones</li>
                <li>Better integration with Cisco features</li>
                <li>Less flexible than SIP</li>
              </ul>
            </div>
            <div>
              <strong>SIP:</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Open standard (RFC 3261)</li>
                <li>More distributed architecture</li>
                <li>Vendor-neutral, interoperable</li>
                <li>More feature-rich</li>
                <li>Industry standard for VoIP</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">SCCP Features</h3>
          <ul className="text-sm space-y-1 text-gray-700 list-disc ml-5">
            <li>Device registration and keep-alive</li>
            <li>Call setup and teardown</li>
            <li>Media (RTP) stream control</li>
            <li>Keypad and button events</li>
            <li>Display and lamp control</li>
            <li>Tone generation</li>
            <li>Hold, transfer, conference</li>
            <li>Call park and pickup</li>
          </ul>
        </div>

        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold mb-2 text-yellow-900">Note</h3>
          <p className="text-sm text-yellow-800">
            SCCP is being phased out in favor of SIP even in Cisco environments. New deployments should
            consider SIP for better interoperability and future-proofing.
          </p>
        </div>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **No Encryption (SCCP)**: Basic SCCP has no encryption
2. **Secure SCCP**: Use encrypted SCCP on port 2443 (TLS)
3. **Authentication**: Device authentication via CUCM
4. **Network Segmentation**: Isolate voice VLANs from data
5. **Call Signaling Security (CSS)**: Enable on CUCM for encrypted signaling
6. **SRTP**: Use Secure RTP for media encryption
7. **Certificate Management**: PKI for device certificates
8. **Access Control**: Limit SCCP traffic at network boundaries
9. **Firmware Security**: Keep phone firmware updated
10. **VLAN Hopping**: Prevent attacks via 802.1Q tagging

## Testing

```bash
# Monitor SCCP traffic with tcpdump
sudo tcpdump -i any port 2000 -A

# Wireshark filter for SCCP
skinny

# Test registration
curl -X POST http://localhost:8787/api/sccp/register \
  -H "Content-Type: application/json" \
  -d '{
    "server": "cucm.example.com",
    "port": 2000,
    "deviceName": "SEP001122334455",
    "deviceType": 8
  }'

# Expected response:
{
  "success": true,
  "registered": true,
  "messages": ["Registration successful"]
}

# Use Cisco IP Phone Emulator (CIPE) for testing
# Available from Cisco DevNet
```

## Resources

- [Cisco SCCP Documentation](https://developer.cisco.com/site/sccp/)
- [Wireshark SCCP Dissector](https://wiki.wireshark.org/SKINNY)
- [Asterisk chan_skinny](https://wiki.asterisk.org/wiki/display/AST/Skinny) - Open-source SCCP support
- [Cisco IP Phone Developer Guide](https://www.cisco.com/c/en/us/support/collaboration-endpoints/unified-ip-phone-7900-series/products-programming-reference-guides-list.html)
- [RFC 3261](https://www.rfc-editor.org/rfc/rfc3261) - SIP (alternative)

## Notes

- **Proprietary Protocol**: SCCP is Cisco-specific, limiting interoperability
- **Device Names**: Follow format `SEP<MAC>` or `ATA<MAC>` (SEP = Selsius Ethernet Phone)
- **Call Manager**: Cisco Unified Communications Manager (CUCM) required
- **Media**: RTP/RTCP for audio/video, separate from signaling
- **Keepalive**: Regular keepalive messages (every 30 seconds) required
- **Call Control**: All intelligence in CUCM, phones are "skinny" clients
- **Protocol Versions**: Multiple versions exist (SCCP 3.x, 17.x, 19.x, etc.)
- **Migration to SIP**: Cisco now recommends SIP for new deployments
- **Asterisk Support**: Open-source PBX Asterisk supports SCCP via chan_skinny
- **Phone Models**: 7900 series, 8800 series, 9900 series support SCCP
- **Debug**: Enable "debug skinny" on CUCM for troubleshooting
