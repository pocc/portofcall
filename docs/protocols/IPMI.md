# IPMI (Intelligent Platform Management Interface)

## Overview

**IPMI** (Intelligent Platform Management Interface) is a standardized protocol for out-of-band server management. It allows administrators to monitor hardware health, control power states, access console, and manage servers remotely even when the operating system is not running.

**Port:** 623 (UDP), 664 (secure RMCP+)
**Transport:** UDP (RMCP - Remote Management Control Protocol)
**Specification:** IPMI v2.0 (most common)

## Protocol Specification

### RMCP Header

All IPMI messages are encapsulated in RMCP (Remote Management Control Protocol):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Version (06) |   Reserved    |  Sequence #   |   Class (07)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      IPMI Session Header                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Version**: 0x06 (RMCP v1.0)
- **Class**: 0x07 (IPMI), 0x06 (ASF)
- **Sequence**: 0xFF (no ACK), or sequence number

### IPMI v2.0 Session Header (RMCP+)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Auth Type     |            Payload Type                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Session ID                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Sequence Number                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Payload Length       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### IPMI Message Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Target Addr  | NetFn | LUN   |   Checksum    | Source Addr   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Seq# | LUN   |   Command     |   Data ...                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          Data (variable)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Checksum    |
+-+-+-+-+-+-+-+-+
```

### Common Network Functions (NetFn)

- `0x00` - Chassis
- `0x02` - Sensor/Event
- `0x04` - App (Get Device ID, Get Self Test Results)
- `0x06` - Storage
- `0x08` - Firmware
- `0x0A` - Transport
- `0x0C` - Bridge
- `0x2C` - Group Extension
- `0x30` - OEM

### Common Commands

**Chassis:**
- `0x00` - Get Chassis Capabilities
- `0x01` - Get Chassis Status
- `0x02` - Chassis Control (power on/off/cycle/reset)
- `0x05` - Set Power Restore Policy
- `0x08` - Set System Boot Options

**App:**
- `0x01` - Get Device ID
- `0x04` - Get Self Test Results
- `0x38` - Get Channel Authentication Capabilities
- `0x3A` - Get Session Challenge
- `0x3B` - Activate Session
- `0x3C` - Set Session Privilege Level

**Sensor:**
- `0x10` - Platform Event
- `0x2D` - Get Sensor Reading
- `0x2F` - Get Sensor Type

## Worker Implementation

```typescript
// workers/ipmi.ts
import { connect } from 'cloudflare:sockets';

interface IPMIConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

interface IPMIResponse {
  success: boolean;
  data?: any;
  error?: string;
  deviceId?: DeviceID;
  chassisStatus?: ChassisStatus;
}

interface DeviceID {
  deviceId: number;
  deviceRevision: number;
  firmwareMajor: number;
  firmwareMinor: number;
  ipmiVersion: number;
  manufacturerId: number;
  productId: number;
}

interface ChassisStatus {
  powerOn: boolean;
  overload: boolean;
  interlock: boolean;
  fault: boolean;
  powerControl: boolean;
  lastPowerEvent: string;
  chassisIntrusion: boolean;
}

const RMCP_VERSION = 0x06;
const RMCP_CLASS_IPMI = 0x07;
const RMCP_CLASS_ASF = 0x06;

const NetFn = {
  CHASSIS: 0x00,
  SENSOR: 0x04,
  APP: 0x06,
  STORAGE: 0x0A,
  TRANSPORT: 0x0C,
} as const;

const ChassisCmd = {
  GET_CAPABILITIES: 0x00,
  GET_STATUS: 0x01,
  CONTROL: 0x02,
} as const;

const AppCmd = {
  GET_DEVICE_ID: 0x01,
  GET_SELF_TEST: 0x04,
  GET_CHANNEL_AUTH_CAP: 0x38,
} as const;

const ChassisControl = {
  POWER_DOWN: 0x00,
  POWER_UP: 0x01,
  POWER_CYCLE: 0x02,
  HARD_RESET: 0x03,
  DIAGNOSTIC_INTERRUPT: 0x04,
  SOFT_SHUTDOWN: 0x05,
} as const;

class IPMIClient {
  private config: Required<IPMIConfig>;
  private socket: any = null;
  private sessionId: number = 0;
  private sequence: number = 0;

  constructor(config: IPMIConfig) {
    this.config = {
      host: config.host,
      port: config.port || 623,
      username: config.username || 'admin',
      password: config.password || '',
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.host,
      port: this.config.port,
    });
  }

  async getDeviceId(): Promise<IPMIResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const request = this.buildIPMIRequest(NetFn.APP, AppCmd.GET_DEVICE_ID, new Uint8Array(0));

      await this.sendMessage(request);
      const response = await this.receiveMessage();

      if (!response) {
        return { success: false, error: 'No response from BMC' };
      }

      const ipmiMsg = this.parseIPMIResponse(response);

      if (ipmiMsg.completionCode !== 0x00) {
        return {
          success: false,
          error: `Command failed with code: 0x${ipmiMsg.completionCode.toString(16)}`,
        };
      }

      const data = ipmiMsg.data;
      const deviceId: DeviceID = {
        deviceId: data[0],
        deviceRevision: data[1] & 0x0F,
        firmwareMajor: data[2] & 0x7F,
        firmwareMinor: data[3],
        ipmiVersion: data[4],
        manufacturerId: data[7] | (data[8] << 8) | (data[9] << 16),
        productId: data[10] | (data[11] << 8),
      };

      return { success: true, deviceId };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getChassisStatus(): Promise<IPMIResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const request = this.buildIPMIRequest(NetFn.CHASSIS, ChassisCmd.GET_STATUS, new Uint8Array(0));

      await this.sendMessage(request);
      const response = await this.receiveMessage();

      if (!response) {
        return { success: false, error: 'No response from BMC' };
      }

      const ipmiMsg = this.parseIPMIResponse(response);

      if (ipmiMsg.completionCode !== 0x00) {
        return {
          success: false,
          error: `Command failed with code: 0x${ipmiMsg.completionCode.toString(16)}`,
        };
      }

      const data = ipmiMsg.data;
      const currentStatus = data[0];
      const lastPowerEvent = data[1];

      const chassisStatus: ChassisStatus = {
        powerOn: (currentStatus & 0x01) !== 0,
        overload: (currentStatus & 0x02) !== 0,
        interlock: (currentStatus & 0x04) !== 0,
        fault: (currentStatus & 0x08) !== 0,
        powerControl: (currentStatus & 0x10) !== 0,
        lastPowerEvent: this.decodePowerEvent(lastPowerEvent),
        chassisIntrusion: (data[2] & 0x01) !== 0,
      };

      return { success: true, chassisStatus };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async chassisControl(action: number): Promise<IPMIResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      const data = new Uint8Array([action]);
      const request = this.buildIPMIRequest(NetFn.CHASSIS, ChassisCmd.CONTROL, data);

      await this.sendMessage(request);
      const response = await this.receiveMessage();

      if (!response) {
        return { success: false, error: 'No response from BMC' };
      }

      const ipmiMsg = this.parseIPMIResponse(response);

      if (ipmiMsg.completionCode !== 0x00) {
        return {
          success: false,
          error: `Command failed with code: 0x${ipmiMsg.completionCode.toString(16)}`,
        };
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildIPMIRequest(netFn: number, command: number, data: Uint8Array): Uint8Array {
    // RMCP Header (4 bytes) + IPMI Session Header (10 bytes) + IPMI Message
    const ipmiMsgLength = 7 + data.length;
    const totalLength = 4 + 10 + ipmiMsgLength;

    const buffer = new Uint8Array(totalLength);
    let offset = 0;

    // RMCP Header
    buffer[offset++] = RMCP_VERSION;        // Version
    buffer[offset++] = 0x00;                 // Reserved
    buffer[offset++] = 0xFF;                 // Sequence (0xFF = no ACK)
    buffer[offset++] = RMCP_CLASS_IPMI;     // Class

    // IPMI Session Header (IPMI v1.5 format - no authentication)
    buffer[offset++] = 0x00;                 // Auth Type (none)
    buffer[offset++] = 0x00;                 // Session Sequence (4 bytes)
    buffer[offset++] = 0x00;
    buffer[offset++] = 0x00;
    buffer[offset++] = 0x00;
    buffer[offset++] = 0x00;                 // Session ID (4 bytes)
    buffer[offset++] = 0x00;
    buffer[offset++] = 0x00;
    buffer[offset++] = 0x00;
    buffer[offset++] = ipmiMsgLength;        // Payload length

    // IPMI Message
    buffer[offset++] = 0x20;                 // Target address (BMC)
    buffer[offset++] = (netFn << 2) | 0x00;  // NetFn/LUN

    // Header checksum
    const headerChecksum = this.calculateChecksum(buffer.slice(14, offset));
    buffer[offset++] = headerChecksum;

    buffer[offset++] = 0x81;                 // Source address (Remote Console)
    buffer[offset++] = (this.sequence << 2) | 0x00; // Sequence/LUN
    buffer[offset++] = command;              // Command

    // Data
    for (let i = 0; i < data.length; i++) {
      buffer[offset++] = data[i];
    }

    // Message checksum
    const msgChecksum = this.calculateChecksum(buffer.slice(17, offset));
    buffer[offset++] = msgChecksum;

    this.sequence = (this.sequence + 1) % 64;

    return buffer;
  }

  private parseIPMIResponse(data: Uint8Array): { completionCode: number; data: Uint8Array } {
    // Skip RMCP header (4 bytes) + Session header (10 bytes)
    const offset = 14;

    // IPMI message starts at offset 14
    // Target addr (1) + NetFn/LUN (1) + Checksum (1) + Source addr (1) + Seq/LUN (1) + Command (1) + Completion Code (1)
    const completionCode = data[offset + 6];
    const responseData = data.slice(offset + 7, data.length - 1); // Exclude final checksum

    return { completionCode, data: responseData };
  }

  private calculateChecksum(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return (0x100 - (sum & 0xFF)) & 0xFF;
  }

  private decodePowerEvent(event: number): string {
    const events = [
      'Unknown',
      'AC failed',
      'Overload',
      'Power interlock',
      'Power fault',
      'Power on via IPMI',
    ];

    const eventType = event & 0x0F;
    return events[eventType] || `Unknown (0x${event.toString(16)})`;
  }

  private async sendMessage(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receiveMessage(): Promise<Uint8Array | null> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      return null;
    }

    return value;
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

    if (url.pathname === '/api/ipmi/device-id') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as IPMIConfig;

        if (!config.host) {
          return new Response(JSON.stringify({ error: 'Host is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new IPMIClient(config);
        const response = await client.getDeviceId();
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

    if (url.pathname === '/api/ipmi/chassis-status') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as IPMIConfig;

        if (!config.host) {
          return new Response(JSON.stringify({ error: 'Host is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new IPMIClient(config);
        const response = await client.getChassisStatus();
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
// src/components/IPMITester.tsx
import React, { useState } from 'react';

interface DeviceID {
  deviceId: number;
  deviceRevision: number;
  firmwareMajor: number;
  firmwareMinor: number;
  ipmiVersion: number;
  manufacturerId: number;
  productId: number;
}

interface ChassisStatus {
  powerOn: boolean;
  overload: boolean;
  interlock: boolean;
  fault: boolean;
  powerControl: boolean;
  lastPowerEvent: string;
  chassisIntrusion: boolean;
}

interface IPMIResponse {
  success: boolean;
  deviceId?: DeviceID;
  chassisStatus?: ChassisStatus;
  error?: string;
}

export default function IPMITester() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('623');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceID | null>(null);
  const [chassisStatus, setChassisStatus] = useState<ChassisStatus | null>(null);
  const [error, setError] = useState<string>('');

  const handleGetDeviceId = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setDeviceInfo(null);

    try {
      const res = await fetch('/api/ipmi/device-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
        }),
      });

      const data: IPMIResponse = await res.json();

      if (data.success && data.deviceId) {
        setDeviceInfo(data.deviceId);
      } else {
        setError(data.error || 'Failed to get device ID');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleGetChassisStatus = async () => {
    setLoading(true);
    setError('');
    setChassisStatus(null);

    try {
      const res = await fetch('/api/ipmi/chassis-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
        }),
      });

      const data: IPMIResponse = await res.json();

      if (data.success && data.chassisStatus) {
        setChassisStatus(data.chassisStatus);
      } else {
        setError(data.error || 'Failed to get chassis status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getManufacturerName = (id: number): string => {
    const manufacturers: Record<number, string> = {
      0x0157: 'Intel',
      0x0B4B: 'Supermicro',
      0x0000: 'Dell',
      0x4CA: 'Hewlett-Packard',
    };
    return manufacturers[id] || `Unknown (0x${id.toString(16)})`;
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">IPMI Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>IPMI (Intelligent Platform Management Interface)</strong> allows out-of-band server
          management for monitoring hardware, controlling power, and accessing remote console independent
          of the OS.
        </p>
      </div>

      <form onSubmit={handleGetDeviceId} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            BMC Host/IP
          </label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="192.168.1.100"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1">
            <label className="block text-sm font-medium mb-2">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="623"
              min="1"
              max="65535"
              required
            />
          </div>

          <div className="col-span-1">
            <label className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="admin"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-sm font-medium mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="password"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'Querying...' : 'Get Device Info'}
          </button>

          <button
            type="button"
            onClick={handleGetChassisStatus}
            disabled={loading || !host}
            className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
          >
            Get Chassis Status
          </button>
        </div>
      </form>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Device Info */}
      {deviceInfo && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Device Information</h2>
          <div className="space-y-2 font-mono text-sm">
            <div><strong>Device ID:</strong> 0x{deviceInfo.deviceId.toString(16)}</div>
            <div><strong>Device Revision:</strong> {deviceInfo.deviceRevision}</div>
            <div><strong>Firmware:</strong> {deviceInfo.firmwareMajor}.{deviceInfo.firmwareMinor}</div>
            <div><strong>IPMI Version:</strong> {(deviceInfo.ipmiVersion >> 4) & 0x0F}.{deviceInfo.ipmiVersion & 0x0F}</div>
            <div><strong>Manufacturer:</strong> {getManufacturerName(deviceInfo.manufacturerId)}</div>
            <div><strong>Product ID:</strong> 0x{deviceInfo.productId.toString(16)}</div>
          </div>
        </div>
      )}

      {/* Chassis Status */}
      {chassisStatus && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Chassis Status</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center">
              <span className={`inline-block w-3 h-3 rounded-full mr-2 ${chassisStatus.powerOn ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <strong>Power:</strong> {chassisStatus.powerOn ? 'ON' : 'OFF'}
            </div>
            <div><strong>Last Power Event:</strong> {chassisStatus.lastPowerEvent}</div>
            <div><strong>Overload:</strong> {chassisStatus.overload ? 'Yes' : 'No'}</div>
            <div><strong>Interlock:</strong> {chassisStatus.interlock ? 'Active' : 'Inactive'}</div>
            <div><strong>Fault:</strong> {chassisStatus.fault ? 'Yes' : 'No'}</div>
            <div><strong>Chassis Intrusion:</strong> {chassisStatus.chassisIntrusion ? 'Detected' : 'None'}</div>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold mb-2">IPMI Features</h3>
        <ul className="text-sm space-y-1 text-gray-700 list-disc ml-5">
          <li>Power control (on/off/cycle/reset)</li>
          <li>Hardware monitoring (temp, voltage, fan speed)</li>
          <li>System Event Log (SEL) access</li>
          <li>Remote console (Serial over LAN)</li>
          <li>Virtual media mounting (CD/DVD/USB)</li>
          <li>Firmware updates</li>
          <li>Out-of-band management (works even when OS is down)</li>
        </ul>
      </div>

      <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2 text-yellow-900">⚠️ Security Warning</h3>
        <p className="text-sm text-yellow-800">
          IPMI has known security vulnerabilities. Always use IPMI v2.0+ with strong passwords,
          isolate BMC on a separate management network, and consider disabling if not needed.
        </p>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **Known Vulnerabilities**: IPMI has many documented security issues (CVEs)
2. **Weak Default Credentials**: Many BMCs ship with default passwords
3. **Network Isolation**: Always place BMCs on isolated management networks
4. **IPMI v2.0+**: Use RMCP+ with encryption, avoid legacy IPMI v1.5
5. **Cipher Suites**: Use strong cipher suites, disable weak ones
6. **Access Control**: Limit IP addresses that can access BMC
7. **Firmware Updates**: Keep BMC firmware updated
8. **Disable If Unused**: Disable IPMI if not required
9. **Monitor Access**: Log and alert on IPMI access attempts
10. **Certificate Validation**: Validate SSL/TLS certificates for web interfaces

## Testing

```bash
# Test with ipmitool (standard IPMI client)
sudo apt install ipmitool

# Get device ID
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus mc info

# Get chassis status
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus chassis status

# Power on
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus chassis power on

# Power off
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus chassis power off

# Get sensor readings
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus sdr list

# Get SEL (System Event Log)
ipmitool -H 192.168.1.100 -U admin -P password -I lanplus sel list

# Test API endpoint
curl -X POST http://localhost:8787/api/ipmi/device-id \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "port": 623,
    "username": "admin",
    "password": "password"
  }'
```

## Resources

- **IPMI v2.0 Specification**: Intel/HP/NEC/Dell standard
- **RMCP/RMCP+**: ASF specification v2.0
- [ipmitool](https://github.com/ipmitool/ipmitool) - Command-line IPMI client
- [FreeIPMI](https://www.gnu.org/software/freeipmi/) - IPMI tools and libraries
- [OpenIPMI](https://openipmi.sourceforge.io/) - Linux IPMI driver
- [IPMI Security Best Practices](https://www.us-cert.gov/ncas/alerts/TA13-207A)

## Notes

- **BMC**: Baseboard Management Controller - the hardware chip that implements IPMI
- **SOL**: Serial over LAN - remote console access via IPMI
- **SDR**: Sensor Data Record - hardware sensor information
- **SEL**: System Event Log - hardware event logging
- **Redfish**: Modern replacement for IPMI (RESTful API)
- **Common Vendors**: Dell iDRAC, HP iLO, Supermicro IPMI, Lenovo IMM
- **Default Ports**: UDP 623 (IPMI), UDP 664 (RMCP Secure)
- **Authentication**: IPMI v1.5 (weak MD5), IPMI v2.0 (RMCP+ with AES)
- **Vulnerabilities**: Cipher Zero, hash passing, weak defaults
- **Migration**: Consider moving to Redfish for new deployments
