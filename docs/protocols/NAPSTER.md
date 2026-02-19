# Napster / OpenNap Protocol — Power-User Documentation

## Overview

**Napster** was a pioneering peer-to-peer file sharing service that revolutionized music distribution from 1999-2001. While the original Napster service was shut down due to copyright lawsuits, the protocol lives on through OpenNap-compatible servers.

- **Default Port**: 8888 (OpenNap standard), original Napster used 8875/6699
- **Transport**: TCP, no encryption (plaintext)
- **Wire Format**: Binary framing with little-endian integers
- **Architecture**: Centralized server indexes files, P2P transfers between clients

**Legal Notice**: This implementation is for educational purposes, historical protocol research, and OpenNap server compatibility testing. Do not use for copyright infringement.

## Historical Context

- **Launched**: June 1999 by Shawn Fanning (19-year-old college student)
- **Peak**: 80 million registered users (February 2001)
- **Shutdown**: July 2001 by court order (A&M Records, Inc. v. Napster, Inc.)
- **Legacy**: Inspired BitTorrent, Kazaa, Gnutella, LimeWire, and modern P2P protocols
- **Innovation**: First mainstream P2P file sharing with centralized search index

### Why Napster Mattered

1. **Democratized Music Access**: Made millions of songs instantly available
2. **Challenged Distribution Models**: Forced music industry to adapt (iTunes, Spotify)
3. **P2P Architecture**: Proved viability of hybrid centralized/decentralized systems
4. **Social Discovery**: Users browsed other users' libraries, discovering new music
5. **Technical Innovation**: Pioneered MP3 metadata indexing at scale

## Protocol Architecture

### Wire Format

Every OpenNap message uses this binary structure:

```
┌────────────────┬────────────────┬────────────────────────┐
│ Length (LE)    │ Type (LE)      │ Payload (ASCII/UTF-8)  │
│ 2 bytes        │ 2 bytes        │ variable length        │
└────────────────┴────────────────┴────────────────────────┘
```

- **Length**: Uint16 little-endian (payload byte count, excludes 4-byte header)
- **Type**: Uint16 little-endian (message type ID)
- **Payload**: ASCII or UTF-8 text (space-separated fields, quoted filenames)

**Example**: LOGIN message
```
Length: 0x0032 (50 bytes payload)
Type:   0x0002 (LOGIN = 2)
Payload: "testuser password123 0 \"PortOfCall/1.0\" 8"
```

### Message Types

| Type | Name           | Direction      | Description                                           |
|------|----------------|----------------|-------------------------------------------------------|
| 2    | LOGIN          | Client→Server  | Authenticate with username/password                   |
| 3    | LOGIN_ACK      | Server→Client  | Login successful (payload = email address)            |
| 5    | LOGIN_ERROR    | Server→Client  | Login failed (payload = error message)                |
| 6    | EMAIL          | Server→Client  | Email address notification (informational, ignored)   |
| 7    | USER_COUNT     | Server→Client  | Server stats: "users files gigabytes"                 |
| 200  | SEARCH         | Client→Server  | Search for files by filename/metadata                 |
| 201  | SEARCH_RESULT  | Server→Client  | Single search result (one per file)                   |
| 202  | SEARCH_END     | Server→Client  | Marks end of search results                           |
| 211  | BROWSE         | Client→Server  | Request all files shared by a user                    |
| 212  | BROWSE_RESULT  | Server→Client  | Single browse result (same format as SEARCH_RESULT)   |
| 213  | BROWSE_END     | Server→Client  | Marks end of browse results                           |
| 214  | STATS          | Bidirectional  | Query/response for server statistics                  |

**Note**: OpenNap protocol defines 100+ message types. This implementation only uses the subset needed for server probing, authentication, search, and browsing.

## Connection Flow

### 1. TCP Probe (Connect Only)

```
Client                                    Server
  │                                         │
  ├────────── TCP SYN ──────────────────→  │
  │ ←───────── TCP SYN-ACK ───────────────┤
  ├────────── TCP ACK ──────────────────→  │
  │                                         │
  │  [Connection established — RTT measured]│
  │                                         │
  ├────────── TCP FIN ──────────────────→  │
```

**Use Case**: Test if an OpenNap server is reachable without sending protocol messages.

**Endpoint**: `POST /api/napster/connect`

### 2. Login Flow

```
Client                                    Server
  │                                         │
  ├────── LOGIN (type 2) ─────────────────→│
  │   "user pass port \"client\" speed"     │
  │                                         │
  │ ←──── USER_COUNT (type 7) ─────────────┤  (optional)
  │       "1234 50000 100"                  │
  │                                         │
  │ ←──── EMAIL (type 6) ──────────────────┤  (optional)
  │       "user@example.com"                │
  │                                         │
  │ ←──── LOGIN_ACK (type 3) ──────────────┤  (success)
  │       "user@example.com"                │
  │                                         │
  │        OR                               │
  │                                         │
  │ ←──── LOGIN_ERROR (type 5) ────────────┤  (failure)
  │       "Invalid password"                │
```

**LOGIN Payload Format**: `nick password port "clientinfo" speed [email]`

| Field      | Description                                             | Example             |
|------------|---------------------------------------------------------|---------------------|
| nick       | Username (alphanumeric, hyphens, underscores)           | `testuser`          |
| password   | Password (plaintext — no encryption!)                   | `secret123`         |
| port       | Client's listening port for incoming transfers (0 = not sharing) | `0`        |
| clientinfo | Quoted client software identifier                       | `"PortOfCall/1.0"`  |
| speed      | Link speed code (see table below)                       | `8` (DSL)           |
| email      | Optional email for account registration                 | `user@example.com`  |

**Link Speed Codes**:

| Code | Speed      | Code | Speed      | Code | Speed  |
|------|------------|------|------------|------|--------|
| 0    | Unknown    | 4    | 57.6K      | 8    | DSL    |
| 1    | 14.4K      | 5    | 64K ISDN   | 9    | T1     |
| 2    | 28.8K      | 6    | 128K ISDN  | 10   | T3+    |
| 3    | 33.6K      | 7    | Cable      |      |        |

### 3. Search Flow

```
Client                                    Server
  │                                         │
  ├─── LOGIN (type 2) ────────────────────→│
  │ ←─ LOGIN_ACK (type 3) ─────────────────┤
  │                                         │
  ├─── SEARCH (type 200) ─────────────────→│
  │   FILENAME CONTAINS "nirvana" ...       │
  │                                         │
  │ ←─ SEARCH_RESULT (type 201) ───────────┤
  │    "song1.mp3" md5 3145728 128 44100 ... │
  │                                         │
  │ ←─ SEARCH_RESULT (type 201) ───────────┤
  │    "song2.mp3" md5 4194304 192 44100 ... │
  │                                         │
  │ ←─ SEARCH_END (type 202) ──────────────┤
```

**SEARCH Payload Format**:
```
FILENAME CONTAINS "query" MAX_RESULTS 20 LINESPEED "EQUAL TO" 0 BITRATE "EQUAL TO" 0 FREQ "EQUAL TO" 0 [TYPE "EQUAL TO" N]
```

**Search Constraints**:

| Field           | Operator      | Description                           |
|-----------------|---------------|---------------------------------------|
| FILENAME        | CONTAINS      | Substring match (case-insensitive)    |
| MAX_RESULTS     | (value)       | Limit result count (1-100)            |
| LINESPEED       | EQUAL TO      | Minimum link speed code (0 = any)     |
| BITRATE         | EQUAL TO      | Minimum bitrate kbps (0 = any)        |
| FREQ            | EQUAL TO      | Minimum sample rate Hz (0 = any)      |
| TYPE            | EQUAL TO      | File type code (optional, see table)  |

**File Type Codes**:

| Type | Code | Type | Code |
|------|------|------|------|
| mp3  | 0    | mov  | 2    |
| wav  | 1    | avi  | 3    |
| jpg  | 4    |      |      |

**SEARCH_RESULT Payload Format**:
```
"filename" md5 size bitrate freq length nick ip speed
```

| Field    | Type   | Description                              | Example        |
|----------|--------|------------------------------------------|----------------|
| filename | string | Quoted filename with extension           | `"song.mp3"`   |
| md5      | string | MD5 hash (32 hex chars)                  | `a1b2c3...`    |
| size     | int    | File size in bytes                       | `3145728`      |
| bitrate  | int    | Audio bitrate (kbps)                     | `128`          |
| freq     | int    | Sample rate (Hz)                         | `44100`        |
| length   | int    | Duration (seconds)                       | `180`          |
| nick     | string | Username sharing the file                | `alice`        |
| ip       | string | IP address (decimal or dotted)           | `192.168.1.50` |
| speed    | int    | Link speed code                          | `8`            |

### 4. Browse Flow

```
Client                                    Server
  │                                         │
  ├─── LOGIN (type 2) ────────────────────→│
  │ ←─ LOGIN_ACK (type 3) ─────────────────┤
  │                                         │
  ├─── BROWSE (type 211) ─────────────────→│
  │    "targetUsername"                     │
  │                                         │
  │ ←─ BROWSE_RESULT (type 212) ───────────┤  (one per file)
  │ ←─ BROWSE_RESULT (type 212) ───────────┤
  │ ←─ BROWSE_RESULT (type 212) ───────────┤
  │                                         │
  │ ←─ BROWSE_END (type 213) ──────────────┤
```

**BROWSE Payload**: Just the target username (no quotes)

**BROWSE_RESULT Format**: Identical to SEARCH_RESULT

### 5. Stats Query Flow

```
Client                                    Server
  │                                         │
  ├─── LOGIN (type 2) ────────────────────→│  (optional, most servers require it)
  │ ←─ LOGIN_ACK (type 3) ─────────────────┤
  │                                         │
  ├─── STATS (type 214) ──────────────────→│  (empty payload)
  │                                         │
  │ ←─ STATS (type 214) ───────────────────┤  "users files gigabytes"
  │    "1234 50000 100"                     │
```

**STATS/USER_COUNT Payload Format**: `users files gigabytes`

| Field     | Description                        | Example |
|-----------|------------------------------------|---------|
| users     | Online users count                 | `1234`  |
| files     | Total shared files count           | `50000` |
| gigabytes | Total shared data (GB, rounded)    | `100`   |

## API Endpoints

### POST /api/napster/connect

**Description**: Test TCP connectivity to OpenNap server (no protocol messages sent)

**Request Body**:
```json
{
  "host": "opennap.example.com",
  "port": 8888,
  "timeout": 15000
}
```

**Request Fields**:

| Field   | Type   | Required | Default | Description                        |
|---------|--------|----------|---------|-------------------------------------|
| host    | string | Yes      | —       | Server hostname or IP address      |
| port    | number | No       | 8888    | Server port (1-65535)              |
| timeout | number | No       | 15000   | Connection timeout (ms)            |

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "TCP connection established",
  "rtt": 45
}
```

**Response Fields**:

| Field   | Type    | Description                               |
|---------|---------|-------------------------------------------|
| success | boolean | Connection successful                     |
| host    | string  | Server hostname (echo of request)         |
| port    | number  | Server port (echo of request)             |
| message | string  | Human-readable status message             |
| rtt     | number  | Round-trip time (ms) for TCP handshake    |
| error   | string  | Error message (only if `success: false`)  |

**Error Response** (HTTP 400/500):
```json
{
  "success": false,
  "host": "opennap.example.com",
  "port": 8888,
  "error": "Connection timeout"
}
```

**Common Errors**:

| Error                     | Cause                                  |
|---------------------------|----------------------------------------|
| Host is required          | Missing `host` field                   |
| Port must be 1-65535      | Invalid port number                    |
| Connection timeout        | Server unreachable or not listening    |
| Connection refused        | Port closed or firewall blocking       |

### POST /api/napster/login

**Description**: Authenticate with OpenNap server using LOGIN (type 2) message

**Request Body**:
```json
{
  "host": "opennap.example.com",
  "port": 8888,
  "username": "testuser",
  "password": "secret123",
  "email": "user@example.com",
  "timeout": 15000
}
```

**Request Fields**:

| Field    | Type   | Required | Default | Description                         |
|----------|--------|----------|---------|--------------------------------------|
| host     | string | Yes      | —       | Server hostname or IP address       |
| username | string | Yes      | —       | Login username                      |
| password | string | Yes      | —       | Login password (sent in plaintext!) |
| port     | number | No       | 8888    | Server port                         |
| email    | string | No       | —       | Email (for account registration)    |
| timeout  | number | No       | 15000   | Total timeout (ms)                  |

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "testuser@example.com",
  "users": 1234,
  "rtt": 152
}
```

**Failure Response** (HTTP 200 with `success: false`):
```json
{
  "success": false,
  "host": "opennap.example.com",
  "port": 8888,
  "users": 1234,
  "error": "Login failed: Invalid password",
  "rtt": 148
}
```

**Response Fields**:

| Field   | Type    | Description                                      |
|---------|---------|--------------------------------------------------|
| success | boolean | Login successful (LOGIN_ACK received)            |
| host    | string  | Server hostname                                  |
| port    | number  | Server port                                      |
| message | string  | Server's LOGIN_ACK message (usually email)       |
| users   | number  | Online user count (from USER_COUNT message)      |
| rtt     | number  | Round-trip time (ms) from connect to login ack   |
| error   | string  | Error message (LOGIN_ERROR or timeout)           |

**Common Errors**:

| Error                                | Cause                              |
|--------------------------------------|------------------------------------|
| Username and password are required   | Missing credentials                |
| Login failed: Invalid password       | Wrong password                     |
| Login failed: Username already in use | Username already logged in       |
| Login timed out or was not acknowledged | Server not responding          |

### POST /api/napster/stats

**Description**: Query server statistics (users/files/gigabytes)

**Request Body**:
```json
{
  "host": "opennap.example.com",
  "port": 8888,
  "username": "testuser",
  "password": "secret123",
  "timeout": 15000
}
```

**Request Fields**:

| Field    | Type   | Required | Default | Description                               |
|----------|--------|----------|---------|-------------------------------------------|
| host     | string | Yes      | —       | Server hostname or IP address             |
| username | string | No       | —       | Login username (recommended)              |
| password | string | No       | —       | Login password (recommended)              |
| port     | number | No       | 8888    | Server port                               |
| timeout  | number | No       | 15000   | Total timeout (ms)                        |

**Note**: Most OpenNap servers require login before responding to STATS queries. Providing credentials is strongly recommended.

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "Server statistics retrieved",
  "users": 1234,
  "files": 50000,
  "gigabytes": 100,
  "rtt": 165
}
```

**Response Fields**:

| Field     | Type    | Description                               |
|-----------|---------|-------------------------------------------|
| success   | boolean | Stats retrieved successfully              |
| host      | string  | Server hostname                           |
| port      | number  | Server port                               |
| message   | string  | Human-readable status                     |
| users     | number  | Online users count                        |
| files     | number  | Total shared files count                  |
| gigabytes | number  | Total shared data (GB)                    |
| rtt       | number  | Round-trip time (ms)                      |
| error     | string  | Error message (if `success: false`)       |

**No Data Response** (HTTP 200 with `success: false`):
```json
{
  "success": false,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "No stats received (server may require login)",
  "rtt": 120
}
```

### POST /api/napster/search

**Description**: Search for files on OpenNap server

**Request Body**:
```json
{
  "host": "opennap.example.com",
  "port": 8888,
  "username": "testuser",
  "password": "secret123",
  "query": "nirvana",
  "fileType": "mp3",
  "timeout": 20000
}
```

**Request Fields**:

| Field    | Type   | Required | Default | Description                           |
|----------|--------|----------|---------|---------------------------------------|
| host     | string | Yes      | —       | Server hostname or IP address         |
| username | string | Yes      | —       | Login username                        |
| password | string | Yes      | —       | Login password                        |
| query    | string | Yes      | —       | Search query (filename substring)     |
| port     | number | No       | 8888    | Server port                           |
| fileType | string | No       | —       | File type filter (mp3/wav/mov/avi/jpg)|
| timeout  | number | No       | 20000   | Total timeout (ms)                    |

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "count": 2,
  "results": [
    {
      "filename": "Nirvana - Smells Like Teen Spirit.mp3",
      "size": 3145728,
      "bitrate": 128,
      "freq": 44100,
      "lengthSecs": 301
    },
    {
      "filename": "Nirvana - Come As You Are.mp3",
      "size": 2621440,
      "bitrate": 128,
      "freq": 44100,
      "lengthSecs": 258
    }
  ],
  "serverUserCount": 1234,
  "rtt": 1850
}
```

**Response Fields**:

| Field           | Type    | Description                                |
|-----------------|---------|--------------------------------------------|
| success         | boolean | Search completed successfully              |
| host            | string  | Server hostname                            |
| port            | number  | Server port                                |
| count           | number  | Number of results found                    |
| results         | array   | Search results (see table below)           |
| serverUserCount | number  | Online user count                          |
| rtt             | number  | Round-trip time (ms) from connect to end   |
| error           | string  | Error message (if `success: false`)        |

**Result Object Fields**:

| Field      | Type   | Description                        |
|------------|--------|------------------------------------|
| filename   | string | File name with extension           |
| size       | number | File size (bytes)                  |
| bitrate    | number | Audio bitrate (kbps)               |
| freq       | number | Sample rate (Hz)                   |
| lengthSecs | number | Duration (seconds)                 |

**No Results Response** (HTTP 200 with `count: 0`):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "count": 0,
  "results": [],
  "serverUserCount": 1234,
  "rtt": 1200
}
```

**Common Errors**:

| Error                      | Cause                          |
|----------------------------|--------------------------------|
| query is required          | Missing search query           |
| Login failed: ...          | Authentication failed          |
| Connection timeout         | Server slow or unresponsive    |

### POST /api/napster/browse

**Description**: Browse all files shared by a specific user

**Request Body**:
```json
{
  "host": "opennap.example.com",
  "port": 8888,
  "username": "testuser",
  "password": "secret123",
  "targetUser": "alice",
  "timeout": 20000
}
```

**Request Fields**:

| Field      | Type   | Required | Default | Description                        |
|------------|--------|----------|---------|------------------------------------|
| host       | string | Yes      | —       | Server hostname or IP address      |
| username   | string | Yes      | —       | Login username                     |
| password   | string | Yes      | —       | Login password                     |
| targetUser | string | Yes      | —       | Username to browse files from      |
| port       | number | No       | 8888    | Server port                        |
| timeout    | number | No       | 20000   | Total timeout (ms)                 |

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "targetUser": "alice",
  "count": 142,
  "files": [
    {
      "filename": "Beatles - Hey Jude.mp3",
      "size": 4194304,
      "bitrate": 192,
      "freq": 44100,
      "lengthSecs": 431
    },
    {
      "filename": "Queen - Bohemian Rhapsody.mp3",
      "size": 5242880,
      "bitrate": 192,
      "freq": 44100,
      "lengthSecs": 354
    }
  ],
  "rtt": 2340
}
```

**Response Fields**:

| Field      | Type    | Description                                  |
|------------|---------|----------------------------------------------|
| success    | boolean | Browse completed successfully                |
| host       | string  | Server hostname                              |
| port       | number  | Server port                                  |
| targetUser | string  | Username browsed                             |
| count      | number  | Number of files shared by user               |
| files      | array   | File list (same format as search results)    |
| rtt        | number  | Round-trip time (ms)                         |
| error      | string  | Error message (if `success: false`)          |

**Empty Library Response** (HTTP 200 with `count: 0`):
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "targetUser": "bob",
  "count": 0,
  "files": [],
  "rtt": 980
}
```

**Common Errors**:

| Error                      | Cause                          |
|----------------------------|--------------------------------|
| targetUser is required     | Missing target username        |
| Login failed: ...          | Authentication failed          |
| Connection timeout         | Server slow or user has many files |

## curl Examples

### Test TCP Connectivity

```bash
curl -X POST http://localhost:8787/api/napster/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "timeout": 10000
  }'
```

**Expected Output**:
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "TCP connection established",
  "rtt": 45
}
```

### Authenticate with OpenNap Server

```bash
curl -X POST http://localhost:8787/api/napster/login \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "username": "testuser",
    "password": "secret123",
    "timeout": 15000
  }'
```

**Expected Output**:
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "testuser@example.com",
  "users": 1234,
  "rtt": 152
}
```

### Query Server Statistics

```bash
curl -X POST http://localhost:8787/api/napster/stats \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "username": "testuser",
    "password": "secret123",
    "timeout": 15000
  }'
```

**Expected Output**:
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "message": "Server statistics retrieved",
  "users": 1234,
  "files": 50000,
  "gigabytes": 100,
  "rtt": 165
}
```

### Search for MP3 Files

```bash
curl -X POST http://localhost:8787/api/napster/search \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "username": "testuser",
    "password": "secret123",
    "query": "nirvana smells like",
    "fileType": "mp3",
    "timeout": 20000
  }'
```

**Expected Output**:
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "count": 5,
  "results": [
    {
      "filename": "Nirvana - Smells Like Teen Spirit.mp3",
      "size": 3145728,
      "bitrate": 128,
      "freq": 44100,
      "lengthSecs": 301
    }
  ],
  "serverUserCount": 1234,
  "rtt": 1850
}
```

### Browse User's Shared Files

```bash
curl -X POST http://localhost:8787/api/napster/browse \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "username": "testuser",
    "password": "secret123",
    "targetUser": "alice",
    "timeout": 20000
  }'
```

**Expected Output**:
```json
{
  "success": true,
  "host": "opennap.example.com",
  "port": 8888,
  "targetUser": "alice",
  "count": 142,
  "files": [
    {
      "filename": "Beatles - Hey Jude.mp3",
      "size": 4194304,
      "bitrate": 192,
      "freq": 44100,
      "lengthSecs": 431
    }
  ],
  "rtt": 2340
}
```

### Search with Special Characters

```bash
curl -X POST http://localhost:8787/api/napster/search \
  -H "Content-Type: application/json" \
  -d '{
    "host": "opennap.example.com",
    "port": 8888,
    "username": "testuser",
    "password": "secret123",
    "query": "AC/DC \"Back in Black\"",
    "timeout": 20000
  }'
```

**Note**: Quotes in query are automatically escaped to prevent OpenNap command injection.

## Implementation Quirks and Limitations

### 1. No TLS/Encryption

**Issue**: All traffic is plaintext TCP — passwords and data are transmitted unencrypted.

**Impact**: Credentials can be intercepted by network eavesdroppers (MitM attacks).

**Workaround**: Use only for educational/testing purposes. Never use production passwords.

**Historical Context**: Original Napster (1999-2001) predates modern security practices. TLS 1.0 was released in 1999 but wasn't widely adopted until mid-2000s.

### 2. Timeout Shared Across Login and Query

**Issue**: The `timeout` parameter is split between login and the subsequent operation (search/browse/stats). If login takes 10 seconds with a 15-second timeout, the query gets only 5 seconds.

**Example**:
```javascript
// STATS endpoint with 15s timeout
const loginTime = 8000;      // Login takes 8 seconds
const statsTimeout = 15000 - loginTime; // Stats query gets 7 seconds max
```

**Impact**: Slow login servers cause premature timeout on query operations.

**Workaround**: Use larger timeout values (25000-30000ms) for search/browse on slow servers.

### 3. Message Length Safety Limit (1MB)

**Issue**: Implementation rejects any OpenNap message with `length` field > 1MB to prevent memory exhaustion attacks.

**Protection**:
```typescript
if (len > 1024 * 1024) {
  throw new Error(`OpenNap message length ${len} exceeds 1MB safety limit`);
}
```

**Impact**: Extremely rare — legitimate OpenNap messages are typically < 1KB. Only malicious servers or corrupted data would trigger this.

**Historical Context**: OpenNap protocol doesn't specify a maximum message length. This limit was added during code review (2026-02-18) as a security hardening measure.

### 4. Search Query Quote Escaping

**Issue**: Search queries containing double quotes (`"`) are escaped to `\"` to prevent OpenNap command injection.

**Example**:
```typescript
// User query: AC/DC "Back in Black"
// Escaped:    AC/DC \"Back in Black\"
// Final:      FILENAME CONTAINS "AC/DC \"Back in Black\"" MAX_RESULTS 20 ...
```

**Impact**: None for users — transparent fix prevents malicious queries like `" MAX_RESULTS 999999` from manipulating the SEARCH command.

**Security**: This fix was added during code review (2026-02-18) to prevent protocol-level injection attacks.

### 5. No Connection Reuse

**Issue**: Every API call creates a new TCP connection, authenticates, performs the operation, and closes.

**Impact**: Higher latency for multiple operations. Network overhead from repeated TCP handshakes and logins.

**Workaround**: Use `/api/napster/search` or `/api/napster/browse` for comprehensive queries instead of multiple calls.

**Why**: Cloudflare Workers don't support long-lived TCP connections across multiple HTTP requests. Each HTTP request gets a fresh Worker instance.

### 6. parseSearchResult Returns Null on Malformed Data

**Issue**: If a SEARCH_RESULT/BROWSE_RESULT payload doesn't match expected format, `parseSearchResult()` returns `null`.

**Protection**: Null results are silently skipped — they don't crash the handler or corrupt the result array.

```typescript
const parsed = parseSearchResult(msg.data);
if (parsed) results.push(parsed);  // null results ignored
```

**Impact**: Malformed results are silently dropped. Result count may be lower than server claimed.

**Server Behavior**: OpenNap servers vary in result format. Some use unquoted filenames, different field orders, or omit fields.

### 7. No Username/Password Validation

**Issue**: Implementation doesn't validate username or password format before sending LOGIN.

**Impact**: Invalid characters (e.g., spaces in username) are sent to server, which rejects with LOGIN_ERROR.

**Historical Context**: OpenNap servers have inconsistent username rules. Some allow spaces, others don't. Some require email-like usernames, others don't.

**Workaround**: Server rejection message is returned in error field — users see the server's validation rules.

### 8. No File Transfer Support

**Issue**: Implementation only handles the indexing/search protocol. Actual file transfers (P2P between clients) are not supported.

**Why**: Cloudflare Workers can't act as a file server — no persistent storage, no inbound TCP connections.

**Historical Context**: In original Napster, the server was only an index. File transfers happened directly between clients (P2P).

**Workaround**: Use this implementation for server discovery, authentication testing, and file metadata search. Use a native Napster/OpenNap client for downloads.

### 9. Fallback Search Result Parser

**Issue**: `parseSearchResult()` has two parsing modes:
1. Quoted filename format: `"filename" md5 size ...`
2. Space-separated fallback: `filename md5 size ...`

**Why**: OpenNap servers use different result formats. Some quote filenames with spaces, others don't.

**Impact**: Filenames with spaces may be truncated in fallback mode:
```
// Quoted mode (correct):
"AC/DC - Back in Black.mp3" md5 3145728 192 44100 180

// Fallback mode (broken):
AC/DC size=0 bitrate=3145728 freq=192 lengthSecs=44100
```

**Mitigation**: Quoted mode tried first. Fallback only used if regex match fails.

### 10. USER_COUNT vs STATS Response Handling

**Issue**: Server statistics come from two different message types:
- **USER_COUNT (type 7)**: Sent automatically after login
- **STATS (type 214)**: Response to explicit STATS query

**Behavior**: Implementation treats both identically — they use the same `"users files gigabytes"` payload format.

**Edge Case**: Some servers send USER_COUNT but not STATS (or vice versa). The `/api/napster/stats` endpoint accepts either.

### 11. No Server Version Detection

**Issue**: OpenNap protocol has multiple variants (OpenNap 1.0, OpenNap 2.0, custom forks). Implementation doesn't detect server version.

**Impact**: Rare incompatibilities with exotic servers. Most OpenNap servers use compatible message types.

**Workaround**: If a server doesn't respond to LOGIN (type 2), it may be using a different protocol entirely (e.g., Gnutella, eDonkey).

### 12. No Rate Limiting or Abuse Protection

**Issue**: Implementation doesn't rate-limit requests. A user could hammer `/api/napster/search` with thousands of queries.

**Impact**: Could overwhelm OpenNap server or violate server ToS.

**Mitigation**: Deploy behind Cloudflare rate limiting rules:
```
Rate limit: 10 requests per minute per IP for /api/napster/*
```

### 13. Error Responses Use HTTP 200

**Issue**: Login failures, timeout errors, and "no stats received" all return HTTP 200 with `success: false` in JSON body.

**Example**:
```json
{
  "success": false,
  "error": "Login failed: Invalid password"
}
```

**Why**: These aren't HTTP errors — the Worker successfully communicated with the server. The OpenNap protocol layer failed.

**Contrast**: HTTP 400 is used for invalid request payloads (missing `host`, invalid `port`). HTTP 500 is used for Worker crashes or network errors.

### 14. RTT Measurement Includes Login Time

**Issue**: The `rtt` field in `/api/napster/search` and `/api/napster/browse` responses includes login time + query time.

**Example**:
```
Total RTT: 1850ms
  - TCP connect: 45ms
  - Login: 150ms
  - Search: 1655ms
```

**Impact**: RTT is not a pure protocol latency measurement — it's wall-clock time from start to finish.

**Workaround**: Use `/api/napster/connect` for TCP-only RTT, `/api/napster/login` for login-only RTT.

## Security Considerations

### 1. Plaintext Credentials

**Risk**: Username and password are sent unencrypted over TCP.

**Attack Vector**: Network sniffing (Wireshark, tcpdump) on local network or upstream ISP.

**Mitigation**:
- Never use production passwords with OpenNap
- Use disposable test accounts only
- Consider SSH tunneling for server administration

**Historical Context**: Napster era (1999-2001) predates widespread HTTPS adoption. Many protocols (FTP, Telnet, HTTP) used plaintext auth.

### 2. No Server Certificate Validation

**Risk**: No TLS means no server identity verification — MitM attacks trivial.

**Attack Vector**: ARP spoofing, DNS hijacking, BGP hijacking could redirect traffic to malicious server.

**Mitigation**: Use OpenNap only in trusted network environments (localhost, VPN).

### 3. OpenNap Command Injection (Fixed)

**Risk**: Search queries with unescaped quotes could manipulate SEARCH command.

**Example Attack**:
```json
{
  "query": "\" MAX_RESULTS 999999 FILENAME CONTAINS \""
}
```

**Result Before Fix**:
```
FILENAME CONTAINS "" MAX_RESULTS 999999 FILENAME CONTAINS "" MAX_RESULTS 20 ...
```

**Fix Applied** (2026-02-18):
```typescript
const escapedQuery = query.replace(/"/g, '\\"');
```

**Impact**: Quotes are now escaped to `\"` — injection impossible.

### 4. Resource Exhaustion via Large Messages

**Risk**: Malicious server sends `length: 0xFFFF` (65535 bytes) to exhaust Worker memory.

**Fix Applied** (2026-02-18):
```typescript
if (len > 1024 * 1024) {
  throw new Error(`OpenNap message length ${len} exceeds 1MB safety limit`);
}
```

**Impact**: Messages > 1MB trigger error, connection closed, Worker memory protected.

### 5. No Request Rate Limiting

**Risk**: Abuse of `/api/napster/search` could flood OpenNap servers.

**Mitigation**: Deploy Cloudflare rate limiting rules at edge:
```
Rule: /api/napster/* → 10 req/min per IP → 429 Too Many Requests
```

### 6. Socket Resource Leaks (Fixed)

**Risk**: If an error occurs after acquiring reader/writer locks, original code called `socket.close()` without releasing locks first.

**Fix Applied** (2026-02-18):
```typescript
try {
  socket.close();
} catch {
  // Ignore close errors
}
```

**Impact**: Socket close errors (rare) no longer propagate as unhandled exceptions.

## Testing and Debugging

### Public OpenNap Servers (Historical)

**Warning**: Most public OpenNap servers are defunct. Original Napster shut down in 2001. Modern OpenNap servers are rare and often underground.

**Educational Alternatives**:
- Run your own OpenNap server locally (gnunet-napster, opennap-ng)
- Use packet captures from historical datasets
- Test with mock servers that implement OpenNap protocol subset

### Wireshark Packet Analysis

**Capture Filter** (only OpenNap traffic):
```
tcp.port == 8888
```

**Display Filter** (show LOGIN messages):
```
tcp.port == 8888 && tcp.payload[2:2] == 02:00
```

**Decode OpenNap Message**:
1. Right-click TCP payload → Copy → Hex Stream
2. First 4 bytes: `3200 0200` → length=50 (0x0032), type=2 (0x0002)
3. Remaining bytes: ASCII payload

**Example Packet**:
```
0000: 32 00 02 00 74 65 73 74 75 73 65 72 20 70 61 73  2...testuser pas
0010: 73 77 6f 72 64 20 30 20 22 50 6f 72 74 4f 66 43  sword 0 "PortOfC
0020: 61 6c 6c 2f 31 2e 30 22 20 38                    all/1.0" 8
```

Decoded:
- Length: 50 bytes
- Type: 2 (LOGIN)
- Payload: `testuser password 0 "PortOfCall/1.0" 8`

### Test Server Setup (Local)

**Option 1: Docker OpenNap Server**
```bash
docker run -p 8888:8888 opennap/server
```

**Option 2: Build from Source**
```bash
git clone https://github.com/opennap/opennap.git
cd opennap
./configure --prefix=/usr/local
make
sudo make install
opennap --port 8888
```

**Configuration** (`opennap.conf`):
```
port 8888
max_users 100
server_name "Test OpenNap Server"
```

**Test Connectivity**:
```bash
curl -X POST http://localhost:8787/api/napster/connect \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":8888}'
```

### Common Server Responses

**LOGIN_ACK** (type 3):
```
Length: 0x0014 (20 bytes)
Type:   0x0003
Payload: "testuser@example.com"
```

**LOGIN_ERROR** (type 5):
```
Length: 0x0010 (16 bytes)
Type:   0x0005
Payload: "Invalid password"
```

**USER_COUNT** (type 7):
```
Length: 0x000E (14 bytes)
Type:   0x0007
Payload: "1234 50000 100"
```

**SEARCH_END** (type 202):
```
Length: 0x0000 (0 bytes)
Type:   0x00CA
Payload: (empty)
```

## References

### Official Documentation

- **OpenNap Protocol Specification**: http://opennap.sourceforge.net/napster.txt
- **Napster Protocol Documentation**: http://opennap.sourceforge.net/
- **OpenNap Message Types**: http://opennap.sourceforge.net/protocol.html

### Historical Resources

- **A&M Records v. Napster (2001)**: https://www.eff.org/cases/am-records-inc-v-napster-inc
- **Napster Wikipedia**: https://en.wikipedia.org/wiki/Napster
- **Shawn Fanning Interview**: https://www.wired.com/2000/10/napster-shawn-fanning/

### Technical References

- **Little-Endian Byte Order**: https://en.wikipedia.org/wiki/Endianness
- **MD5 Hash**: https://datatracker.ietf.org/doc/html/rfc1321

### Alternative P2P Protocols

- **Gnutella**: Decentralized P2P (no central server)
- **BitTorrent**: Torrent-based file sharing
- **eDonkey2000**: Hybrid P2P with server indexing
- **Kazaa**: FastTrack protocol (post-Napster)

## Changelog

- **2026-02-18**: Initial power-user documentation created
- **2026-02-18**: Fixed OpenNap command injection in search query (quote escaping)
- **2026-02-18**: Fixed message length safety limit (1MB max) to prevent memory exhaustion
- **2026-02-18**: Fixed socket close error handling (try-catch wrapper)
- **2026-02-18**: Fixed buffer allocation in `decodeOpenNapMessages` (fresh DataView)
- **2026-02-18**: Documented all 14 implementation quirks and limitations
- **2026-02-18**: Added comprehensive curl examples and Wireshark debugging guide
