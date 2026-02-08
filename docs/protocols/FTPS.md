# FTPS (FTP over SSL/TLS)

## Overview

**FTPS** is an extension to FTP that adds support for TLS and SSL cryptographic protocols. It provides encrypted file transfer, protecting credentials and data from eavesdropping. Not to be confused with SFTP (SSH File Transfer Protocol).

**Port:** 21 (control), 990 (implicit FTPS)
**Transport:** TCP with TLS/SSL
**Status:** Active standard
**RFC:** 4217 (Securing FTP with TLS)

## Protocol Specification

### Key Features

1. **Encryption**: TLS/SSL encryption for control and data channels
2. **Authentication**: Encrypted username/password
3. **Data Protection**: Encrypted file transfers
4. **Certificate Support**: X.509 certificates for server authentication
5. **Backward Compatible**: Falls back to plain FTP if TLS unavailable
6. **Two Modes**: Explicit FTPS and Implicit FTPS

### Connection Modes

**Explicit FTPS (FTPES):**
- Port 21 (standard FTP port)
- Client sends `AUTH TLS` or `AUTH SSL` command
- Upgrades existing FTP connection to TLS
- More firewall-friendly

**Implicit FTPS:**
- Port 990 (separate port)
- TLS negotiation starts immediately
- No plain-text commands ever sent
- Legacy approach (deprecated)

### TLS Commands

- `AUTH TLS` - Request TLS encryption (preferred)
- `AUTH SSL` - Request SSL encryption (legacy)
- `PBSZ 0` - Set protection buffer size
- `PROT P` - Enable data channel encryption (Private)
- `PROT C` - Disable data channel encryption (Clear)

### Connection Flow (Explicit FTPS)

1. Client connects to port 21
2. Server sends `220` welcome message
3. Client sends `AUTH TLS`
4. Server responds `234 AUTH TLS OK`
5. TLS handshake performed
6. Client sends `USER username` (encrypted)
7. Client sends `PASS password` (encrypted)
8. Client sends `PBSZ 0`
9. Client sends `PROT P` (encrypt data channel)
10. File transfer commands (encrypted)

### Data Channel Protection

- **PROT C**: Clear (no encryption) - control only
- **PROT S**: Safe (integrity only)
- **PROT E**: Confidential (encryption, no integrity)
- **PROT P**: Private (encryption + integrity) - **recommended**

### Active vs Passive Mode

**Active Mode (PORT):**
- Client opens port, sends PORT command
- Server connects to client's IP:port
- Firewall issues (incoming connection to client)

**Passive Mode (PASV/EPSV):**
- Client sends PASV command
- Server opens port, sends IP:port
- Client connects to server's IP:port
- More firewall-friendly

## Resources

- **RFC 4217**: Securing FTP with TLS
- **RFC 2228**: FTP Security Extensions
- [FileZilla](https://filezilla-project.org/) - Popular FTPS client
- [vsftpd](https://security.appspot.com/vsftpd.html) - Secure FTP server
- [ProFTPD](http://www.proftpd.org/) - Configurable FTP server

## Notes

- **vs SFTP**: FTPS uses TLS/SSL, SFTP uses SSH (completely different)
- **vs FTP**: FTPS adds encryption, FTP is plain-text
- **Firewall Complexity**: Data channel requires multiple ports
- **Certificate Validation**: Should validate server certificate
- **Implicit FTPS**: Deprecated, use Explicit FTPS (port 21)
- **Browser Support**: Limited (most browsers dropped FTP/FTPS)
- **TLS 1.2+**: Use modern TLS versions (avoid SSLv3, TLS 1.0)
- **Data Channel**: Must explicitly enable encryption with PROT P
- **Port Range**: Passive mode may need port range (e.g., 50000-51000)
- **NAT Issues**: Passive mode works better with NAT/firewalls
- **Certificate Types**: Self-signed or CA-signed certificates
- **Client Certificates**: Optional mutual authentication
- **Session Reuse**: TLS session reuse for data connections
- **Performance**: Encryption adds CPU overhead
- **Compliance**: Required for PCI DSS, HIPAA data transfers
