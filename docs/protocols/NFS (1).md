# NFS (Network File System)

## Overview

**NFS (Network File System)** is a distributed file system protocol that allows clients to access files over a network as if they were local. Originally developed by Sun Microsystems, NFS is widely used in Unix/Linux environments for sharing files between servers.

**Port:** 2049 (TCP/UDP for NFSv2/v3), 2049 (TCP for NFSv4)
**Transport:** TCP/UDP (NFSv2/v3), TCP (NFSv4)
**Status:** Active standard
**RFC:** 1813 (NFSv2), 1813 (NFSv3), 7530 (NFSv4.0), 8881 (NFSv4.2)

## Protocol Specification

### Key Features

1. **Transparent Access**: Remote files appear as local
2. **Stateless (v2/v3)**: Server doesn't track client state
3. **Stateful (v4)**: Connection-based with sessions
4. **Caching**: Client-side caching for performance
5. **File Locking**: Advisory and mandatory locks
6. **Access Control**: Unix permissions + NFSv4 ACLs
7. **Kerberos Support**: NFSv4 supports Kerberos authentication
8. **Delegation**: NFSv4 delegates file management to clients

### NFS Versions

**NFSv2 (1989):**
- 32-bit offsets (2GB file limit)
- UDP only
- Stateless

**NFSv3 (1995):**
- 64-bit offsets (large files)
- TCP support
- Better performance
- READDIRPLUS (reduces round trips)

**NFSv4 (2000):**
- Stateful protocol
- Single port (2049)
- Compound operations
- Kerberos integration
- ACLs (not just Unix permissions)
- Delegation
- No separate mount protocol

**NFSv4.1 (2010):**
- pNFS (parallel NFS)
- Sessions
- Better performance

**NFSv4.2 (2016):**
- Server-side copy
- Sparse files
- Application data blocks
- Clone/reflink

### NFSv3 Operations

**File Operations:**
- `NULL` - Do nothing (ping)
- `GETATTR` - Get file attributes
- `SETATTR` - Set file attributes
- `LOOKUP` - Look up filename
- `ACCESS` - Check access rights
- `READLINK` - Read symbolic link
- `READ` - Read from file
- `WRITE` - Write to file
- `CREATE` - Create file
- `MKDIR` - Create directory
- `SYMLINK` - Create symbolic link
- `MKNOD` - Create device
- `REMOVE` - Remove file
- `RMDIR` - Remove directory
- `RENAME` - Rename file/directory
- `LINK` - Create hard link
- `READDIR` - Read directory entries
- `READDIRPLUS` - Read directory with attributes
- `FSSTAT` - Get filesystem statistics
- `FSINFO` - Get filesystem information
- `PATHCONF` - Get path configuration
- `COMMIT` - Commit data to stable storage

### NFSv4 Compound Operations

NFSv4 allows multiple operations in single RPC:

```
COMPOUND:
  PUTFH (file handle)
  READ (offset, length)
  GETATTR (attributes)
```

**Reduces Round Trips:**
```
# NFSv3: 3 separate RPCs
LOOKUP("file.txt")
READ(fh, 0, 4096)
GETATTR(fh)

# NFSv4: 1 compound RPC
COMPOUND(PUTROOTFH, LOOKUP("file.txt"), READ(0, 4096), GETATTR)
```

### Mount Protocol (NFSv2/v3)

**Separate Mount Service (Port 111 + mountd):**

```
# Mount request
MOUNT /export/data

# Mount response
File Handle: 0x1234abcd...
Auth Flavors: AUTH_SYS, AUTH_KRB5
```

**NFSv4:** No separate mount protocol, uses special operations

### File Handles

**Opaque Identifiers:**
- Server-generated unique identifier
- Not human-readable
- Persists across server reboots (usually)
- Contains filesystem ID + inode info

**NFSv3:** Fixed 64-byte handle
**NFSv4:** Variable-length handle (up to 128 bytes)

### Security Flavors

**AUTH_SYS (AUTH_UNIX):**
- UID/GID based
- No encryption
- Trusts client-provided credentials

**RPCSEC_GSS (NFSv4):**
- Kerberos authentication
- Integrity protection
- Encryption (krb5p)
- Privacy modes:
  - `krb5` - Authentication only
  - `krb5i` - Integrity checking
  - `krb5p` - Privacy (encryption)

### Delegation (NFSv4)

**Read Delegation:**
- Client caches file, notified if changes occur
- Multiple clients can have read delegation

**Write Delegation:**
- Exclusive access to file
- Client can cache writes
- Only one client can have write delegation

## Configuration Examples

**Linux NFS Server (/etc/exports):**
```
# Basic export
/export/data 192.168.1.0/24(rw,sync,no_subtree_check)

# Read-only export
/export/public *(ro,sync,no_subtree_check)

# NFSv4 with Kerberos
/export/secure 192.168.1.0/24(rw,sync,sec=krb5p,no_subtree_check)

# Root squash (map root to nobody)
/export/users 192.168.1.0/24(rw,sync,root_squash,no_subtree_check)

# No root squash (dangerous!)
/export/admin 192.168.1.100(rw,sync,no_root_squash,no_subtree_check)
```

**Linux NFS Client:**
```bash
# Mount NFSv3
mount -t nfs server:/export/data /mnt/data

# Mount NFSv4
mount -t nfs4 server:/export/data /mnt/data

# Mount with Kerberos
mount -t nfs4 -o sec=krb5p server:/export/secure /mnt/secure

# Mount with specific options
mount -t nfs -o rw,hard,intr,rsize=8192,wsize=8192 server:/export/data /mnt/data

# Auto-mount (/etc/fstab)
server:/export/data /mnt/data nfs defaults,_netdev 0 0
```

**FreeBSD NFS Server (/etc/exports):**
```
/export/data -network 192.168.1.0 -mask 255.255.255.0
/export/public -alldirs -ro
```

## Resources

- **RFC 7530**: NFSv4 Protocol
- **RFC 8881**: NFSv4.2 Protocol
- **RFC 1813**: NFSv3 Protocol
- [Linux NFS Documentation](https://linux-nfs.org/)
- [NFS-Ganesha](https://github.com/nfs-ganesha/nfs-ganesha) - User-space NFS server

## Notes

- **vs SMB**: NFS is Unix-native, SMB is Windows-native
- **vs iSCSI**: NFS is file-level, iSCSI is block-level
- **vs 9P**: 9P is Plan 9 filesystem, NFS is more common
- **Stateless (v3)**: Server crash doesn't lose client state
- **Stateful (v4)**: Better performance, locking, caching
- **Performance**: Local network typically 100-1000 MB/s
- **Caching**: Client caches aggressively (stale data possible)
- **Locking**: fcntl() locks work over NFS (NFSv4)
- **Root Squash**: Maps root UID to nobody for security
- **Portmapper**: NFSv3 uses rpcbind (port 111) for service location
- **Single Port**: NFSv4 only uses port 2049 (firewall-friendly)
- **Hard vs Soft**: Hard mounts retry forever, soft mounts timeout
- **Jumbo Frames**: Improve performance on 10GbE+
- **pNFS**: Parallel NFS for high-performance storage
- **Storage**: Common for shared storage in HPC, virtualization
- **Home Directories**: Common for Unix/Linux home directories
- **Container Storage**: Used by Kubernetes via NFS provisioner
- **Latency Sensitive**: Performance degrades on high-latency links
