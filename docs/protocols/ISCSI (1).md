# iSCSI (Internet Small Computer System Interface)

## Overview

**iSCSI** is a protocol that allows SCSI commands to be sent over IP networks, enabling block-level storage access over standard Ethernet. It provides an alternative to Fibre Channel SANs, allowing organizations to build storage networks using existing IP infrastructure.

**Port:** 3260 (TCP)
**Transport:** TCP/IP
**Status:** Active standard
**RFC:** 7143 (replaces RFC 3720)

## Protocol Specification

### Key Features

1. **Block-Level Storage**: Remote disks appear as local block devices
2. **IP-Based**: Uses existing Ethernet/IP infrastructure
3. **SCSI Command Set**: Full SCSI functionality over IP
4. **Multipath I/O**: Multiple network paths for redundancy
5. **Authentication**: CHAP, Kerberos, SRP support
6. **Encryption**: IPsec encryption support
7. **Discovery**: SendTargets, iSNS, SLP discovery methods
8. **Jumbo Frames**: Supports 9000-byte MTU for performance

### Architecture

**Components:**
- **Initiator**: iSCSI client (server accessing storage)
- **Target**: iSCSI server (provides storage)
- **LUN**: Logical Unit Number (individual storage volume)
- **Portal**: IP address + port combination
- **IQN**: iSCSI Qualified Name (unique identifier)

**Naming Convention (IQN):**
```
iqn.YYYY-MM.reverse-domain:unique-name

Examples:
iqn.2024-01.com.example:storage.disk1
iqn.1992-05.com.emc:cx.apm00123456789.a0
iqn.2010-10.org.openstack:volume-12345678
```

### Protocol Data Unit (PDU)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|.|I| Opcode    |F|  Opcode-specific fields                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|TotalAHSLength | DataSegmentLength                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| LUN or Opcode-specific fields                                 |
+                                                               +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Initiator Task Tag                                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Opcode-specific fields                                        |
+                                                               +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Header-Digest (optional)                                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Data Segment (optional, variable length)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Data-Digest (optional)                                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### PDU Opcodes

**Initiator → Target:**
- `0x01` - SCSI Command
- `0x02` - SCSI Task Management
- `0x03` - Login Request
- `0x04` - Text Request
- `0x05` - SCSI Data-Out
- `0x06` - Logout Request
- `0x10` - SNACK Request
- `0x1c` - NOP-Out

**Target → Initiator:**
- `0x21` - SCSI Response
- `0x22` - Task Management Response
- `0x23` - Login Response
- `0x24` - Text Response
- `0x25` - SCSI Data-In
- `0x26` - Logout Response
- `0x31` - Ready To Transfer (R2T)
- `0x32` - Async Message
- `0x3c` - Reject
- `0x3f` - NOP-In

### Login Phase

**Negotiation Parameters:**
- `InitiatorName` / `TargetName`
- `SessionType` (Normal or Discovery)
- `AuthMethod` (None, CHAP, KRB5, SRP)
- `HeaderDigest` / `DataDigest` (CRC32C)
- `MaxRecvDataSegmentLength`
- `MaxConnections`
- `MaxBurstLength`
- `FirstBurstLength`

**Authentication Methods:**
- **None**: No authentication
- **CHAP**: Challenge-Handshake Authentication Protocol
- **Kerberos**: KRB5 (enterprise environments)
- **SRP**: Secure Remote Password

### Discovery Methods

**SendTargets:**
```
Text Request: SendTargets=All
Text Response: 
  TargetName=iqn.2024-01.com.example:storage.disk1
  TargetAddress=192.168.1.100:3260,1
  TargetAddress=192.168.2.100:3260,2
```

**iSNS (Internet Storage Name Service):**
- Centralized discovery service
- Similar to DNS for iSCSI
- Port 3205

**SLP (Service Location Protocol):**
- Port 427
- Less common

## Configuration Examples

**Linux Initiator (open-iscsi):**
```bash
# Discover targets
iscsiadm -m discovery -t st -p 192.168.1.100

# Login to target
iscsiadm -m node -T iqn.2024-01.com.example:storage.disk1 -p 192.168.1.100 --login

# Set CHAP authentication
iscsiadm -m node -T iqn.2024-01.com.example:storage.disk1 \
  --op update -n node.session.auth.authmethod -v CHAP
iscsiadm -m node -T iqn.2024-01.com.example:storage.disk1 \
  --op update -n node.session.auth.username -v initiator_username
iscsiadm -m node -T iqn.2024-01.com.example:storage.disk1 \
  --op update -n node.session.auth.password -v initiator_password

# Logout
iscsiadm -m node -T iqn.2024-01.com.example:storage.disk1 --logout
```

**Windows Initiator:**
```powershell
# Configure initiator name
Set-InitiatorPort -NodeAddress "iqn.1991-05.com.microsoft:client01"

# Discover targets
New-IscsiTargetPortal -TargetPortalAddress 192.168.1.100

# Connect to target
Connect-IscsiTarget -NodeAddress "iqn.2024-01.com.example:storage.disk1"
```

**Linux Target (targetcli):**
```bash
# Create backstorage
targetcli /backstores/block create disk1 /dev/sdb

# Create target
targetcli /iscsi create iqn.2024-01.com.example:storage.disk1

# Create LUN
targetcli /iscsi/iqn.2024-01.com.example:storage.disk1/tpg1/luns create /backstores/block/disk1

# Set ACL (initiator authorization)
targetcli /iscsi/iqn.2024-01.com.example:storage.disk1/tpg1/acls create iqn.1991-05.com.microsoft:client01

# Save configuration
targetcli saveconfig
```

## Resources

- **RFC 7143**: Internet Small Computer System Interface (iSCSI)
- **RFC 4171**: Internet Storage Name Service (iSNS)
- [Open-iSCSI](https://www.open-iscsi.com/) - Linux initiator
- [TGT](http://stgt.sourceforge.net/) - Linux SCSI target framework
- [FreeNAS/TrueNAS](https://www.truenas.com/) - iSCSI storage appliance

## Notes

- **vs Fibre Channel**: iSCSI uses Ethernet, FC uses dedicated fabric
- **vs NFS/SMB**: iSCSI is block-level, NFS/SMB are file-level
- **vs FCoE**: FCoE is FC over Ethernet, iSCSI is SCSI over IP
- **vs NVMe-oF**: NVMe-oF is newer, faster for flash storage
- **Performance**: 10GbE iSCSI can match 8Gb FC performance
- **Jumbo Frames**: MTU 9000 recommended for performance
- **Multipath**: Use multiple NICs for redundancy and load balancing
- **CHAP**: Most common authentication method
- **IPsec**: Encryption for security (performance impact)
- **MPIO**: Multipath I/O for failover and load balancing
- **CRC**: Header/Data digests for data integrity
- **VMware**: Supports iSCSI for VM storage (VMFS over iSCSI)
- **Hyper-V**: Supports iSCSI for VM storage
- **Boot from SAN**: Can boot OS from iSCSI disk
- **VLAN**: Often uses dedicated storage VLAN
- **Latency**: ~1ms typical (Ethernet latency)
- **SCSI Commands**: Full SCSI-3 command set support
