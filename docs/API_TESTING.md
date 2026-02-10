# API Testing Guide

This guide provides curl commands to test all Port of Call API endpoints.

## FTP Protocol Endpoints

All FTP operations have been implemented and tested against public FTP test servers.

### Test FTP Connection

**Using Query Parameters (GET)**:
```bash
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.dlptest.com&port=21&username=dlpuser@dlptest.com&password=SzMf7rTE4pCrf9dV286GuNe4N"
```

**Using JSON Body (POST)**:
```bash
curl -X POST https://portofcall.ross.gg/api/ftp/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Connected successfully",
  "currentDirectory": "/"
}
```

### List FTP Directory

**Using Query Parameters (GET)**:
```bash
curl "https://portofcall.ross.gg/api/ftp/list?host=ftp.dlptest.com&port=21&username=dlpuser@dlptest.com&password=SzMf7rTE4pCrf9dV286GuNe4N&path=/"
```

**Using JSON Body (POST)**:
```bash
curl -X POST https://portofcall.ross.gg/api/ftp/list \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N",
    "path": "/"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "path": "/",
  "files": [
    {
      "name": "file.txt",
      "size": 1024,
      "type": "file",
      "modified": "Jan 01 12:00"
    }
  ]
}
```

### Upload File to FTP Server

**Using curl with file upload**:
```bash
curl -X POST https://portofcall.ross.gg/api/ftp/upload \
  -F "host=ftp.dlptest.com" \
  -F "port=21" \
  -F "username=dlpuser@dlptest.com" \
  -F "password=SzMf7rTE4pCrf9dV286GuNe4N" \
  -F "remotePath=/test-upload.txt" \
  -F "file=@/path/to/local/file.txt"
```

**Using Node.js**:
```javascript
const fs = require('fs');
const formData = new FormData();
formData.append('host', 'ftp.dlptest.com');
formData.append('port', '21');
formData.append('username', 'dlpuser@dlptest.com');
formData.append('password', 'SzMf7rTE4pCrf9dV286GuNe4N');
formData.append('remotePath', '/test-upload.txt');
formData.append('file', fs.createReadStream('./test.txt'));

fetch('https://portofcall.ross.gg/api/ftp/upload', {
  method: 'POST',
  body: formData
}).then(r => r.json()).then(console.log);
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Uploaded file.txt to /test-upload.txt",
  "size": 1024
}
```

### Download File from FTP Server

**Using Query Parameters (GET)**:
```bash
curl "https://portofcall.ross.gg/api/ftp/download?host=ftp.dlptest.com&port=21&username=dlpuser@dlptest.com&password=SzMf7rTE4pCrf9dV286GuNe4N&remotePath=/test.txt" \
  -o downloaded-file.txt
```

**Using JSON Body (POST)**:
```bash
curl -X POST https://portofcall.ross.gg/api/ftp/download \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N",
    "remotePath": "/test.txt"
  }' \
  -o downloaded-file.txt
```

**Expected Response**: Binary file content with appropriate headers

### Delete File from FTP Server

```bash
curl -X POST https://portofcall.ross.gg/api/ftp/delete \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N",
    "remotePath": "/test-upload.txt"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Deleted /test-upload.txt"
}
```

### Create Directory on FTP Server

```bash
curl -X POST https://portofcall.ross.gg/api/ftp/mkdir \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N",
    "dirPath": "/test-directory"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Created directory /test-directory"
}
```

### Rename File or Directory

```bash
curl -X POST https://portofcall.ross.gg/api/ftp/rename \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ftp.dlptest.com",
    "port": 21,
    "username": "dlpuser@dlptest.com",
    "password": "SzMf7rTE4pCrf9dV286GuNe4N",
    "fromPath": "/old-name.txt",
    "toPath": "/new-name.txt"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Renamed /old-name.txt to /new-name.txt"
}
```

## SSH Protocol Endpoints

### Test SSH Connection

**Using Query Parameters (GET)**:
```bash
curl "https://portofcall.ross.gg/api/ssh/connect?host=test.rebex.net&port=22"
```

**Using JSON Body (POST)**:
```bash
curl -X POST https://portofcall.ross.gg/api/ssh/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "test.rebex.net",
    "port": 22,
    "username": "demo",
    "password": "password"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "SSH server reachable",
  "banner": "SSH-2.0-Rebex-SSH-5.0.7892.0",
  "note": "Full SSH requires WebSocket connection. Use WebSocket upgrade for interactive sessions."
}
```

### WebSocket SSH Connection

For interactive SSH sessions, use WebSocket:

```bash
# Using websocat tool
websocat "wss://portofcall.ross.gg/api/ssh/connect?host=test.rebex.net&port=22"

# Using wscat tool
wscat -c "wss://portofcall.ross.gg/api/ssh/connect?host=test.rebex.net&port=22"
```

## TCP Ping Endpoint

Test basic TCP connectivity:

```bash
curl -X POST https://portofcall.ross.gg/api/ping \
  -H "Content-Type: application/json" \
  -d '{
    "host": "google.com",
    "port": 443
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "host": "google.com",
  "port": 443,
  "rtt": 42,
  "message": "TCP Ping Success: 42ms"
}
```

## WHOIS Protocol Endpoint

### Lookup Domain Registration

```bash
curl -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "google.com",
    "timeout": 10000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "domain": "google.com",
  "server": "whois.verisign-grs.com",
  "response": "   Domain Name: GOOGLE.COM\n   Registry Domain ID: ..."
}
```

**With explicit server override**:
```bash
curl -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "wikipedia.org",
    "server": "whois.pir.org",
    "port": 43,
    "timeout": 10000
  }'
```

**Auto-selected WHOIS servers by TLD**: `.com`/`.net` → verisign, `.org` → pir.org, `.edu` → educause, `.gov` → dotgov.gov, `.uk` → nic.uk, `.de` → denic.de, `.jp` → jprs.jp

## Syslog Protocol Endpoint

### Send Syslog Message (RFC 5424)

```bash
curl -X POST https://portofcall.ross.gg/api/syslog/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "syslog.example.com",
    "port": 514,
    "severity": 6,
    "facility": 16,
    "message": "Application started successfully",
    "hostname": "web-server-01",
    "appName": "myapp",
    "format": "rfc5424",
    "timeout": 5000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Syslog message sent successfully",
  "formatted": "<134>1 2026-02-09T12:00:00.000Z web-server-01 myapp - - - Application started successfully"
}
```

**Priority = (Facility x 8) + Severity**. Example: facility 16 (Local0) + severity 6 (Info) = priority 134.

**Legacy BSD format (RFC 3164)**:
```bash
curl -X POST https://portofcall.ross.gg/api/syslog/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "syslog.example.com",
    "severity": 4,
    "facility": 4,
    "message": "Failed password for root from 10.0.2.2 port 4791 ssh2",
    "hostname": "bastion-01",
    "appName": "sshd",
    "format": "rfc3164"
  }'
```

## SOCKS4 Proxy Endpoint

### Test SOCKS4 Proxy Connection

```bash
curl -X POST https://portofcall.ross.gg/api/socks4/connect \
  -H "Content-Type: application/json" \
  -d '{
    "proxyHost": "proxy.example.com",
    "proxyPort": 1080,
    "destHost": "example.com",
    "destPort": 80,
    "userId": "",
    "useSocks4a": true,
    "timeout": 10000
  }'
```

**Expected Response (if proxy grants)**:
```json
{
  "success": true,
  "granted": true,
  "responseCode": 90,
  "responseMessage": "Request granted",
  "boundAddress": "0.0.0.0",
  "boundPort": 0
}
```

## Daytime Protocol Endpoint (RFC 867)

### Get Human-Readable Time

```bash
curl -X POST https://portofcall.ross.gg/api/daytime/get \
  -H "Content-Type: application/json" \
  -d '{
    "host": "time.nist.gov",
    "port": 13,
    "timeout": 10000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "time": "60444 26-02-09 17:00:00 00 0 0 0.0 UTC(NIST) *",
  "localTime": "2026-02-09T17:00:00.123Z",
  "localTimestamp": 1770613200123,
  "offsetMs": -42
}
```

## Finger Protocol Endpoint (RFC 1288)

### Query User Information

```bash
curl -X POST https://portofcall.ross.gg/api/finger/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "finger.example.com",
    "port": 79,
    "username": "admin",
    "timeout": 10000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "query": "admin",
  "response": "Login: admin\nName: System Administrator\n..."
}
```

**With remote host forwarding** (user@host):
```bash
curl -X POST https://portofcall.ross.gg/api/finger/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "gateway.example.com",
    "username": "john",
    "remoteHost": "internal.example.com"
  }'
```

## Time Protocol Endpoint (RFC 868)

### Get Binary Time

```bash
curl -X POST https://portofcall.ross.gg/api/time/get \
  -H "Content-Type: application/json" \
  -d '{
    "host": "time.nist.gov",
    "port": 37,
    "timeout": 10000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "raw": 3978691200,
  "unixTimestamp": 1769702400,
  "date": "2026-01-29T00:00:00.000Z",
  "localTime": "2026-01-29T00:00:00.123Z",
  "localTimestamp": 1769702400123,
  "offsetMs": -42
}
```

The `raw` field is seconds since 1900-01-01 (RFC 868 epoch). `unixTimestamp` subtracts the 70-year offset (2,208,988,800 seconds).

## Echo Protocol Endpoint

### Test TCP Echo

```bash
curl -X POST https://portofcall.ross.gg/api/echo/test \
  -H "Content-Type: application/json" \
  -d '{
    "host": "tcpbin.com",
    "port": 4242,
    "message": "Hello, World!",
    "timeout": 10000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "sent": "Hello, World!",
  "received": "Hello, World!",
  "match": true
}
```

## Public Test Servers

### FTP Test Servers

1. **DLP Test FTP**:
   - Host: `ftp.dlptest.com`
   - Port: `21`
   - Username: `dlpuser@dlptest.com`
   - Password: `SzMf7rTE4pCrf9dV286GuNe4N`
   - Features: Read-only access, passive mode supported

2. **Rebex FTP**:
   - Host: `test.rebex.net`
   - Port: `21`
   - Username: `demo`
   - Password: `password`
   - Features: Read-only access

### SSH Test Servers

1. **Rebex SSH**:
   - Host: `test.rebex.net`
   - Port: `22`
   - Username: `demo`
   - Password: `password`
   - Features: SSH2, read-only access

### WHOIS Test Targets

Domains with stable, well-known WHOIS records:
- `google.com` → `whois.verisign-grs.com` (port 43)
- `wikipedia.org` → `whois.pir.org` (port 43)
- `mit.edu` → `whois.educause.edu` (port 43)
- `example.com` → `whois.verisign-grs.com` (port 43)

### Daytime / Time Test Servers

1. **NIST Internet Time Service**:
   - Host: `time.nist.gov`
   - Daytime port: `13` (RFC 867, human-readable ASCII)
   - Time port: `37` (RFC 868, binary 32-bit)
   - Features: Legacy time protocols, still operational

### Echo Test Servers

1. **tcpbin.com**:
   - Host: `tcpbin.com`
   - Port: `4242`
   - Features: Echoes back any TCP data; may rate-limit under heavy load

### MQTT Test Brokers

1. **HiveMQ**: `broker.hivemq.com:1883` (no auth)
2. **EMQX**: `broker.emqx.io:1883` (user: `emqx`, pass: `public`)
3. **Mosquitto**: `test.mosquitto.org:1883` (no auth), `1884` (user: `rw`, pass: `readwrite`)

### LDAP Test Server

1. **ForumSys**: `ldap.forumsys.com:389` (bind DN: `cn=read-only-admin,dc=example,dc=com`, pass: `password`)

## Error Handling

### Missing Parameters
```bash
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.example.com"
# Returns 400 Bad Request
```

### Invalid Credentials
```bash
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.dlptest.com&port=21&username=wrong&password=wrong"
# Returns 500 with error message
```

### Connection Timeout
```bash
curl "https://portofcall.ross.gg/api/ftp/connect?host=nonexistent.example.com&port=21&username=user&password=pass"
# Returns 500 with connection error
```

## Performance Testing

### Measure Round-Trip Time
```bash
time curl -X POST https://portofcall.ross.gg/api/ping \
  -H "Content-Type: application/json" \
  -d '{"host": "google.com", "port": 443}'
```

### Test Smart Placement

Connect to servers in different regions to test Smart Placement migration:

```bash
# US East server
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.us-east.example.com&..."

# Europe server
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.eu-west.example.com&..."
```

After repeated requests to the same region, workers migrate closer, reducing latency.

## Debugging

### View Response Headers
```bash
curl -i "https://portofcall.ross.gg/api/ftp/connect?host=ftp.dlptest.com&..."
```

### Verbose Output
```bash
curl -v "https://portofcall.ross.gg/api/ftp/connect?host=ftp.dlptest.com&..."
```

### Pretty Print JSON
```bash
curl "https://portofcall.ross.gg/api/ftp/connect?host=ftp.dlptest.com&..." | jq
```

## Rate Limiting

Cloudflare Workers have the following limits:
- 100,000 requests/day (free tier)
- 10ms CPU time per request
- 128MB memory per request
- 30 seconds max execution time

For production use, implement rate limiting and authentication.

## Security Notes

⚠️ **Warning**: These endpoints are public and unauthenticated for demo purposes.

For production deployments:
1. Add API authentication (API keys, OAuth)
2. Implement rate limiting
3. Whitelist allowed destination hosts
4. Add request logging and monitoring
5. Use environment variables for sensitive data
