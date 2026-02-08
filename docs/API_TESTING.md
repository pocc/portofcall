# API Testing Guide

This guide provides curl commands to test all Port of Call API endpoints.

## FTP Protocol Endpoints

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
