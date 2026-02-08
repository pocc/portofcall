# AJP (Apache JServ Protocol)

## Overview

**AJP (Apache JServ Protocol)** is a binary protocol used to proxy requests from a web server (Apache, Nginx) to an application server (Tomcat, Jetty). It's optimized for performance and is the preferred method for connecting Apache HTTP Server to Tomcat.

**Port:** 8009 (default)
**Transport:** TCP
**Status:** Active (AJP/1.3 current version)
**Developer:** Apache Software Foundation

## Protocol Specification

### Key Features

1. **Binary Protocol**: More efficient than HTTP proxying
2. **Connection Pooling**: Persistent connections between servers
3. **SSL Information**: Forwards SSL/TLS certificate data
4. **Request Attributes**: Extended request metadata
5. **Load Balancing**: Built-in support via mod_proxy_balancer
6. **Keep-Alive**: Reuses connections for multiple requests

### Packet Structure

```
Packet Format:
+-------------+-------------+-------------+
| Magic (0x12 | Data Length |   Payload   |
|    0x34)    |  (2 bytes)  | (variable)  |
+-------------+-------------+-------------+
```

**Server → Container:**
- Magic: `0x1234`

**Container → Server:**
- Magic: `AB` (0x4142)

### Message Types

**Request Packets (Server → Container):**
- `2` - Forward Request
- `7` - Shutdown
- `8` - Ping
- `10` - CPing (Connection Ping)

**Response Packets (Container → Server):**
- `3` - Send Body Chunk
- `4` - Send Headers
- `5` - End Response
- `9` - CPong Reply

### Forward Request Structure

Contains HTTP request data:
- HTTP Method (1 byte code)
- Protocol (String)
- Request URI (String)
- Remote Address (String)
- Remote Host (String)
- Server Name (String)
- Server Port (Integer)
- Is SSL (Boolean)
- Headers (Name-Value pairs)
- Attributes (Optional metadata)

### HTTP Method Codes

- `1` - OPTIONS
- `2` - GET
- `3` - HEAD
- `4` - POST
- `5` - PUT
- `6` - DELETE
- `7` - TRACE
- `8` - PROPFIND
- `9` - PROPPATCH
- `10` - MKCOL
- `11` - COPY
- `12` - MOVE
- `13` - LOCK
- `14` - UNLOCK

## Resources

- [AJP13 Specification](https://tomcat.apache.org/connectors-doc/ajp/ajpv13a.html)
- [Apache mod_proxy_ajp](https://httpd.apache.org/docs/current/mod/mod_proxy_ajp.html)
- [Tomcat AJP Connector](https://tomcat.apache.org/tomcat-9.0-doc/config/ajp.html)
- [Nginx AJP Module](https://github.com/yaoweibin/nginx_ajp_module)

## Notes

- **Tomcat Default**: AJP connector enabled by default on port 8009
- **Performance**: ~15% faster than HTTP proxying due to binary protocol
- **SSL Termination**: Web server handles SSL, forwards decrypted to Tomcat
- **Security (Ghostcat)**: CVE-2020-1938 required securing AJP connector
- **Default Binding**: Should bind to localhost only (not 0.0.0.0)
- **vs HTTP Proxy**: AJP is faster, HTTP proxy is more standard
- **vs mod_jk**: mod_proxy_ajp is newer, mod_jk is legacy
- **Connection Reuse**: Dramatically reduces connection overhead
- **Request Attributes**: Can forward custom attributes (user ID, roles, etc.)
- **Apache + Tomcat**: Most common deployment pattern
- **Nginx Support**: Requires third-party module
- **Binary Format**: Not human-readable (use packet sniffer)
- **Keep-Alive**: Requires both server and container support
- **Load Balancing**: mod_proxy_balancer supports sticky sessions
