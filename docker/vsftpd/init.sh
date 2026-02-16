#!/bin/bash
# Initialize FTP server with test files

set -e

USER_HOME="/home/vsftpd/testuser"

# Create directory structure
mkdir -p "$USER_HOME"/{uploads,downloads,public,private}

# Generate test files for download
echo "Hello from the FTP test server!" > "$USER_HOME/downloads/welcome.txt"
echo "This is a sample text file for FTP testing." > "$USER_HOME/downloads/sample.txt"
echo "Test file $(date)" > "$USER_HOME/downloads/timestamp.txt"

# Create a larger test file
dd if=/dev/urandom of="$USER_HOME/downloads/random_1mb.bin" bs=1024 count=1024 2>/dev/null
dd if=/dev/zero of="$USER_HOME/downloads/zeros_5mb.bin" bs=1024 count=5120 2>/dev/null

# Create a sample CSV
cat > "$USER_HOME/downloads/sample.csv" <<EOF
id,name,email,created_at
1,Alice Johnson,alice@example.com,2024-01-15
2,Bob Smith,bob@example.com,2024-02-20
3,Carol Williams,carol@example.com,2024-03-10
4,David Brown,david@example.com,2024-04-05
EOF

# Create a sample JSON
cat > "$USER_HOME/downloads/sample.json" <<'EOF'
{
  "server": "FTP Test Server",
  "version": "1.0",
  "protocols": ["FTP", "FTPS"],
  "users": [
    {"username": "testuser", "access": "full"}
  ],
  "features": {
    "upload": true,
    "download": true,
    "delete": true,
    "rename": true,
    "mkdir": true
  }
}
EOF

# Create README
cat > "$USER_HOME/README.md" <<'EOF'
# FTP Test Server

Welcome to the FTP test server!

## Available Directories

- `/downloads/` - Sample files for download testing
- `/uploads/` - Upload your test files here
- `/public/` - Public read-only files
- `/private/` - Private test directory

## Test Files

- `welcome.txt` - Simple text file
- `sample.txt` - Another text sample
- `timestamp.txt` - File with current timestamp
- `random_1mb.bin` - 1MB random binary data
- `zeros_5mb.bin` - 5MB zero-filled file
- `sample.csv` - Sample CSV data
- `sample.json` - Sample JSON data

## Session Timeout

All FTP sessions timeout after 15 minutes of inactivity.

## Credentials

- **Username**: testuser
- **Password**: testpass123
EOF

# Set permissions
chmod -R 755 "$USER_HOME"
chmod 777 "$USER_HOME/uploads"

echo "FTP test environment initialized at $USER_HOME"
ls -lah "$USER_HOME"
