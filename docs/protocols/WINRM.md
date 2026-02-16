# WinRM (Windows Remote Management) Protocol

## Overview
WinRM is Microsoft's implementation of the WS-Management (DMTF DSP0226) standard for remote management of Windows systems. It uses HTTP/HTTPS transport with SOAP XML envelopes to execute management operations.

## Protocol Details
- **Default Ports:** 5985 (HTTP), 5986 (HTTPS)
- **Transport:** HTTP/1.1 with SOAP 1.2 XML payloads
- **Standard:** DMTF DSP0226 (WS-Management), MS-WSMV
- **Authentication:** Basic, Negotiate (NTLM/Kerberos), CredSSP

## Key Endpoints

| Endpoint | Auth Required | Description |
|----------|---------------|-------------|
| `/wsman-anon/identify` | No | Anonymous WSMAN Identify probe |
| `/wsman` | Yes | Main management endpoint |

## WSMAN Identify

The Identify operation is the only anonymous (no-auth) operation in WS-Management. It returns:
- **ProductVendor:** e.g., "Microsoft Corporation"
- **ProductVersion:** e.g., "OS: 10.0.20348 SP: 0.0 Stack: 3.0"
- **ProtocolVersion:** e.g., "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
- **SecurityProfiles:** Supported auth profiles

### Request Format
```xml
<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>
```

### Response Format
```xml
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Body>
    <wsmid:IdentifyResponse>
      <wsmid:ProtocolVersion>http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd</wsmid:ProtocolVersion>
      <wsmid:ProductVendor>Microsoft Corporation</wsmid:ProductVendor>
      <wsmid:ProductVersion>OS: 10.0.20348 SP: 0.0 Stack: 3.0</wsmid:ProductVersion>
    </wsmid:IdentifyResponse>
  </s:Body>
</s:Envelope>
```

## Authentication Methods

| Method | Description |
|--------|-------------|
| Basic | Username/password in Base64 (requires HTTPS in production) |
| Negotiate | NTLM or Kerberos negotiation (most common) |
| Kerberos | Direct Kerberos authentication |
| CredSSP | Credential delegation for double-hop scenarios |

## Implementation Details

### Worker (`src/worker/winrm.ts`)
- `handleWinRMIdentify()` - Sends WSMAN Identify SOAP request, parses XML response
- `handleWinRMAuth()` - Probes auth methods via 401 WWW-Authenticate header
- Uses raw HTTP over TCP sockets (Cloudflare Workers `connect()`)
- Tries `/wsman-anon/identify` first, falls back to `/wsman`

### Client (`src/components/WinRMClient.tsx`)
- Server identification with vendor/version display
- Authentication method enumeration
- Security profile listing
- HTTP status and RTT display

### API Endpoints
- `POST /api/winrm/identify` - WSMAN Identify probe (anonymous)
- `POST /api/winrm/auth` - Authentication method detection

## Edge Cases
- **Authentication:** Identify is anonymous; all other operations require auth
- **Timeouts:** Standard HTTP timeout with Connection: close
- **Binary vs Text:** Pure text (XML over HTTP)
- **401 Response:** Still considered successful - reveals auth methods
- **404 on /wsman-anon/identify:** Falls back to /wsman endpoint

## Common Use Cases
- PowerShell Remoting (`Enter-PSSession`, `Invoke-Command`)
- Ansible Windows modules
- SCCM/Configuration Manager
- Enterprise Windows administration
- Server health monitoring

## Enabling WinRM on Windows
```powershell
# Quick enable (HTTP)
winrm quickconfig

# Enable with specific settings
Enable-PSRemoting -Force

# Check WinRM status
winrm get winrm/config

# Allow Basic auth (not recommended for production)
winrm set winrm/config/service/auth @{Basic="true"}
```

## Security Considerations
- HTTP (port 5985) transmits data unencrypted - use HTTPS (5986) in production
- Basic auth over HTTP exposes credentials in Base64 (easily decoded)
- Negotiate/Kerberos is the recommended auth method
- CredSSP enables credential delegation but increases attack surface
- WinRM should be restricted via Windows Firewall rules
