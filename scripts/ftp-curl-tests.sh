#!/bin/bash
# FTP Integration Tests using curl
# Tests all FTP operations against live test servers

set -e  # Exit on error

API_BASE="https://portofcall.ross.gg/api/ftp"
HOST="ftp.dlptest.com"
PORT="21"
USERNAME="dlpuser@dlptest.com"
PASSWORD="SzMf7rTE4pCrf9dV286GuNe4N"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🧪 FTP Integration Tests (curl)"
echo "================================"
echo ""
echo "Testing against: $HOST"
echo ""

# Test 1: Connect
echo -n "Testing FTP Connect... "
RESPONSE=$(curl -s -X POST "$API_BASE/connect" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\"
  }")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Test 2: List Directory
echo -n "Testing FTP List Directory... "
RESPONSE=$(curl -s -X POST "$API_BASE/list" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"path\": \"/\"
  }")

if echo "$RESPONSE" | grep -q '"success":true' && echo "$RESPONSE" | grep -q '"files":\['; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Test 3: Upload File
echo -n "Testing FTP Upload File... "
TEST_CONTENT="Test file uploaded at $(date)"
echo "$TEST_CONTENT" > /tmp/portofcall-test-upload.txt

RESPONSE=$(curl -s -X POST "$API_BASE/upload" \
  -F "host=$HOST" \
  -F "port=$PORT" \
  -F "username=$USERNAME" \
  -F "password=$PASSWORD" \
  -F "remotePath=/portofcall-test-upload.txt" \
  -F "file=@/tmp/portofcall-test-upload.txt")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Test 4: Download File
echo -n "Testing FTP Download File... "
curl -s -X POST "$API_BASE/download" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"remotePath\": \"/portofcall-test-upload.txt\"
  }" \
  -o /tmp/portofcall-test-download.txt

if [ -f /tmp/portofcall-test-download.txt ] && grep -q "Test file uploaded at" /tmp/portofcall-test-download.txt; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  exit 1
fi

# Test 5: Rename File
echo -n "Testing FTP Rename File... "
RESPONSE=$(curl -s -X POST "$API_BASE/rename" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"fromPath\": \"/portofcall-test-upload.txt\",
    \"toPath\": \"/portofcall-test-renamed.txt\"
  }")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Test 6: Delete File
echo -n "Testing FTP Delete File... "
RESPONSE=$(curl -s -X POST "$API_BASE/delete" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"remotePath\": \"/portofcall-test-renamed.txt\"
  }")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Test 7: Create Directory
echo -n "Testing FTP Create Directory... "
TIMESTAMP=$(date +%s)
RESPONSE=$(curl -s -X POST "$API_BASE/mkdir" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"$HOST\",
    \"port\": $PORT,
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"dirPath\": \"/portofcall-test-dir-$TIMESTAMP\"
  }")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "$RESPONSE"
  exit 1
fi

# Cleanup
rm -f /tmp/portofcall-test-*.txt

echo ""
echo "================================"
echo -e "${GREEN}All tests passed!${NC}"
