# SSDP / UPnP Protocol Implementation

**Reviewed:** 2026-02-18
**Source:** `/Users/rj/gd/code/portofcall/src/worker/ssdp.ts`

## Overview

Simple Service Discovery Protocol (SSDP) is the discovery layer of Universal Plug and Play (UPnP). It enables devices to advertise themselves and respond to service discovery requests on local networks. SSDP uses UDP multicast (239.255.255.250:1900) for discovery and HTTP-like message formatting.

**Key Challenge:** Cloudflare Workers cannot send UDP multicast traffic. This implementation works around that limitation using two complementary strategies:

1. **HTTP XML Fetch** — Direct HTTP GET to common UPnP description XML paths
2. **TCP Unicast M-SEARCH** — TCP-based M-SEARCH to port 1900 (supported by some stacks like Windows SSDP service)

Additionally implements:
- **GENA Event Subscription** — Subscribe to UPnP device events
- **SOAP Action Invocation** — Execute UPnP service control actions

## Endpoints

### 1. POST /api/ssdp/discover

Fetch a UPnP device description XML from a specific path and parse device information.

**Request:**
```json
{
  "host": "192.168.1.1",
  "port": 1900,
  "path": "/rootDesc.xml",
  "timeout": 10000
}
```

**Parameters:**
- `host` (required) — Target device IP or hostname
- `port` (optional) — HTTP port, default 1900
- `path` (optional) — XML description path, default `/rootDesc.xml`
- `timeout` (optional) — Request timeout in milliseconds, default 10000

**Response (success):**
```json
{
  "success": true,
  "latencyMs": 245,
  "foundPath": "/rootDesc.xml",
  "deviceType": "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "friendlyName": "Netgear Router",
  "manufacturer": "NETGEAR",
  "manufacturerURL": "http://www.netgear.com",
  "modelName": "Nighthawk R7000",
  "modelNumber": "R7000v2",
  "serialNumber": "ABC123456",
  "udn": "uuid:12345678-1234-1234-1234-123456789abc",
  "presentationURL": "http://192.168.1.1/",
  "services": [
    {
      "serviceType": "urn:schemas-upnp-org:service:WANIPConnection:1",
      "serviceId": "urn:upnp-org:serviceId:WANIPConn1",
      "controlURL": "/ctl/IPConn",
      "eventSubURL": "/evt/IPConn",
      "SCPDURL": "/WANIPConnection.xml"
    }
  ]
}
```

**Response (failure):**
```json
{
  "success": false,
  "latencyMs": 5002,
  "httpStatus": 404,
  "error": "HTTP 404 Not Found",
  "path": "/rootDesc.xml"
}
```

**Common Error Codes:**
- 404 — Path not found on device
- 403 — Cloudflare IP detected (blocked)
- 500 — Connection error or malformed XML

---

### 2. POST /api/ssdp/fetch

Try multiple common UPnP XML paths and return the first successful parse. Best for discovery when the device's XML path is unknown.

**Common Paths Tried (in order):**
1. `/rootDesc.xml`
2. `/description.xml`
3. `/upnp/IGD.xml`
4. `/gateway.xml`
5. `/setup.xml`
6. `/wps_info.xml`
7. `/tr64desc.xml`
8. `/gatedesc.xml`
9. `/igd.xml`
10. `/device-desc.xml`

**Request:**
```json
{
  "host": "192.168.1.254",
  "port": 49152,
  "timeout": 15000
}
```

**Parameters:**
- `host` (required) — Target device IP or hostname
- `port` (optional) — HTTP port, default 1900
- `timeout` (optional) — Total timeout across all paths, default 15000ms

**Response (success):**
```json
{
  "success": true,
  "latencyMs": 1823,
  "foundPath": "/upnp/IGD.xml",
  "deviceType": "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
  "friendlyName": "ASUS Router",
  "manufacturer": "ASUSTek",
  "modelName": "RT-AC68U",
  "udn": "uuid:abcd-1234-efgh-5678",
  "services": [...]
}
```

**Response (failure):**
```json
{
  "success": false,
  "latencyMs": 15012,
  "error": "No UPnP description found at any known path",
  "triedPaths": [
    "/rootDesc.xml",
    "/description.xml",
    "/upnp/IGD.xml",
    "/gateway.xml"
  ]
}
```

**Use Cases:**
- Initial device discovery when XML path is unknown
- Scanning multiple devices to identify UPnP-capable hardware
- Fallback when specific path fails

---

### 3. POST /api/ssdp/search

Send an M-SEARCH request over TCP unicast to port 1900. Some UPnP implementations (notably Windows SSDP service) accept M-SEARCH over TCP instead of the standard UDP multicast.

**Protocol Note:** Per UPnP Device Architecture spec, the HOST header MUST be `239.255.255.250:1900` (the multicast address) even when sending unicast M-SEARCH over TCP.

**Request:**
```json
{
  "host": "192.168.1.1",
  "port": 1900,
  "st": "ssdp:all",
  "mx": 3,
  "timeout": 5000
}
```

**Parameters:**
- `host` (required) — Target device IP or hostname
- `port` (optional) — TCP port, default 1900
- `st` (optional) — Search Target, default `ssdp:all`
  - `ssdp:all` — All devices and services
  - `upnp:rootdevice` — Root devices only
  - `uuid:{device-UUID}` — Specific device
  - `urn:schemas-upnp-org:device:{deviceType}:{version}` — Device type
  - `urn:schemas-upnp-org:service:{serviceType}:{version}` — Service type
- `mx` (optional) — Maximum wait time in seconds (1-120), default 3
- `timeout` (optional) — Connection timeout in milliseconds, default 5000

**M-SEARCH Message Format:**
```
M-SEARCH * HTTP/1.1
HOST: 239.255.255.250:1900
MAN: "ssdp:discover"
MX: 3
ST: ssdp:all
USER-AGENT: PortOfCall/1.0 UPnP/1.1

```

**Response (success):**
```json
{
  "success": true,
  "latencyMs": 187,
  "statusLine": "HTTP/1.1 200 OK",
  "location": "http://192.168.1.1:1900/rootDesc.xml",
  "server": "Linux/3.14 UPnP/1.0 IpBridge/1.26.0",
  "usn": "uuid:12345678-1234-1234-1234-123456789abc::upnp:rootdevice",
  "st": "upnp:rootdevice",
  "cacheControl": "max-age=1800",
  "date": "Mon, 18 Feb 2026 12:34:56 GMT"
}
```

**Response (no reply):**
```json
{
  "success": false,
  "latencyMs": 5003,
  "error": "No response received"
}
```

**Known Limitations:**
- Most UPnP devices only respond to UDP multicast M-SEARCH (which Workers cannot send)
- Windows SSDP service and some IoT devices accept TCP M-SEARCH
- Responses are limited to the first received packet (no multi-response handling)

---

### 4. POST /api/ssdp/subscribe

Subscribe to UPnP GENA (General Event Notification Architecture) events from a device service. Establishes an event subscription and returns the subscription ID (SID).

**Important:** Event delivery to the callback URL will not work from Cloudflare Workers (Workers cannot listen for incoming HTTP requests). This endpoint is useful for testing device eventing support and retrieving SID/timeout parameters.

**Request:**
```json
{
  "host": "192.168.1.1",
  "port": 1900,
  "eventSubURL": "/evt/IPConn",
  "callbackURL": "http://192.168.1.100:8080/events",
  "timeoutSecs": 1800,
  "httpTimeout": 8000
}
```

**Parameters:**
- `host` (required) — Target device IP or hostname
- `port` (optional) — HTTP port, default 1900
- `eventSubURL` (required) — Event subscription URL from service description (e.g., `/evt/IPConn`)
- `callbackURL` (optional) — Where device sends events, default `http://127.0.0.1:1901/`
- `timeoutSecs` (optional) — Subscription timeout in seconds, default 1800 (30 minutes)
- `httpTimeout` (optional) — HTTP request timeout in milliseconds, default 8000

**SUBSCRIBE Message Format:**
```
SUBSCRIBE /evt/IPConn HTTP/1.1
HOST: 192.168.1.1:1900
CALLBACK: <http://192.168.1.100:8080/events>
NT: upnp:event
TIMEOUT: Second-1800
Connection: close
User-Agent: PortOfCall/1.0

```

**Response (success):**
```json
{
  "success": true,
  "latencyMs": 234,
  "statusCode": 200,
  "statusLine": "HTTP/1.1 200 OK",
  "sid": "uuid:subscription-12345678-abcd-1234-efgh-123456789abc",
  "timeoutHeader": "Second-1800",
  "note": "Subscription established. Events will be sent to callbackURL (not receivable in Workers)."
}
```

**Response (rejected):**
```json
{
  "success": false,
  "latencyMs": 142,
  "statusCode": 412,
  "statusLine": "HTTP/1.1 412 Precondition Failed",
  "error": "SUBSCRIBE rejected: HTTP/1.1 412 Precondition Failed"
}
```

**GENA Event Subscription Lifecycle:**
1. **Initial subscription** — Send SUBSCRIBE with CALLBACK and NT headers
2. **Renewal** — Send SUBSCRIBE with SID header (no CALLBACK/NT) before timeout expires
3. **Cancellation** — Send UNSUBSCRIBE with SID header

**Common Status Codes:**
- 200 OK — Subscription accepted
- 412 Precondition Failed — Invalid CALLBACK, NT, or TIMEOUT header
- 500 Internal Server Error — Device eventing error

**Renewal (not implemented):**
```
SUBSCRIBE /evt/IPConn HTTP/1.1
HOST: 192.168.1.1:1900
SID: uuid:subscription-12345678-abcd-1234-efgh-123456789abc
TIMEOUT: Second-1800

```

**Cancellation (not implemented):**
```
UNSUBSCRIBE /evt/IPConn HTTP/1.1
HOST: 192.168.1.1:1900
SID: uuid:subscription-12345678-abcd-1234-efgh-123456789abc

```

---

### 5. POST /api/ssdp/action

Invoke a UPnP SOAP control action on a device service. Uses SOAP 1.1 over HTTP POST to execute service-defined actions.

**Request:**
```json
{
  "host": "192.168.1.1",
  "port": 1900,
  "controlURL": "/ctl/IPConn",
  "serviceType": "urn:schemas-upnp-org:service:WANIPConnection:1",
  "action": "GetExternalIPAddress",
  "args": {},
  "httpTimeout": 8000
}
```

**Parameters:**
- `host` (required) — Target device IP or hostname
- `port` (optional) — HTTP port, default 1900
- `controlURL` (required) — Control URL from service description (e.g., `/ctl/IPConn`)
- `serviceType` (required) — Full service type URN
- `action` (required) — Action name (e.g., `GetExternalIPAddress`, `SetVolume`)
- `args` (optional) — Action arguments as key-value pairs, default `{}`
- `httpTimeout` (optional) — HTTP request timeout in milliseconds, default 8000

**HTTP POST Message Format:**
```
POST /ctl/IPConn HTTP/1.1
HOST: 192.168.1.1:1900
Content-Type: text/xml; charset="utf-8"
SOAPAction: "urn:schemas-upnp-org:service:WANIPConnection:1#GetExternalIPAddress"
Content-Length: 295
Connection: close
User-Agent: PortOfCall/1.0

<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetExternalIPAddress xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1"></u:GetExternalIPAddress>
  </s:Body>
</s:Envelope>
```

**Response (success):**
```json
{
  "success": true,
  "latencyMs": 321,
  "statusCode": 200,
  "action": "GetExternalIPAddress",
  "serviceType": "urn:schemas-upnp-org:service:WANIPConnection:1",
  "responseArgs": {
    "NewExternalIPAddress": "203.0.113.42"
  }
}
```

**Response (SOAP fault):**
```json
{
  "success": false,
  "latencyMs": 187,
  "statusCode": 500,
  "action": "SetVolume",
  "serviceType": "urn:schemas-upnp-org:service:RenderingControl:1",
  "fault": {
    "code": "s:Client",
    "message": "UPnPError"
  },
  "error": "HTTP 500"
}
```

**Common Actions by Service Type:**

**WANIPConnection / WANPPPConnection (Internet Gateway):**
- `GetExternalIPAddress` — Get router's public IP
- `GetConnectionTypeInfo` — Get connection type
- `GetStatusInfo` — Get connection status
- `AddPortMapping` — Add port forwarding rule (args: NewRemoteHost, NewExternalPort, NewProtocol, NewInternalPort, NewInternalClient, NewEnabled, NewPortMappingDescription, NewLeaseDuration)
- `DeletePortMapping` — Remove port forwarding rule

**RenderingControl (Media Renderer):**
- `SetVolume` — Set audio volume (args: InstanceID, Channel, DesiredVolume)
- `GetVolume` — Get current volume
- `SetMute` — Mute/unmute audio

**AVTransport (Media Playback):**
- `Play` — Start playback
- `Pause` — Pause playback
- `Stop` — Stop playback
- `SetAVTransportURI` — Set media URI

**ContentDirectory (Media Server):**
- `Browse` — Browse media content
- `Search` — Search media library
- `GetSystemUpdateID` — Get content update ID

**Example: Port Forwarding:**
```json
{
  "host": "192.168.1.1",
  "port": 49152,
  "controlURL": "/ctl/IPConn",
  "serviceType": "urn:schemas-upnp-org:service:WANIPConnection:1",
  "action": "AddPortMapping",
  "args": {
    "NewRemoteHost": "",
    "NewExternalPort": "8080",
    "NewProtocol": "TCP",
    "NewInternalPort": "80",
    "NewInternalClient": "192.168.1.100",
    "NewEnabled": "1",
    "NewPortMappingDescription": "Web Server",
    "NewLeaseDuration": "0"
  }
}
```

---

## UPnP Device Discovery Workflow

### Step 1: Discover Device XML Location

**Option A: Known path (fast)**
```bash
curl -X POST https://portofcall.example.com/api/ssdp/discover \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.1","port":1900,"path":"/rootDesc.xml"}'
```

**Option B: Auto-detect path (slower, tries multiple)**
```bash
curl -X POST https://portofcall.example.com/api/ssdp/fetch \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.1","port":49152}'
```

**Option C: TCP M-SEARCH (extracts LOCATION from response)**
```bash
curl -X POST https://portofcall.example.com/api/ssdp/search \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.1","st":"ssdp:all","mx":3}'
```

### Step 2: Parse Device Description

The response includes a `services` array listing available services with their control URLs, event subscription URLs, and service description URLs.

Example service entry:
```json
{
  "serviceType": "urn:schemas-upnp-org:service:WANIPConnection:1",
  "serviceId": "urn:upnp-org:serviceId:WANIPConn1",
  "controlURL": "/ctl/IPConn",
  "eventSubURL": "/evt/IPConn",
  "SCPDURL": "/WANIPConnection.xml"
}
```

### Step 3: Fetch Service Description (SCPD)

To discover available actions and their arguments, fetch the SCPD XML:
```bash
curl http://192.168.1.1:1900/WANIPConnection.xml
```

Parse `<actionList>` to find action names and `<argumentList>` for each action.

### Step 4: Invoke Actions

Use the `/api/ssdp/action` endpoint with the `controlURL`, `serviceType`, and action details from the SCPD.

### Step 5: Subscribe to Events (optional)

If the service supports eventing (`eventSubURL` is present), subscribe to state variable changes:
```bash
curl -X POST https://portofcall.example.com/api/ssdp/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "host":"192.168.1.1",
    "port":1900,
    "eventSubURL":"/evt/IPConn",
    "callbackURL":"http://192.168.1.100:8080/events",
    "timeoutSecs":1800
  }'
```

---

## Protocol Reference

### SSDP (Simple Service Discovery Protocol)

**Specification:** UPnP Device Architecture v1.1, Section 1.2-1.3
**Transport:** HTTP over UDP (HTTPMU for multicast, HTTPU for unicast)
**Multicast Address:** 239.255.255.250:1900 (IPv4), ff0x::c (IPv6)

**Discovery Methods:**
1. **Advertisement (NOTIFY)** — Devices send periodic NOTIFY messages to multicast group
2. **Search (M-SEARCH)** — Control points send M-SEARCH queries, devices respond

**M-SEARCH Required Headers:**
- `HOST: 239.255.255.250:1900` — MUST be multicast address even for unicast TCP
- `MAN: "ssdp:discover"` — MUST be quoted
- `MX: {seconds}` — Maximum wait time (1-120), devices delay response randomly 0-MX seconds
- `ST: {search-target}` — What to search for (ssdp:all, upnp:rootdevice, uuid:, urn:)

**M-SEARCH Response Headers:**
- `LOCATION: {url}` — URL to device description XML
- `USN: {unique-service-name}` — Unique service identifier
- `ST: {search-target}` — Echo of search target
- `CACHE-CONTROL: max-age={seconds}` — How long response is valid
- `SERVER: {os}/{version} UPnP/{version} {product}/{version}` — Device info

**Search Target (ST) Values:**
- `ssdp:all` — All devices and services
- `upnp:rootdevice` — Root devices only
- `uuid:{device-UUID}` — Specific device by UUID
- `urn:schemas-upnp-org:device:{deviceType}:{version}` — Devices of specific type
- `urn:schemas-upnp-org:service:{serviceType}:{version}` — Services of specific type
- `urn:domain-name:device:{deviceType}:{version}` — Vendor-specific device
- `urn:domain-name:service:{serviceType}:{version}` — Vendor-specific service

### GENA (General Event Notification Architecture)

**Specification:** UPnP Device Architecture v1.1, Section 4
**Transport:** HTTP/1.1 over TCP
**Methods:** SUBSCRIBE, UNSUBSCRIBE, NOTIFY

**Initial Subscription Required Headers:**
- `HOST: {host}:{port}` — Device address
- `CALLBACK: <{url}>` — MUST be enclosed in angle brackets, can list multiple URLs
- `NT: upnp:event` — Notification type
- `TIMEOUT: Second-{seconds}` — Requested timeout (device may grant different value)

**Subscription Response Headers:**
- `SID: uuid:{subscription-id}` — Subscription identifier (use for renewal/cancel)
- `TIMEOUT: Second-{seconds}` — Actual granted timeout

**Renewal Headers:**
- `HOST: {host}:{port}`
- `SID: uuid:{subscription-id}` — From initial subscription response
- `TIMEOUT: Second-{seconds}` — Requested renewal timeout

**Cancellation Headers:**
- `HOST: {host}:{port}`
- `SID: uuid:{subscription-id}`

**Event Delivery (NOTIFY):**
Device sends NOTIFY to callback URL(s) with XML body containing state variable changes.

### SOAP (Simple Object Access Protocol)

**Specification:** SOAP 1.1 (W3C Note 2000-05-08)
**Transport:** HTTP POST
**Content-Type:** `text/xml; charset="utf-8"`

**Required Headers:**
- `HOST: {host}:{port}`
- `Content-Type: text/xml; charset="utf-8"`
- `SOAPAction: "{serviceType}#{actionName}"` — MUST be quoted per SOAP 1.1 spec
- `Content-Length: {bytes}`

**SOAP Body Format:**
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:{actionName} xmlns:u="{serviceType}">
      <{argumentName}>{value}</{argumentName}>
      ...
    </u:{actionName}>
  </s:Body>
</s:Envelope>
```

**SOAP Fault Format:**
```xml
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <s:Fault>
      <faultcode>s:Client</faultcode>
      <faultstring>UPnPError</faultstring>
      <detail>
        <UPnPError xmlns="urn:schemas-upnp-org:control-1-0">
          <errorCode>{code}</errorCode>
          <errorDescription>{description}</errorDescription>
        </UPnPError>
      </detail>
    </s:Fault>
  </s:Body>
</s:Envelope>
```

**Common UPnP Error Codes:**
- 401 — Invalid Action
- 402 — Invalid Args
- 501 — Action Failed
- 600 — Argument Value Invalid
- 601 — Argument Value Out of Range
- 602 — Optional Action Not Implemented
- 603 — Out of Memory
- 604 — Human Intervention Required
- 605 — String Argument Too Long
- 606 — Action Not Authorized
- 607 — Signature Failure
- 608 — Signature Missing
- 609 — Not Encrypted
- 610 — Invalid Sequence
- 611 — Invalid Control URL
- 612 — No Such Session

### UPnP Device Types

**Standard Device Types:**
- `urn:schemas-upnp-org:device:InternetGatewayDevice:1` — Internet Gateway (router)
- `urn:schemas-upnp-org:device:WANDevice:1` — WAN connection device
- `urn:schemas-upnp-org:device:WANConnectionDevice:1` — WAN connection container
- `urn:schemas-upnp-org:device:MediaRenderer:1` — Media player
- `urn:schemas-upnp-org:device:MediaServer:1` — Media server
- `urn:schemas-upnp-org:device:Basic:1` — Basic UPnP device
- `urn:schemas-upnp-org:device:Printer:1` — Network printer
- `urn:schemas-upnp-org:device:Scanner:1` — Network scanner

**Vendor-Specific Examples:**
- `urn:schemas-sony-com:service:IRCC:1` — Sony TV IR control
- `urn:dial-multiscreen-org:service:dial:1` — DIAL protocol (Netflix, YouTube)
- `urn:schemas-wifialliance-org:device:WFADevice:1` — WiFi Alliance device

### UPnP Service Types

**Common Service Types:**
- `urn:schemas-upnp-org:service:WANIPConnection:1` — WAN IP connection control
- `urn:schemas-upnp-org:service:WANPPPConnection:1` — WAN PPP connection control
- `urn:schemas-upnp-org:service:Layer3Forwarding:1` — Routing table
- `urn:schemas-upnp-org:service:RenderingControl:1` — Volume, mute, brightness
- `urn:schemas-upnp-org:service:AVTransport:1` — Play, pause, stop, seek
- `urn:schemas-upnp-org:service:ContentDirectory:1` — Browse media library
- `urn:schemas-upnp-org:service:ConnectionManager:1` — Protocol info

---

## Known Limitations and Edge Cases

### 1. UDP Multicast Not Supported

**Problem:** Cloudflare Workers cannot send UDP packets or join multicast groups.

**Workaround:** This implementation uses:
- HTTP GET to common UPnP XML paths (most reliable)
- TCP unicast M-SEARCH to port 1900 (works on Windows, some IoT devices)

**Impact:** Cannot perform true SSDP multicast discovery. Must know device IP address beforehand.

### 2. M-SEARCH HOST Header Requirement

**Specification:** Per UPnP Device Architecture, M-SEARCH requests MUST use `HOST: 239.255.255.250:1900` even when sending unicast to a specific IP.

**Rationale:** Devices validate the HOST header to confirm the request is SSDP-compliant.

**Bug Fixed:** Previous implementation incorrectly used `HOST: {unicast-ip}:{port}`, causing some devices to reject the request.

### 3. TCP M-SEARCH Limited Support

**Support Matrix:**
- Windows SSDP service — YES (accepts TCP unicast M-SEARCH)
- Most Linux/embedded UPnP stacks — NO (UDP multicast only)
- Some IoT devices — PARTIAL (vendor-specific)

**Recommendation:** Use `/api/ssdp/fetch` for most reliable discovery (direct HTTP XML fetch).

### 4. XML Parsing Limitations

**Supported:**
- Simple nested elements
- CDATA sections (stripped during parsing)
- Case-insensitive tag matching
- Namespaced elements (prefix ignored)

**Not Supported:**
- XML namespaces (xmlns validation)
- XML schema validation
- Comments preservation
- Processing instructions
- Entity references beyond standard HTML entities

**Bug Fixed:** Previous regex `<tag>([^<]*)</tag>` failed on nested elements. Now uses `<tag>([\s\S]*?)</tag>` with non-greedy match and CDATA stripping.

### 5. GENA Event Delivery Not Possible

**Problem:** Cloudflare Workers cannot listen for incoming HTTP connections.

**Consequence:** While you can establish a subscription and receive an SID, the device's NOTIFY messages to the callback URL will never reach the Worker.

**Use Case:** Testing device eventing support, retrieving subscription parameters, or subscribing from a callback URL on a local machine accessible to the device.

### 6. No Multi-Response Handling

**M-SEARCH Behavior:** Devices may send multiple responses (one per device/service match). This implementation returns only the first response received.

**Impact:** When searching for `ssdp:all`, you'll see only the first response, missing additional services/devices.

**Workaround:** Use specific ST values (e.g., `upnp:rootdevice`) or query each service type individually.

### 7. No Cloudflare IP Protection Bypass

All endpoints check if the target host resolves to a Cloudflare IP and return HTTP 403 to prevent abuse of Cloudflare's network for lateral scanning.

**Bypasses:**
- Use hostnames instead of IPs (still blocked if DNS resolves to Cloudflare)
- Not available (security feature by design)

### 8. Connection Timeout Precision

**TCP Read Timeout:** Uses polling-based deadline check rather than true socket timeout. May exceed specified timeout by up to the read chunk interval (~100-500ms).

**HTTP Fetch Timeout:** Uses `Promise.race` with `setTimeout`, which is precise to ~1-10ms.

### 9. Large XML Responses

**No Size Limit:** Fetch responses are read into memory without size limit checks. A malicious device could send multi-megabyte XML and cause memory pressure.

**Mitigation:** Workers have a 128MB memory limit and will error if exceeded.

**Recommendation:** Add Content-Length validation before reading response body in production.

### 10. SOAP Argument Escaping

**Current Behavior:** Action arguments are inserted into SOAP XML without escaping:
```javascript
const argXml = Object.entries(args)
  .map(([k, v]) => `<${k}>${v}</${k}>`)
  .join('');
```

**Risk:** If argument values contain `<`, `>`, `&`, `"`, or `'`, the XML will be malformed.

**Example:**
```json
{"args": {"Description": "Port < 1024"}}
```
Produces invalid XML:
```xml
<Description>Port < 1024</Description>
```

**Mitigation Required:** HTML-escape argument values before insertion:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- `"` → `&quot;`
- `'` → `&apos;`

---

## Testing Examples

### Discover Router Description
```bash
curl -X POST http://localhost:8787/api/ssdp/fetch \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.1","timeout":10000}'
```

### Get External IP Address
```bash
curl -X POST http://localhost:8787/api/ssdp/action \
  -H "Content-Type: application/json" \
  -d '{
    "host":"192.168.1.1",
    "port":49152,
    "controlURL":"/ctl/IPConn",
    "serviceType":"urn:schemas-upnp-org:service:WANIPConnection:1",
    "action":"GetExternalIPAddress"
  }'
```

### Add Port Forwarding
```bash
curl -X POST http://localhost:8787/api/ssdp/action \
  -H "Content-Type: application/json" \
  -d '{
    "host":"192.168.1.1",
    "port":49152,
    "controlURL":"/ctl/IPConn",
    "serviceType":"urn:schemas-upnp-org:service:WANIPConnection:1",
    "action":"AddPortMapping",
    "args":{
      "NewRemoteHost":"",
      "NewExternalPort":"8080",
      "NewProtocol":"TCP",
      "NewInternalPort":"80",
      "NewInternalClient":"192.168.1.100",
      "NewEnabled":"1",
      "NewPortMappingDescription":"Web Server",
      "NewLeaseDuration":"0"
    }
  }'
```

### Subscribe to Connection Events
```bash
curl -X POST http://localhost:8787/api/ssdp/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "host":"192.168.1.1",
    "port":49152,
    "eventSubURL":"/evt/IPConn",
    "callbackURL":"http://192.168.1.100:8080/upnp-events"
  }'
```

### Search for All Devices (TCP M-SEARCH)
```bash
curl -X POST http://localhost:8787/api/ssdp/search \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.1","st":"ssdp:all","mx":3}'
```

---

## References

- [UPnP Device Architecture 1.1 (PDF)](https://upnp.org/specs/arch/UPnP-arch-DeviceArchitecture-v1.1.pdf)
- [UPnP Device Architecture 2.0 (PDF)](https://openconnectivity.org/upnp-specs/UPnP-arch-DeviceArchitecture-v2.0-20200417.pdf)
- [Simple Service Discovery Protocol - Wikipedia](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol)
- [SSDP - Wireshark Wiki](https://wiki.wireshark.org/SSDP)
- [SOAP 1.1 Specification - W3C](https://www.w3.org/TR/2000/NOTE-SOAP-20000508/)
- [Microsoft SSDP Documentation](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-ssdp/)
- [Introduction to UPnP](https://www.gabriel.urdhr.fr/2021/03/22/introduction-to-upnp/)

---

## Appendix: Device XML Schema (Simplified)

```xml
<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <friendlyName>My Router</friendlyName>
    <manufacturer>Manufacturer Name</manufacturer>
    <manufacturerURL>http://www.manufacturer.com</manufacturerURL>
    <modelDescription>Model Description</modelDescription>
    <modelName>Model Name</modelName>
    <modelNumber>v1.0</modelNumber>
    <modelURL>http://www.manufacturer.com/model</modelURL>
    <serialNumber>123456789</serialNumber>
    <UDN>uuid:12345678-1234-1234-1234-123456789abc</UDN>
    <presentationURL>http://192.168.1.1/</presentationURL>

    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>
        <controlURL>/ctl/IPConn</controlURL>
        <eventSubURL>/evt/IPConn</eventSubURL>
        <SCPDURL>/WANIPConnection.xml</SCPDURL>
      </service>
    </serviceList>

    <deviceList>
      <device>
        <!-- Embedded devices -->
      </device>
    </deviceList>
  </device>
</root>
```

## Appendix: Service Description (SCPD) Schema

```xml
<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>

  <actionList>
    <action>
      <name>GetExternalIPAddress</name>
      <argumentList>
        <argument>
          <name>NewExternalIPAddress</name>
          <direction>out</direction>
          <relatedStateVariable>ExternalIPAddress</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
  </actionList>

  <serviceStateTable>
    <stateVariable sendEvents="yes">
      <name>ExternalIPAddress</name>
      <dataType>string</dataType>
    </stateVariable>
  </serviceStateTable>
</scpd>
```
