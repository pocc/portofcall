# Test Server Quick Start Guide

Get the multi-protocol test server running in 5 minutes.

## Prerequisites

- Docker and Docker Compose installed
- 4GB+ RAM available
- 20GB disk space

## Setup Steps

### 1. Run Setup Script

```bash
cd portofcall
./setup-testserver.sh
```

This will:
- Generate SSL certificates
- Create configuration files
- Build custom Docker images
- Create `.env` file with default settings

### 2. Start All Services

```bash
docker-compose up -d
```

Wait 30-60 seconds for all services to initialize.

### 3. Verify Services

```bash
# Check all containers are running
docker-compose ps

# Should see 15 services in "Up" state
```

### 4. Test Access

**Web Interface:**
```bash
open http://localhost
```

**Quick Protocol Tests:**
```bash
# HTTP
curl http://localhost

# SSH
ssh -p 2222 testuser@localhost
# Password: testpass123

# MySQL
mysql -h localhost -P 3306 -u testuser -ptestpass123 -e "SHOW DATABASES;"

# Redis
redis-cli -h localhost ping

# Echo protocol
echo "hello" | nc localhost 7
```

## Default Credentials

All services use:
- **Username**: `testuser`
- **Password**: `testpass123`

See [docs/WEBSERVER.md](docs/WEBSERVER.md) for service-specific credentials.

## Available Protocols

| Protocol | Port | Test Command |
|----------|------|--------------|
| HTTP | 80 | `curl http://localhost` |
| HTTPS | 443 | `curl -k https://localhost` |
| FTP | 21 | `ftp localhost` |
| SSH | 2222 | `ssh -p 2222 testuser@localhost` |
| SMTP | 25 | `telnet localhost 25` |
| MySQL | 3306 | `mysql -h localhost -u testuser -p` |
| PostgreSQL | 5432 | `psql -h localhost -U testuser testdb` |
| Redis | 6379 | `redis-cli -h localhost` |
| MongoDB | 27017 | `mongosh localhost:27017` |
| MQTT | 1883 | `mosquitto_sub -h localhost -t test` |
| Echo | 7 | `echo test \| nc localhost 7` |
| Daytime | 13 | `nc localhost 13` |

Full list: [docs/WEBSERVER.md#port-mappings](docs/WEBSERVER.md#port-mappings)

## Common Commands

```bash
# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Restart a service
docker-compose restart [service-name]

# Complete reset (deletes data!)
docker-compose down -v
./setup-testserver.sh
docker-compose up -d
```

## Troubleshooting

**Port conflict?**
```bash
# Check what's using the port
sudo lsof -i :80

# Stop conflicting service or change port in docker-compose.yml
```

**Container won't start?**
```bash
# Check logs
docker-compose logs [service-name]

# Rebuild
docker-compose build [service-name]
docker-compose up -d [service-name]
```

**Permission denied?**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

## Next Steps

1. **Review Security**: [docs/WEBSERVER.md#security](docs/WEBSERVER.md#security)
2. **Configure Firewall**: Restrict access to your IP only
3. **Change Passwords**: Edit `.env` file and rebuild
4. **Test All Protocols**: See [docs/WEBSERVER.md#testing-procedures](docs/WEBSERVER.md#testing-procedures)

## Production Deployment

**⚠️ Important**: This is a TEST SERVER with default passwords and self-signed certificates.

Before production use:
- [ ] Change all default passwords
- [ ] Use real SSL certificates (Let's Encrypt)
- [ ] Configure firewall (UFW)
- [ ] Enable rate limiting
- [ ] Set up monitoring
- [ ] Review [docs/WEBSERVER.md#security](docs/WEBSERVER.md#security)

## Digital Ocean Deployment

```bash
# SSH to your droplet
ssh root@YOUR_VPS_IP

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
sudo apt update
sudo apt install docker-compose-plugin

# Clone repo and setup
cd /opt
git clone [your-repo] portofcall
cd portofcall
./setup-testserver.sh

# Configure firewall
sudo ufw enable
sudo ufw allow from YOUR_IP_ADDRESS

# Start services
docker-compose up -d

# View status
docker-compose ps
```

## Complete Documentation

📖 **Full Documentation**: [docs/WEBSERVER.md](docs/WEBSERVER.md)

Covers:
- All protocol configurations
- Security best practices
- Testing procedures
- Troubleshooting guides
- Architecture details

## Support

Issues? Check:
1. Container logs: `docker-compose logs -f`
2. Service status: `docker-compose ps`
3. Documentation: `docs/WEBSERVER.md`
4. Docker network: `docker network inspect portofcall_testnet`
