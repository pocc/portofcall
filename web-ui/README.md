# Port of Call - Protocol Testing Web UI

A React + TypeScript + Tailwind CSS interface for testing TCP protocol implementations using Cloudflare Workers' Sockets API.

## Features

- **Protocol Selection**: Choose from FTP (Passive Mode) or SSH clients
- **FTP Client**:
  - Passive mode FTP connections
  - Directory browsing
  - File listing with metadata
  - Real-time connection logs
- **SSH Client**:
  - Secure Shell terminal emulation
  - Command execution
  - Real-time output display
  - Quick command shortcuts

## Development

```bash
cd web-ui
npm install
npm run dev
```

Visit http://localhost:5173

## Build

```bash
npm run build
```

## API Endpoints Required

See full documentation in the README for required Cloudflare Worker endpoints.

- `POST /api/ftp/connect`
- `POST /api/ftp/list`
- `POST /api/ssh/connect`
- `POST /api/ssh/execute`
- `POST /api/ssh/disconnect`
