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

## DNS Protocol Endpoint

### Query DNS Records

```bash
# A record via Google DNS
curl -X POST https://portofcall.ross.gg/api/dns/query \
  -H "Content-Type: application/json" \
  -d '{"domain": "google.com", "type": "A", "server": "8.8.8.8"}'

# MX records via Cloudflare DNS
curl -X POST https://portofcall.ross.gg/api/dns/query \
  -H "Content-Type: application/json" \
  -d '{"domain": "gmail.com", "type": "MX", "server": "1.1.1.1"}'

# TXT records (SPF)
curl -X POST https://portofcall.ross.gg/api/dns/query \
  -H "Content-Type: application/json" \
  -d '{"domain": "google.com", "type": "TXT", "server": "9.9.9.9"}'
```

## Gopher Protocol Endpoint (RFC 1436)

```bash
curl -X POST https://portofcall.ross.gg/api/gopher/fetch \
  -H "Content-Type: application/json" \
  -d '{"host": "gopher.floodgap.com", "port": 70, "selector": ""}'
```

## Gemini Protocol Endpoint

```bash
curl -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "gemini://geminiprotocol.net/"}'
```

## IRC Protocol Endpoint (RFC 2812)

```bash
curl -X POST https://portofcall.ross.gg/api/irc/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "irc.libera.chat", "port": 6667, "nickname": "portofcall_test"}'
```

## NNTP Protocol Endpoint (RFC 3977)

```bash
# Connect
curl -X POST https://portofcall.ross.gg/api/nntp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "nntp.aioe.org", "port": 119}'

# Select newsgroup
curl -X POST https://portofcall.ross.gg/api/nntp/group \
  -H "Content-Type: application/json" \
  -d '{"host": "nntp.aioe.org", "group": "comp.lang.python"}'
```

## Memcached Protocol Endpoint

```bash
# Connection test
curl -X POST https://portofcall.ross.gg/api/memcached/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "memcached.example.com", "port": 11211}'

# Run command
curl -X POST https://portofcall.ross.gg/api/memcached/command \
  -H "Content-Type: application/json" \
  -d '{"host": "memcached.example.com", "command": "stats"}'

# Get stats
curl -X POST https://portofcall.ross.gg/api/memcached/stats \
  -H "Content-Type: application/json" \
  -d '{"host": "memcached.example.com"}'
```

## STOMP Protocol Endpoint

```bash
# Connect to broker
curl -X POST https://portofcall.ross.gg/api/stomp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "broker.example.com", "port": 61613}'

# Send message
curl -X POST https://portofcall.ross.gg/api/stomp/send \
  -H "Content-Type: application/json" \
  -d '{"host": "broker.example.com", "destination": "/queue/test", "body": "Hello"}'
```

## SOCKS5 Proxy Endpoint (RFC 1928)

```bash
curl -X POST https://portofcall.ross.gg/api/socks5/connect \
  -H "Content-Type: application/json" \
  -d '{
    "proxyHost": "proxy.example.com",
    "proxyPort": 1080,
    "destHost": "example.com",
    "destPort": 80
  }'
```

## Modbus Protocol Endpoint (ICS/SCADA)

```bash
# Connection test
curl -X POST https://portofcall.ross.gg/api/modbus/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "plc.example.com", "port": 502, "unitId": 1}'

# Read holding registers
curl -X POST https://portofcall.ross.gg/api/modbus/read \
  -H "Content-Type: application/json" \
  -d '{"host": "plc.example.com", "functionCode": 3, "address": 0, "quantity": 10}'
```

## MongoDB Protocol Endpoint

```bash
# Connection test
curl -X POST https://portofcall.ross.gg/api/mongodb/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "mongo.example.com", "port": 27017}'

# Ping
curl -X POST https://portofcall.ross.gg/api/mongodb/ping \
  -H "Content-Type: application/json" \
  -d '{"host": "mongo.example.com", "port": 27017}'
```

## Graphite (Carbon) Protocol Endpoint

```bash
curl -X POST https://portofcall.ross.gg/api/graphite/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "graphite.example.com",
    "port": 2003,
    "metrics": [
      {"name": "servers.web01.cpu.usage", "value": 45.2},
      {"name": "servers.web01.mem.used", "value": 78.5}
    ]
  }'
```

## RCON Protocol Endpoint (Minecraft/Source Engine)

```bash
# Authenticate
curl -X POST https://portofcall.ross.gg/api/rcon/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "mc.example.com", "port": 25575, "password": "rcon_password"}'

# Execute command
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -H "Content-Type: application/json" \
  -d '{"host": "mc.example.com", "password": "rcon_password", "command": "list"}'
```

## Git Protocol Endpoint

```bash
curl -X POST https://portofcall.ross.gg/api/git/refs \
  -H "Content-Type: application/json" \
  -d '{"host": "git.savannah.gnu.org", "port": 9418, "repo": "emacs.git"}'
```

## ZooKeeper Protocol Endpoint

```bash
# Health check (ruok)
curl -X POST https://portofcall.ross.gg/api/zookeeper/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "zk.example.com", "port": 2181}'

# Four-letter word command
curl -X POST https://portofcall.ross.gg/api/zookeeper/command \
  -H "Content-Type: application/json" \
  -d '{"host": "zk.example.com", "command": "srvr"}'
```

## Cassandra Protocol Endpoint

```bash
curl -X POST https://portofcall.ross.gg/api/cassandra/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "cassandra.example.com", "port": 9042}'
```

## AMQP Protocol Endpoint (RabbitMQ)

```bash
curl -X POST https://portofcall.ross.gg/api/amqp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "rabbitmq.example.com", "port": 5672, "vhost": "/"}'
```

## Kafka Protocol Endpoint

```bash
# API versions
curl -X POST https://portofcall.ross.gg/api/kafka/versions \
  -H "Content-Type: application/json" \
  -d '{"host": "kafka.example.com", "port": 9092}'

# Metadata
curl -X POST https://portofcall.ross.gg/api/kafka/metadata \
  -H "Content-Type: application/json" \
  -d '{"host": "kafka.example.com", "port": 9092, "topics": ["test-topic"]}'
```

## RTSP Protocol Endpoint (RFC 2326)

```bash
# OPTIONS
curl -X POST https://portofcall.ross.gg/api/rtsp/options \
  -H "Content-Type: application/json" \
  -d '{"host": "camera.example.com", "port": 554, "path": "/stream1"}'

# DESCRIBE
curl -X POST https://portofcall.ross.gg/api/rtsp/describe \
  -H "Content-Type: application/json" \
  -d '{"host": "camera.example.com", "port": 554, "path": "/stream1"}'
```

## Rsync Protocol Endpoint

```bash
# Connect (list modules)
curl -X POST https://portofcall.ross.gg/api/rsync/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "rsync.kernel.org", "port": 873}'

# Get module details
curl -X POST https://portofcall.ross.gg/api/rsync/module \
  -H "Content-Type: application/json" \
  -d '{"host": "rsync.kernel.org", "module": "pub"}'
```

## TDS Protocol Endpoint (SQL Server)

```bash
curl -X POST https://portofcall.ross.gg/api/tds/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "sqlserver.example.com", "port": 1433}'
```

## VNC Protocol Endpoint (RFB)

```bash
curl -X POST https://portofcall.ross.gg/api/vnc/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "vnc.example.com", "port": 5900}'
```

## CHARGEN Protocol Endpoint (RFC 864)

```bash
curl -X POST https://portofcall.ross.gg/api/chargen/stream \
  -H "Content-Type: application/json" \
  -d '{"host": "chargen.example.com", "port": 19, "maxBytes": 1024}'
```

## Neo4j Protocol Endpoint (Bolt)

```bash
curl -X POST https://portofcall.ross.gg/api/neo4j/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "neo4j.example.com", "port": 7687}'
```

## RTMP Protocol Endpoint

```bash
curl -X POST https://portofcall.ross.gg/api/rtmp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "live.twitch.tv", "port": 1935}'
```

## TACACS+ Protocol Endpoint (RFC 8907)

```bash
# Probe (connectivity test)
curl -X POST https://portofcall.ross.gg/api/tacacs/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "tacacs.example.com", "port": 49}'

# Authenticate
curl -X POST https://portofcall.ross.gg/api/tacacs/authenticate \
  -H "Content-Type: application/json" \
  -d '{"host": "tacacs.example.com", "username": "admin", "password": "pass", "secret": "shared_key"}'
```

## HL7 v2.x Protocol Endpoint (MLLP)

```bash
# Connection test
curl -X POST https://portofcall.ross.gg/api/hl7/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "hl7.example.com", "port": 2575}'

# Send ADT^A01 message
curl -X POST https://portofcall.ross.gg/api/hl7/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "hl7.example.com",
    "messageType": "ADT^A01",
    "sendingApplication": "PortOfCall",
    "sendingFacility": "TestFacility"
  }'
```

## Elasticsearch Protocol Endpoint

```bash
# Cluster health
curl -X POST https://portofcall.ross.gg/api/elasticsearch/health \
  -H "Content-Type: application/json" \
  -d '{"host": "es.example.com", "port": 9200}'

# Query
curl -X POST https://portofcall.ross.gg/api/elasticsearch/query \
  -H "Content-Type: application/json" \
  -d '{"host": "es.example.com", "index": "my-index", "query": {"match_all": {}}}'
```

## AJP Protocol Endpoint (Apache JServ)

```bash
curl -X POST https://portofcall.ross.gg/api/ajp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "tomcat.example.com", "port": 8009}'
```

## RDP Protocol Endpoint (Remote Desktop)

```bash
curl -X POST https://portofcall.ross.gg/api/rdp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "rdp.example.com", "port": 3389}'
```

## JetDirect Protocol Endpoint (PJL)

```bash
curl -X POST https://portofcall.ross.gg/api/jetdirect/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "printer.example.com", "port": 9100}'
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

### DNS Resolvers

1. **Google**: `8.8.8.8:53`, `8.8.4.4:53`
2. **Cloudflare**: `1.1.1.1:53`, `1.0.0.1:53`
3. **Quad9**: `9.9.9.9:53`

### Gopher Test Server

1. **Floodgap**: `gopher.floodgap.com:70` (public Gopher server with root menu)

### IRC Test Server

1. **Libera.Chat**: `irc.libera.chat:6667` (public IRC network, requires unique nickname)

### NNTP Test Server

1. **Aioe**: `nntp.aioe.org:119` (public NNTP server, newsgroups like `comp.lang.python`)

### Rsync Test Server

1. **Kernel.org**: `rsync.kernel.org:873` (public rsync daemon, modules: `pub`)

### Git Test Server

1. **GNU Savannah**: `git.savannah.gnu.org:9418` (public git daemon, repos: `emacs.git`)

### NATS Test Server

1. **NATS Demo**: `demo.nats.io:4222` (public NATS server, no auth required)

### XMPP Test Server

1. **Jabber.org**: `jabber.org:5222` (public XMPP server)

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
