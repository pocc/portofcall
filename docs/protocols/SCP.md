# SCP (Secure Copy Protocol)

## Overview

**SCP (Secure Copy Protocol)** is a network protocol for securely transferring files between hosts. It uses SSH for data transfer and authentication, providing the same security as SSH. SCP is being deprecated in favor of SFTP and rsync.

**Port:** 22 (SSH)
**Transport:** SSH (TCP)
**Status:** Legacy (OpenSSH deprecating in favor of SFTP)
**RFC:** Not standardized (SSH-based implementation)

## Protocol Specification

### Key Features

1. **SSH-Based**: Uses SSH for authentication and encryption
2. **Simple Protocol**: Text-based protocol over SSH connection
3. **Recursive Copy**: Can copy entire directory trees
4. **Preserve Metadata**: Maintains timestamps and permissions
5. **Authentication**: Supports password and public key auth
6. **No Resume**: Cannot resume interrupted transfers

### Protocol Flow

1. Client establishes SSH connection
2. Client executes `scp -t /remote/path` on remote (upload) or `scp -f /remote/path` (download)
3. Protocol messages exchanged over SSH channel
4. Files transferred with metadata
5. SSH connection closed

### Protocol Messages

**From Client (Source → Sink):**

File copy:
```
C<mode> <length> <filename>\n
<file content>
\0
```

Directory:
```
D<mode> 0 <dirname>\n
```

End directory:
```
E\n
```

Time (optional):
```
T<mtime> 0 <atime> 0\n
```

**From Server (Sink → Source):**

- `\0` - OK, ready for next
- `\1<message>\n` - Warning message
- `\2<message>\n` - Fatal error

### Mode Format

Unix file permissions in octal (e.g., `0644`, `0755`)

### Example Session

**Upload file:**
```
Client → Server: C0644 13 hello.txt\n
Server → Client: \0 (OK)
Client → Server: Hello, World!\0
Server → Client: \0 (OK)
```

**Download file:**
```
Server → Client: C0644 13 hello.txt\n
Client → Server: \0 (OK)
Server → Client: Hello, World!\0
Client → Server: \0 (OK)
```

## Command Line Usage

```bash
# Upload file
scp file.txt user@host:/remote/path/

# Download file
scp user@host:/remote/file.txt /local/path/

# Recursive copy (directory)
scp -r directory/ user@host:/remote/path/

# Preserve timestamps
scp -p file.txt user@host:/remote/path/

# Specify port
scp -P 2222 file.txt user@host:/path/

# Copy between two remote hosts
scp user1@host1:/file user2@host2:/path/

# Use specific identity file
scp -i ~/.ssh/key.pem file.txt user@host:/path/

# Limit bandwidth (KB/s)
scp -l 1000 file.txt user@host:/path/

# Verbose output
scp -v file.txt user@host:/path/
```

## Resources

- [OpenSSH SCP](https://www.openssh.com/txt/release-8.0) - Deprecation notice
- [scp(1) Manual](https://man.openbsd.org/scp.1)
- [SCP Protocol Description](https://web.archive.org/web/20170215221933/https://blogs.oracle.com/janp/entry/how_the_scp_protocol_works)
- [WinSCP](https://winscp.net/) - Windows SCP client

## Notes

- **Deprecation**: OpenSSH discourages SCP, recommends SFTP or rsync
- **Security Issues**: Protocol design vulnerabilities (CVE-2019-6111, CVE-2019-6110)
- **No Resume**: Cannot resume interrupted transfers (use rsync instead)
- **Bandwidth Limit**: `-l` flag limits transfer speed
- **vs SFTP**: SFTP has more features, interactive mode, resume support
- **vs rsync**: rsync has delta-sync, resume, better for large files
- **vs FTP**: SCP is encrypted and authenticated via SSH
- **Recursive Mode**: `-r` flag for directories
- **Preserve Mode**: `-p` preserves modification times and permissions
- **3-Way Copy**: Can copy between two remote hosts (client routes data)
- **Wildcard Support**: Shell wildcards work in remote paths
- **Compression**: SSH compression can be enabled (`-C` flag)
- **Identity File**: `-i` specifies SSH private key
- **Progress**: `-v` shows progress (verbose mode)
- **Firewall**: Only needs SSH port (22) open
- **Performance**: Fast for small files, slower than rsync for large files
