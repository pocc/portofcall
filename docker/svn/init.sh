#!/bin/sh
set -e

REPO_PATH="/var/svn/testrepo"

# Create test repository if it doesn't exist
if [ ! -d "$REPO_PATH" ]; then
    svnadmin create "$REPO_PATH"
    cp /etc/svnserve.conf "$REPO_PATH/conf/svnserve.conf"

    # Create password file
    cat > "$REPO_PATH/conf/passwd" <<EOF
[users]
testuser = testpass123
EOF
fi

exec svnserve -d --foreground -r /var/svn --listen-host 0.0.0.0 --listen-port 3690
