#!/bin/bash

# Test FTP Protocol with Local Docker and Wrangler
# This script sets up and tests the FTP implementation

set -e  # Exit on error

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   FTP Protocol Testing Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Change to project directory
cd "$(dirname "$0")"

# Step 1: Check if Docker is running
echo -e "${YELLOW}[1/6] Checking Docker...${NC}"
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"
echo ""

# Step 2: Start FTP container
echo -e "${YELLOW}[2/6] Starting FTP Docker container...${NC}"
docker compose up -d vsftpd
sleep 3  # Wait for container to initialize
echo -e "${GREEN}✓ FTP container started${NC}"
echo ""

# Step 3: Verify FTP container is running
echo -e "${YELLOW}[3/6] Verifying FTP container...${NC}"
if docker compose ps | grep -q "testserver-ftp.*running"; then
    FTP_STATUS=$(docker compose ps | grep testserver-ftp)
    echo -e "${GREEN}✓ FTP container is running:${NC}"
    echo "  $FTP_STATUS"
else
    echo -e "${RED}Error: FTP container is not running${NC}"
    docker compose logs vsftpd
    exit 1
fi
echo ""

# Step 4: Test FTP server directly (without worker)
echo -e "${YELLOW}[4/6] Testing FTP server directly...${NC}"
timeout 5 bash -c 'echo -e "QUIT" | nc localhost 21' > /tmp/ftp-test.txt 2>&1
if grep -q "220" /tmp/ftp-test.txt; then
    echo -e "${GREEN}✓ FTP server is responding on port 21${NC}"
    cat /tmp/ftp-test.txt
else
    echo -e "${RED}Error: FTP server not responding${NC}"
    cat /tmp/ftp-test.txt
    exit 1
fi
echo ""

# Step 5: Check if wrangler dev is already running
echo -e "${YELLOW}[5/6] Checking Wrangler status...${NC}"
if curl -s http://localhost:8787/ > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Wrangler dev server is already running on port 8787${NC}"
    WRANGLER_RUNNING=true
else
    echo -e "${YELLOW}⚠ Wrangler is not running.${NC}"
    echo -e "${YELLOW}Please start it in another terminal with:${NC}"
    echo -e "  ${BLUE}cd /Users/rj/gd/code/portofcall && npx wrangler dev --port 8787${NC}"
    echo ""
    echo -e "${YELLOW}Press Enter when wrangler is running, or Ctrl+C to cancel...${NC}"
    read -r

    # Check again
    if ! curl -s http://localhost:8787/ > /dev/null 2>&1; then
        echo -e "${RED}Error: Wrangler still not accessible on port 8787${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Wrangler is now accessible${NC}"
fi
echo ""

# Step 6: Test FTP via Worker API
echo -e "${YELLOW}[6/6] Testing FTP via Cloudflare Worker API...${NC}"
echo ""

echo -e "${BLUE}Test 1: FTP Connection Test${NC}"
CONNECT_RESULT=$(curl -s -X POST http://localhost:8787/api/ftp/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "localhost",
    "port": 21,
    "username": "testuser",
    "password": "testpass123"
  }')

if echo "$CONNECT_RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ FTP connection successful!${NC}"
    echo "$CONNECT_RESULT" | jq '.'
else
    echo -e "${RED}✗ FTP connection failed${NC}"
    echo "$CONNECT_RESULT" | jq '.' || echo "$CONNECT_RESULT"
fi
echo ""

echo -e "${BLUE}Test 2: List /downloads directory${NC}"
LIST_RESULT=$(curl -s -X POST http://localhost:8787/api/ftp/list \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "localhost",
    "port": 21,
    "username": "testuser",
    "password": "testpass123",
    "path": "/downloads"
  }')

if echo "$LIST_RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Directory listing successful!${NC}"
    echo "$LIST_RESULT" | jq '.'

    # Count files
    FILE_COUNT=$(echo "$LIST_RESULT" | jq '.files | length')
    echo -e "${GREEN}Found $FILE_COUNT files in /downloads${NC}"
else
    echo -e "${RED}✗ Directory listing failed${NC}"
    echo "$LIST_RESULT" | jq '.' || echo "$LIST_RESULT"
fi
echo ""

echo -e "${BLUE}Test 3: Get file information${NC}"
if [ -n "$FILE_COUNT" ] && [ "$FILE_COUNT" -gt 0 ]; then
    FIRST_FILE=$(echo "$LIST_RESULT" | jq -r '.files[0].name')
    echo -e "Getting info for: ${YELLOW}$FIRST_FILE${NC}"

    # This would require implementing a file info endpoint
    # For now, show what we got from the list
    echo "$LIST_RESULT" | jq ".files[0]"
else
    echo -e "${YELLOW}⚠ No files found to test${NC}"
fi
echo ""

echo -e "${BLUE}Test 4: Test with invalid credentials${NC}"
INVALID_RESULT=$(curl -s -X POST http://localhost:8787/api/ftp/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "localhost",
    "port": 21,
    "username": "wronguser",
    "password": "wrongpass"
  }')

if echo "$INVALID_RESULT" | jq -e '.success == false' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Authentication properly rejected invalid credentials${NC}"
    echo "$INVALID_RESULT" | jq '.error'
else
    echo -e "${RED}✗ Unexpected result for invalid credentials${NC}"
    echo "$INVALID_RESULT" | jq '.' || echo "$INVALID_RESULT"
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "FTP Server: ${GREEN}Running on localhost:21${NC}"
echo -e "Worker API: ${GREEN}Running on localhost:8787${NC}"
echo ""
echo -e "${GREEN}All FTP protocol tests completed!${NC}"
echo ""
echo -e "${YELLOW}To stop the FTP server:${NC}"
echo -e "  ${BLUE}docker compose stop vsftpd${NC}"
echo ""
echo -e "${YELLOW}To view FTP server logs:${NC}"
echo -e "  ${BLUE}docker compose logs -f vsftpd${NC}"
echo ""
