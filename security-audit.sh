#!/bin/bash
#
# Docker Container Security Audit Script
# Checks running containers for security misconfigurations
#

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Docker Container Security Audit${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Function to print results
pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    warn "Not running as root. Some checks may be incomplete."
    echo ""
fi

# Get all running containers
CONTAINERS=$(docker ps --format '{{.Names}}')

if [ -z "$CONTAINERS" ]; then
    fail "No running containers found. Start with: docker-compose up -d"
    exit 1
fi

info "Found $(echo "$CONTAINERS" | wc -l) running containers"
echo ""

# ========================================
# 1. Check for Privileged Containers
# ========================================
echo -e "${BLUE}[1] Checking for Privileged Containers...${NC}"
PRIVILEGED=$(docker ps --quiet | xargs docker inspect --format '{{.Name}}: {{.HostConfig.Privileged}}' | grep true || true)
if [ -z "$PRIVILEGED" ]; then
    pass "No privileged containers found"
else
    fail "Privileged containers detected:"
    echo "$PRIVILEGED"
fi
echo ""

# ========================================
# 2. Check Containers Running as Root
# ========================================
echo -e "${BLUE}[2] Checking for Containers Running as Root...${NC}"
for container in $CONTAINERS; do
    USER=$(docker exec "$container" id -u 2>/dev/null || echo "unknown")
    if [ "$USER" = "0" ]; then
        fail "$container is running as root (UID 0)"
    elif [ "$USER" = "unknown" ]; then
        warn "$container: Unable to determine user"
    else
        pass "$container is running as UID $USER"
    fi
done
echo ""

# ========================================
# 3. Check for Dangerous Capabilities
# ========================================
echo -e "${BLUE}[3] Checking for Dangerous Capabilities...${NC}"
DANGEROUS_CAPS="SYS_ADMIN SYS_MODULE NET_ADMIN SYS_PTRACE DAC_READ_SEARCH"
for container in $CONTAINERS; do
    CAPS=$(docker inspect "$container" --format '{{.HostConfig.CapAdd}}' 2>/dev/null | grep -E "$DANGEROUS_CAPS" || true)
    if [ -n "$CAPS" ]; then
        fail "$container has dangerous capabilities: $CAPS"
    else
        pass "$container: No dangerous capabilities"
    fi
done
echo ""

# ========================================
# 4. Check for Mounted Docker Socket
# ========================================
echo -e "${BLUE}[4] Checking for Mounted Docker Socket...${NC}"
SOCKET_MOUNTS=$(docker ps --quiet | xargs docker inspect --format '{{.Name}} {{range .Mounts}}{{if eq .Source "/var/run/docker.sock"}}DANGER{{end}}{{end}}' | grep DANGER || true)
if [ -z "$SOCKET_MOUNTS" ]; then
    pass "Docker socket not mounted in any container"
else
    fail "Docker socket mounted (allows container escape):"
    echo "$SOCKET_MOUNTS"
fi
echo ""

# ========================================
# 5. Check for Host Network Mode
# ========================================
echo -e "${BLUE}[5] Checking for Host Network Mode...${NC}"
HOST_NETWORK=$(docker ps --quiet | xargs docker inspect --format '{{.Name}}: {{.HostConfig.NetworkMode}}' | grep "host" || true)
if [ -z "$HOST_NETWORK" ]; then
    pass "No containers using host network mode"
else
    fail "Containers using host network (bypasses network isolation):"
    echo "$HOST_NETWORK"
fi
echo ""

# ========================================
# 6. Check for no-new-privileges
# ========================================
echo -e "${BLUE}[6] Checking for no-new-privileges Security Option...${NC}"
for container in $CONTAINERS; do
    NO_NEW_PRIV=$(docker inspect "$container" --format '{{.HostConfig.SecurityOpt}}' | grep "no-new-privileges:true" || echo "")
    if [ -z "$NO_NEW_PRIV" ]; then
        warn "$container: no-new-privileges not set (allows privilege escalation)"
    else
        pass "$container: no-new-privileges enabled"
    fi
done
echo ""

# ========================================
# 7. Check for Seccomp Profiles
# ========================================
echo -e "${BLUE}[7] Checking for Seccomp Profiles...${NC}"
for container in $CONTAINERS; do
    SECCOMP=$(docker inspect "$container" --format '{{.HostConfig.SecurityOpt}}' | grep "seccomp" || echo "")
    if [ -z "$SECCOMP" ]; then
        warn "$container: No custom seccomp profile (using default)"
    else
        pass "$container: Custom seccomp profile applied"
    fi
done
echo ""

# ========================================
# 8. Check for Read-Only Root Filesystem
# ========================================
echo -e "${BLUE}[8] Checking for Read-Only Root Filesystem...${NC}"
for container in $CONTAINERS; do
    READONLY=$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')
    if [ "$READONLY" = "false" ]; then
        warn "$container: Root filesystem is writable"
    else
        pass "$container: Read-only root filesystem"
    fi
done
echo ""

# ========================================
# 9. Check for Resource Limits
# ========================================
echo -e "${BLUE}[9] Checking for Resource Limits...${NC}"
for container in $CONTAINERS; do
    MEM_LIMIT=$(docker inspect "$container" --format '{{.HostConfig.Memory}}')
    CPU_LIMIT=$(docker inspect "$container" --format '{{.HostConfig.NanoCpus}}')
    PID_LIMIT=$(docker inspect "$container" --format '{{.HostConfig.PidsLimit}}')

    if [ "$MEM_LIMIT" = "0" ] && [ "$CPU_LIMIT" = "0" ] && [ "$PID_LIMIT" = "0" ]; then
        warn "$container: No resource limits set (vulnerable to DoS)"
    else
        pass "$container: Resource limits configured"
    fi
done
echo ""

# ========================================
# 10. Check for Sensitive Host Mounts
# ========================================
echo -e "${BLUE}[10] Checking for Sensitive Host Path Mounts...${NC}"
SENSITIVE_PATHS="/:/boot:/proc:/sys:/dev:/etc/shadow:/etc/passwd:/var/run/docker.sock"
for container in $CONTAINERS; do
    MOUNTS=$(docker inspect "$container" --format '{{range .Mounts}}{{.Source}} {{end}}')
    DANGEROUS=""

    for path in $(echo "$SENSITIVE_PATHS" | tr ':' ' '); do
        if echo "$MOUNTS" | grep -q "^$path$\|^$path/"; then
            DANGEROUS="$DANGEROUS $path"
        fi
    done

    if [ -n "$DANGEROUS" ]; then
        fail "$container: Dangerous host paths mounted:$DANGEROUS"
    else
        pass "$container: No sensitive host paths mounted"
    fi
done
echo ""

# ========================================
# 11. Check Docker Daemon User Namespace
# ========================================
echo -e "${BLUE}[11] Checking Docker Daemon User Namespace Remapping...${NC}"
USERNS=$(docker info 2>/dev/null | grep "userns" || echo "")
if [ -z "$USERNS" ]; then
    fail "Docker user namespace remapping NOT enabled (container root = host root)"
    info "Enable with: echo '{\"userns-remap\": \"default\"}' | sudo tee /etc/docker/daemon.json && sudo systemctl restart docker"
else
    pass "Docker user namespace remapping is enabled"
fi
echo ""

# ========================================
# 12. Check for AppArmor/SELinux
# ========================================
echo -e "${BLUE}[12] Checking for AppArmor/SELinux...${NC}"
if command -v aa-status &> /dev/null; then
    if aa-status --enabled 2>/dev/null; then
        pass "AppArmor is enabled"
    else
        warn "AppArmor is installed but not enabled"
    fi
elif command -v getenforce &> /dev/null; then
    STATUS=$(getenforce)
    if [ "$STATUS" = "Enforcing" ]; then
        pass "SELinux is enforcing"
    elif [ "$STATUS" = "Permissive" ]; then
        warn "SELinux is in permissive mode"
    else
        fail "SELinux is disabled"
    fi
else
    warn "Neither AppArmor nor SELinux detected"
fi
echo ""

# ========================================
# 13. Check Image Vulnerabilities (if Trivy installed)
# ========================================
echo -e "${BLUE}[13] Checking Image Vulnerabilities...${NC}"
if command -v trivy &> /dev/null; then
    info "Scanning images with Trivy (this may take a while)..."
    for container in $CONTAINERS; do
        IMAGE=$(docker inspect "$container" --format '{{.Config.Image}}')
        echo -e "\n${BLUE}Scanning $container ($IMAGE)...${NC}"
        trivy image --severity HIGH,CRITICAL --quiet "$IMAGE" || warn "Scan failed for $IMAGE"
    done
else
    warn "Trivy not installed. Install with:"
    info "wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -"
    info "echo 'deb https://aquasecurity.github.io/trivy-repo/deb \$(lsb_release -sc) main' | sudo tee /etc/apt/sources.list.d/trivy.list"
    info "sudo apt update && sudo apt install trivy"
fi
echo ""

# ========================================
# 14. Check Firewall Status
# ========================================
echo -e "${BLUE}[14] Checking Firewall Status...${NC}"
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1 || echo "inactive")
    if echo "$UFW_STATUS" | grep -q "active"; then
        pass "UFW firewall is active"
    else
        fail "UFW firewall is inactive"
        info "Enable with: sudo ufw enable"
    fi
else
    warn "UFW not installed. Install with: sudo apt install ufw"
fi
echo ""

# ========================================
# Summary
# ========================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Audit Complete${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo "Recommendations:"
echo "1. Review all [FAIL] items and remediate immediately"
echo "2. Address [WARN] items based on your security requirements"
echo "3. Use docker-compose.hardened.yml for production deployments"
echo "4. Enable Docker user namespace remapping"
echo "5. Configure UFW firewall to restrict access"
echo "6. Regularly scan images for vulnerabilities"
echo "7. Monitor container logs for suspicious activity"
echo ""
echo "For complete hardening guide, see: docs/WEBSERVER.md#container-escape-prevention"
echo ""
