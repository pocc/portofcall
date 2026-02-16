# Matrix Protocol Implementation

## Overview

**Protocol:** Matrix (HTTP/JSON over TCP)
**Port:** 8448 (federation), 8008 (client-server alternative), 443 (client-server HTTPS)
**Specification:** [Matrix Specification](https://spec.matrix.org/)
**Complexity:** Medium
**Purpose:** Decentralized real-time communication and federation

Matrix is an **open standard for decentralized, real-time communication**. It enables secure messaging, VoIP, and IoT communication across federated homeservers.

### Use Cases
- Instant messaging and chat
- End-to-end encrypted communication
- VoIP and video conferencing
- IoT device communication
- Bridging to other platforms (Slack, Discord, IRC, Telegram)
- Decentralized social networking
- Collaborative editing and presence

## Protocol Specification

### Matrix Architecture

Matrix uses a federated architecture:
- **Homeservers** - user accounts and rooms
- **Federation** - homeserver-to-homeserver communication (port 8448)
- **Client-Server API** - user applications (port 443 or 8008)
- **Application Services** - bridges and bots

### HTTP/JSON API

Matrix uses HTTP/1.1 with JSON payloads. This implementation constructs raw HTTP requests over TCP sockets.

### Key API Endpoints

#### Discovery & Health

**Supported Versions:**
```http
GET /_matrix/client/versions HTTP/1.1
Host: matrix.org:8448
Accept: application/json
Connection: close
```

Response:
```json
{
  "versions": [
    "r0.0.1",
    "r0.1.0",
    "r0.2.0",
    "v1.1",
    "v1.2"
  ],
  "unstable_features": {
    "org.matrix.e2e_cross_signing": true,
    "org.matrix.msc2285.stable": true
  }
}
```

**Login Flows:**
```http
GET /_matrix/client/v3/login HTTP/1.1
Host: matrix.org:8448
```

Response:
```json
{
  "flows": [
    { "type": "m.login.password" },
    { "type": "m.login.sso" },
    { "type": "m.login.token" }
  ]
}
```

**Federation Version:**
```http
GET /_matrix/federation/v1/version HTTP/1.1
Host: matrix.org:8448
```

Response:
```json
{
  "server": {
    "name": "Synapse",
    "version": "1.95.1"
  }
}
```

## Implementation

### Worker Endpoints

#### 1. Health Check Endpoint

**Path:** `/api/matrix/health`
**Method:** `POST`

Request:
```json
{
  "host": "matrix.org",
  "port": 8448,
  "timeout": 15000
}
```

Response:
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 245,
  "parsed": {
    "versions": {
      "versions": ["r0.0.1", "v1.1", "v1.2"],
      "unstable_features": {
        "org.matrix.e2e_cross_signing": true
      }
    },
    "loginFlows": {
      "flows": [
        { "type": "m.login.password" },
        { "type": "m.login.sso" }
      ]
    },
    "federation": {
      "server": {
        "name": "Synapse",
        "version": "1.95.1"
      }
    }
  }
}
```

## Testing

### Public Matrix Homeservers

- **matrix.org** - Official Matrix Foundation homeserver
  - Host: `matrix.org`
  - Federation Port: 8448
  - Client Port: 443

### Test Queries

**1. Version Check:**
```bash
curl https://matrix.org/_matrix/client/versions
```

**2. Login Flows:**
```bash
curl https://matrix.org/_matrix/client/v3/login
```

**3. Public Rooms:**
```bash
curl "https://matrix.org/_matrix/client/v3/publicRooms?limit=5"
```

## Resources

- **Specification:** [spec.matrix.org](https://spec.matrix.org/)
- **Matrix.org:** [matrix.org](https://matrix.org/)
- **Try Matrix Now:** [app.element.io](https://app.element.io/)
- **Synapse Docs:** [element-hq.github.io/synapse](https://element-hq.github.io/synapse/latest/)

## Port of Call Implementation Status

✅ **Implemented:**
- Homeserver discovery and health checking
- Supported spec versions detection
- Login flow enumeration
- Federation server version detection
- Public rooms directory query
- Arbitrary Matrix API queries (GET/POST/PUT/DELETE)
- Bearer token authentication
- HTTP/1.1 over TCP implementation
- Chunked transfer encoding support

**Focus:** Discovery, health checking, and API exploration rather than full client functionality.
