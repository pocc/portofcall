#!/bin/sh
# Redis initialization script - populate with test data
# This runs after Redis starts

sleep 2  # Wait for Redis to be ready

redis-cli <<EOF
# String examples
SET greeting "Hello from Redis Test Server"
SET counter 42
SET pi 3.14159

# Hash examples
HSET user:1 username alice email alice@example.com created "2024-01-15"
HSET user:2 username bob email bob@example.com created "2024-02-20"
HSET user:3 username charlie email charlie@example.com created "2024-03-10"

# List examples
RPUSH tasks "Write documentation"
RPUSH tasks "Run tests"
RPUSH tasks "Deploy to production"
RPUSH tasks "Monitor performance"

# Set examples
SADD tags:programming "javascript" "python" "go" "rust"
SADD tags:databases "mysql" "postgresql" "redis" "mongodb"

# Sorted set examples
ZADD leaderboard 100 alice
ZADD leaderboard 250 bob
ZADD leaderboard 175 charlie
ZADD leaderboard 300 diana

# JSON-like data (strings)
SET config:app '{"name":"testserver","version":"1.0","debug":true}'
SET config:db '{"host":"localhost","port":3306,"pool":10}'

# Expiring keys (for testing TTL)
SET session:abc123 "user_session_data" EX 3600

# Pub/Sub test message
PUBLISH test-channel "Redis pub/sub is working!"

SAVE
EOF

echo "Redis test data initialized successfully"
