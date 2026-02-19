# Multi-Protocol Test Server Documentation

Comprehensive TCP protocol testing environment for Port of Call development.

## Overview

This test server provides 19+ TCP protocols in Docker containers for testing the Cloudflare Workers Sockets API. Every service is configured with a **15-minute session timeout** and includes sample data for comprehensive testing.

## Table of Contents

- [Quick Start](#quick-start)
- [Implemented Protocols](#implemented-protocols)
- [Port Mappings](#port-mappings)
- [Credentials](#credentials)
- [Configuration Details](#configuration-details)
- [Security](#security)
- [Testing Procedures](#testing-procedures)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Prerequisites

- Ubuntu 24.04 LTS (or similar Linux distribution)
- Docker Engine 24.0+ and Docker Compose 2.0+
- 4GB RAM minimum, 8GB recommended
- 20GB disk space

### Installation

```bash
# Clone the repository
cd portofcall

# Run setup script (generates SSL certs, creates configs)
./setup-testserver.sh

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps

# Access web interface
open http://localhost
```

### Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

## Implemented Protocols

### Production Protocols

| Protocol | Port(s) | Tool | Status | Sample Data |
|----------|---------|------|--------|-------------|
| **HTTP** | 80 | nginx | ✅ Ready | Static HTML, API endpoints |
| **HTTPS** | 443 | nginx | ✅ Ready | Self-signed certificate |
| **FTP** | 21, 21100-21110 | vsftpd | ✅ Ready | Test files, upload/download dirs |
| **SSH** | 2222 | OpenSSH | ✅ Ready | Shell access, SFTP subsystem |
| **SMTP** | 25, 587 | Docker-Mailserver | ✅ Ready | Test mailbox |
| **IMAP** | 143, 993 | Dovecot | ✅ Ready | Pre-loaded test emails |
| **POP3** | 110, 995 | Dovecot | ✅ Ready | Test mailbox |
| **MySQL** | 3306 | MySQL 8.0 | ✅ Ready | Test database with schema |
| **PostgreSQL** | 5432 | PostgreSQL 16 | ✅ Ready | Test database with schema |
| **Redis** | 6379 | Redis 7 | ✅ Ready | Pre-populated key-value data |
| **MongoDB** | 27017 | MongoDB 7 | ✅ Ready | Test collections with documents |
| **Memcached** | 11211 | Memcached | ✅ Ready | Memory caching |
| **MQTT** | 1883 | Mosquitto | ✅ Ready | IoT pub/sub broker |
| **IRC** | 6667 | InspIRCd | ✅ Ready | Chat server |
| **Telnet** | 23 | telnetd | ✅ Ready | Legacy terminal access |

### Simple Test Protocols (RFC-Defined)

| Protocol | Port | RFC | Description | Handler |
|----------|------|-----|-------------|---------|
| **Echo** | 7 | RFC 862 | Echoes received data | Python custom |
| **Discard** | 9 | RFC 863 | Discards all data | Python custom |
| **Daytime** | 13 | RFC 867 | ASCII time string | Python custom |
| **Chargen** | 19 | RFC 864 | Character generator | Python custom |
| **Time** | 37 | RFC 868 | Binary time value | Python custom |
| **Finger** | 79 | RFC 1288 | User information | Python custom |

## Port Mappings

### Host to Container Port Mapping

All services bind to `0.0.0.0` (all interfaces) on the host machine:

```
HTTP:        80:80       -> nginx
HTTPS:       443:443     -> nginx
FTP:         21:21       -> vsftpd
FTP Passive: 21100-21110:21100-21110 -> vsftpd
SSH:         2222:2222   -> openssh
SMTP:        25:25       -> mailserver
SMTP Submit: 587:587     -> mailserver
IMAP:        143:143     -> mailserver
IMAPS:       993:993     -> mailserver
POP3:        110:110     -> mailserver
POP3S:       995:995     -> mailserver
MySQL:       3306:3306   -> mysql
PostgreSQL:  5432:5432   -> postgres
Redis:       6379:6379   -> redis
MongoDB:     27017:27017 -> mongodb
Memcached:   11211:11211 -> memcached
MQTT:        1883:1883   -> mosquitto
IRC:         6667:6667   -> ircd
Telnet:      23:23       -> telnet
Echo:        7:7         -> simple-protocols
Discard:     9:9         -> simple-protocols
Daytime:     13:13       -> simple-protocols
Chargen:     19:19       -> simple-protocols
Time:        37:37       -> simple-protocols
Finger:      79:79       -> simple-protocols
```

### Accessing Services

When running locally:
```bash
# Web browser
http://localhost

# SSH
ssh -p 2222 testuser@localhost

# MySQL
mysql -h localhost -P 3306 -u testuser -p testdb

# Redis
redis-cli -h localhost -p 6379

# FTP
ftp localhost 21
```

When running on a VPS (replace `YOUR_VPS_IP`):
```bash
ssh -p 2222 testuser@YOUR_VPS_IP
mysql -h YOUR_VPS_IP -P 3306 -u testuser -p testdb
```

## Credentials

All services use consistent test credentials for easy testing:

### Default User Account
```
Username: testuser
Password: testpass123
```

### Service-Specific Credentials

#### SSH / Telnet
- **User**: `testuser`
- **Pass**: `testpass123`
- **Port**: 2222 (SSH), 23 (Telnet)

#### FTP
- **User**: `testuser`
- **Pass**: `testpass123`
- **Port**: 21
- **Passive Ports**: 21100-21110

#### Email (SMTP/IMAP/POP3)
- **Email**: `test@testserver.local`
- **Pass**: `testpass123`
- **SMTP**: Port 25, 587
- **IMAP**: Port 143 (unencrypted), 993 (SSL)
- **POP3**: Port 110 (unencrypted), 995 (SSL)

#### MySQL
- **User**: `testuser`
- **Pass**: `testpass123`
- **Database**: `testdb`
- **Root Password**: `rootpass123`

#### PostgreSQL
- **User**: `testuser`
- **Pass**: `rootpass123`
- **Database**: `testdb`

#### MongoDB
- **User**: `testuser`
- **Pass**: `testpass123`
- **Database**: `testdb`
- **Auth Database**: `admin`

#### MQTT (Mosquitto)
- **User**: `testuser`
- **Pass**: `testpass123`
- **Anonymous**: Disabled

#### Redis
- **Auth**: None (no password required)

#### Memcached
- **Auth**: None (no password required)

#### IRC
- **Auth**: None (no registration required)

## Configuration Details

### 15-Minute Session Timeout Implementation

Every protocol enforces a 15-minute (900 second) timeout:

#### nginx (HTTP/HTTPS)
```nginx
keepalive_timeout 900s;
client_body_timeout 900s;
client_header_timeout 900s;
send_timeout 900s;
```

#### vsftpd (FTP)
```conf
idle_session_timeout=900
data_connection_timeout=900
```

#### OpenSSH (SSH)
```conf
ClientAliveInterval 60
ClientAliveCountMax 15
# = 60 * 15 = 900 seconds
```

#### MySQL
```bash
--wait_timeout=900
--interactive_timeout=900
```

#### PostgreSQL
```bash
-c idle_in_transaction_session_timeout=900000  # milliseconds
-c statement_timeout=900000
```

#### Redis
```bash
--timeout 900
```

#### MQTT (Mosquitto)
```conf
max_keepalive 900
persistent_client_expiration 15m
```

#### Custom Python Servers (Echo, Daytime, etc.)
```python
SESSION_TIMEOUT = 900
client.settimeout(SESSION_TIMEOUT)
```

### Sample Data Details

#### HTTP/HTTPS (nginx)
- **Location**: `docker/nginx/html/`
- **Files**:
  - `index.html` - Protocol overview page
  - `/api` endpoint - Test API returning JSON
  - `/health` endpoint - Health check

#### FTP (vsftpd)
- **Location**: Container `/home/vsftpd/testuser/`
- **Directories**:
  - `downloads/` - Pre-populated test files
  - `uploads/` - Writable directory for testing uploads
  - `public/` - Public files
  - `private/` - Private directory
- **Test Files**:
  - `welcome.txt` - Simple text file
  - `sample.txt` - Text sample
  - `timestamp.txt` - Timestamped file
  - `random_1mb.bin` - 1MB random binary data
  - `zeros_5mb.bin` - 5MB zero-filled file
  - `sample.csv` - CSV data
  - `sample.json` - JSON data

#### MySQL
- **Database**: `testdb`
- **Tables**:
  - `users` - 5 sample users
  - `products` - 8 sample products
  - `orders` - 6 sample orders
- **Views**: `order_summary` - Joined order details
- **Stored Procedures**: `GetUserOrders(userId)`

#### PostgreSQL
- **Database**: `testdb`
- **Tables**: Same structure as MySQL
  - `users` - 5 sample users
  - `products` - 8 sample products
  - `orders` - 6 sample orders
- **Views**: `order_summary`
- **Functions**: `get_user_order_count(user_id)`

#### Redis
Pre-populated with:
- **Strings**: `greeting`, `counter`, `pi`
- **Hashes**: `user:1`, `user:2`, `user:3`
- **Lists**: `tasks` (4 items)
- **Sets**: `tags:programming`, `tags:databases`
- **Sorted Sets**: `leaderboard` (4 entries)
- **JSON Strings**: `config:app`, `config:db`

#### MongoDB
- **Database**: `testdb`
- **Collections**:
  - `users` - 3 documents with nested profiles
  - `products` - 3 documents with tags array
  - `orders` - 2 documents with embedded items
- **Indexes**: On `username`, `email`, `name`, `tags`, `userId`, `status`

#### Email Server
- **Mailbox**: `test@testserver.local`
- **Pre-loaded Messages**: System welcome emails
- **Capabilities**: Send and receive test emails

#### MQTT
- **Topics**: `test-channel` (for pub/sub testing)
- **Retained Messages**: None initially
- **QoS Levels**: 0, 1, 2 supported

#### Simple Protocols
- **Echo**: Returns exactly what you send
- **Discard**: Silently discards all data
- **Daytime**: Returns current date/time on connect
- **Chargen**: Streams rotating ASCII characters
- **Time**: Returns seconds since 1900 epoch (binary)
- **Finger**: Returns user info for `testuser`, `alice`, or list all

## Security

### ⚠️ Critical Security Warnings

**THIS IS A TEST SERVER**. It is designed for protocol development and testing in **controlled environments only**.

### 🔴 Container Escape Prevention

**CRITICAL**: The default configuration has multiple attack vectors for container escape and privilege escalation. This section documents hardening measures to lock down containers.

#### Identified Attack Vectors

1. **NET_ADMIN Capability** - mailserver has NET_ADMIN (can manipulate network stack)
2. **Root Processes** - telnet service runs as root inside container
3. **No Capability Dropping** - Containers retain default capabilities
4. **No Seccomp Filtering** - System calls not restricted
5. **Writable Root Filesystem** - Containers can modify their own rootfs
6. **No Resource Limits** - Fork bombs and DoS possible
7. **Host Path Mounts** - Config files mounted from host (read-only, but still risky)
8. **No User Namespace Remapping** - Container root = host root (UID 0)

#### Hardening Measures (Apply ALL for Production)

##### 1. Enable Docker User Namespace Remapping

**HIGHEST PRIORITY**: Prevents container root from being host root.

```bash
# Edit Docker daemon config
sudo nano /etc/docker/daemon.json
```

Add:
```json
{
  "userns-remap": "default",
  "live-restore": true,
  "userland-proxy": false
}
```

```bash
# Restart Docker (WARNING: Rebuilds all containers)
sudo systemctl restart docker

# Verify
docker info | grep "userns"
```

This creates subordinate UID/GID mapping where container UID 0 maps to host UID 100000+.

##### 2. Apply Seccomp Profile

Create a custom seccomp profile to block dangerous syscalls:

```bash
# Download Docker's default seccomp profile
curl -o /etc/docker/seccomp-default.json \
  https://raw.githubusercontent.com/moby/moby/master/profiles/seccomp/default.json
```

Then apply in docker-compose.yml:
```yaml
services:
  nginx:
    security_opt:
      - seccomp=/etc/docker/seccomp-default.json
      - no-new-privileges:true
      - apparmor=docker-default
```

##### 3. Drop All Capabilities and Add Only Required

**Default docker-compose.yml should be updated with:**

```yaml
# Example for nginx (apply to all services)
nginx:
  cap_drop:
    - ALL
  cap_add:
    - CHOWN        # Only if needed
    - SETGID       # Only if needed
    - SETUID       # Only if needed
    - NET_BIND_SERVICE  # For ports < 1024
  security_opt:
    - no-new-privileges:true
```

**Capability audit per service:**
- **nginx**: NET_BIND_SERVICE (ports 80, 443)
- **vsftpd**: NET_BIND_SERVICE, CHOWN, SETGID, SETUID
- **openssh**: NET_BIND_SERVICE, SYS_CHROOT (may need more)
- **mailserver**: NET_BIND_SERVICE (remove NET_ADMIN if possible)
- **databases**: CHOWN, SETGID, SETUID, DAC_OVERRIDE
- **simple-protocols**: NET_BIND_SERVICE (privileged ports)
- **telnet**: NET_BIND_SERVICE, SYS_CHROOT

##### 4. Enable Read-Only Root Filesystem

Where possible, mount container root filesystem as read-only:

```yaml
services:
  nginx:
    read_only: true
    tmpfs:
      - /var/run:size=10M
      - /var/cache/nginx:size=100M
      - /tmp:size=10M
```

**Services that can use read_only:**
- nginx ✅
- redis ✅ (with tmpfs /tmp)
- memcached ✅
- simple-protocols ✅

**Services requiring writable rootfs:**
- Databases (MySQL, PostgreSQL, MongoDB)
- Mail server
- FTP server
- SSH server

##### 5. Enforce Resource Limits (Prevent DoS)

```yaml
services:
  nginx:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
          pids: 100        # Prevent fork bombs
        reservations:
          cpus: '0.1'
          memory: 64M
```

**Recommended limits per service:**
```yaml
# Lightweight services
nginx, simple-protocols, memcached, redis:
  cpus: '0.5'
  memory: 256M
  pids: 100

# Medium services
vsftpd, openssh, mosquitto, ircd:
  cpus: '1.0'
  memory: 512M
  pids: 200

# Heavy services
mysql, postgres, mongodb, mailserver:
  cpus: '2.0'
  memory: 2G
  pids: 500
```

##### 6. Disable Inter-Container Communication

```yaml
networks:
  testnet:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
    internal: false  # Set to 'true' to block internet access
```

This prevents containers from directly communicating unless explicitly linked.

##### 7. Run Containers as Non-Root User

**Check which containers run as root:**
```bash
docker-compose exec nginx id
docker-compose exec mysql id
```

**Force non-root:**
```yaml
services:
  nginx:
    user: "1000:1000"  # Run as UID 1000

  # For images that don't support user override:
  telnet:
    # Don't run telnetd as root
    command: >
      bash -c "
        ...
        useradd -u 1001 -m telnetuser &&
        sudo -u telnetuser xinetd -dontfork
      "
```

##### 8. Harden Docker Daemon

```bash
# /etc/docker/daemon.json
{
  "userns-remap": "default",
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true,
  "icc": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}
```

##### 9. Audit Docker Events

Monitor for suspicious activity:
```bash
# Real-time monitoring
docker events --filter 'type=container' --format '{{.Time}} {{.Status}} {{.Actor.Attributes.name}}'

# Log to file
docker events --filter 'type=container' >> /var/log/docker-events.log &
```

##### 10. Use AppArmor or SELinux

**For Ubuntu (AppArmor):**
```bash
# Check AppArmor is enabled
sudo aa-status

# Load Docker profile
sudo apparmor_parser -r /etc/apparmor.d/docker

# Apply to containers
# In docker-compose.yml:
security_opt:
  - apparmor=docker-default
```

**For RHEL/CentOS (SELinux):**
```bash
# Check SELinux is enabled
getenforce

# Apply to containers
security_opt:
  - label=type:docker_t
```

##### 11. Prevent Mount Namespace Escapes

Avoid mounting sensitive host paths:

**❌ NEVER mount these:**
```yaml
volumes:
  - /:/host                    # Never mount host root
  - /var/run/docker.sock:/...  # Never expose Docker socket
  - /proc:/host/proc           # Never mount host proc
  - /sys:/host/sys             # Never mount host sys
  - /boot:/boot                # Never mount kernel files
```

**✅ Current mounts are safe (read-only configs):**
```yaml
volumes:
  - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro  # ✅ Read-only
  - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro  # ✅ Read-only
```

##### 12. Network Isolation with iptables

```bash
# Block container-to-host communication except necessary ports
sudo iptables -I DOCKER-USER -i docker0 -j DROP
sudo iptables -I DOCKER-USER -i docker0 -d 169.254.169.254 -j DROP  # Block metadata service
sudo iptables -I DOCKER-USER -i docker0 -p tcp --dport 53 -j ACCEPT  # Allow DNS
sudo iptables -I DOCKER-USER -i docker0 -p udp --dport 53 -j ACCEPT

# Save rules
sudo iptables-save > /etc/iptables/rules.v4
```

##### 13. Enable Kernel Hardening

```bash
# /etc/sysctl.d/99-docker-security.conf
# Prevent kernel pointer leaks
kernel.kptr_restrict = 2

# Restrict dmesg access
kernel.dmesg_restrict = 1

# Restrict kernel profiling
kernel.perf_event_paranoid = 3

# Disable kexec
kernel.kexec_load_disabled = 1

# Enable ASLR
kernel.randomize_va_space = 2

# Restrict BPF
kernel.unprivileged_bpf_disabled = 1

# Apply
sudo sysctl -p /etc/sysctl.d/99-docker-security.conf
```

##### 14. Scan Images for Vulnerabilities

```bash
# Install Trivy
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee -a /etc/apt/sources.list.d/trivy.list
sudo apt update && sudo apt install trivy

# Scan all images
docker-compose config | grep 'image:' | awk '{print $2}' | xargs -I {} trivy image {}

# Example
trivy image nginx:alpine
trivy image mysql:8.0
```

##### 15. Implement Defense in Depth

**Layered security approach:**
```
┌─────────────────────────────────────────┐
│ Layer 1: UFW Firewall (Host)           │  ← Block all except allowed IPs
├─────────────────────────────────────────┤
│ Layer 2: Docker Network (testnet)      │  ← Isolate containers
├─────────────────────────────────────────┤
│ Layer 3: Seccomp + AppArmor            │  ← Syscall filtering
├─────────────────────────────────────────┤
│ Layer 4: Capability Dropping           │  ← Remove Linux capabilities
├─────────────────────────────────────────┤
│ Layer 5: User Namespaces               │  ← UID remapping
├─────────────────────────────────────────┤
│ Layer 6: Read-Only Rootfs              │  ← Immutable containers
├─────────────────────────────────────────┤
│ Layer 7: Resource Limits               │  ← Prevent DoS
├─────────────────────────────────────────┤
│ Layer 8: Monitoring & Auditing         │  ← Detect breaches
└─────────────────────────────────────────┘
```

##### 16. Hardened docker-compose.yml Example

See [docker-compose.hardened.yml](../docker-compose.hardened.yml) for a fully hardened configuration with all security measures applied.

**To use:**
```bash
# Backup original
cp docker-compose.yml docker-compose.original.yml

# Use hardened version
cp docker-compose.hardened.yml docker-compose.yml

# Deploy
docker-compose up -d
```

##### 17. Regular Security Audits

```bash
# Check for privileged containers
docker ps --filter "label=privileged=true"

# Check for containers running as root
docker ps -q | xargs docker inspect --format '{{.Name}} {{.Config.User}}' | grep -E "^/.+ $"

# Check for host network mode (dangerous)
docker ps -q | xargs docker inspect --format '{{.Name}} {{.HostConfig.NetworkMode}}' | grep host

# Check mounted volumes
docker ps -q | xargs docker inspect --format '{{.Name}} {{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}'

# Check capabilities
docker ps -q | xargs docker inspect --format '{{.Name}} {{.HostConfig.CapAdd}} {{.HostConfig.CapDrop}}'
```

##### 18. Emergency Container Isolation

If you suspect a container has been compromised:

```bash
# Immediately disconnect from network
docker network disconnect testnet testserver-[compromised]

# Stop container
docker stop testserver-[compromised]

# Capture forensics
docker export testserver-[compromised] > compromised-container.tar
docker logs testserver-[compromised] > compromised-logs.txt

# Inspect
docker inspect testserver-[compromised] > compromised-inspect.json

# Remove
docker rm testserver-[compromised]
```

##### 19. Runtime Security Monitoring

Install Falco for runtime threat detection:

```bash
# Install Falco
curl -s https://falco.org/repo/falcosecurity-3672BA8F.asc | sudo apt-key add -
echo "deb https://download.falco.org/packages/deb stable main" | sudo tee -a /etc/apt/sources.list.d/falcosecurity.list
sudo apt update && sudo apt install falco

# Start Falco
sudo systemctl start falco

# Monitor logs
sudo journalctl -fu falco
```

Falco will alert on:
- Container escapes
- Privilege escalations
- Unexpected syscalls
- File modifications in /etc
- Shell spawned in container

##### 20. Automated Security Auditing

Use the included security audit script to check for vulnerabilities:

```bash
# Run security audit (requires sudo for some checks)
sudo ./security-audit.sh
```

The audit script checks for:
- ✅ Privileged containers
- ✅ Containers running as root
- ✅ Dangerous capabilities (SYS_ADMIN, NET_ADMIN, etc.)
- ✅ Mounted Docker socket
- ✅ Host network mode
- ✅ no-new-privileges flag
- ✅ Seccomp profiles
- ✅ Read-only root filesystems
- ✅ Resource limits (CPU, memory, PIDs)
- ✅ Sensitive host path mounts
- ✅ Docker user namespace remapping
- ✅ AppArmor/SELinux status
- ✅ Image vulnerabilities (with Trivy)
- ✅ Firewall status (UFW)

**Example output:**
```
[PASS] No privileged containers found
[FAIL] testserver-mysql is running as root (UID 0)
[WARN] testserver-nginx: no-new-privileges not set
[FAIL] Docker user namespace remapping NOT enabled
```

**Run audit regularly:**
```bash
# Add to cron for daily checks
echo "0 2 * * * /opt/portofcall/security-audit.sh > /var/log/docker-audit.log 2>&1" | sudo crontab -
```

### Security Hardening Checklist

Before deploying to production, complete this checklist:

#### Pre-Deployment (Required)

- [ ] Enable Docker user namespace remapping (`/etc/docker/daemon.json`)
- [ ] Download seccomp profile to `/etc/docker/seccomp-default.json`
- [ ] Enable and configure UFW firewall
- [ ] Change all default passwords in `.env`
- [ ] Replace self-signed SSL certificates with Let's Encrypt
- [ ] Use `docker-compose.hardened.yml` instead of `docker-compose.yml`
- [ ] Run security audit: `sudo ./security-audit.sh`
- [ ] Scan all images: `trivy image [image-name]`

#### Network Security (Required)

- [ ] Configure UFW to allow only specific IPs
- [ ] Disable inter-container communication (ICC) in Docker network
- [ ] Set up iptables rules to block metadata service (169.254.169.254)
- [ ] Configure fail2ban for SSH and other services
- [ ] Enable connection rate limiting in nginx

#### Container Hardening (Recommended)

- [ ] Apply seccomp profiles to all containers
- [ ] Drop all capabilities, add only required ones
- [ ] Enable `no-new-privileges` on all containers
- [ ] Use read-only root filesystem where possible
- [ ] Set resource limits (CPU, memory, PIDs) on all containers
- [ ] Run containers as non-root users
- [ ] Enable AppArmor or SELinux profiles

#### Monitoring & Auditing (Recommended)

- [ ] Install and configure Falco for runtime security
- [ ] Set up centralized logging (ELK, Splunk, etc.)
- [ ] Configure Docker event logging
- [ ] Schedule daily security audits (cron)
- [ ] Set up alerts for failed authentication attempts
- [ ] Monitor disk usage and resource consumption

#### Ongoing Maintenance (Required)

- [ ] Regularly update Docker images: `docker-compose pull`
- [ ] Apply security patches to host OS: `sudo apt update && sudo apt upgrade`
- [ ] Review and rotate credentials quarterly
- [ ] Audit firewall rules monthly
- [ ] Review container logs for anomalies
- [ ] Re-scan images after updates: `trivy image --clear-cache [image]`

#### Advanced Hardening (Optional)

- [ ] Implement network policies (Calico, Cilium)
- [ ] Use external secrets management (HashiCorp Vault)
- [ ] Set up intrusion detection (Snort, Suricata)
- [ ] Enable kernel hardening (`/etc/sysctl.d/`)
- [ ] Implement host-based IDS (AIDE, OSSEC)
- [ ] Configure audit logging (auditd)

### Quick Reference: Attack Surface Reduction

```
┌─────────────────────────────────────────────────────────────┐
│ Attack Vector              │ Mitigation                      │
├────────────────────────────┼─────────────────────────────────┤
│ Container → Host Escape    │ User namespace remapping        │
│ Privilege Escalation       │ no-new-privileges, drop caps    │
│ Kernel Exploits            │ Seccomp, AppArmor, SELinux      │
│ Fork Bombs / DoS           │ Resource limits (PIDs, memory)  │
│ File System Tampering      │ Read-only rootfs, tmpfs         │
│ Network Attacks            │ UFW, iptables, disable ICC      │
│ Docker Socket Access       │ Never mount /var/run/docker.sock│
│ Sensitive Data Leaks       │ No host path mounts, secrets    │
│ Vulnerable Images          │ Trivy scanning, regular updates │
│ Lateral Movement           │ Network isolation, ICC disabled │
└────────────────────────────┴─────────────────────────────────┘
```

### Recommended Security Practices

#### 1. Firewall Configuration (UFW)

**IMPORTANT**: Restrict access to your IP or testing IPs only:

```bash
# Enable UFW
sudo ufw enable

# Allow SSH (for server management)
sudo ufw allow 22/tcp

# Block all incoming by default
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow specific IPs only (replace with your IP)
sudo ufw allow from YOUR_IP_ADDRESS to any

# Or allow specific ports from specific IPs
sudo ufw allow from YOUR_IP_ADDRESS to any port 80 proto tcp
sudo ufw allow from YOUR_IP_ADDRESS to any port 443 proto tcp
sudo ufw allow from YOUR_IP_ADDRESS to any port 2222 proto tcp

# Check rules
sudo ufw status verbose
```

#### 2. Docker Network Isolation

Services communicate via Docker's internal network (`testnet`). External access is controlled via exposed ports.

To further isolate:
```yaml
# In docker-compose.yml, remove port mappings for internal-only services
# For example, if Redis should only be accessed by other containers:
services:
  redis:
    # Remove or comment out:
    # ports:
    #   - "6379:6379"
```

#### 3. Change Default Passwords

**Before exposing to any network**, change all default passwords:

```bash
# Edit .env file
nano .env

# Change these values:
TEST_USER=your_username
TEST_PASS=your_strong_password
MYSQL_ROOT_PASSWORD=strong_mysql_password
POSTGRES_PASSWORD=strong_postgres_password
MONGO_ROOT_PASSWORD=strong_mongo_password
```

Then rebuild:
```bash
docker-compose down
docker-compose up -d
```

#### 4. Use SSL/TLS

- **HTTPS**: Self-signed certificate included. For production, use Let's Encrypt.
- **FTPS**: Configure explicit FTP over TLS in vsftpd.
- **IMAPS/POP3S**: Already configured (ports 993, 995).
- **SMTPS**: Port 465 can be enabled in mailserver config.

#### 5. Rate Limiting

Consider using `fail2ban` or nginx rate limiting:

```nginx
# Add to nginx.conf
limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;

location / {
    limit_req zone=general burst=20 nodelay;
}
```

#### 6. Monitoring & Logging

All services log to Docker logs:
```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f nginx
docker-compose logs -f mysql

# Save logs to file
docker-compose logs > testserver-logs.txt
```

#### 7. Regular Updates

Keep Docker images updated:
```bash
docker-compose pull
docker-compose up -d
```

#### 8. VPS-Specific Security

For Digital Ocean or other VPS providers:

```bash
# Disable root SSH login
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Enable automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Install fail2ban
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Monitor connections
sudo apt install netstat-nat
netstat -tulpn | grep LISTEN
```

#### 9. Cloudflare Workers Testing

When testing with Cloudflare Workers:

- **DO NOT** expose this server to the public internet
- Use a **VPN** or **private network** for Worker-to-server connections
- Or use **Cloudflare Tunnel** (cloudflared) for secure access
- Set up **IP allowlisting** for Cloudflare's IP ranges only

#### 10. Production Deployment

**DO NOT use this configuration in production!**

For production deployments:
- Use proper SSL certificates (Let's Encrypt)
- Implement authentication and authorization
- Use secrets management (Docker secrets, Vault)
- Enable audit logging
- Run services as non-root users (already done for custom services)
- Implement network policies and segmentation
- Use read-only file systems where possible
- Regular security audits and penetration testing

## Testing Procedures

### Quick Tests

Test each protocol is accessible:

```bash
# HTTP
curl http://localhost

# HTTPS (ignore self-signed cert)
curl -k https://localhost

# FTP
echo "quit" | ftp localhost 21

# SSH
ssh -p 2222 -o ConnectTimeout=5 testuser@localhost "echo 'SSH works'"

# MySQL
mysql -h localhost -P 3306 -u testuser -ptestpass123 -e "SELECT 1;"

# PostgreSQL
PGPASSWORD=rootpass123 psql -h localhost -p 5432 -U testuser -d testdb -c "SELECT 1;"

# Redis
redis-cli -h localhost ping

# Echo protocol
echo "hello" | nc localhost 7

# Daytime protocol
nc localhost 13

# Finger protocol
echo "" | nc localhost 79
```

### Comprehensive Protocol Tests

#### HTTP/HTTPS
```bash
# Test HTTP
curl http://localhost
curl http://localhost/api

# Test HTTPS
curl -k https://localhost
curl -k https://localhost/api

# Test timeout (should stay open for 15 minutes)
curl --max-time 901 http://localhost/health
```

#### FTP
```bash
# Connect and list files
ftp -n localhost <<EOF
user testuser testpass123
cd downloads
ls
get welcome.txt
bye
EOF

# Test upload
echo "test upload" > test_upload.txt
ftp -n localhost <<EOF
user testuser testpass123
cd uploads
put test_upload.txt
bye
EOF
```

#### SSH
```bash
# Password auth
sshpass -p testpass123 ssh -p 2222 -o StrictHostKeyChecking=no testuser@localhost "ls -la"

# SFTP file transfer
sftp -P 2222 testuser@localhost <<EOF
cd /home/testuser
ls
bye
EOF
```

#### MySQL
```bash
# Connect and query
mysql -h localhost -P 3306 -u testuser -ptestpass123 testdb <<EOF
SELECT * FROM users LIMIT 5;
SELECT * FROM products WHERE price < 200;
SELECT COUNT(*) FROM orders;
SHOW TABLES;
EOF
```

#### PostgreSQL
```bash
# Connect and query
PGPASSWORD=rootpass123 psql -h localhost -p 5432 -U testuser -d testdb <<EOF
SELECT * FROM users LIMIT 5;
SELECT * FROM products WHERE price < 200;
SELECT COUNT(*) FROM orders;
\\dt
EOF
```

#### Redis
```bash
# Test commands
redis-cli -h localhost <<EOF
GET greeting
HGETALL user:1
LRANGE tasks 0 -1
SMEMBERS tags:programming
ZRANGE leaderboard 0 -1 WITHSCORES
PING
EOF
```

#### MongoDB
```bash
# Using mongosh
mongosh "mongodb://testuser:testpass123@localhost:27017/testdb?authSource=admin" <<EOF
db.users.find().pretty()
db.products.find({price: {\$lt: 200}})
db.orders.countDocuments()
show collections
EOF
```

#### MQTT
```bash
# Subscribe to topic (in one terminal)
mosquitto_sub -h localhost -p 1883 -u testuser -P testpass123 -t "test/#" -v

# Publish message (in another terminal)
mosquitto_pub -h localhost -p 1883 -u testuser -P testpass123 -t "test/hello" -m "Hello MQTT"
```

#### Simple Protocols
```bash
# Echo
echo "Hello World" | nc localhost 7

# Discard (sends data, returns nothing)
echo "This will be discarded" | nc localhost 9

# Daytime
nc localhost 13

# Chargen (press Ctrl+C to stop)
nc localhost 19

# Time (returns binary, use od to view)
nc localhost 37 | od -An -td4

# Finger (list users)
echo "" | nc localhost 79

# Finger (specific user)
echo "testuser" | nc localhost 79
```

### Session Timeout Tests

Test that sessions properly timeout after 15 minutes:

```bash
# SSH timeout test (should disconnect after 15 min of inactivity)
ssh -p 2222 testuser@localhost
# Wait 15 minutes without typing
# Should see: "Connection closed by remote host"

# FTP timeout test
ftp localhost 21
# Login and wait 15 minutes
# Should see: "421 Timeout"

# MySQL timeout test
mysql -h localhost -P 3306 -u testuser -ptestpass123 testdb
# Wait 15 minutes in mysql shell
# Try a query: "MySQL server has gone away"
```

## Troubleshooting

### Common Issues

#### 1. Port Already in Use

**Error**: `Bind for 0.0.0.0:80 failed: port is already allocated`

**Solution**:
```bash
# Find process using port
sudo lsof -i :80

# Kill process or stop conflicting service
sudo systemctl stop apache2  # or nginx, etc.

# Or change port in docker-compose.yml
ports:
  - "8080:80"  # Use 8080 instead of 80
```

#### 2. Permission Denied

**Error**: `Permission denied while trying to connect to Docker daemon`

**Solution**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, or:
newgrp docker

# Test
docker ps
```

#### 3. Container Fails to Start

**Error**: Service exits immediately

**Solution**:
```bash
# Check logs
docker-compose logs [service-name]

# Example
docker-compose logs mysql

# Rebuild if needed
docker-compose build --no-cache [service-name]
docker-compose up -d [service-name]
```

#### 4. Cannot Connect to Service

**Error**: `Connection refused` or `Connection timeout`

**Solution**:
```bash
# Check if container is running
docker-compose ps

# Check if port is listening
sudo netstat -tulpn | grep [port]

# Check firewall
sudo ufw status

# Test from inside Docker network
docker exec -it testserver-nginx sh
nc -zv redis 6379
```

#### 5. SSL Certificate Errors

**Error**: `SSL certificate problem: self signed certificate`

**Solution**:
```bash
# For testing, ignore certificate errors:
curl -k https://localhost

# Or regenerate certificate:
./setup-testserver.sh  # Will regenerate if missing
```

#### 6. Database Connection Fails

**Error**: `Access denied for user`

**Solution**:
```bash
# Check credentials in .env file
cat .env

# Restart database container
docker-compose restart mysql
docker-compose restart postgres

# Re-run init scripts
docker-compose down -v  # WARNING: Deletes all data
docker-compose up -d
```

#### 7. Out of Disk Space

**Error**: `no space left on device`

**Solution**:
```bash
# Check disk usage
df -h

# Clean up Docker
docker system prune -a --volumes

# Remove old containers
docker-compose down -v

# Rebuild
docker-compose up -d
```

### Service-Specific Troubleshooting

#### nginx
```bash
# Test config syntax
docker exec testserver-nginx nginx -t

# Reload config
docker exec testserver-nginx nginx -s reload

# View error logs
docker-compose logs nginx
```

#### MySQL
```bash
# Connect as root
docker exec -it testserver-mysql mysql -uroot -prootpass123

# Check users
SELECT user, host FROM mysql.user;

# Check databases
SHOW DATABASES;
```

#### PostgreSQL
```bash
# Connect as testuser
docker exec -it testserver-postgres psql -U testuser -d testdb

# List databases
\\l

# List tables
\\dt
```

#### Redis
```bash
# Connect to Redis CLI
docker exec -it testserver-redis redis-cli

# Check info
INFO

# List keys
KEYS *
```

### Performance Tuning

If experiencing performance issues:

```yaml
# In docker-compose.yml, adjust resource limits:
services:
  mysql:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          memory: 512M
```

### Getting Help

If you encounter issues not covered here:

1. Check container logs: `docker-compose logs -f [service]`
2. Review service-specific documentation
3. Check Docker network: `docker network inspect portofcall_testnet`
4. Verify connectivity: `docker exec [container] ping [other-container]`
5. Check resource usage: `docker stats`

## Maintenance

### Backups

Important data to backup:

```bash
# Backup databases
docker exec testserver-mysql mysqldump -uroot -prootpass123 testdb > backup-mysql.sql
docker exec testserver-postgres pg_dump -U testuser testdb > backup-postgres.sql

# Backup Docker volumes
docker run --rm -v portofcall_mysql_data:/data -v $(pwd):/backup ubuntu tar czf /backup/mysql_data.tar.gz /data
```

### Updates

```bash
# Pull latest images
docker-compose pull

# Rebuild custom images
docker-compose build

# Restart with new images
docker-compose up -d
```

### Clean Slate

To completely reset:

```bash
# Stop and remove everything
docker-compose down -v

# Remove generated files
rm -rf docker/nginx/ssl/*
rm -rf docker/mailserver/config/*

# Re-run setup
./setup-testserver.sh
docker-compose up -d
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Host (Ubuntu 24.04)                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Docker Network: testnet (bridge)                ││
│  │                                                               ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   ││
│  │  │  nginx   │  │ vsftpd   │  │ openssh  │  │   mail   │   ││
│  │  │  :80,443 │  │  :21     │  │  :2222   │  │:25,143,  │   ││
│  │  └──────────┘  └──────────┘  └──────────┘  │ 110,587  │   ││
│  │                                              └──────────┘   ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   ││
│  │  │  mysql   │  │ postgres │  │  redis   │  │ mongodb  │   ││
│  │  │  :3306   │  │  :5432   │  │  :6379   │  │  :27017  │   ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   ││
│  │                                                               ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   ││
│  │  │mosquitto │  │  ircd    │  │ telnet   │  │ simple   │   ││
│  │  │  :1883   │  │  :6667   │  │  :23     │  │protocols │   ││
│  │  └──────────┘  └──────────┘  └──────────┘  │:7,9,13,  │   ││
│  │                                              │19,37,79  │   ││
│  │                                              └──────────┘   ││
│  └───────────────────────────────────────────────────────────┘│
│                                                                   │
│  Volumes: ftp_data, ssh_data, mysql_data, postgres_data, etc.   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Internet / VPN / Testing Client
                              │
                        ┌─────────────┐
                        │   Firewall  │
                        │    (UFW)    │
                        └─────────────┘
```

## License

This test server configuration is part of the Port of Call project. See LICENSE for details.

## Contributing

Found a bug or want to add a protocol? Open an issue or pull request!

## Support

For questions or issues:
- Check [Troubleshooting](#troubleshooting) section
- Review container logs
- Consult service-specific documentation

---

**Last Updated**: 2024-02-16
**Version**: 1.0
**Compatible With**: Port of Call v1.0+
