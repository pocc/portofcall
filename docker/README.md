# Docker Test Server Configuration

This directory contains all Docker service configurations for the multi-protocol test server.

## Directory Structure

```
docker/
├── nginx/              # HTTP/HTTPS web server
│   ├── nginx.conf      # Main nginx configuration
│   ├── html/           # Static HTML files
│   └── ssl/            # SSL certificates (generated)
├── vsftpd/             # FTP server
│   ├── vsftpd.conf     # FTP configuration
│   └── init.sh         # FTP initialization script
├── openssh/            # SSH server
│   ├── sshd_config     # SSH daemon configuration
│   └── banner.txt      # SSH login banner
├── mailserver/         # Email server (SMTP/IMAP/POP3)
│   └── config/         # Mail server configs
├── mysql/              # MySQL database
│   └── init.sql        # Database initialization
├── postgres/           # PostgreSQL database
│   └── init.sql        # Database initialization
├── redis/              # Redis cache
│   └── init.sh         # Redis data population
├── mongodb/            # MongoDB database
│   └── init.js         # MongoDB initialization
├── mosquitto/          # MQTT broker
│   ├── mosquitto.conf  # MQTT configuration
│   └── passwd          # MQTT user passwords
├── ircd/               # IRC server
│   └── inspircd.conf   # IRC configuration
└── simple-protocols/   # RFC test protocols
    ├── Dockerfile      # Python server image
    └── server.py       # Multi-protocol server
```

## Quick Reference

### File Modifications

To customize configurations, edit these files:

- **Web Content**: `nginx/html/index.html`
- **HTTP Settings**: `nginx/nginx.conf`
- **FTP Settings**: `vsftpd/vsftpd.conf`
- **SSH Settings**: `openssh/sshd_config`
- **Database Schema**: `mysql/init.sql`, `postgres/init.sql`
- **MongoDB Data**: `mongodb/init.js`
- **MQTT Config**: `mosquitto/mosquitto.conf`

### Rebuilding Services

After modifying configurations:

```bash
# Rebuild specific service
docker-compose build [service-name]
docker-compose up -d [service-name]

# Example: Rebuild simple-protocols
docker-compose build simple-protocols
docker-compose up -d simple-protocols

# Restart without rebuild
docker-compose restart [service-name]
```

### Adding New Protocols

1. Create new directory: `docker/[service-name]/`
2. Add configuration files
3. Update `docker-compose.yml` with new service
4. Update `docs/WEBSERVER.md` with protocol details
5. Run `docker-compose up -d`

## Service Ports

| Service | Ports | Config Location |
|---------|-------|-----------------|
| nginx | 80, 443 | `nginx/nginx.conf` |
| vsftpd | 21, 21100-21110 | `vsftpd/vsftpd.conf` |
| openssh | 2222 | `openssh/sshd_config` |
| mailserver | 25, 110, 143, 587, 993, 995 | `mailserver/config/` |
| mysql | 3306 | `mysql/init.sql` |
| postgres | 5432 | `postgres/init.sql` |
| redis | 6379 | `redis/init.sh` |
| mongodb | 27017 | `mongodb/init.js` |
| mosquitto | 1883 | `mosquitto/mosquitto.conf` |
| ircd | 6667 | `ircd/inspircd.conf` |
| simple-protocols | 7, 9, 13, 19, 37, 79 | `simple-protocols/server.py` |

## Security Notes

- All services use default test credentials
- Change passwords before production use
- SSL certificates are self-signed (for testing only)
- Review `docs/WEBSERVER.md` for security best practices

## Troubleshooting

### View Logs
```bash
docker-compose logs -f [service-name]
```

### Connect to Container
```bash
docker exec -it testserver-[service-name] sh
```

### Test Configuration
```bash
# nginx
docker exec testserver-nginx nginx -t

# MySQL
docker exec testserver-mysql mysql -uroot -prootpass123 -e "SHOW DATABASES;"

# Redis
docker exec testserver-redis redis-cli ping
```

## Documentation

See [docs/WEBSERVER.md](../docs/WEBSERVER.md) for complete documentation.
