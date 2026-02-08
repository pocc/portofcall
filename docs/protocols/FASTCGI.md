# FastCGI Protocol

## Overview

**FastCGI** is a binary protocol for interfacing interactive programs with web servers. It's a variation of CGI that keeps processes running between requests for better performance, widely used with PHP, Python, and other web applications.

**Port:** Unix sockets or TCP port 9000 (common default)
**Transport:** TCP or Unix domain sockets
**Status:** Active standard
**RFC:** Not standardized (proprietary specification)

## Protocol Specification

### Key Features

1. **Persistent Processes**: Process pool stays alive between requests
2. **Multiplexing**: Multiple requests over single connection
3. **Distributed**: Separate web server from application server
4. **Language Agnostic**: Works with any programming language
5. **Binary Protocol**: Efficient binary message format
6. **Load Balancing**: Multiple backend processes

### Record Structure

```
typedef struct {
    unsigned char version;           // Protocol version (1)
    unsigned char type;              // Record type
    unsigned char requestIdB1;       // Request ID (MSB)
    unsigned char requestIdB0;       // Request ID (LSB)
    unsigned char contentLengthB1;   // Content length (MSB)
    unsigned char contentLengthB0;   // Content length (LSB)
    unsigned char paddingLength;     // Padding length
    unsigned char reserved;          // Reserved
    unsigned char contentData[contentLength];
    unsigned char paddingData[paddingLength];
} FCGI_Record;
```

### Record Types

- `1` - FCGI_BEGIN_REQUEST (start new request)
- `2` - FCGI_ABORT_REQUEST (abort request)
- `3` - FCGI_END_REQUEST (end request)
- `4` - FCGI_PARAMS (name-value pairs)
- `5` - FCGI_STDIN (request body data)
- `6` - FCGI_STDOUT (response body data)
- `7` - FCGI_STDERR (error stream)
- `8` - FCGI_DATA (additional data stream)
- `9` - FCGI_GET_VALUES (query server variables)
- `10` - FCGI_GET_VALUES_RESULT (server variable response)
- `11` - FCGI_UNKNOWN_TYPE (unknown type response)

### Application Roles

- **Responder**: Receives HTTP request, generates response (most common)
- **Authorizer**: Access control decisions
- **Filter**: Filters data from file before sending to client

### Request Flow

1. Web server sends FCGI_BEGIN_REQUEST
2. Web server sends FCGI_PARAMS (CGI variables)
3. Web server sends FCGI_STDIN (request body)
4. Application sends FCGI_STDOUT (response)
5. Application sends FCGI_END_REQUEST

## Resources

- [FastCGI Specification](https://fastcgi-archives.github.io/FastCGI_Specification.html)
- [Nginx FastCGI](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html)
- [PHP-FPM](https://www.php.net/manual/en/install.fpm.php) - PHP FastCGI Process Manager
- [spawn-fcgi](https://redmine.lighttpd.net/projects/spawn-fcgi/wiki) - FastCGI launcher

## Notes

- **PHP-FPM**: Most common FastCGI implementation
- **Unix Sockets**: Faster than TCP for local connections
- **vs CGI**: FastCGI keeps processes alive (CGI spawns per request)
- **vs WSGI**: WSGI is Python-specific, FastCGI is language-agnostic
- **vs Reverse Proxy**: FastCGI is protocol, reverse proxy is architecture
- **Performance**: Eliminates process startup overhead of CGI
- **Nginx + PHP-FPM**: Most popular web stack configuration
- **Connection Types**: Can use persistent or per-request connections
- **Multiplexing**: Single connection can handle multiple requests
- **Error Handling**: FCGI_STDERR stream for error messages
- **Environment Variables**: Passed via FCGI_PARAMS
- **Max Request Size**: Limited by web server configuration
