# EPP (Extensible Provisioning Protocol) Reference

## Overview

EPP is an XML-based protocol for provisioning and managing domain names, hosts, and contacts at domain registries. It operates over a TLS-secured TCP connection and uses a request-response model with length-prefixed framing.

**Port:** 700 (TCP over TLS)
**RFCs:** 5730 (base), 5731 (domain mapping), 5732 (host mapping), 5733 (contact mapping), 5734 (TCP transport)
**Namespace:** `urn:ietf:params:xml:ns:epp-1.0`

## TCP Transport Framing (RFC 5734)

Every EPP message on the wire is preceded by a **4-byte length header** in network byte order (big-endian). The length value **includes the 4 header bytes themselves**.

```
+--------+--------+--------+--------+------------------------------+
| Byte 0 | Byte 1 | Byte 2 | Byte 3 |         XML Payload          |
|         Total Length (uint32)       |      (Length - 4 bytes)      |
+--------+--------+--------+--------+------------------------------+
```

**Example:** An XML payload of 200 bytes has a total length field of 204.

**Key rules:**
- Minimum valid length value is 4 (empty payload)
- Maximum length is server-defined; implementations typically cap at 10 MB
- The length is an unsigned 32-bit integer (big-endian / network byte order)
- There is no message delimiter -- framing is entirely length-based
- Stream chunks from TCP may not align with frame boundaries; implementations must handle partial reads

## Session Lifecycle (RFC 5730 Section 2)

```
  Client                           Server
    |                                |
    |<----- [greeting] --------------|  (server sends immediately on connect)
    |                                |
    |----- <hello/> ---------------->|  (optional: request fresh greeting)
    |<----- [greeting] --------------|
    |                                |
    |----- <login> ----------------->|  (authenticate + declare object URIs)
    |<----- [response 1000] ---------|
    |                                |
    |----- <check>/<info>/... ------>|  (query/transform commands)
    |<----- [response] --------------|
    |                                |
    |----- <logout> ---------------->|  (graceful session end)
    |<----- [response 1500] ---------|  (1500 = ending session)
    |          [connection closed]   |
```

### 1. Greeting (server-initiated)

The server sends a `<greeting>` immediately upon connection. It contains:
- `<svID>` -- server name
- `<svDate>` -- server date (UTC)
- `<svcMenu>` -- supported EPP versions, languages, and object URIs
- `<dcp>` -- data collection policy

A greeting has **no `<result>` element** -- it is not a command response.

### 2. Hello (client-initiated, optional)

The client may send `<hello/>` at any time to request a fresh greeting. The server responds with a new `<greeting>`.

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <hello/>
</epp>
```

### 3. Login

Authenticates the client and declares which object namespaces the session will use.

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>RegistrarID</clID>
      <pw>secretPassword</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
        <objURI>urn:ietf:params:xml:ns:domain-1.0</objURI>
        <objURI>urn:ietf:params:xml:ns:contact-1.0</objURI>
        <objURI>urn:ietf:params:xml:ns:host-1.0</objURI>
      </svcs>
    </login>
    <clTRID>client-txn-001</clTRID>
  </command>
</epp>
```

**Important:** The `<svcs>` element lists object namespace URIs the client intends to use during the session. Only objects whose URIs are listed here can be queried or modified.

### 4. Logout

Clients SHOULD send `<logout/>` before closing the connection (RFC 5730 Section 2.9.1.2).

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <logout/>
    <clTRID>client-txn-099</clTRID>
  </command>
</epp>
```

The server responds with code **1500** ("Command completed successfully; ending session") and then closes the connection.

## XML Namespaces

| Namespace URI | Purpose | RFC |
|---|---|---|
| `urn:ietf:params:xml:ns:epp-1.0` | EPP base protocol | 5730 |
| `urn:ietf:params:xml:ns:domain-1.0` | Domain name mapping | 5731 |
| `urn:ietf:params:xml:ns:host-1.0` | Host object mapping | 5732 |
| `urn:ietf:params:xml:ns:contact-1.0` | Contact mapping | 5733 |

All EPP XML documents use the `epp` root element with `xmlns="urn:ietf:params:xml:ns:epp-1.0"`. Object-specific elements use their own namespace prefix (e.g., `domain:`, `contact:`, `host:`).

## Result Codes (RFC 5730 Section 3)

### Success (1xxx)

| Code | Meaning |
|------|---------|
| 1000 | Command completed successfully |
| 1001 | Command completed successfully; action pending |
| 1300 | No messages in queue |
| 1301 | Message acknowledged; dequeued |
| 1500 | Command completed successfully; ending session |

### Error (2xxx)

| Code | Meaning |
|------|---------|
| 2000 | Unknown command |
| 2001 | Command syntax error |
| 2002 | Command use error |
| 2003 | Required parameter missing |
| 2004 | Parameter value range error |
| 2005 | Parameter value syntax error |
| 2100 | Unimplemented protocol version |
| 2101 | Unimplemented command |
| 2102 | Unimplemented option |
| 2103 | Unimplemented extension |
| 2104 | Billing failure |
| 2105 | Object not eligible for renewal |
| 2106 | Object not eligible for transfer |
| 2200 | Authentication error |
| 2201 | Authorization error |
| 2202 | Invalid authorization information |
| 2300 | Object pending transfer |
| 2301 | Object not pending transfer |
| 2302 | Object exists |
| 2303 | Object does not exist |
| 2304 | Object status prohibits operation |
| 2305 | Object association prohibits operation |
| 2306 | Parameter value policy error |
| 2307 | Unimplemented object service |
| 2308 | Data management policy violation |
| 2400 | Command failed |
| 2500 | Command failed; server closing connection |
| 2501 | Authentication error; server closing connection |
| 2502 | Session limit exceeded; server closing connection |

## Transaction IDs

Every `<command>` element SHOULD contain a `<clTRID>` (client transaction ID). The server response includes both:
- `<clTRID>` -- echoed back from the request
- `<svTRID>` -- server-assigned transaction ID

Together they provide end-to-end transaction tracing.

```xml
<trID>
  <clTRID>client-txn-001</clTRID>
  <svTRID>SRV-12345</svTRID>
</trID>
```

## Domain Commands (RFC 5731)

### domain:check

Checks whether one or more domains are available for registration.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
        <domain:name>example.net</domain:name>
      </domain:check>
    </check>
    <clTRID>check-001</clTRID>
  </command>
</epp>
```

Response includes `avail="1"` (available) or `avail="0"` (taken) for each name.

### domain:info

Retrieves detailed information about a domain.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name hosts="all">example.com</domain:name>
      </domain:info>
    </info>
    <clTRID>info-001</clTRID>
  </command>
</epp>
```

The `hosts` attribute can be `"all"`, `"del"` (delegated), `"sub"` (subordinate), or `"none"`.

Response fields: `domain:name`, `domain:roid`, `domain:status`, `domain:registrant`, `domain:contact`, `domain:ns`, `domain:host`, `domain:clID`, `domain:crID`, `domain:crDate`, `domain:upID`, `domain:upDate`, `domain:exDate`, `domain:trDate`, `domain:authInfo`.

### domain:create

Creates a new domain registration.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
        <domain:period unit="y">2</domain:period>
        <domain:ns>
          <domain:hostObj>ns1.example.com</domain:hostObj>
          <domain:hostObj>ns2.example.com</domain:hostObj>
        </domain:ns>
        <domain:registrant>REG-001</domain:registrant>
        <domain:contact type="admin">ADMIN-001</domain:contact>
        <domain:contact type="tech">TECH-001</domain:contact>
        <domain:authInfo>
          <domain:pw>transferSecret123</domain:pw>
        </domain:authInfo>
      </domain:create>
    </create>
    <clTRID>create-001</clTRID>
  </command>
</epp>
```

Success codes: **1000** (created immediately) or **1001** (pending approval).

### domain:renew

Extends a domain's registration period. The current expiration date MUST be provided as a safety check.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <renew>
      <domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
        <domain:curExpDate>2026-04-03</domain:curExpDate>
        <domain:period unit="y">1</domain:period>
      </domain:renew>
    </renew>
    <clTRID>renew-001</clTRID>
  </command>
</epp>
```

### domain:update

Modifies a domain's nameservers, contacts, status, or auth info. Uses `<add>`, `<rem>`, and `<chg>` sub-elements (all optional, but at least one must be present).

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
        <domain:add>
          <domain:ns>
            <domain:hostObj>ns3.example.com</domain:hostObj>
          </domain:ns>
        </domain:add>
        <domain:rem>
          <domain:ns>
            <domain:hostObj>ns1.example.com</domain:hostObj>
          </domain:ns>
        </domain:rem>
        <domain:chg>
          <domain:authInfo>
            <domain:pw>newSecret456</domain:pw>
          </domain:authInfo>
        </domain:chg>
      </domain:update>
    </update>
    <clTRID>update-001</clTRID>
  </command>
</epp>
```

### domain:delete

Removes a domain registration. The domain must not have active subordinate host objects.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <domain:delete xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
      </domain:delete>
    </delete>
    <clTRID>delete-001</clTRID>
  </command>
</epp>
```

### domain:transfer

Initiates, approves, rejects, or cancels a domain transfer.

```xml
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <transfer op="request">
      <domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.com</domain:name>
        <domain:authInfo>
          <domain:pw>transferSecret123</domain:pw>
        </domain:authInfo>
      </domain:transfer>
    </transfer>
    <clTRID>transfer-001</clTRID>
  </command>
</epp>
```

The `op` attribute can be: `request`, `approve`, `reject`, `cancel`, or `query`.

## Implementation API Endpoints

This implementation exposes EPP operations as HTTP POST endpoints:

| Endpoint | Description | Required Fields |
|---|---|---|
| `POST /api/epp/connect` | Test connection (greeting + hello) | `host`, `port` |
| `POST /api/epp/login` | Test authentication | `host`, `port`, `clid`, `pw` |
| `POST /api/epp/domain-check` | Check domain availability | `host`, `port`, `clid`, `pw`, `domain` |
| `POST /api/epp/domain-info` | Get domain details | `host`, `clid`, `pw`, `domain` |
| `POST /api/epp/domain-create` | Register a domain | `host`, `clid`, `pw`, `domain` |
| `POST /api/epp/domain-update` | Modify domain (NS, auth) | `host`, `clid`, `pw`, `domain` |
| `POST /api/epp/domain-delete` | Delete a domain | `host`, `clid`, `pw`, `domain` |
| `POST /api/epp/domain-renew` | Renew a domain | `host`, `clid`, `pw`, `domain`, `curExpDate` |

Optional fields: `port` (default 700), `period`/`years`, `nameservers[]`, `registrant`, `password` (authInfo), `addNs[]`, `remNs[]`, `authPw`.

## Security Considerations

- EPP requires TLS (RFC 5734 Section 9). The Cloudflare `connect()` API handles TLS.
- All user-supplied strings are XML-escaped before insertion into command templates to prevent XML injection.
- Credentials (`clid`, `pw`) are sent in the `<login>` command and never logged or returned in API responses.
- The `<authInfo>` password is a domain-level transfer authorization secret, separate from the registrar login password.

## Common Registries

| Registry | Host | Notes |
|---|---|---|
| Verisign (.com/.net) | `epp.verisign-grs.com:700` | Requires OT&E account |
| Afilias (.info) | `epp.afilias.net:700` | |
| Nominet (.uk) | `epp.nominet.org.uk:700` | |
| CIRA (.ca) | `epp.cira.ca:700` | |

## Source File

Implementation: `src/worker/epp.ts`
