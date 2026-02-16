# SSDP Protocol Implementation

## Overview

**SSDP (Simple Service Discovery Protocol)** is the discovery protocol used by UPnP (Universal Plug and Play) for finding devices and services on local networks.

- **Port:** 1900 (UDP multicast 239.255.255.250, or TCP unicast)
- **Protocol:** HTTP-like text protocol
- **Purpose:** Device and service discovery (smart home, media servers, routers, etc.)

## Features

- ✅ M-SEARCH discovery requests
- ✅ HTTP-like response parsing
- ✅ Multiple search targets (device types)
- ✅ Device metadata extraction (Location, USN, Server, ST)
- ✅ Multiple device response collection
- ✅ Common UPnP device types supported

## API Endpoints

### POST /api/ssdp/discover

Send M-SEARCH request and collect device responses.

**Request:**
```json
{
  "host": "192.168.1.1",
  "port": 1900,
  "searchTarget": "ssdp:all",
  "maxWait": 3,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "devices": [
    {
      "location": "http://192.168.1.1:49152/description.xml",
      "searchTarget": "upnp:rootdevice",
      "uniqueServiceName": "uuid:12345678-1234-1234-1234-123456789abc::upnp:rootdevice",
      "server": "Linux/3.10 UPnP/1.0 MyDevice/1.0",
      "cacheControl": "max-age=1800",
      "date": "Sun, 16 Feb 2026 12:00:00 GMT"
    }
  ]
}
```

### GET /api/ssdp/search

Search for specific device type (query parameter version).

**Example:**
```
GET /api/ssdp/search?host=192.168.1.1&searchTarget=upnp:rootdevice&maxWait=3
```

## Common Search Targets

| Search Target | Description |
|---------------|-------------|
| `ssdp:all` | All devices and services |
| `upnp:rootdevice` | Root devices only |
| `urn:schemas-upnp-org:device:MediaServer:1` | DLNA/UPnP media servers |
| `urn:schemas-upnp-org:device:MediaRenderer:1` | Media playback devices |
| `urn:schemas-upnp-org:device:InternetGatewayDevice:1` | Routers/gateways |
| `urn:schemas-upnp-org:device:WANDevice:1` | WAN devices |
| `urn:schemas-upnp-org:device:WANConnectionDevice:1` | WAN connections |
| `uuid:device-UUID` | Specific device by UUID |

## Usage Examples

### cURL - Discover All Devices

```bash
curl -X POST http://localhost:8787/api/ssdp/discover \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "searchTarget": "ssdp:all",
    "maxWait": 3
  }'
```

### cURL - Find Media Servers

```bash
curl -X POST http://localhost:8787/api/ssdp/discover \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "searchTarget": "urn:schemas-upnp-org:device:MediaServer:1",
    "maxWait": 5
  }'
```

### JavaScript

```javascript
const response = await fetch('/api/ssdp/discover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: '192.168.1.1',
    searchTarget: 'upnp:rootdevice',
    maxWait: 3,
  }),
});

const data = await response.json();
console.log(`Found ${data.count} devices`);

data.devices.forEach(device => {
  console.log('Device:', device.searchTarget);
  console.log('Location:', device.location);
  console.log('USN:', device.uniqueServiceName);
});
```

## Protocol Details

### M-SEARCH Request Format

```
M-SEARCH * HTTP/1.1
HOST: 192.168.1.1:1900
MAN: "ssdp:discover"
MX: 3
ST: ssdp:all
USER-AGENT: PortOfCall/1.0 UPnP/1.1

```

**Headers:**
- **HOST:** Target host and port
- **MAN:** "ssdp:discover" (mandatory extension)
- **MX:** Maximum wait time (1-120 seconds)
- **ST:** Search target (device/service type)
- **USER-AGENT:** Client identifier

### SSDP Response Format

```
HTTP/1.1 200 OK
CACHE-CONTROL: max-age=1800
DATE: Sun, 16 Feb 2026 12:00:00 GMT
EXT:
LOCATION: http://192.168.1.1:49152/description.xml
SERVER: Linux/3.10 UPnP/1.0 MyDevice/1.0
ST: upnp:rootdevice
USN: uuid:12345678-1234-1234-1234-123456789abc::upnp:rootdevice

```

**Headers:**
- **LOCATION:** URL to device description XML
- **ST:** Search target (device/service type)
- **USN:** Unique Service Name (UUID::ST format)
- **SERVER:** Server string (OS/version UPnP/version product/version)
- **CACHE-CONTROL:** How long to cache this advertisement
- **DATE:** Response timestamp
- **EXT:** Required by UPnP spec (empty value)

### Device Description XML

The LOCATION URL points to an XML file describing the device:

```xml
<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>My Media Server</friendlyName>
    <manufacturer>ExampleCorp</manufacturer>
    <modelName>MediaServer 3000</modelName>
    <UDN>uuid:12345678-1234-1234-1234-123456789abc</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <controlURL>/ContentDirectory/control</controlURL>
        <eventSubURL>/ContentDirectory/event</eventSubURL>
        <SCPDURL>/ContentDirectory/scpd.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>
```

## Authentication

**SSDP (This Implementation):**
- ❌ **No authentication** - SSDP is an open discovery protocol
- Any client can query any device on the network
- Designed for zero-configuration (plug and play)

**Security Implications:**
- ⚠️ Devices advertise their presence and capabilities
- ⚠️ Device description URLs can be accessed by anyone
- ⚠️ Information disclosure risk (device models, services, URLs)

**Edge Cases:**
- Open network → All devices respond to M-SEARCH
- Protected network → Firewall may block port 1900
- UPnP disabled → Device won't respond to SSDP

---

## Timeouts and Keep-Alives

**Connection Timeout:**
- ✅ Default: 10 seconds (overall timeout)
- ✅ Configurable via `timeout` parameter
- ✅ MX header specifies device response delay (1-120 seconds)

**Response Collection:**
- Devices respond with random delay (0 to MX seconds)
- Multiple devices may respond to same M-SEARCH
- Collection window = MX + 2 seconds (to catch late responses)
- Reads responses in 1-second intervals

**No Keep-Alives:**
- SSDP is stateless discovery
- Each M-SEARCH is independent
- Devices send periodic NOTIFY advertisements (not implemented)

**Edge Cases:**
- Many devices → Multiple responses collected
- Slow device → May respond late (within MX window)
- No responses → Times out after collection window
- Duplicate responses → Deduplicated by USN + ST

---

## Binary vs. Text Encoding

**Request Path: JSON → Text**
```
Client JSON → Worker → HTTP-like M-SEARCH → TCP Socket → SSDP Device
```

**Response Path: Text → JSON**
```
SSDP Device → TCP Socket → HTTP-like Response → Parser → JSON → Client
```

---

**Text Encoding Details:**

**M-SEARCH Format:**
- HTTP/1.1 request format
- CRLF line endings (`\r\n`)
- Colon-separated headers
- Double CRLF marks end of headers

**Response Parsing:**
```typescript
// Split by lines
const lines = response.split('\r\n');

// Parse status line
const statusLine = lines[0]; // "HTTP/1.1 200 OK"

// Parse headers
for (const line of lines.slice(1)) {
  const [key, value] = line.split(':', 2);
  headers[key.trim().toUpperCase()] = value.trim();
}
```

**Multiple Responses:**
- SSDP can send multiple responses (one per device/service)
- Responses separated by double CRLF (`\r\n\r\n`)
- Each response parsed independently
- Duplicates removed by comparing USN + ST

**Edge Cases:**

**Malformed Responses:**
- Missing status line → Parse error (skipped)
- Invalid headers → Skipped (logged to console)
- Truncated response → Partial data (may be incomplete)

**Character Encoding:**
- ✅ UTF-8 encoded text (TextEncoder/TextDecoder)
- ✅ Standard HTTP header format
- ⚠️ Non-ASCII characters in headers may cause issues (rare)

**Header Case Sensitivity:**
- HTTP headers are case-insensitive
- Parser converts all to uppercase for consistency
- `Location`, `LOCATION`, `location` all work

---

## Limitations

### What's Supported

- ✅ M-SEARCH discovery requests
- ✅ TCP unicast to specific host
- ✅ HTTP-like response parsing
- ✅ Multiple device response collection
- ✅ Common UPnP device types

### What's NOT Supported

- ❌ UDP multicast (239.255.255.250) - Workers limitation
- ❌ NOTIFY advertisements (async device announcements)
- ❌ Subscription to device events (SUBSCRIBE/UNSUBSCRIBE)
- ❌ M-POST method (alternative to M-SEARCH)
- ❌ UPnP control actions (requires SOAP)
- ❌ Automatic device description XML fetching

### TCP vs. UDP

**Standard:** SSDP uses UDP multicast (239.255.255.250:1900)

**This Implementation:** Uses TCP unicast due to Cloudflare Workers' TCP-only sockets API

**Impact:**
- Must target specific device IP (can't broadcast to all devices)
- Some devices may only support UDP multicast
- Most UPnP devices support both UDP and TCP
- TCP provides reliability but loses multicast convenience

**Workaround:**
- Target known device IPs (router, media server, etc.)
- Some routers expose SSDP on TCP for WAN access
- Use network scanner to find device IPs first

---

## Common Use Cases

### Discover DLNA Media Servers

```javascript
{
  "searchTarget": "urn:schemas-upnp-org:device:MediaServer:1",
  "maxWait": 5
}
```

### Find Internet Gateway (Router)

```javascript
{
  "searchTarget": "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "maxWait": 3
}
```

### Discover All UPnP Devices

```javascript
{
  "searchTarget": "ssdp:all",
  "maxWait": 5
}
```

---

## Testing

### Test with Local Router

```bash
# Most routers support SSDP on port 1900
curl -X POST http://localhost:8787/api/ssdp/discover \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "searchTarget": "upnp:rootdevice"
  }'
```

### Test with Example Client

```bash
# Open the test client
open examples/ssdp-test.html

# Or use the deployed version
https://portofcall.ross.gg/examples/ssdp-test.html
```

---

## Security Considerations

### Information Disclosure

- ⚠️ SSDP reveals device information (model, services, URLs)
- ⚠️ Anyone on network can discover devices
- ⚠️ Device description XML may contain sensitive data

**Mitigation:**
- Firewall port 1900 from untrusted networks
- Disable UPnP on devices that don't need it
- Use network segmentation (IoT VLAN)

### Spoofing

- ⚠️ No authentication - devices can be spoofed
- Attacker can send fake SSDP responses
- Can redirect to malicious device description URLs

**Mitigation:**
- Validate device description XML content
- Use HTTPS for device communication (if supported)
- Trust only known device UUIDs

### Amplification Attacks

- SSDP can be used for DDoS amplification (UDP multicast)
- This implementation uses TCP unicast (not vulnerable)

---

## Future Enhancements

- [ ] UDP multicast support (when Workers supports UDP)
- [ ] NOTIFY advertisement listening
- [ ] Automatic device description XML fetching and parsing
- [ ] UPnP control point (SOAP action invocation)
- [ ] Event subscription (GENA)
- [ ] Device alive monitoring

---

## References

- [UPnP Device Architecture](https://openconnectivity.org/developer/specifications/upnp-resources/upnp/)
- [SSDP Specification](https://tools.ietf.org/html/draft-cai-ssdp-v1-03)
- [DLNA Guidelines](http://www.dlna.org/)

---

## Example Device Response

```json
{
  "success": true,
  "count": 1,
  "devices": [
    {
      "location": "http://192.168.1.100:8200/rootDesc.xml",
      "searchTarget": "urn:schemas-upnp-org:device:MediaServer:1",
      "uniqueServiceName": "uuid:4d696e69-444c-164e-9d41-001122334455::urn:schemas-upnp-org:device:MediaServer:1",
      "server": "Linux/4.9.0 UPnP/1.0 MiniDLNA/1.2.1",
      "cacheControl": "max-age=1800",
      "date": "Sun, 16 Feb 2026 18:30:00 GMT"
    }
  ]
}
```

**Interpretation:**
- Found 1 media server
- Device description at http://192.168.1.100:8200/rootDesc.xml
- Running MiniDLNA 1.2.1 on Linux 4.9.0
- Device UUID: 4d696e69-444c-164e-9d41-001122334455
- Advertisement valid for 1800 seconds (30 minutes)

---

**SSDP implementation complete!** The protocol has been successfully integrated into the Port of Call gateway for UPnP device discovery over TCP.
