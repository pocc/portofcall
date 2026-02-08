# SOAP (Simple Object Access Protocol)

## Overview

**SOAP** is a protocol for exchanging structured information in web services using XML. While declining in favor of REST and gRPC, it's still widely used in enterprise and legacy systems.

**Port:** 80 (HTTP), 443 (HTTPS)
**Transport:** HTTP/HTTPS
**Type:** XML over HTTP

## Protocol Specification

### SOAP Message Structure

```xml
<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <!-- Optional metadata -->
  </soap:Header>
  <soap:Body>
    <m:GetUser xmlns:m="http://example.com/users">
      <m:UserId>123</m:UserId>
    </m:GetUser>
  </soap:Body>
</soap:Envelope>
```

### HTTP Transport

```
POST /UserService HTTP/1.1
Host: example.com
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://example.com/GetUser"
Content-Length: 350

<?xml version="1.0"?>
<soap:Envelope>...</soap:Envelope>
```

### WSDL (Web Services Description Language)

Services described in WSDL XML documents defining operations, messages, and bindings.

## Resources

- [W3C SOAP Specification](https://www.w3.org/TR/soap/)
- [WSDL Specification](https://www.w3.org/TR/wsdl20/)

## Notes

- **Enterprise Use**: Common in banking, insurance, healthcare
- **WS-* Standards**: WS-Security, WS-ReliableMessaging, etc.
- **Verbose**: XML overhead compared to JSON
- **Declining**: Being replaced by REST and gRPC
- **Type Safety**: Strong typing via XML Schema
- **vs REST**: More structured but more complex
