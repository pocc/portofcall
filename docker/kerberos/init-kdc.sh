#!/bin/bash
set -e

# Initialize the KDC database if it doesn't exist
if [ ! -f /var/lib/krb5kdc/principal ]; then
    echo "Initializing Kerberos KDC database..."
    kdb5_util create -s -P masterpass123 -r TEST.LOCAL

    # Create test principals
    kadmin.local -q "addprinc -pw testpass123 testuser@TEST.LOCAL"
    kadmin.local -q "addprinc -pw alicepass123 alice@TEST.LOCAL"
    kadmin.local -q "addprinc -pw adminpass123 admin/admin@TEST.LOCAL"
    kadmin.local -q "addprinc -randkey host/localhost@TEST.LOCAL"
fi

echo "Starting Kerberos KDC..."
exec krb5kdc -n
