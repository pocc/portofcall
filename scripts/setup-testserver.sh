#!/bin/bash
#
# Multi-Protocol Test Server Setup Script
# Initializes SSL certificates, test users, and sample data
#

set -e

echo "================================================"
echo "  Multi-Protocol Test Server Setup"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    error "docker-compose is not installed. Please install docker-compose first."
    exit 1
fi

info "Creating directory structure..."
mkdir -p docker/nginx/ssl
mkdir -p docker/nginx/html
mkdir -p docker/mailserver/config

# Generate self-signed SSL certificate for nginx
if [ ! -f docker/nginx/ssl/server.key ]; then
    info "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout docker/nginx/ssl/server.key \
        -out docker/nginx/ssl/server.crt \
        -subj "/C=US/ST=Test/L=Test/O=TestServer/OU=IT/CN=testserver.local" \
        2>/dev/null
    info "SSL certificate generated"
else
    info "SSL certificate already exists"
fi

# Create SSH banner
if [ ! -f docker/openssh/banner.txt ]; then
    info "Creating SSH banner..."
    mkdir -p docker/openssh
    cat > docker/openssh/banner.txt <<'EOF'
═══════════════════════════════════════════════════════════
  ⚓ Multi-Protocol Test Server - SSH Access
═══════════════════════════════════════════════════════════

  This is a TEST SERVER for protocol development and testing.

  ⏱  Session Timeout: 15 minutes of inactivity
  🔐 Authentication: Password or public key

  Default credentials:
    Username: testuser
    Password: testpass123

  ⚠️  WARNING: Do not use in production!

═══════════════════════════════════════════════════════════
EOF
fi

# Setup mail server test account
info "Configuring mail server test account..."
mkdir -p docker/mailserver/config
cat > docker/mailserver/config/postfix-accounts.cf <<EOF
test@testserver.local|{SHA512-CRYPT}\$6\$rounds=50000\$h5e7Df3X\$vWFyHvN5h5GGJxCJ.eRhzRr1HqKqBLJxZhQHKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKq
EOF

# Generate Mosquitto password file
info "Generating MQTT password file..."
if command -v mosquitto_passwd &> /dev/null; then
    mosquitto_passwd -c -b docker/mosquitto/passwd testuser testpass123
else
    warn "mosquitto_passwd not found. Using pre-configured password file."
fi

# Create .env file for docker-compose
if [ ! -f .env ]; then
    info "Creating .env file..."
    cat > .env <<EOF
# Test Server Environment Configuration

# Server hostname (change to your VPS IP or domain)
SERVER_HOST=127.0.0.1

# FTP Passive mode address (change to your VPS public IP)
PASV_ADDRESS=127.0.0.1

# Timezone
TZ=UTC

# Test credentials (change these for production!)
TEST_USER=testuser
TEST_PASS=testpass123
TEST_EMAIL=test@testserver.local

# Database credentials
MYSQL_ROOT_PASSWORD=rootpass123
POSTGRES_PASSWORD=rootpass123
MONGO_ROOT_PASSWORD=testpass123
EOF
    info ".env file created"
else
    warn ".env file already exists, skipping"
fi

# Build custom images
info "Building custom Docker images..."
docker-compose build

echo ""
info "Setup complete! 🎉"
echo ""
echo "To start the test server:"
echo "  ${GREEN}docker-compose up -d${NC}"
echo ""
echo "To view logs:"
echo "  ${GREEN}docker-compose logs -f${NC}"
echo ""
echo "To stop the server:"
echo "  ${GREEN}docker-compose down${NC}"
echo ""
warn "⚠️  Important Security Notes:"
echo "  1. This is a TEST SERVER - do not expose to public internet without firewall rules"
echo "  2. Change default passwords before production use"
echo "  3. Review docs/WEBSERVER.md for security best practices"
echo "  4. All sessions timeout after 15 minutes of inactivity"
echo ""
echo "Access the web interface at: http://${SERVER_HOST:-localhost}"
echo ""
