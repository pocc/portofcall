# Security Documentation

## Overview

This document outlines the security measures, hardening steps, and threat model for the multi-protocol test server.

**⚠️ CRITICAL**: The default `docker-compose.yml` configuration is **NOT production-ready**. It contains multiple container escape vectors and privilege escalation risks. **Use `docker-compose.hardened.yml` for any deployment beyond localhost testing.**

## Threat Model

### Attack Vectors

1. **Container Escape** - Attacker gains access to host system from within container
2. **Privilege Escalation** - Attacker elevates from container user to root
3. **Lateral Movement** - Attacker moves between containers
4. **Resource Exhaustion** - DoS via fork bombs or memory exhaustion
5. **Data Exfiltration** - Attacker accesses sensitive host files
6. **Network Attacks** - Exploitation of exposed services

### Assets to Protect

- **Host System** - VPS operating system and kernel
- **Docker Daemon** - Container runtime
- **Host Filesystem** - Configuration files, logs, data
- **Network** - Other containers and external services
- **Credentials** - Database passwords, API keys

## Security Controls

### Layer 1: Network Perimeter

```
Internet → UFW Firewall → Docker Network → Containers
```

- **UFW Firewall**: IP allowlisting, port restrictions
- **iptables**: Block Docker metadata service (169.254.169.254)
- **fail2ban**: Automatic IP blocking on failed auth attempts
- **Rate Limiting**: nginx connection limits

### Layer 2: Container Isolation

```
Container → User Namespace → Host (UID remapping)
Container → Seccomp → Kernel (syscall filtering)
Container → AppArmor/SELinux → Resources (mandatory access control)
Container → Capabilities → Privileges (Linux capabilities)
```

- **User Namespaces**: Container root ≠ host root
- **Seccomp Profiles**: Block dangerous syscalls
- **AppArmor/SELinux**: Mandatory access control
- **Capability Dropping**: Minimal Linux capabilities
- **no-new-privileges**: Prevent privilege escalation

### Layer 3: Resource Limits

- **CPU Limits**: Prevent CPU exhaustion
- **Memory Limits**: Prevent OOM attacks
- **PID Limits**: Prevent fork bombs
- **Network Bandwidth**: Rate limiting via nginx

### Layer 4: Filesystem Isolation

- **Read-Only Rootfs**: Immutable container filesystem (where possible)
- **tmpfs**: In-memory temporary filesystems
- **Volume Isolation**: Named volumes, no host path mounts
- **No Sensitive Mounts**: Never mount `/`, `/proc`, `/sys`, `/boot`, Docker socket

### Layer 5: Monitoring & Detection

- **Falco**: Runtime threat detection
- **Docker Events**: Audit logging
- **Container Logs**: Centralized logging
- **Security Audits**: Automated vulnerability scanning

## Configuration Comparison

### Default vs. Hardened

| Security Control | docker-compose.yml | docker-compose.hardened.yml |
|------------------|--------------------|-----------------------------|
| User Namespace Remapping | ❌ No | ✅ Yes (requires daemon config) |
| Capability Dropping | ❌ No | ✅ Yes (drop ALL, add minimal) |
| no-new-privileges | ❌ No | ✅ Yes (all containers) |
| Seccomp Profiles | ⚠️ Default only | ✅ Custom profiles |
| AppArmor/SELinux | ⚠️ Default only | ✅ Explicit profiles |
| Read-Only Rootfs | ❌ No | ✅ Where possible |
| Resource Limits | ❌ No | ✅ Yes (CPU, memory, PIDs) |
| ICC Disabled | ❌ No | ✅ Yes |
| Non-Root Users | ⚠️ Some | ✅ All containers |

## Quick Start: Secure Deployment

### 1. Enable Docker User Namespace Remapping

```bash
# /etc/docker/daemon.json
{
  "userns-remap": "default",
  "live-restore": true,
  "no-new-privileges": true
}

sudo systemctl restart docker
```

### 2. Download Seccomp Profile

```bash
sudo mkdir -p /etc/docker
sudo curl -o /etc/docker/seccomp-default.json \
  https://raw.githubusercontent.com/moby/moby/master/profiles/seccomp/default.json
```

### 3. Configure Firewall

```bash
sudo ufw enable
sudo ufw allow from YOUR_IP_ADDRESS
sudo ufw status verbose
```

### 4. Use Hardened Configuration

```bash
cp docker-compose.hardened.yml docker-compose.yml
docker-compose up -d
```

### 5. Run Security Audit

```bash
sudo ./security-audit.sh
```

## Security Audit Script

The `security-audit.sh` script checks for 14 security misconfigurations:

```bash
sudo ./security-audit.sh
```

**Checks performed:**
1. Privileged containers
2. Containers running as root (UID 0)
3. Dangerous capabilities (SYS_ADMIN, NET_ADMIN, etc.)
4. Mounted Docker socket (allows escape)
5. Host network mode (bypasses isolation)
6. no-new-privileges flag
7. Seccomp profiles
8. Read-only root filesystem
9. Resource limits (DoS prevention)
10. Sensitive host path mounts
11. Docker user namespace remapping
12. AppArmor/SELinux status
13. Image vulnerabilities (Trivy)
14. Firewall status (UFW)

## Known Vulnerabilities (Default Configuration)

### HIGH: Container Root = Host Root

**Impact**: Container root user has UID 0 on host
**Exploit**: Kernel vulnerability → host root access
**Mitigation**: Enable Docker user namespace remapping

### HIGH: Telnet Container Runs as Root

**Impact**: Telnet process runs as root inside container
**Exploit**: Container escape → root shell on host
**Mitigation**: Run xinetd as non-root user (see hardened config)

### MEDIUM: mailserver Has NET_ADMIN Capability

**Impact**: Can manipulate network stack (routes, iptables)
**Exploit**: Network poisoning, ARP spoofing
**Mitigation**: Remove NET_ADMIN if not absolutely required

### MEDIUM: No Resource Limits

**Impact**: Fork bombs and memory exhaustion possible
**Exploit**: Infinite process spawning, OOM killer triggers
**Mitigation**: Set CPU, memory, and PID limits

### MEDIUM: Writable Root Filesystem

**Impact**: Attackers can modify container binaries
**Exploit**: Persistent backdoors in container
**Mitigation**: Use read-only rootfs with tmpfs

### LOW: No Seccomp Filtering

**Impact**: Containers can use all syscalls
**Exploit**: Kernel vulnerabilities exploitable
**Mitigation**: Apply custom seccomp profiles

## Incident Response

### If You Suspect Container Compromise

1. **Isolate Container**
   ```bash
   docker network disconnect testnet [container]
   docker stop [container]
   ```

2. **Capture Forensics**
   ```bash
   docker export [container] > compromised.tar
   docker logs [container] > compromised-logs.txt
   docker inspect [container] > compromised-inspect.json
   ```

3. **Analyze**
   ```bash
   # Check for suspicious processes
   docker top [container]

   # Check for network connections
   docker exec [container] netstat -tulpn

   # Check for modified files
   docker diff [container]
   ```

4. **Remove and Rebuild**
   ```bash
   docker rm [container]
   docker-compose up -d [container]
   ```

5. **Update Firewall**
   ```bash
   # Block attacker IP
   sudo ufw deny from ATTACKER_IP
   ```

## Security Best Practices

### DO ✅

- Use `docker-compose.hardened.yml` for production
- Enable Docker user namespace remapping
- Configure UFW firewall with IP allowlisting
- Run security audits regularly (`./security-audit.sh`)
- Scan images with Trivy before deployment
- Update images and host OS regularly
- Monitor logs for suspicious activity
- Use strong, unique passwords
- Rotate credentials quarterly
- Implement rate limiting
- Enable Falco for runtime monitoring

### DON'T ❌

- **NEVER** mount Docker socket (`/var/run/docker.sock`)
- **NEVER** run containers with `--privileged` flag
- **NEVER** mount host root (`/`) into containers
- **NEVER** use `--net=host` network mode
- **NEVER** disable security features for convenience
- **NEVER** use default passwords in production
- **NEVER** expose Docker daemon port (2375/2376)
- **NEVER** run untrusted images without scanning
- **NEVER** ignore security audit failures

## Compliance & Standards

This configuration can be aligned with:

- **CIS Docker Benchmark**: Follow hardening guidelines
- **PCI DSS**: Network segmentation, access control
- **NIST 800-190**: Container security best practices
- **ISO 27001**: Security controls and monitoring

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** create a public GitHub issue
2. Email security details to [your-email]
3. Include: description, steps to reproduce, impact assessment
4. Allow 48 hours for initial response

## References

- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [OWASP Container Security](https://owasp.org/www-project-docker-top-10/)
- [Seccomp Profiles](https://docs.docker.com/engine/security/seccomp/)
- [AppArmor for Docker](https://docs.docker.com/engine/security/apparmor/)
- [User Namespaces](https://docs.docker.com/engine/security/userns-remap/)
- [Falco Runtime Security](https://falco.org/)

## Change Log

- **2024-02-16**: Initial security documentation
- **2024-02-16**: Added container escape prevention measures
- **2024-02-16**: Created hardened docker-compose configuration
- **2024-02-16**: Added automated security audit script

---

**Last Updated**: 2024-02-16
**Security Reviewed**: 2024-02-16
**Next Review**: 2024-03-16
