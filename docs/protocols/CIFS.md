# CIFS (Common Internet File System)

## Overview

**CIFS** is Microsoft's file sharing protocol, essentially SMB (Server Message Block) over TCP/IP. Also known as SMB 1.0. It's largely deprecated in favor of SMB 2.0+ but still found in legacy systems.

**Port:** 445 (TCP), 139 (NetBIOS)
**Transport:** TCP
**Status:** Deprecated (use SMB 2.0+)

## Protocol Specification

CIFS is an enhanced version of SMB protocol providing:
- File and print sharing
- Authentication and authorization
- File locking
- Named pipes
- Transaction semantics

## Resources

- [Microsoft SMB Protocol](https://learn.microsoft.com/en-us/windows/win32/fileio/microsoft-smb-protocol-and-cifs-protocol-overview)

## Notes

- **Deprecated**: SMB 1.0/CIFS disabled by default in modern Windows
- **Security**: Multiple vulnerabilities (EternalBlue, etc.)
- **SMB 2.0+**: Modern replacement with better security and performance
- **Port 445**: Direct TCP without NetBIOS
- **Samba**: Linux implementation
- **vs NFS**: Windows file sharing vs Unix file sharing
