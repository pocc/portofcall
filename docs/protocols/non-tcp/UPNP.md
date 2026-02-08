# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**UPnP** is a set of networking protocols for device discovery, description, control, and eventing. Commonly used for NAT traversal (port forwarding), media servers (DLNA), smart home devices, and IoT.

**Port:** 1900 (UDP SSDP), dynamic TCP for control
**Transport:** UDP (discovery), HTTP/TCP (control)
**Type:** SOAP over HTTP

## Protocol Specification

### SSDP (Simple Service Discovery Protocol)

**Multicast Address**: 239.255.255.250:1900

**Discovery Request (M-SEARCH)**:
```
M-SEARCH * HTTP/1.1
HOST: 239.255.255.250:1900
MAN: "ssdp:discover"
MX: 3
ST: upnp:rootdevice
```

**Advertisement (NOTIFY)**:
```
NOTIFY * HTTP/1.1
HOST: 239.255.255.250:1900
NT: upnp:rootdevice
NTS: ssdp:alive
LOCATION: http://192.168.1.1:5000/device.xml
USN: uuid:12345678-1234-1234-1234-123456789012
```

### Device Description (XML over HTTP)

```xml
<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>My Media Server</friendlyName>
    <manufacturer>Acme</manufacturer>
    <modelName>MediaServer Pro</modelName>
    <UDN>uuid:12345678-1234-1234-1234-123456789012</UDN>
  </device>
</root>
```

## Resources

- [UPnP Forum](https://openconnectivity.org/developer/specifications/upnp-resources)
- [RFC 6970](https://tools.ietf.org/html/rfc6970) - UPnP IGD considerations

## Notes

- **Security Issues**: UPnP has many known vulnerabilities
- **NAT-PMP Alternative**: Simpler NAT traversal protocol
- **DLNA**: Built on UPnP for media sharing
- **IoT**: Used in smart home devices
- **Port Forwarding**: IGD (Internet Gateway Device) for automatic port mapping
- **Disable if Unused**: Recommended to disable on routers if not needed
