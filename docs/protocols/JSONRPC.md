# JSON-RPC (JSON Remote Procedure Call)

## Overview

**JSON-RPC** is a lightweight remote procedure call protocol using JSON for data encoding. It's simpler than SOAP and commonly used in blockchain (Ethereum, Bitcoin), APIs, and WebSocket applications.

**Port:** Varies (commonly 8545 for Ethereum, 8332 for Bitcoin)
**Transport:** HTTP, WebSocket, TCP
**Version:** JSON-RPC 2.0

## Protocol Specification

### Request Format

```json
{
  "jsonrpc": "2.0",
  "method": "subtract",
  "params": [42, 23],
  "id": 1
}
```

**Or with named parameters**:
```json
{
  "jsonrpc": "2.0",
  "method": "subtract",
  "params": {"subtrahend": 23, "minuend": 42},
  "id": 1
}
```

### Response Format

**Success**:
```json
{
  "jsonrpc": "2.0",
  "result": 19,
  "id": 1
}
```

**Error**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  },
  "id": null
}
```

### Error Codes

- `-32700` - Parse error
- `-32600` - Invalid Request
- `-32601` - Method not found
- `-32602` - Invalid params
- `-32603` - Internal error
- `-32000 to -32099` - Server error (reserved)

### Notification (no response expected)

```json
{
  "jsonrpc": "2.0",
  "method": "update",
  "params": [1, 2, 3, 4, 5]
}
```

### Batch Requests

```json
[
  {"jsonrpc": "2.0", "method": "sum", "params": [1,2,4], "id": "1"},
  {"jsonrpc": "2.0", "method": "notify_hello", "params": [7]},
  {"jsonrpc": "2.0", "method": "subtract", "params": [42,23], "id": "2"}
]
```

## Resources

- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Ethereum JSON-RPC](https://ethereum.org/en/developers/docs/apis/json-rpc/)
- [Bitcoin JSON-RPC](https://developer.bitcoin.org/reference/rpc/)

## Notes

- **Lightweight**: Minimal overhead compared to SOAP
- **Transport Agnostic**: Works over HTTP, WebSocket, TCP, etc.
- **Stateless**: Each request is independent
- **Batch Support**: Multiple requests in one call
- **Blockchain**: Standard for Ethereum and Bitcoin RPC
- **vs REST**: More like traditional RPC, not resource-oriented
- **vs gRPC**: JSON instead of protobuf, HTTP instead of HTTP/2
- **Simple**: Easy to implement and debug
