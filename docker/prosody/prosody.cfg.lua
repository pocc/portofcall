-- Prosody XMPP Server Test Configuration

admins = { "admin@test.local" }

modules_enabled = {
    "roster";
    "saslauth";
    "tls";
    "dialback";
    "disco";
    "posix";
    "register";
    "admin_adhoc";
    "ping";
    "pep";
    "version";
    "uptime";
    "time";
    "blocklist";
    "carbons";
}

allow_registration = true
c2s_require_encryption = false
s2s_require_encryption = false
authentication = "internal_plain"

VirtualHost "test.local"

Component "conference.test.local" "muc"
    name = "Test Chat Rooms"
    restrict_room_creation = false

Component "component.test.local"
    component_secret = "testpass123"
