# AFP (Apple Filing Protocol)

## Overview

**AFP** is Apple's file sharing protocol for macOS and classic Mac OS. While still supported, it's being replaced by SMB in modern macOS versions. Provides file sharing, Time Machine backups, and resource forks.

**Port:** 548 (TCP)
**Transport:** TCP (AFP 3.0+), AppleTalk (legacy)
**Status:** Deprecated (SMB recommended)

## Protocol Specification

AFP provides:
- File and directory services
- Resource forks (Mac-specific metadata)
- File locking
- Access control
- Unicode filenames
- Spotlight search

### Connection Flow

1. **DSIOpenSession**: Establish session
2. **FPLogin**: Authenticate user
3. **FPOpenVol**: Mount volume
4. **File Operations**: Read, write, enumerate
5. **FPCloseVol**: Unmount
6. **DSICloseSession**: Close connection

## Resources

- [AFP Protocol Reference](https://developer.apple.com/library/archive/documentation/Networking/Reference/AFP_Reference/Introduction/Introduction.html)
- [Netatalk](http://netatalk.sourceforge.net/) - Open-source AFP server

## Notes

- **Deprecated**: Apple recommends SMB for new deployments
- **Time Machine**: Supported for backups
- **Resource Forks**: Mac-specific file metadata
- **Bonjour**: Auto-discovery via mDNS
- **vs SMB**: Better for Mac-to-Mac, but SMB is cross-platform
- **macOS**: Still supported but SMB is default
- **Netatalk**: Linux/Unix AFP server implementation
