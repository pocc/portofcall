import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ChecklistTab from './ChecklistTab';

type ProtocolStatus = 'active' | 'deprecated' | 'niche';
type PopularityTier = 'ubiquitous' | 'common' | 'moderate' | 'rare' | 'niche';
type ProtocolCategory = 'databases' | 'messaging' | 'email' | 'remote' | 'files' | 'web' | 'network' | 'specialty';

interface ProtocolSelectorProps {
  onSelect: (protocol: 'echo' | 'activeusers' | 'whois' | 'syslog' | 'socks4' | 'daytime' | 'finger' | 'time' | 'chargen' | 'gemini' | 'ftp' | 'ftps' | 'sftp' | 'ssh' | 'telnet' | 'smtp' | 'submission' | 'pop3' | 'imap' | 'mysql' | 'postgres' | 'redis' | 'mqtt' | 'ldap' | 'smb' | 'irc' | 'ircs' | 'gopher' | 'memcached' | 'dns' | 'stomp' | 'socks5' | 'modbus' | 'mongodb' | 'graphite' | 'git' | 'zookeeper' | 'amqp' | 'cassandra' | 'kafka' | 'rtsp' | 'rsync' | 'tds' | 'vnc' | 'spice' | 'battlenet' | 'neo4j' | 'rtmp' | 'tacacs' | 'hl7' | 'elasticsearch' | 'ajp' | 'rcon' | 'sourcercon' | 'nntp' | 'rdp' | 'xmpp' | 'nats' | 'jetdirect' | 'fastcgi' | 'diameter' | 'etcd' | 'consul' | 'influxdb' | 'bgp' | 'docker' | 'jupyter' | 'pptp' | 'dicom' | 'jsonrpc' | '9p' | 'thrift' | 'slp' | 'bittorrent' | 'x11' | 'kerberos' | 'sccp' | 'matrix' | 'cdp' | 'node-inspector' | 'dap' | 'iscsi' | 'websocket' | 'h323' | 'dot' | 'soap' | 'openvpn' | 'dict' | 'sip' | 'qotd' | 'lpd' | 'discard' | 'minecraft' | 'zabbix' | 'ident' | 'oracle-tns' | 'mpd' | 'beanstalkd' | 'clamav' | 'lmtp' | 'managesieve' | 'couchdb' | 'ipp' | 'svn' | 'smpp' | 'teamspeak' | 'radius' | 'nrpe' | 'rlogin' | 's7comm' | 'snpp' | 'rethinkdb' | 'clickhouse' | 'gearman' | 'ethernetip' | 'prometheus' | 'portmapper' | 'relp' | 'adb' | 'dnp3' | 'fluentd' | 'stun' | 'rexec' | 'rsh' | 'fix' | 'aerospike' | 'epmd' | 'epp' | 'tarantool' | 'vault' | 'solr' | 'iec104' | 'riak' | 'opentsdb' | 'bitcoin' | 'spamd' | 'nsq' | 'opcua' | 'zmtp' | 'munin' | 'sane' | 'ceph' | 'httpproxy' | 'varnish' | 'fins' | 'couchbase' | 'ami' | 'jdwp' | 'drda' | 'livestatus' | 'dcerpc' | 'nsca' | 'imaps' | 'loki' | 'openflow' | 'pjlink' | 'icecast' | 'meilisearch' | 'haproxy' | 'rmi' | 'nbd' | 'ganglia' | 'netbios' | 'pop3s' | 'smtps' | 'pcep' | 'winrm' | 'uwsgi' | 'torcontrol' | 'gpsd' | 'ldaps' | 'kibana' | 'grafana' | 'rserve' | 'sonic' | 'sentinel' | 'nntps' | 'rabbitmq' | 'cvs' | 'amqps' | 'nomad' | 'ldp-mpls' | 'firebird' | 'hazelcast' | 'ignite' | 'beats' | 'coap' | 'msrp' | 'radsec' | 'sips' | 'gadugadu' | 'napster' | 'ventrilo' | 'oscar' | 'ymsg' | 'msn' | 'jabber-component' | 'xmpp-s2s' | 'informix' | 'sybase' | 'shoutcast' | 'realaudio' | 'mms' | 'mumble' | 'ike' | 'l2tp' | 'turn' | 'kubernetes' | 'activemq' | 'uucp' | 'perforce' | 'quake3' | 'collectd' | 'ethereum' | 'ipfs' | 'tcp' | 'lsp' | 'maxdb' | 'nfs' | 'mgcp' | 'cifs' | 'doh' | 'ipmi' | 'scp' | 'spdy' | 'shadowsocks') => void;
}

const popularityConfig: Record<PopularityTier, { width: number; barColor: string; textColor: string; label: string }> = {
  ubiquitous: { width: 100, barColor: 'bg-green-500', textColor: 'text-green-400', label: 'Ubiquitous' },
  common:     { width: 70,  barColor: 'bg-blue-500',  textColor: 'text-blue-400',  label: 'Common' },
  moderate:   { width: 40,  barColor: 'bg-yellow-500', textColor: 'text-yellow-500', label: 'Moderate' },
  rare:       { width: 10,  barColor: 'bg-slate-500', textColor: 'text-slate-500', label: 'Rare' },
  niche:      { width: 5,   barColor: 'bg-purple-500', textColor: 'text-purple-500', label: 'Niche' },
};

const categoryConfig: Record<'all' | ProtocolCategory, { label: string; icon: string }> = {
  all:       { label: 'All',           icon: '🔷' },
  databases: { label: 'Databases',     icon: '🗄️' },
  messaging: { label: 'Messaging',     icon: '💬' },
  email:     { label: 'Email',         icon: '📧' },
  remote:    { label: 'Remote Access', icon: '🖥️' },
  files:     { label: 'File Transfer', icon: '📁' },
  web:       { label: 'Web & APIs',    icon: '🌐' },
  network:   { label: 'Network',       icon: '🔌' },
  specialty: { label: 'Specialty',     icon: '⚡' },
};

const retroBarChars = (tier: PopularityTier): string => {
  const fills: Record<PopularityTier, number> = { ubiquitous: 10, common: 7, moderate: 4, rare: 1, niche: 1 };
  const filled = fills[tier];
  return '#'.repeat(filled) + '.'.repeat(10 - filled);
};

const sortKey = (p: { status: ProtocolStatus; popularity: PopularityTier }): number => {
  if (p.status === 'deprecated') return 100;
  if (p.status === 'niche') return 50;
  const popOrder: Record<PopularityTier, number> = { ubiquitous: 0, common: 10, moderate: 20, rare: 30, niche: 35 };
  return popOrder[p.popularity];
};

// Comprehensive RFC list including protocols that cannot be implemented on Workers
interface RFCEntry {
  name: string;
  icon: string;
  rfc: string | null;
  year: number;
  description: string;
  workersCompatible: boolean;
  reason?: string; // Why it's not compatible
  layer: 'L2' | 'L3' | 'L4/L7' | 'Application';
}

const nonImplementableRFCs: RFCEntry[] = [
  // Layer 2 Protocols (Cannot implement on Workers)
  { name: 'ARP', icon: '🔗', rfc: '826', year: 1982, description: 'Address Resolution Protocol - Maps IP addresses to MAC addresses', workersCompatible: false, reason: 'Layer 2 protocol, requires raw ethernet access', layer: 'L2' },
  { name: 'Ethernet', icon: '🔌', rfc: null, year: 1983, description: 'IEEE 802.3 - Physical and data link layer protocol for LANs', workersCompatible: false, reason: 'Layer 2 protocol, requires raw ethernet access', layer: 'L2' },
  { name: 'PPP', icon: '🔗', rfc: '1661', year: 1994, description: 'Point-to-Point Protocol - Data link protocol for serial connections', workersCompatible: false, reason: 'Layer 2 protocol, requires direct link access', layer: 'L2' },
  { name: 'LLDP', icon: '📡', rfc: null, year: 2005, description: 'IEEE 802.1AB Link Layer Discovery Protocol - Network device discovery', workersCompatible: false, reason: 'Layer 2 protocol, requires raw ethernet access', layer: 'L2' },
  { name: 'VLAN (802.1Q)', icon: '🏷️', rfc: null, year: 1998, description: 'IEEE 802.1Q - Virtual LAN tagging', workersCompatible: false, reason: 'Layer 2 protocol, requires ethernet frame manipulation', layer: 'L2' },

  // Layer 3 Protocols (Cannot implement on Workers)
  { name: 'ICMP', icon: '🏓', rfc: '792', year: 1981, description: 'Internet Control Message Protocol - Network diagnostics (ping, traceroute)', workersCompatible: false, reason: 'Layer 3 protocol, Workers only supports TCP connections', layer: 'L3' },
  { name: 'ICMPv6', icon: '🏓', rfc: '4443', year: 2006, description: 'ICMP for IPv6 - Network diagnostics and neighbor discovery for IPv6', workersCompatible: false, reason: 'Layer 3 protocol, Workers only supports TCP connections', layer: 'L3' },
  { name: 'IGMP', icon: '📢', rfc: '1112', year: 1989, description: 'Internet Group Management Protocol - IP multicast group management', workersCompatible: false, reason: 'Layer 3 protocol, requires multicast support', layer: 'L3' },
  { name: 'IPsec', icon: '🔐', rfc: '4301', year: 2005, description: 'Internet Protocol Security - Network layer encryption and authentication', workersCompatible: false, reason: 'Layer 3 protocol, requires raw IP packet manipulation', layer: 'L3' },
  { name: 'OSPF', icon: '🗺️', rfc: '2328', year: 1998, description: 'Open Shortest Path First - Interior gateway routing protocol', workersCompatible: false, reason: 'Layer 3 routing protocol, requires raw IP access', layer: 'L3' },
  { name: 'RIP', icon: '🗺️', rfc: '2453', year: 1998, description: 'Routing Information Protocol - Distance-vector routing protocol', workersCompatible: false, reason: 'Layer 3 routing protocol, uses UDP', layer: 'L3' },
  { name: 'GRE', icon: '🚇', rfc: '2784', year: 2000, description: 'Generic Routing Encapsulation - IP tunneling protocol', workersCompatible: false, reason: 'Layer 3 protocol, requires raw IP packet manipulation', layer: 'L3' },
  { name: 'IS-IS', icon: '🗺️', rfc: '1142', year: 1990, description: 'Intermediate System to Intermediate System - Link-state routing protocol', workersCompatible: false, reason: 'Layer 3 routing protocol, operates directly on data link layer', layer: 'L3' },

  // Layer 4 UDP-based Protocols (Cannot implement on Workers - TCP only)
  { name: 'DHCP', icon: '📋', rfc: '2131', year: 1997, description: 'Dynamic Host Configuration Protocol - Automatic IP address assignment', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'DHCPv6', icon: '📋', rfc: '8415', year: 2018, description: 'Dynamic Host Configuration Protocol for IPv6', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'TFTP', icon: '📁', rfc: '1350', year: 1992, description: 'Trivial File Transfer Protocol - Simple file transfer over UDP', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'NTP', icon: '⏰', rfc: '5905', year: 2010, description: 'Network Time Protocol - Clock synchronization over UDP', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'SNMP', icon: '📊', rfc: '1157', year: 1990, description: 'Simple Network Management Protocol - Network device monitoring', workersCompatible: false, reason: 'Primarily UDP-based, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'RTP', icon: '🎵', rfc: '3550', year: 2003, description: 'Real-time Transport Protocol - Audio/video streaming over UDP', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'QUIC', icon: '⚡', rfc: '9000', year: 2021, description: 'Quick UDP Internet Connections - Modern transport protocol (HTTP/3)', workersCompatible: false, reason: 'UDP-based protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'SCTP', icon: '📦', rfc: '4960', year: 2007, description: 'Stream Control Transmission Protocol - Alternative to TCP/UDP', workersCompatible: false, reason: 'Separate L4 protocol, Workers only supports TCP', layer: 'L4/L7' },
  { name: 'SIP (UDP)', icon: '📞', rfc: '3261', year: 2002, description: 'Session Initiation Protocol over UDP - VoIP signaling', workersCompatible: false, reason: 'Typically UDP-based for VoIP, Workers supports TCP SIP only', layer: 'L4/L7' },
  { name: 'Syslog (UDP)', icon: '📝', rfc: '5424', year: 2009, description: 'Syslog Protocol over UDP - System logging', workersCompatible: false, reason: 'Traditional syslog uses UDP, Workers supports TCP variant', layer: 'L4/L7' },
];

export const protocols = [
  { id: 'tcp' as const, name: 'Raw TCP', description: 'Raw TCP client — connect to any port, send text or hex bytes, inspect the response', port: 0, icon: '🔌', features: ['Banner grabbing', 'Protocol exploration', 'Hex + UTF-8 display', 'Protocol presets'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 1974 },
  { id: 'echo' as const, name: 'ECHO', description: 'ECHO Protocol (RFC 862) - The simplest TCP test protocol', port: 7, icon: '🔊', features: ['Network testing', 'Latency measurement', 'Connectivity verification'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'activeusers' as const, name: 'Active Users', description: 'Active Users Protocol (RFC 866) - Reports number of users logged into a system', port: 11, icon: '👥', features: ['System monitoring', 'User count query', 'Internet Standard'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 1983, rfc: '866' },
  { id: 'whois' as const, name: 'WHOIS', description: 'WHOIS Protocol (RFC 3912) - Domain registration information lookup', port: 43, icon: '🔍', features: ['Domain registration info', 'Auto-detect WHOIS server', 'IP/ASN lookup'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 2004 },
  { id: 'syslog' as const, name: 'Syslog', description: 'Syslog Protocol (RFC 5424/3164) - Centralized logging and event forwarding', port: 514, icon: '📝', features: ['8 severity levels', 'RFC 5424 & 3164 formats', 'SIEM integration'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 2001 },
  { id: 'socks4' as const, name: 'SOCKS4', description: 'SOCKS4 Protocol - TCP connection proxying through firewalls', port: 1080, icon: '🔀', features: ['Proxy testing', 'SOCKS4a hostname support', 'SSH tunneling'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 1992 },
  { id: 'daytime' as const, name: 'Daytime', description: 'Daytime Protocol (RFC 867) - Human-readable time from remote servers', port: 13, icon: '🕐', features: ['Simplest time protocol', 'Educational', 'Clock synchronization check'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'finger' as const, name: 'Finger', description: 'Finger Protocol (RFC 1288) - Legacy user information lookup', port: 79, icon: '👤', features: ['User information', 'Educational', 'Internet archaeology'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1991 },
  { id: 'time' as const, name: 'TIME', description: 'TIME Protocol (RFC 868) - Binary time synchronization since 1900', port: 37, icon: '⏰', features: ['32-bit binary time', 'Clock synchronization', 'Y2K36 problem demonstration'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'chargen' as const, name: 'CHARGEN', description: 'CHARGEN Protocol (RFC 864) - Continuous ASCII character stream', port: 19, icon: '🔤', features: ['Bandwidth testing', '72-char rotating pattern', 'Network testing'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'discard' as const, name: 'Discard', description: 'Discard Protocol (RFC 863) - Silently discards all data sent to it', port: 9, icon: '🗑️', features: ['Fire-and-forget testing', 'Throughput measurement', 'Data sink for debugging'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'gemini' as const, name: 'Gemini', description: 'Gemini Protocol - Modern privacy-focused alternative to HTTP/HTML', port: 1965, icon: '💎', features: ['TLS mandatory', 'Simple Gemtext markup', 'No tracking/cookies'], status: 'niche' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2020 },
  { id: 'ftp' as const, name: 'FTP (Passive Mode)', description: 'File Transfer Protocol - Transfer files to/from FTP servers', port: 21, icon: '📁', features: ['Directory listing', 'File upload/download', 'Passive mode support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory , year: 1985 },
  { id: 'ftps' as const, name: 'FTPS', description: 'FTPS - FTP over TLS (RFC 4217) - Encrypted file transfer with implicit TLS on port 990', port: 990, icon: '🔒', features: ['Implicit TLS on port 990', 'FEAT/SYST detection', 'TLS feature enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory, year: 2005 },
  { id: 'sftp' as const, name: 'SFTP', description: 'SSH File Transfer Protocol - Secure file transfer and remote file system access over SSH', port: 22, icon: '📂', features: ['SSH subsystem probe', 'Server capability detection', 'Secure channel verification'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'files' as ProtocolCategory, year: 2006 },
  { id: 'ssh' as const, name: 'SSH', description: 'Secure Shell - Execute commands on remote servers', port: 22, icon: '🔐', features: ['Private key authentication', 'Password authentication', 'Encrypted connection'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1995, lastUpdated: 2025, implementations: [{name: 'OpenSSH 9.9p2', url: 'https://www.openssh.com/'}] },
  { id: 'telnet' as const, name: 'Telnet', description: 'Telnet Protocol - Unencrypted text-based terminal protocol', port: 23, icon: '📟', features: ['Interactive terminal', 'Command execution', 'WebSocket tunnel'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1983 },
  { id: 'smtp' as const, name: 'SMTP', description: 'Simple Mail Transfer Protocol - Send emails via SMTP servers', port: 587, icon: '📧', features: ['Email sending', 'AUTH LOGIN support', 'Multiple ports (25/587/465)'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'email' as ProtocolCategory , year: 1982 },
  { id: 'submission' as const, name: 'Submission', description: 'Message Submission Protocol (RFC 6409) - Authenticated mail submission on port 587 with STARTTLS', port: 587, icon: '📮', features: ['STARTTLS support', 'Authenticated submission', 'AUTH before MAIL FROM', 'RFC 6409 compliance'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'email' as ProtocolCategory , year: 2011 },
  { id: 'pop3' as const, name: 'POP3', description: 'Post Office Protocol v3 - Retrieve emails from mail servers', port: 110, icon: '📬', features: ['Email retrieval', 'Message listing', 'Mailbox management'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory , year: 1996 },
  { id: 'imap' as const, name: 'IMAP', description: 'Internet Message Access Protocol - Advanced email management', port: 143, icon: '📮', features: ['Multiple folders', 'Server-side organization', 'Message flags'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'email' as ProtocolCategory , year: 2003 },
  { id: 'mysql' as const, name: 'MySQL', description: 'MySQL Database - Connectivity testing for MySQL servers', port: 3306, icon: '🗄️', features: ['Server handshake', 'Version detection', 'Connection testing'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 1995, lastUpdated: 2025, implementations: [{name: 'MySQL 8.0.41', url: 'https://dev.mysql.com/'}] },
  { id: 'postgres' as const, name: 'PostgreSQL', description: 'PostgreSQL Database - Connectivity testing for PostgreSQL servers', port: 5432, icon: '🐘', features: ['Startup message', 'Authentication check', 'Connection testing'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 1996 },
  { id: 'redis' as const, name: 'Redis', description: 'Redis In-Memory Store - Key-value store and cache server', port: 6379, icon: '⚡', features: ['RESP protocol', 'Command execution', 'AUTH & database selection'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2009 },
  { id: 'mqtt' as const, name: 'MQTT', description: 'MQTT Protocol - Lightweight IoT messaging protocol', port: 1883, icon: '📡', features: ['Publish/subscribe', 'MQTT 3.1.1', 'Username/password auth'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1999 },
  { id: 'ldap' as const, name: 'LDAP', description: 'LDAP Protocol - Directory services and authentication', port: 389, icon: '📂', features: ['BIND operation', 'Anonymous/authenticated bind', 'ASN.1/BER encoding'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'network' as ProtocolCategory , year: 1993 },
  { id: 'ldaps' as const, name: 'LDAPS', description: 'LDAP over TLS - Secure directory services with implicit TLS', port: 636, icon: '🔒', features: ['Implicit TLS encryption', 'Secure bind (anonymous/authenticated)', 'Base DN search over TLS'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'network' as ProtocolCategory , year: 1997 },
  { id: 'smb' as const, name: 'SMB', description: 'SMB Protocol - Windows file sharing and network communication', port: 445, icon: '💾', features: ['SMB2/SMB3 negotiation', 'Protocol dialect detection', 'Connectivity testing'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'files' as ProtocolCategory , year: 1984 },
  { id: 'irc' as const, name: 'IRC', description: 'IRC Protocol (RFC 2812) - Real-time internet relay chat', port: 6667, icon: '💬', features: ['Channel chat', 'Private messaging', 'Interactive WebSocket session'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1988 },
  { id: 'ircs' as const, name: 'IRCS', description: 'IRC over TLS (RFC 7194) - Encrypted real-time internet relay chat with implicit TLS on port 6697', port: 6697, icon: '🔐', features: ['Implicit TLS encryption', 'Channel chat', 'Private messaging', 'Interactive WebSocket session'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2000 },
  { id: 'gopher' as const, name: 'Gopher', description: 'Gopher Protocol (RFC 1436) - Pre-Web hypertext browsing from 1991', port: 70, icon: '🐿️', features: ['Menu browsing', 'Search servers', 'Internet archaeology'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory , year: 1991 },
  { id: 'memcached' as const, name: 'Memcached', description: 'Memcached Protocol - Distributed memory caching system', port: 11211, icon: '🧊', features: ['Cache inspection', 'Key-value operations', 'Stats monitoring'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2003 },
  { id: 'dns' as const, name: 'DNS', description: 'DNS over TCP (RFC 1035) - Domain name resolution and debugging', port: 53, icon: '🌐', features: ['A/AAAA/MX/NS/TXT records', 'Multiple DNS servers', 'Raw response parsing'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'network' as ProtocolCategory , year: 1987 },
  { id: 'stomp' as const, name: 'STOMP', description: 'STOMP Protocol (v1.2) - Simple text messaging for brokers', port: 61613, icon: '📨', features: ['Queue & topic messaging', 'RabbitMQ/ActiveMQ support', 'Text-based framing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2006 },
  { id: 'socks5' as const, name: 'SOCKS5', description: 'SOCKS5 Protocol (RFC 1928) - Authenticated TCP proxy with IPv6 support', port: 1080, icon: '🛡️', features: ['Username/password auth', 'Domain name resolution', 'IPv6 & IPv4 support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 1996 },
  { id: 'modbus' as const, name: 'Modbus TCP', description: 'Modbus TCP Protocol - Industrial automation and SCADA monitoring', port: 502, icon: '🏭', features: ['Read registers & coils', 'PLC/sensor monitoring', 'Read-only safety mode'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1979 },
  { id: 'mongodb' as const, name: 'MongoDB', description: 'MongoDB Wire Protocol - NoSQL document database connectivity testing', port: 27017, icon: '🍃', features: ['BSON wire protocol', 'Server version detection', 'Wire version & status check'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2009 },
  { id: 'graphite' as const, name: 'Graphite', description: 'Graphite Plaintext Protocol - Time-series metrics collection and monitoring', port: 2003, icon: '📊', features: ['Metric batch sending', 'Dot-separated naming', 'Fire-and-forget protocol'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2008 },
  { id: 'git' as const, name: 'Git Protocol', description: 'Git Protocol (git://) - Read-only repository browsing via native protocol', port: 9418, icon: '🔀', features: ['Branch & tag listing', 'Pkt-line format', 'Server capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory , year: 2005 },
  { id: 'zookeeper' as const, name: 'ZooKeeper', description: 'Apache ZooKeeper - Distributed coordination service health checking', port: 2181, icon: '🐘', features: ['Four-letter word commands', 'Health check (ruok/imok)', 'Server stats & monitoring'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2008 },
  { id: 'amqp' as const, name: 'AMQP', description: 'AMQP 0-9-1 Protocol - Message broker connectivity (RabbitMQ)', port: 5672, icon: '🐇', features: ['Broker detection', 'Version & platform info', 'Auth mechanism discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2003 },
  { id: 'cassandra' as const, name: 'Cassandra', description: 'Apache Cassandra CQL Protocol - Wide-column NoSQL database connectivity', port: 9042, icon: '👁️', features: ['CQL Binary Protocol v4', 'Version & compression detection', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2008 },
  { id: 'kafka' as const, name: 'Kafka', description: 'Apache Kafka Protocol - Distributed event streaming and message broker', port: 9092, icon: '📊', features: ['API version discovery', 'Cluster metadata', 'Topic & partition inspection'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2011 },
  { id: 'rtsp' as const, name: 'RTSP', description: 'RTSP Protocol (RFC 2326) - Streaming media server control and IP cameras', port: 554, icon: '🎥', features: ['OPTIONS capability discovery', 'SDP stream description', 'IP camera & surveillance'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1998 },
  { id: 'rsync' as const, name: 'Rsync', description: 'Rsync Daemon Protocol - File synchronization and module discovery', port: 873, icon: '🔄', features: ['Version detection', 'Module listing', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory , year: 1996 },
  { id: 'nfs' as const, name: 'NFS', description: 'Network File System (RFC 7530) - Distributed file system for mounting remote shares over TCP', port: 2049, icon: '🗂️', features: ['RPC NULL probe', 'Mount daemon discovery', 'Export enumeration'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'files' as ProtocolCategory, year: 1984 },
  { id: 'tds' as const, name: 'TDS / SQL Server', description: 'TDS Protocol (MS-TDS) - Microsoft SQL Server connectivity testing', port: 1433, icon: '🗃️', features: ['Pre-Login handshake', 'Version & encryption detection', 'MARS capability check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 1984 },
  { id: 'vnc' as const, name: 'VNC', description: 'VNC / RFB Protocol (RFC 6143) - Remote desktop server discovery and testing', port: 5900, icon: '🖥️', features: ['RFB version detection', 'Security type enumeration', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1998 },
  { id: 'spice' as const, name: 'SPICE', description: 'Simple Protocol for Independent Computing Environments - Red Hat VDI protocol for KVM/QEMU', port: 5900, icon: '🖥️', features: ['Protocol version detection', 'Capability enumeration', 'Channel discovery'], status: 'active' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'remote' as ProtocolCategory , year: 2008 },
  { id: 'battlenet' as const, name: 'Battle.net', description: 'Battle.net BNCS Protocol - Blizzard gaming service for classic games (Diablo, StarCraft, Warcraft)', port: 6112, icon: '🎮', features: ['BNCS protocol detection', 'Message parsing', 'Protocol selector support'], status: 'active' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1996 },
  { id: 'neo4j' as const, name: 'Neo4j', description: 'Neo4j Bolt Protocol - Graph database connectivity and version detection', port: 7687, icon: '🔗', features: ['Bolt handshake', 'Protocol version detection', 'PackStream encoding'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2012 },
  { id: 'rtmp' as const, name: 'RTMP', description: 'RTMP Protocol - Live video streaming server connectivity testing', port: 1935, icon: '📺', features: ['Handshake validation', 'Version detection', 'Twitch/YouTube/NGINX-RTMP'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2002 },
  { id: 'tacacs' as const, name: 'TACACS+', description: 'TACACS+ Protocol (RFC 8907) - Network device AAA for Cisco environments', port: 49, icon: '🔐', features: ['Server probe & detection', 'Authentication flow testing', 'MD5 encryption support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1993 },
  { id: 'hl7' as const, name: 'HL7 v2.x', description: 'HL7 v2.x Protocol - Healthcare data exchange via MLLP framing', port: 2575, icon: '🏥', features: ['MLLP connectivity testing', 'ADT & ORU message types', 'ACK response parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1987 },
  { id: 'elasticsearch' as const, name: 'Elasticsearch', description: 'Elasticsearch REST API - Distributed search and analytics engine over TCP', port: 9200, icon: '🔎', features: ['Cluster health & info', 'Query DSL search', 'Raw HTTP over TCP sockets'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2010 },
  { id: 'ajp' as const, name: 'AJP', description: 'Apache JServ Protocol (AJP/1.3) - Binary proxy for Tomcat/Jetty connectivity', port: 8009, icon: '🐱', features: ['CPing/CPong health check', 'Binary protocol detection', 'Tomcat/Jetty connector test'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 1999 },
  { id: 'rcon' as const, name: 'Minecraft RCON', description: 'Source RCON Protocol - Minecraft/Source engine server remote administration', port: 25575, icon: '🎮', features: ['Server command execution', 'Password authentication', 'Player & world management'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2010 },
  { id: 'sourcercon' as const, name: 'Source RCON', description: 'Valve Source RCON Protocol - Steam/Source engine game server administration (CS:GO, TF2, L4D2, GMod)', port: 27015, icon: '🕹️', features: ['Game server commands', 'Player management', 'Map & config control'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2010 },
  { id: 'rdp' as const, name: 'RDP', description: 'Remote Desktop Protocol (MS-RDPBCGR) - Windows remote desktop connectivity testing', port: 3389, icon: '🖥️', features: ['X.224/TPKT handshake', 'Security protocol detection', 'NLA/CredSSP/TLS check'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1996 },
  { id: 'nntp' as const, name: 'NNTP', description: 'Network News Transfer Protocol (RFC 3977) - Usenet newsgroup browsing and article reading', port: 119, icon: '📰', features: ['Newsgroup browsing', 'Article retrieval', 'OVER header fetching'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1986 },
  { id: 'nats' as const, name: 'NATS', description: 'NATS Protocol - Ultra-fast cloud-native pub/sub messaging system', port: 4222, icon: '🚀', features: ['Pub/sub messaging', 'Server info & JetStream detection', 'Token & user/pass auth'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2011 },
  { id: 'xmpp' as const, name: 'XMPP', description: 'XMPP Protocol (RFC 6120) - Extensible messaging and presence (Jabber)', port: 5222, icon: '💬', features: ['TLS & SASL discovery', 'Server feature probing', 'XML stream negotiation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1999 },
  { id: 'jetdirect' as const, name: 'JetDirect', description: 'HP JetDirect Protocol - Raw network printing and PJL printer identification', port: 9100, icon: '🖨️', features: ['PJL status queries', 'Printer model identification', 'Port connectivity testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1992 },
  { id: 'fastcgi' as const, name: 'FastCGI', description: 'FastCGI Protocol - Binary web server to application server interface', port: 9000, icon: '🔧', features: ['Server capability probing', 'PHP-FPM health check', 'CGI request/response testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 1996 },
  { id: 'diameter' as const, name: 'Diameter', description: 'Diameter Protocol (RFC 6733) - Modern AAA for 4G/5G mobile networks', port: 3868, icon: '📶', features: ['Capabilities exchange (CER/CEA)', 'Device watchdog (DWR/DWA)', 'AVP parsing & peer info'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2001 },
  { id: 'etcd' as const, name: 'etcd', description: 'etcd v3 API - Distributed key-value store powering Kubernetes coordination', port: 2379, icon: '🔑', features: ['Key-value CRUD operations', 'Cluster health & status', 'Lease & lock management'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2013 },
  { id: 'consul' as const, name: 'Consul', description: 'HashiCorp Consul HTTP API - Service discovery and health checking', port: 8500, icon: '🏛️', features: ['Service catalog discovery', 'Agent version & datacenter', 'ACL token support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2014 },
  { id: 'influxdb' as const, name: 'InfluxDB', description: 'InfluxDB HTTP API - Purpose-built time-series database for metrics and IoT', port: 8086, icon: '📈', features: ['Health check & version detection', 'Line Protocol data writing', 'Flux query execution'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2013 },
  { id: 'bgp' as const, name: 'BGP', description: 'Border Gateway Protocol (RFC 4271) - Internet routing between autonomous systems', port: 179, icon: '🌍', features: ['OPEN handshake & version detection', 'AS number & capability discovery', 'Session establishment check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1989 },
  { id: 'docker' as const, name: 'Docker', description: 'Docker Engine API - HTTP REST API for container management over TCP', port: 2375, icon: '🐳', features: ['Ping connectivity check', 'Version & platform detection', 'Cloudflare protection detection'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2013 },
  { id: 'jupyter' as const, name: 'Jupyter', description: 'Jupyter Notebook/JupyterLab REST API - Interactive computing server for notebooks and kernels', port: 8888, icon: '📓', features: ['Server health & version check', 'Kernel & session enumeration', 'Token authentication support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory, year: 2014 },
  { id: 'kubernetes' as const, name: 'Kubernetes', description: 'Kubernetes API Server (port 6443) - HTTPS REST API for cluster management and control plane access', port: 6443, icon: '☸️', features: ['Health probe (/healthz)', 'Authenticated API queries', 'Bearer token support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2014 },
  { id: 'activemq' as const, name: 'ActiveMQ', description: 'Apache ActiveMQ (port 61616) - OpenWire binary protocol handshake and broker capability detection', port: 61616, icon: '📨', features: ['WireFormatInfo handshake', 'Broker version & name detection', 'Capability flags (stack traces, cache, tight encoding)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 2004 },
  { id: 'uucp' as const, name: 'UUCP', description: 'Unix-to-Unix Copy Protocol (port 540) - Legacy Unix network communication and file transfer', port: 540, icon: '📡', features: ['Wakeup handshake detection', 'Server system name discovery', 'UUCP greeting negotiation'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory, year: 1978 },
  { id: 'perforce' as const, name: 'Perforce', description: 'Perforce Helix Core (port 1666) - Proprietary version control system used in game development and enterprise', port: 1666, icon: '🗃️', features: ['Protocol negotiation probe', 'Server version detection', 'Server info query (address, date, root)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory, year: 1995 },
  { id: 'quake3' as const, name: 'Quake 3', description: 'Quake 3 Arena game server (port 27960) - UDP OOB protocol for server status and player listing', port: 27960, icon: '🎮', features: ['getstatus — full vars + player list', 'getinfo — summary query', 'Server variable parsing'], status: 'active' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 1999 },
  { id: 'collectd' as const, name: 'collectd', description: 'collectd metrics daemon (port 25826) - Binary TLV protocol for system performance metrics', port: 25826, icon: '📊', features: ['Listen for pushed metric data', 'Send GAUGE metric via TLV', 'Part type decoding'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2005 },
  { id: 'ethereum' as const, name: 'Ethereum P2P', description: 'Ethereum RLPx/DevP2P (port 30303) - Encrypted P2P protocol for Ethereum node communication', port: 30303, icon: '⟠', features: ['TCP connectivity check', 'RLPx fingerprinting', 'DevP2P handshake detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2015 },
  { id: 'ipfs' as const, name: 'IPFS', description: 'IPFS / libp2p (port 4001) - Decentralized file system using multistream-select protocol negotiation', port: 4001, icon: '🌐', features: ['Multistream-select handshake', 'Protocol negotiation (ls)', 'libp2p protocol detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory, year: 2015 },
  { id: 'pptp' as const, name: 'PPTP', description: 'PPTP Protocol (RFC 2637) - Legacy VPN server discovery and fingerprinting', port: 1723, icon: '🔒', features: ['Version & capability detection', 'Hostname & vendor fingerprint', 'Framing/bearer enumeration'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 1996 },
  { id: 'dicom' as const, name: 'DICOM', description: 'DICOM Protocol (ISO 12052) - Medical imaging communication and PACS connectivity', port: 104, icon: '🏥', features: ['A-ASSOCIATE handshake', 'C-ECHO verification (DICOM ping)', 'SOP Class negotiation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1993 },
  { id: 'jsonrpc' as const, name: 'JSON-RPC', description: 'JSON-RPC 2.0 Protocol - Lightweight RPC for Ethereum, Bitcoin, and custom APIs', port: 8545, icon: '🔗', features: ['Ethereum & Bitcoin RPC', 'Method call with params', 'Batch request support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2005 },
  { id: 'lsp' as const, name: 'LSP', description: 'Language Server Protocol (LSP 3.17) - JSON-RPC 2.0 over TCP for IDE language intelligence', port: 2087, icon: '🖥️', features: ['Initialize handshake', 'Server capability detection', 'Code completion / hover / refactoring support'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory, year: 2016 },
  { id: '9p' as const, name: '9P', description: '9P Protocol (Plan 9) - Network filesystem where everything is a file', port: 564, icon: '📁', features: ['Version negotiation', 'Filesystem attach', 'Used by QEMU & WSL2'], status: 'niche' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory , year: 1992 },
  { id: 'thrift' as const, name: 'Thrift', description: 'Apache Thrift Protocol - Cross-language binary RPC framework', port: 9090, icon: '⚙️', features: ['Binary protocol probe', 'Custom RPC method calls', 'Framed & buffered transport'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 2007 },
  { id: 'slp' as const, name: 'SLP', description: 'Service Location Protocol (RFC 2608) - Automatic network service discovery', port: 427, icon: '🔍', features: ['Service type enumeration', 'Service URL discovery', 'Attribute-based queries'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 1999 },
  { id: 'bittorrent' as const, name: 'BitTorrent', description: 'BitTorrent Peer Wire Protocol (BEP 3) - P2P file sharing handshake and peer detection', port: 6881, icon: '🌊', features: ['Protocol handshake', 'Client fingerprinting', 'Extension discovery (DHT/PEX)'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'files' as ProtocolCategory , year: 2001 },
  { id: 'x11' as const, name: 'X11', description: 'X Window System Protocol - Network-transparent graphical display server probing', port: 6000, icon: '🖼️', features: ['Setup handshake & auth', 'Vendor & version detection', 'Screen resolution discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1984 },
  { id: 'kerberos' as const, name: 'Kerberos', description: 'Kerberos v5 Protocol (RFC 4120) - Network authentication for Active Directory', port: 88, icon: '🔑', features: ['AS-REQ probe & KDC detection', 'Encryption type discovery', 'Realm & version info'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'network' as ProtocolCategory , year: 1988 },
  { id: 'sccp' as const, name: 'SCCP (Skinny)', description: 'Cisco Skinny Client Control Protocol - VoIP phone signaling for CUCM', port: 2000, icon: '📞', features: ['KeepAlive probe & detection', 'Device registration attempt', 'Binary message parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1990 },
  { id: 'matrix' as const, name: 'Matrix', description: 'Matrix Protocol - Decentralized real-time communication and federation', port: 8448, icon: '🔷', features: ['Homeserver discovery', 'Federation version detection', 'Login flow enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2014 },
  { id: 'cdp' as const, name: 'Chrome DevTools', description: 'Chrome DevTools Protocol (CDP) - Remote browser debugging and automation', port: 9222, icon: '🔍', features: ['Browser version detection', 'Target enumeration', 'CDP API exploration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1994 },
  { id: 'node-inspector' as const, name: 'Node Inspector', description: 'V8 Inspector Protocol - Node.js debugging and profiling via DevTools', port: 9229, icon: '🐛', features: ['Session discovery', 'JavaScript debugging', 'Runtime evaluation & profiling'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2011 },
  { id: 'dap' as const, name: 'DAP', description: 'Debug Adapter Protocol - Universal debugger interface for IDEs and language adapters', port: 5678, icon: '🔧', features: ['Adapter capabilities probe', 'Live debug session', 'Request/event message exchange'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2016 },
  { id: 'iscsi' as const, name: 'iSCSI', description: 'iSCSI Protocol (RFC 7143) - Block-level storage over TCP/IP networks', port: 3260, icon: '💿', features: ['Login & session negotiation', 'SendTargets discovery', 'Target IQN enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2000 },
  { id: 'websocket' as const, name: 'WebSocket', description: 'WebSocket Protocol (RFC 6455) - Full-duplex communication over TCP via HTTP Upgrade', port: 80, icon: '🔌', features: ['HTTP Upgrade handshake probe', 'Accept key validation', 'Ping/pong frame testing'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'web' as ProtocolCategory , year: 2011 },
  { id: 'h323' as const, name: 'H.323', description: 'H.323 Protocol (ITU-T) - Legacy VoIP call signaling via Q.931 over TCP', port: 1720, icon: '📞', features: ['Q.931 SETUP probe & response parsing', 'Call flow message detection', 'Gateway/gatekeeper fingerprinting'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1996 },
  { id: 'mgcp' as const, name: 'MGCP', description: 'Media Gateway Control Protocol (RFC 3435) - VoIP gateway signaling between call agents and media gateways', port: 2427, icon: '📞', features: ['AUEP endpoint probe', 'Gateway response parsing', 'Call agent connectivity check'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2003 },
  { id: 'cifs' as const, name: 'CIFS', description: 'CIFS/SMB1 (Common Internet File System) — legacy Windows file sharing protocol, predecessor to SMB 2.0', port: 445, icon: '🗃️', features: ['SMB1 Negotiate probe', 'SMB2 redirect detection', 'Legacy dialect identification'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory, year: 1987 },
  { id: 'doh' as const, name: 'DoH', description: 'DNS over HTTPS (RFC 8484) — encrypted DNS queries via HTTPS, indistinguishable from web traffic', port: 443, icon: '🔐', features: ['Binary DNS wire format', 'Multiple record types', 'Cloudflare, Google, Quad9 resolvers'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2018 },
  { id: 'ipmi' as const, name: 'IPMI', description: 'Intelligent Platform Management Interface — out-of-band server management via BMC (RMCP probe)', port: 623, icon: '🖥️', features: ['RMCP ASF Presence Ping', 'TCP port reachability check', 'BMC presence detection'], status: 'niche' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'network' as ProtocolCategory, year: 1998 },
  { id: 'scp' as const, name: 'SCP', description: 'Secure Copy Protocol — SSH-based file transfer; probes SSH banner on port 22', port: 22, icon: '📂', features: ['SSH banner grab', 'Server software detection', 'SCP/SSH availability check'], status: 'deprecated' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory, year: 1995 },
  { id: 'spdy' as const, name: 'SPDY', description: 'SPDY (speedy) — deprecated Google protocol that preceded HTTP/2; TLS probe with SETTINGS frame', port: 443, icon: '⚡', features: ['TLS connection probe', 'SPDY/3 SETTINGS frame', 'Protocol detection (SPDY/h2/h1)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'web' as ProtocolCategory, year: 2009 },
  { id: 'shadowsocks' as const, name: 'Shadowsocks', description: 'Shadowsocks — encrypted proxy protocol for censorship circumvention; TCP connectivity probe', port: 8388, icon: '🕶️', features: ['TCP port reachability', 'Silent-on-connect detection', 'AEAD cipher support (AES-256-GCM, ChaCha20)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2012 },
  { id: 'dot' as const, name: 'DNS over TLS', description: 'DoT Protocol (RFC 7858) - Encrypted DNS queries via TLS on port 853', port: 853, icon: '🔒', features: ['Encrypted DNS resolution', 'Public DoT server support', 'Full record type queries'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 2016 },
  { id: 'soap' as const, name: 'SOAP', description: 'Simple Object Access Protocol - XML web services for enterprise integration', port: 80, icon: '🧼', features: ['SOAP 1.1/1.2 envelope support', 'WSDL discovery & operation listing', 'XML fault parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 1998 },
  { id: 'openvpn' as const, name: 'OpenVPN', description: 'OpenVPN Protocol - SSL/TLS VPN server detection and TCP handshake testing', port: 1194, icon: '🔐', features: ['TCP mode handshake', 'Session ID exchange', 'Protocol version detection'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 2001 },
  { id: 'dict' as const, name: 'DICT', description: 'DICT Protocol (RFC 2229) - Dictionary server for word definitions and thesaurus', port: 2628, icon: '📖', features: ['Word definitions', 'Pattern matching (prefix, soundex, regex)', 'Multi-dictionary search'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1997 },
  { id: 'sip' as const, name: 'SIP', description: 'SIP Protocol (RFC 3261) - VoIP and multimedia session signaling', port: 5060, icon: '📱', features: ['OPTIONS capability probe', 'REGISTER auth detection', 'Server agent fingerprinting'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1999 },
  { id: 'qotd' as const, name: 'QOTD', description: 'Quote of the Day (RFC 865) - Random quotes from remote servers', port: 17, icon: '💬', features: ['Zero-command protocol', 'Completes classic RFC simple services', 'Network connectivity test'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'lpd' as const, name: 'LPD', description: 'Line Printer Daemon (RFC 1179) - Classic Unix network printing protocol', port: 515, icon: '🖨️', features: ['Print queue status query', 'Short & long format listing', 'Printer name discovery'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1987 },
  { id: 'discard' as const, name: 'DISCARD', description: 'DISCARD Protocol (RFC 863) - Send data into a silent black hole for network testing', port: 9, icon: '🕳️', features: ['Bandwidth/throughput testing', 'Connection verification', 'Complement to ECHO (RFC 862)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1983 },
  { id: 'minecraft' as const, name: 'Minecraft SLP', description: 'Minecraft Server List Ping - Query server status, players, version, and MOTD', port: 25565, icon: '⛏️', features: ['Server status & MOTD', 'Player count & list', 'Version & latency check'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2009 },
  { id: 'zabbix' as const, name: 'Zabbix', description: 'Zabbix Protocol - Network monitoring server and agent connectivity testing', port: 10051, icon: '📊', features: ['Server probe (active checks)', 'Agent item queries', 'ZBXD binary header protocol'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 2001 },
  { id: 'ident' as const, name: 'IDENT', description: 'IDENT Protocol (RFC 1413) - TCP connection user identification for IRC and mail servers', port: 113, icon: '🪪', features: ['User ID lookup by port pair', 'OS type detection', 'IRC/SMTP auth verification'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 1993 },
  { id: 'oracle-tns' as const, name: 'Oracle TNS', description: 'Oracle TNS Protocol - Oracle Database listener detection and service connectivity testing', port: 1521, icon: '🔶', features: ['TNS Connect handshake', 'Listener & version detection', 'Service name probe'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 1990 },
  { id: 'mpd' as const, name: 'MPD', description: 'Music Player Daemon - Server-side music player with text-based control protocol', port: 6600, icon: '🎵', features: ['Playback status & stats', 'Current song metadata', 'Audio output discovery'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2003 },
  { id: 'beanstalkd' as const, name: 'Beanstalkd', description: 'Beanstalkd Work Queue - Fast text-based job queue for distributing time-consuming tasks', port: 11300, icon: '🫘', features: ['Server stats & version', 'Tube listing & stats', 'Read-only job inspection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2007 },
  { id: 'clamav' as const, name: 'ClamAV', description: 'ClamAV Daemon Protocol - Open-source antivirus engine health and version checking', port: 3310, icon: '🛡️', features: ['PING/PONG health check', 'Version & DB info', 'Thread pool statistics'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2001 },
  { id: 'lmtp' as const, name: 'LMTP', description: 'LMTP Protocol (RFC 2033) - Local mail delivery with per-recipient status', port: 24, icon: '📬', features: ['LHLO capability discovery', 'Per-recipient delivery status', 'Dovecot/Cyrus/Postfix local delivery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory , year: 1997 },
  { id: 'couchdb' as const, name: 'CouchDB', description: 'Apache CouchDB - HTTP-native NoSQL document database with REST API', port: 5984, icon: '🛋️', features: ['Server info & version detection', 'Database listing & browsing', 'REST API query interface'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2005 },
  { id: 'managesieve' as const, name: 'ManageSieve', description: 'ManageSieve Protocol (RFC 5804) - Sieve email filtering script management', port: 4190, icon: '📧', features: ['Capability probing', 'SASL PLAIN authentication', 'Sieve script listing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory , year: 2008 },
  { id: 'ipp' as const, name: 'IPP', description: 'Internet Printing Protocol (RFC 8011) - CUPS network printing and printer discovery', port: 631, icon: '🖨️', features: ['Get-Printer-Attributes probe', 'CUPS server detection', 'Printer capability discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1997 },
  { id: 'svn' as const, name: 'SVN', description: 'Subversion (svnserve) - Version control server greeting and capability detection', port: 3690, icon: '🔀', features: ['S-expression greeting parsing', 'Capability & auth detection', 'Protocol version discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory , year: 2000 },
  { id: 'smpp' as const, name: 'SMPP', description: 'SMPP v3.4 Protocol - SMS gateway connectivity testing and SMSC detection', port: 2775, icon: '📱', features: ['Bind Transceiver handshake', 'Server authentication testing', 'Interface version detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1996 },
  { id: 'teamspeak' as const, name: 'TeamSpeak', description: 'TeamSpeak ServerQuery - Text-based administration for TeamSpeak 3 voice servers', port: 10011, icon: '🎧', features: ['Server info & version detection', 'Client & channel listing', 'Read-only admin commands'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2001 },
  { id: 'radius' as const, name: 'RADIUS', description: 'RADIUS Protocol (RFC 2865) - Network access authentication for ISPs, Wi-Fi, and VPNs', port: 1812, icon: '📡', features: ['Status-Server probe & detection', 'Access-Request authentication', 'MD5 password encryption & HMAC'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'network' as ProtocolCategory , year: 1997 },
  { id: 'nrpe' as const, name: 'NRPE', description: 'Nagios NRPE Protocol - Remote plugin execution for Nagios monitoring', port: 5666, icon: '📟', features: ['Version detection (_NRPE_CHECK)', 'CRC32 integrity validation', 'Binary 1036-byte packet format'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1999 },
  { id: 'rlogin' as const, name: 'Rlogin', description: 'Rlogin Protocol (RFC 1282) - BSD remote login, the predecessor to SSH', port: 513, icon: '👴', features: ['Handshake probe & detection', 'User identity passing', 'Internet archaeology (pre-SSH)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1982 },
  { id: 's7comm' as const, name: 'S7comm', description: 'Siemens S7 PLC Protocol - Industrial SCADA/automation over ISO-TSAP', port: 102, icon: '🏭', features: ['COTP/TPKT connection', 'S7 setup communication', 'CPU identification (SZL)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2002 },
  { id: 'snpp' as const, name: 'SNPP', description: 'Simple Network Paging Protocol (RFC 1861) - Text-based TCP pager messaging', port: 444, icon: '📟', features: ['Server probe & banner detection', 'PAGE/MESS/SEND command flow', 'SMTP-like numeric response codes'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 1996 },
  { id: 'rethinkdb' as const, name: 'RethinkDB', description: 'RethinkDB ReQL Wire Protocol - Real-time document database with changefeed support', port: 28015, icon: '🔄', features: ['V0.4 & V1.0 handshake detection', 'SCRAM-SHA-256 auth probing', 'Auth key connectivity testing'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2009 },
  { id: 'clickhouse' as const, name: 'ClickHouse', description: 'ClickHouse - Columnar OLAP database with HTTP query interface for real-time analytics', port: 8123, icon: '🏠', features: ['Health check & version detection', 'SQL query execution', 'Database & table browsing'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2016 },
  { id: 'gearman' as const, name: 'Gearman', description: 'Gearman Job Queue - Distributed task processing with text-based admin protocol', port: 4730, icon: '⚙️', features: ['Server version & status', 'Function queue monitoring', 'Connected worker listing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2008 },
  { id: 'ethernetip' as const, name: 'EtherNet/IP', description: 'EtherNet/IP - CIP industrial protocol for PLC and automation device discovery', port: 44818, icon: '🏭', features: ['ListIdentity device discovery', 'Vendor & product identification', 'Firmware revision & serial number'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2001 },
  { id: 'portmapper' as const, name: 'Portmapper', description: 'ONC RPC Portmapper / rpcbind (RFC 1833) - Service discovery for NFS, NIS, and Unix RPC', port: 111, icon: '🗺️', features: ['RPC service enumeration (DUMP)', 'NULL ping probe', 'NFS/mountd/nlockmgr discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1988 },
  { id: 'adb' as const, name: 'ADB', description: 'Android Debug Bridge - Mobile development tool for device communication and debugging', port: 5037, icon: '📱', features: ['Protocol version detection', 'Device listing with properties', 'Text-based length-prefixed commands'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2007 },
  { id: 'relp' as const, name: 'RELP', description: 'Reliable Event Logging Protocol - Guaranteed syslog delivery with application-level ACKs', port: 20514, icon: '📋', features: ['Session open/close handshake', 'Guaranteed message delivery (ACK)', 'RFC 5424 syslog integration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2008 },
  { id: 'prometheus' as const, name: 'Prometheus', description: 'Prometheus Monitoring - HTTP-based metrics collection, PromQL queries, and health checks', port: 9090, icon: '🔥', features: ['Health & readiness probes', 'PromQL query execution', 'Metrics scrape & parsing'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2012 },
  { id: 'dnp3' as const, name: 'DNP3', description: 'DNP3 Protocol (IEEE 1815) - SCADA protocol for electric utilities and water systems', port: 20000, icon: '⚡', features: ['Link status probe & detection', 'Class 0 data integrity poll', 'CRC-16/DNP frame validation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1993 },
  { id: 'stun' as const, name: 'STUN', description: 'STUN Protocol (RFC 5389/8489) - NAT traversal for WebRTC, VoIP, and peer-to-peer', port: 3478, icon: '🔀', features: ['Binding Request/Response', 'Public IP discovery', 'Server software detection'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 2003 },
  { id: 'fluentd' as const, name: 'Fluentd', description: 'Fluentd Forward Protocol - Log aggregation with MessagePack-encoded forwarding over TCP', port: 24224, icon: '📊', features: ['Server probe with ack verification', 'Custom log entry forwarding', 'MessagePack binary encoding'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 2011 },
  { id: 'rexec' as const, name: 'Rexec', description: 'BSD Remote Execution (Port 512) - Execute commands on remote Unix hosts with password auth', port: 512, icon: '🖥️', features: ['Command execution with output', 'Password authentication (cleartext)', 'Internet archaeology (pre-SSH)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'remote' as ProtocolCategory , year: 1983 },
  { id: 'rsh' as const, name: 'RSH', description: 'BSD Remote Shell (RFC 1282) — execute commands on remote Unix hosts via .rhosts trust', port: 514, icon: '🖥️', features: ['Command execution via .rhosts trust', 'Privileged port detection', 'Internet archaeology (pre-SSH)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'remote' as ProtocolCategory, year: 1983 },
  { id: 'fix' as const, name: 'FIX', description: 'FIX Protocol (FIX.4.x) - Financial Information eXchange for electronic trading', port: 9878, icon: '💹', features: ['Logon/Logout handshake probe', 'Heartbeat & TestRequest', 'FIX version & CompID detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1992 },
  { id: 'aerospike' as const, name: 'Aerospike', description: 'Aerospike Info Protocol - High-performance NoSQL database cluster health and metadata', port: 3000, icon: '🚀', features: ['Build version & edition detection', 'Namespace enumeration', 'Cluster health & statistics'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2009 },
  { id: 'epmd' as const, name: 'EPMD', description: 'Erlang Port Mapper Daemon - Node discovery for RabbitMQ, CouchDB, and Elixir clusters', port: 4369, icon: '🐇', features: ['List registered Erlang nodes', 'Node port lookup', 'RabbitMQ/CouchDB cluster discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 1998 },
  { id: 'epp' as const, name: 'EPP', description: 'EPP Protocol (RFCs 5730-5734) - Extensible Provisioning Protocol for domain registration', port: 700, icon: '🌐', features: ['Connect & hello handshake', 'Login authentication', 'Domain availability check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2009 },
  { id: 'tarantool' as const, name: 'Tarantool', description: 'Tarantool IPROTO Protocol - High-performance in-memory database with binary wire protocol', port: 3301, icon: '🔵', features: ['128-byte greeting banner detection', 'IPROTO_PING connectivity test', 'Version & instance UUID discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2008 },
  { id: 'vault' as const, name: 'Vault', description: 'HashiCorp Vault - Secret management with HTTP API for health, seal status, and system info', port: 8200, icon: '🔐', features: ['Health check & version detection', 'Seal/unseal status monitoring', 'Cluster & replication info'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2015 },
  { id: 'nomad' as const, name: 'Nomad', description: 'HashiCorp Nomad HTTP API - Workload orchestration and job scheduling for containers and VMs', port: 4646, icon: '🚀', features: ['Agent info & cluster status', 'Job listing & management', 'Node discovery & health'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2015 },
  { id: 'solr' as const, name: 'Apache Solr', description: 'Apache Solr - Open-source enterprise search platform with Lucene-based full-text search', port: 8983, icon: '🔎', features: ['System info & version detection', 'Core listing & status', 'Lucene query search interface'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2004 },
  { id: 'iec104' as const, name: 'IEC 104', description: 'IEC 60870-5-104 - Telecontrol protocol for power grid SCADA and substation automation', port: 2404, icon: '⚡', features: ['STARTDT/TESTFR connectivity probing', 'U-frame/I-frame/S-frame detection', 'RTU/IED availability testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2006 },
  { id: 'opentsdb' as const, name: 'OpenTSDB', description: 'OpenTSDB - Distributed time series database with telnet-style text protocol on HBase', port: 4242, icon: '📈', features: ['Server version detection', 'Internal statistics retrieval', 'Metric/tag name suggestion'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2010 },
  { id: 'riak' as const, name: 'Riak KV', description: 'Riak KV - Distributed NoSQL key-value database with Protocol Buffers binary wire protocol', port: 8087, icon: '🔑', features: ['PBC ping & pong health check', 'Server info & version detection', 'Binary length-prefixed framing'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2009 },
  { id: 'bitcoin' as const, name: 'Bitcoin', description: 'Bitcoin P2P Wire Protocol - Connect to Bitcoin nodes, version handshake, and network discovery', port: 8333, icon: '₿', features: ['Version handshake & node info', 'Service flag detection (SegWit, pruned)', 'Block height & user agent discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2009 },
  { id: 'spamd' as const, name: 'SpamAssassin', description: 'SpamAssassin spamd Protocol - Email spam analysis via the SpamAssassin daemon on port 783', port: 783, icon: '🛡️', features: ['PING/PONG connectivity test', 'CHECK/SYMBOLS/REPORT spam analysis', 'GTUBE test pattern support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory , year: 2001 },
  { id: 'nsq' as const, name: 'NSQ', description: 'NSQ TCP Protocol - Realtime distributed messaging platform for high-throughput workloads', port: 4150, icon: '📬', features: ['V2 protocol handshake & IDENTIFY', 'Message publishing to topics', 'Server version & feature detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2012 },
  { id: 'opcua' as const, name: 'OPC UA', description: 'OPC Unified Architecture - Industrial IoT machine-to-machine communication protocol', port: 4840, icon: '🏭', features: ['Hello/Acknowledge handshake probe', 'Endpoint discovery & security policies', 'Server capability detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2006 },
  { id: 'zmtp' as const, name: 'ZMTP', description: 'ZeroMQ Message Transport Protocol - Binary wire protocol for high-performance distributed messaging', port: 5555, icon: '🔗', features: ['ZMTP 3.1 greeting handshake', 'NULL/PLAIN/CURVE mechanism detection', 'Socket type negotiation (REQ/REP/PUB/SUB)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2013 },
  { id: 'munin' as const, name: 'Munin', description: 'Munin Node Protocol - Text-based monitoring daemon for system metrics and plugin data', port: 4949, icon: '📊', features: ['Plugin listing & discovery', 'Plugin value fetching', 'Node version & capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2002 },
  { id: 'sane' as const, name: 'SANE', description: 'SANE (Scanner Access Now Easy) - Network scanner daemon protocol for Linux/Unix systems', port: 6566, icon: '📠', features: ['Daemon version detection', 'SANE_NET_INIT handshake', 'Connection status probing'], status: 'niche' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1996 },
  { id: 'ceph' as const, name: 'Ceph Monitor', description: 'Ceph MSGR Protocol - Distributed storage cluster monitor detection and version probing', port: 6789, icon: '🐙', features: ['MSGR v1/v2 banner detection', 'Entity address & feature flags', 'Cluster monitor reachability'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2006 },
  { id: 'httpproxy' as const, name: 'HTTP Proxy', description: 'HTTP Forward Proxy & CONNECT Tunnel (RFC 9110) - Test Squid, Nginx, and other HTTP proxies', port: 3128, icon: '🔀', features: ['Forward proxy probe & detection', 'CONNECT tunnel testing', 'Proxy type identification (Squid, Nginx, etc.)'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 1996 },
  { id: 'varnish' as const, name: 'Varnish CLI', description: 'Varnish CLI Protocol - Administration interface for Varnish Cache reverse proxy servers', port: 6082, icon: '💨', features: ['Banner & auth detection', 'Backend health monitoring', 'VCL config listing & status'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 2006 },
  { id: 'fins' as const, name: 'FINS', description: 'Omron FINS/TCP Protocol - Industrial PLC communication for CJ, CS, CP, NX series', port: 9600, icon: '🏭', features: ['FINS/TCP node address handshake', 'Controller model identification', 'PLC mode & error status read'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1990 },
  { id: 'couchbase' as const, name: 'Couchbase', description: 'Couchbase Server - Memcached binary protocol for high-performance NoSQL key-value operations', port: 11210, icon: '🔴', features: ['Binary NOOP ping health check', 'Server version detection', 'Key-value statistics retrieval'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2010 },
  { id: 'ami' as const, name: 'Asterisk AMI', description: 'Asterisk Manager Interface (Port 5038) - Text-based PBX control and monitoring protocol', port: 5038, icon: '📞', features: ['Banner & version detection', 'Authenticated action execution', 'Event stream collection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2005 },
  { id: 'jdwp' as const, name: 'JDWP', description: 'Java Debug Wire Protocol - Remote JVM debugging interface (JPDA)', port: 8000, icon: '☕', features: ['ASCII handshake detection', 'JVM version & name query', 'ID sizes & debug capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1999 },
  { id: 'drda' as const, name: 'DRDA (DB2)', description: 'IBM Distributed Relational Database Architecture - DB2/Derby EXCSAT handshake', port: 50000, icon: '🏢', features: ['EXCSAT handshake', 'Server attribute exchange', 'Manager level detection'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'databases' as ProtocolCategory , year: 1993 },
  { id: 'livestatus' as const, name: 'Livestatus', description: 'MK Livestatus - Text-based monitoring query protocol for Checkmk, Naemon, and Icinga', port: 6557, icon: '📊', features: ['Engine status & version detection', 'Host & service state queries', 'LQL query language (SQL-like)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2009 },
  { id: 'dcerpc' as const, name: 'DCE/RPC', description: 'MS-RPC Endpoint Mapper - Windows service discovery via DCE/RPC Bind handshake', port: 135, icon: '🪟', features: ['EPM Bind/Bind Ack handshake', 'RPC interface probing (8 built-in)', 'Custom UUID testing'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 1995 },
  { id: 'imaps' as const, name: 'IMAPS', description: 'IMAP over TLS (RFC 8314) - Secure email access with implicit TLS encryption', port: 993, icon: '🔒', features: ['TLS from first byte (implicit)', 'Capability & auth probing', 'Mailbox listing & selection'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'email' as ProtocolCategory , year: 1997 },
  { id: 'loki' as const, name: 'Loki', description: 'Grafana Loki - Horizontally-scalable log aggregation with LogQL queries', port: 3100, icon: '🪵', features: ['Health & readiness probes', 'LogQL query execution', 'Metrics scrape & label discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2018 },
  { id: 'pjlink' as const, name: 'PJLink', description: 'PJLink Protocol - Unified projector/display control for AV and digital signage', port: 4352, icon: '📽️', features: ['Projector identification & status', 'Power on/off control', 'Lamp hours & error diagnostics'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2005 },
  { id: 'openflow' as const, name: 'OpenFlow', description: 'SDN control protocol for programmable network switches (ONF standard)', port: 6653, icon: '🔀', features: ['HELLO version negotiation', 'Switch feature discovery', 'Echo keepalive testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2008 },
  { id: 'nsca' as const, name: 'NSCA', description: 'Nagios Service Check Acceptor - Binary passive check protocol for monitoring infrastructure', port: 5667, icon: '📡', features: ['132-byte init packet detection', 'Passive check result submission', 'XOR encryption support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2000 },
  { id: 'meilisearch' as const, name: 'Meilisearch', description: 'Meilisearch - Lightning-fast typo-tolerant full-text search engine with REST API', port: 7700, icon: '🔎', features: ['Health & version checks', 'Index listing & statistics', 'Full-text search queries'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 2018 },
  { id: 'icecast' as const, name: 'Icecast', description: 'Icecast Streaming Server - HTTP-based audio/video streaming with mount point monitoring', port: 8000, icon: '📻', features: ['Server status & mount points', 'Listener count monitoring', 'Stream metadata detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1998 },
  { id: 'haproxy' as const, name: 'HAProxy', description: 'HAProxy Runtime API - Text-based administration for the world\'s most popular load balancer', port: 9999, icon: '⚖️', features: ['Process info & version detection', 'CSV frontend/backend statistics', 'Server state & health monitoring'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2000 },
  { id: 'rmi' as const, name: 'Java RMI', description: 'Java Remote Method Invocation - JRMI wire protocol for remote object registry', port: 1099, icon: '☕', features: ['JRMI handshake & ProtocolAck', 'Registry binding discovery', 'Server endpoint identification'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1997 },
  { id: 'nbd' as const, name: 'NBD', description: 'Network Block Device - Linux block storage over TCP with NBDMAGIC handshake', port: 10809, icon: '💾', features: ['NBDMAGIC handshake detection', 'Export listing', 'Newstyle negotiation flags'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 1997 },
  { id: 'ganglia' as const, name: 'Ganglia', description: 'Ganglia gmond - Cluster monitoring with XML dump of CPU, memory, disk, and network metrics', port: 8649, icon: '📊', features: ['Full XML cluster dump on connect', 'Host & metric enumeration', 'Cluster topology discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2000 },
  { id: 'pop3s' as const, name: 'POP3S', description: 'POP3 over TLS (RFC 8314) - Encrypted email retrieval with implicit TLS on port 995', port: 995, icon: '🔒', features: ['Implicit TLS encryption', 'Email message listing', 'Authenticated mailbox access'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'email' as ProtocolCategory , year: 1997 },
  { id: 'netbios' as const, name: 'NetBIOS', description: 'RFC 1002 NetBIOS Session Service - Windows networking transport for SMB/CIFS over NetBIOS', port: 139, icon: '🖧', features: ['Session Request/Response handshake', 'Service suffix discovery (6 types)', 'NetBIOS name encoding/decoding'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'network' as ProtocolCategory , year: 1987 },
  { id: 'smtps' as const, name: 'SMTPS', description: 'SMTP over TLS (RFC 8314) - Secure email submission with implicit TLS encryption', port: 465, icon: '🔐', features: ['Implicit TLS from first byte', 'AUTH LOGIN authentication', 'Email sending over TLS'], status: 'active' as ProtocolStatus, popularity: 'ubiquitous' as PopularityTier, category: 'email' as ProtocolCategory , year: 1997 },
  { id: 'pcep' as const, name: 'PCEP', description: 'RFC 5440 Path Computation Element Protocol - SDN/MPLS path computation for network orchestration', port: 4189, icon: '🛤️', features: ['OPEN handshake detection', 'Session parameter exchange', 'Capability TLV parsing'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 2009 },
  { id: 'winrm' as const, name: 'WinRM', description: 'Windows Remote Management - HTTP/SOAP-based remote management for PowerShell and Ansible', port: 5985, icon: '🪟', features: ['WSMAN Identify probe (anonymous)', 'Auth method detection', 'Product vendor & version discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'remote' as ProtocolCategory , year: 2006 },
  { id: 'uwsgi' as const, name: 'uWSGI', description: 'uWSGI Binary Wire Protocol - High-performance Python/WSGI application server communication', port: 3031, icon: '🐍', features: ['Binary packet probe & detection', 'WSGI request with HTTP response', 'Server software identification'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory , year: 2009 },
  { id: 'torcontrol' as const, name: 'Tor Control', description: 'Tor Control Protocol - Text-based control interface for Tor process management and monitoring', port: 9051, icon: '🧅', features: ['PROTOCOLINFO probe (no auth)', 'Auth method discovery', 'GETINFO query for status/stats'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory , year: 2010 },
  { id: 'gpsd' as const, name: 'GPSD', description: 'GPS Service Daemon - JSON-based protocol for querying GPS receivers and location data', port: 2947, icon: '📡', features: ['Version & protocol detection', 'GPS device enumeration', 'Position fix polling (lat/lon/alt)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1997 },
  { id: 'kibana' as const, name: 'Kibana', description: 'Kibana - Elastic data visualization dashboard with saved objects and plugin discovery', port: 5601, icon: '📊', features: ['Server status & health check', 'Saved objects browsing', 'Plugin & version discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2011 },
  { id: 'grafana' as const, name: 'Grafana', description: 'Grafana Observability Platform - Monitoring dashboards, datasources, and visualization engine', port: 3000, icon: '📈', features: ['Health & server info', 'Datasource enumeration', 'Dashboard search & discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'web' as ProtocolCategory , year: 2014 },
  { id: 'rserve' as const, name: 'Rserve', description: 'Rserve Protocol (QAP1) - R Statistical Computing server for remote expression evaluation', port: 6311, icon: '📊', features: ['32-byte banner & version detection', 'R expression evaluation', 'Auth & TLS capability probing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 2002 },
  { id: 'sonic' as const, name: 'Sonic', description: 'Sonic Search Backend - Lightweight text-based search engine with TCP protocol', port: 1491, icon: '🔍', features: ['Instance & protocol detection', 'Control mode server stats', 'PING/PONG health check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2019 },
  { id: 'nntps' as const, name: 'NNTPS', description: 'NNTP over TLS (RFC 4642) - Encrypted Usenet newsgroup access with implicit TLS', port: 563, icon: '🔒', features: ['Implicit TLS from first byte', 'Newsgroup browsing & article retrieval', 'Capability & posting detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory , year: 1997 },
  { id: 'sentinel' as const, name: 'Redis Sentinel', description: 'Redis Sentinel (Port 26379) - High availability monitoring and automatic failover for Redis', port: 26379, icon: '🛡️', features: ['Master/replica topology discovery', 'Quorum health checking', 'Sentinel cluster monitoring'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2012 },
  { id: 'ldp-mpls' as const, name: 'LDP', description: 'RFC 5036 Label Distribution Protocol - MPLS label binding exchange between LSRs', port: 646, icon: '🏷️', features: ['Initialization handshake', 'Session parameter exchange', 'LSR-ID discovery'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'network' as ProtocolCategory , year: 2001 },
  { id: 'firebird' as const, name: 'Firebird SQL', description: 'Firebird Database Protocol - Open-source relational database with custom binary wire protocol', port: 3050, icon: '🔥', features: ['op_connect handshake', 'Protocol version detection', 'Architecture & server info'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2000 },
  { id: 'hazelcast' as const, name: 'Hazelcast', description: 'Hazelcast IMDG - Binary client protocol for distributed caching and in-memory data grid', port: 5701, icon: '⚡', features: ['Authentication & cluster probe', 'Version & member count detection', 'Cluster name discovery'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2008 },
  { id: 'ignite' as const, name: 'Apache Ignite', description: 'Apache Ignite Thin Client - Distributed in-memory computing platform with version-negotiated handshake', port: 10800, icon: '🔥', features: ['Thin client handshake (v1.7)', 'Protocol version probing (5 versions)', 'Node UUID & feature detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory , year: 2014 },
  { id: 'rabbitmq' as const, name: 'RabbitMQ Management', description: 'RabbitMQ Management HTTP API - Message broker health monitoring and queue management', port: 15672, icon: '🐰', features: ['Health check & overview', 'Queue, exchange, channel stats', 'Node metrics & management'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2007 },
  { id: 'cvs' as const, name: 'CVS pserver', description: 'CVS Password Server - Legacy version control with text-based repository access', port: 2401, icon: '📦', features: ['Repository connection probe', 'Password authentication (scrambled)', '"I LOVE YOU/I HATE YOU" responses'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory , year: 1990 },
  { id: 'amqps' as const, name: 'AMQPS', description: 'AMQP 0-9-1 over TLS - Secure message broker connectivity for RabbitMQ and others', port: 5671, icon: '🔒', features: ['Implicit TLS encryption', 'Broker properties & version', 'Authentication mechanisms'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'messaging' as ProtocolCategory , year: 2008 },
  { id: 'beats' as const, name: 'Beats', description: 'Elastic Beats / Lumberjack v2 — binary log shipping protocol for Filebeat and Metricbeat to Logstash', port: 5044, icon: '📊', features: ['Lumberjack v2 WINDOW/DATA/ACK frames', 'Compressed JSON event batches', 'Acknowledgment tracking'], status: 'active' as ProtocolStatus, popularity: 'common' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2014 },
  { id: 'coap' as const, name: 'CoAP', description: 'Constrained Application Protocol (RFC 7252/8323) — lightweight RESTful protocol for IoT devices', port: 5683, icon: '📡', features: ['GET/POST/PUT/DELETE methods', 'Resource discovery (/.well-known/core)', 'TCP variant (RFC 8323)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2014 },
  { id: 'msrp' as const, name: 'MSRP', description: 'Message Session Relay Protocol (RFC 4975) — SIP-based instant messaging and file transfer', port: 2855, icon: '💬', features: ['SEND request with chunking', 'Transaction ID matching', 'MIME content type support'], status: 'active' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 2007 },
  { id: 'radsec' as const, name: 'RadSec', description: 'RADIUS over TLS (RFC 6614) — secure AAA for WPA2-Enterprise, eduroam, and 802.1X', port: 2083, icon: '🔐', features: ['RADIUS over TLS (no shared secret)', 'Access-Accept/Reject detection', 'eduroam / 802.1X use cases'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2012 },
  { id: 'sips' as const, name: 'SIPS', description: 'SIP over TLS (RFC 3261) — encrypted VoIP signaling on port 5061', port: 5061, icon: '📞', features: ['OPTIONS capability probe', 'REGISTER auth probe (401 detection)', 'Server & Allow header parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2002 },
  { id: 'gadugadu' as const, name: 'Gadu-Gadu', description: 'Gadu-Gadu (GG) — Polish instant messenger with proprietary binary protocol and UIN-based auth', port: 8074, icon: '💬', features: ['GG_WELCOME seed handshake', 'GG32 and SHA-1 password hashing', 'Login status detection'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 2000 },
  { id: 'napster' as const, name: 'Napster', description: 'Napster/OpenNap — pioneering P2P file sharing protocol (historical/educational)', port: 6699, icon: '🎵', features: ['TCP connectivity test', 'LOGIN command & MOTD', 'Server stats (users, files, GB)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'files' as ProtocolCategory, year: 1999 },
  { id: 'ventrilo' as const, name: 'Ventrilo', description: 'Ventrilo — proprietary gaming VoIP with binary status protocol', port: 3784, icon: '🎮', features: ['Server name & version detection', 'User & channel count', 'Uptime reporting'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2002 },
  { id: 'oscar' as const, name: 'OSCAR (AIM/ICQ)', description: 'OSCAR — AOL Instant Messenger / ICQ binary protocol using FLAP frames and SNAC messages', port: 5190, icon: '💬', features: ['FLAP frame detection', 'Channel & sequence probe', 'Login server handshake'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 1997 },
  { id: 'ymsg' as const, name: 'Yahoo Messenger', description: 'YMSG — Yahoo Messenger proprietary binary protocol (versions 9–16)', port: 5050, icon: '💛', features: ['20-byte header detection', 'Service & session ID probe', 'Version negotiation (YMSG9–16)'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 1998 },
  { id: 'msn' as const, name: 'MSN Messenger', description: 'MSNP — Microsoft Notification Protocol for MSN/Windows Live Messenger', port: 1863, icon: '🦋', features: ['VER version negotiation', 'CVR client info exchange', 'Protocol version detection'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 1999 },
  { id: 'jabber-component' as const, name: 'Jabber Component', description: 'XEP-0114 Jabber Component Protocol — connect external components (bots, gateways) to XMPP servers', port: 5275, icon: '🔌', features: ['XML stream opening', 'SHA-1 handshake authentication', 'Server domain detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 2005 },
  { id: 'xmpp-s2s' as const, name: 'XMPP S2S', description: 'XMPP Server-to-Server federation (RFC 6120) — inter-domain message routing between XMPP servers', port: 5269, icon: '🌐', features: ['S2S stream opening', 'STARTTLS & Dialback detection', 'Server domain & feature discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory, year: 2004 },
  { id: 'informix' as const, name: 'IBM Informix', description: 'IBM Informix Dynamic Server — relational database with proprietary binary wire protocol', port: 1526, icon: '🗄️', features: ['Binary protocol probe', 'Server version detection', 'Connectivity testing'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'databases' as ProtocolCategory, year: 1985 },
  { id: 'sybase' as const, name: 'Sybase ASE', description: 'Sybase Adaptive Server Enterprise — TDS-based relational database', port: 5000, icon: '🗄️', features: ['TDS Prelogin packet probe', 'Packet type detection', 'Server presence detection'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'databases' as ProtocolCategory, year: 1987 },
  { id: 'maxdb' as const, name: 'SAP MaxDB', description: 'SAP MaxDB (formerly SAP DB) - Enterprise relational database used with SAP applications', port: 7200, icon: '🗄️', features: ['Connection probe', 'Server version detection', 'Authentication check'], status: 'active' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'databases' as ProtocolCategory, year: 1998 },
  { id: 'shoutcast' as const, name: 'SHOUTcast', description: 'SHOUTcast — Nullsoft internet radio streaming with ICY protocol extensions', port: 8000, icon: '📻', features: ['ICY header detection', 'Station name & genre', 'Bitrate & metadata interval'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 1998 },
  { id: 'realaudio' as const, name: 'RealAudio/RTSP', description: 'RealNetworks RealAudio/RealVideo — RTSP-based streaming with RealMedia extensions on port 7070', port: 7070, icon: '🎬', features: ['RTSP OPTIONS probe', 'DESCRIBE stream metadata', 'Server version detection'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 1995 },
  { id: 'mms' as const, name: 'MMS', description: 'Microsoft Media Services — proprietary Windows Media streaming protocol', port: 1755, icon: '🎬', features: ['Binary command probe', 'Server version detection', 'Command code identification'], status: 'deprecated' as ProtocolStatus, popularity: 'rare' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 1996 },
  { id: 'mumble' as const, name: 'Mumble', description: 'Mumble — open-source low-latency VoIP using Protocol Buffers over TCP/UDP', port: 64738, icon: '🎙️', features: ['Protobuf version handshake', 'Server version & release', 'OS detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory, year: 2005 },
  { id: 'ike' as const, name: 'IKE/ISAKMP', description: 'IKE/ISAKMP — IPsec VPN key exchange protocol (RFC 2408/7296)', port: 500, icon: '🔐', features: ['IKEv1/v2 SA probe', 'Exchange type detection', 'Vendor ID enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 1998 },
  { id: 'l2tp' as const, name: 'L2TP', description: 'Layer 2 Tunneling Protocol (RFC 2661) — PPP tunneling for VPNs, commonly paired with IPsec', port: 1701, icon: '🔒', features: ['SCCRQ tunnel initiation', 'Peer hostname & vendor detection', 'Protocol version discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 1999 },
  { id: 'turn' as const, name: 'TURN', description: 'TURN Relay (RFC 8656) — NAT traversal relay for WebRTC and VoIP, extends STUN', port: 3478, icon: '🔄', features: ['Allocate request probe', 'Relay address discovery', 'Realm & auth detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory, year: 2010 },
];

type SortOption = 'popularity' | 'year-asc' | 'year-desc' | 'port-asc' | 'port-desc';

export default function ProtocolSelector({ onSelect }: ProtocolSelectorProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';
  const [activeTab, setActiveTab] = useState<'protocols' | 'about' | 'rfcs' | 'checklist'>('protocols');
  const [selectedCategory, setSelectedCategory] = useState<'all' | ProtocolCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'deprecated'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [rfcSortBy, setRfcSortBy] = useState<'rfc' | 'year' | null>(null);
  const [rfcSortDirection, setRfcSortDirection] = useState<'asc' | 'desc'>('asc');

  const filteredProtocols = protocols
    .filter(p => selectedCategory === 'all' || p.category === selectedCategory)
    .filter(p => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return p.status !== 'deprecated';
      return p.status === 'deprecated';
    });

  const sortedProtocols = [...filteredProtocols].sort((a, b) => {
    switch (sortBy) {
      case 'year-asc':
        return a.year - b.year;
      case 'year-desc':
        return b.year - a.year;
      case 'port-asc':
        return a.port - b.port;
      case 'port-desc':
        return b.port - a.port;
      case 'popularity':
      default: {
        // Sort by status first (active before deprecated), then by popularity, then by year
        const keyDiff = sortKey(a) - sortKey(b);
        if (keyDiff !== 0) return keyDiff;
        // Within deprecated: sort by year so year-range bands stay contiguous
        if (a.status === 'deprecated' && b.status === 'deprecated') return a.year - b.year;
        return 0;
      }
    }
  });
  const activeCount = protocols.filter(p => p.status !== 'deprecated').length;
  const deprecatedCount = protocols.filter(p => p.status === 'deprecated').length;
  const totalCount = protocols.length;

  const categoryKeys = Object.keys(categoryConfig) as ('all' | ProtocolCategory)[];

  // Helper function to get 5-year range for a year
  const getYearRange = (year: number): string => {
    const rangeStart = Math.floor(year / 5) * 5;
    const rangeEnd = rangeStart + 4;
    return `${rangeStart}–${rangeEnd}`;
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className={`text-center mb-12 ${isRetro ? 'retro-box' : ''}`}>
        <h1 className={`text-5xl font-bold mb-4 ${isRetro ? 'retro-text retro-typewriter' : 'text-white'}`}>
          {isRetro ? '╔═══════════════════════╗' : ''}
          {isRetro && <br />}
          {isRetro ? '║ ' : ''}PORT OF CALL{isRetro ? ' ║' : ''}
          {isRetro && <br />}
          {isRetro ? '╚═══════════════════════╝' : ''}
        </h1>
        <div className="flex items-center justify-center gap-2 mb-2">
          <p className={`text-xl ${isRetro ? 'retro-text' : 'text-slate-300'}`}>
            {isRetro ? '> ' : ''}TCP PROTOCOL CLIENT TESTING INTERFACE
          </p>
          <a
            href="#about"
            className={`text-xl ${isRetro ? 'retro-link' : 'hover:scale-110 transition-transform'}`}
            title="About this tool"
            aria-label="About this tool"
          >
            ℹ️
          </a>
        </div>
        <p className={`text-2xl font-bold mt-3 ${isRetro ? 'retro-text retro-glow' : 'text-blue-400'}`}>
          {totalCount} Protocols Available
        </p>
        <p className={`text-sm mt-1 ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
          {isRetro ? '[ ' : ''}POWERED BY{' '}
          <a
            href="https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/"
            target="_blank"
            rel="noopener noreferrer"
            className={isRetro ? 'retro-link' : 'text-blue-400 hover:text-blue-300 underline transition-colors'}
          >
            CLOUDFLARE WORKERS SOCKETS API
          </a>
          {isRetro ? ' ]' : ''}
        </p>

        {/* Tab Navigation */}
        <div className="mt-8 flex justify-center gap-2">
          <button
            onClick={() => setActiveTab('protocols')}
            className={`px-6 py-3 font-semibold transition-all duration-200 ${
              isRetro
                ? `retro-button ${activeTab === 'protocols' ? 'retro-glow retro-text' : 'retro-text-amber'}`
                : `rounded-lg ${
                    activeTab === 'protocols'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`
            }`}
          >
            {isRetro ? (activeTab === 'protocols' ? '>> ' : '') : ''}
            Protocols
            {isRetro ? (activeTab === 'protocols' ? ' <<' : '') : ''}
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`px-6 py-3 font-semibold transition-all duration-200 ${
              isRetro
                ? `retro-button ${activeTab === 'about' ? 'retro-glow retro-text' : 'retro-text-amber'}`
                : `rounded-lg ${
                    activeTab === 'about'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`
            }`}
          >
            {isRetro ? (activeTab === 'about' ? '>> ' : '') : ''}
            About
            {isRetro ? (activeTab === 'about' ? ' <<' : '') : ''}
          </button>
          <button
            onClick={() => setActiveTab('rfcs')}
            className={`px-6 py-3 font-semibold transition-all duration-200 ${
              isRetro
                ? `retro-button ${activeTab === 'rfcs' ? 'retro-glow retro-text' : 'retro-text-amber'}`
                : `rounded-lg ${
                    activeTab === 'rfcs'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`
            }`}
          >
            {isRetro ? (activeTab === 'rfcs' ? '>> ' : '') : ''}
            RFCs
            {isRetro ? (activeTab === 'rfcs' ? ' <<' : '') : ''}
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`px-6 py-3 font-semibold transition-all duration-200 ${
              isRetro
                ? `retro-button ${activeTab === 'checklist' ? 'retro-glow retro-text' : 'retro-text-amber'}`
                : `rounded-lg ${
                    activeTab === 'checklist'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`
            }`}
          >
            {isRetro ? (activeTab === 'checklist' ? '>> ' : '') : ''}
            Checklist
            {isRetro ? (activeTab === 'checklist' ? ' <<' : '') : ''}
          </button>
        </div>
      </div>

      {/* Protocols Tab Content */}
      {activeTab === 'protocols' && (
        <>
          <div className="text-center mb-8">
            <div className="mt-6 inline-flex gap-3">
          <button
            onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
            className={`px-4 py-2 transition-all ${
              isRetro
                ? `retro-button ${statusFilter === 'active' ? 'retro-glow' : ''}`
                : `rounded-full ${
                    statusFilter === 'active'
                      ? 'bg-blue-600 ring-2 ring-blue-400 shadow-lg shadow-blue-600/50'
                      : 'bg-blue-600 hover:bg-blue-500'
                  }`
            }`}
            aria-pressed={statusFilter === 'active'}
          >
            <span className={`font-semibold text-sm ${isRetro ? 'retro-text' : 'text-white'}`}>
              {isRetro ? '>> ' : ''}{activeCount} Active{isRetro ? ' <<' : ''}
            </span>
          </button>
          <button
            onClick={() => setStatusFilter(statusFilter === 'deprecated' ? 'all' : 'deprecated')}
            className={`px-4 py-2 transition-all ${
              isRetro
                ? `retro-button ${statusFilter === 'deprecated' ? 'retro-glow' : ''}`
                : `rounded-full ${
                    statusFilter === 'deprecated'
                      ? 'bg-slate-600 ring-2 ring-slate-400 shadow-lg shadow-slate-600/50'
                      : 'bg-slate-600 hover:bg-slate-500'
                  }`
            }`}
            aria-pressed={statusFilter === 'deprecated'}
          >
            <span className={`font-semibold text-sm ${isRetro ? 'retro-text-amber' : 'text-slate-300'}`}>
              {isRetro ? '>> ' : ''}{deprecatedCount} Historical{isRetro ? ' <<' : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="mb-8 flex flex-wrap justify-center gap-2">
        {categoryKeys.map((key) => {
          const cfg = categoryConfig[key];
          const count = key === 'all' ? protocols.length : protocols.filter(p => p.category === key).length;
          const isActive = selectedCategory === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedCategory(key)}
              className={isRetro
                ? `retro-button px-3 py-1 text-xs ${isActive ? 'retro-text font-bold' : 'retro-text-amber'}`
                : `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'
                  }`
              }
              aria-pressed={isActive}
            >
              {isRetro
                ? `[${isActive ? '*' : ' '}] ${cfg.label} (${count})`
                : <><span aria-hidden="true">{cfg.icon}</span> {cfg.label} <span className="text-xs opacity-60">({count})</span></>
              }
            </button>
          );
        })}
      </div>

      {/* Sort By Filter */}
      <div className="mb-8 flex flex-wrap justify-center items-center gap-3">
        <span className={`text-sm font-medium ${isRetro ? 'retro-text' : 'text-slate-400'}`}>
          {isRetro ? '> ' : ''}Sort by:
        </span>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'popularity' as SortOption, label: 'Commonality', icon: '⭐' },
            { value: 'year-asc' as SortOption, label: 'Year (Oldest)', icon: '📅' },
            { value: 'year-desc' as SortOption, label: 'Year (Newest)', icon: '📆' },
            { value: 'port-asc' as SortOption, label: 'Port (Low-High)', icon: '🔢' },
            { value: 'port-desc' as SortOption, label: 'Port (High-Low)', icon: '🔣' },
          ].map(option => {
            const isActive = sortBy === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setSortBy(option.value)}
                className={isRetro
                  ? `retro-button px-3 py-1 text-xs ${isActive ? 'retro-text font-bold' : 'retro-text-amber'}`
                  : `px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'
                    }`
                }
                aria-pressed={isActive}
              >
                {isRetro
                  ? `[${isActive ? '*' : ' '}] ${option.label}`
                  : <><span aria-hidden="true">{option.icon}</span> {option.label}</>
                }
              </button>
            );
          })}
        </div>
      </div>

      <div className={isRetro ? 'retro-grid' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'}>
        {(() => {
          const shownYearRanges = new Set<string>();
          return sortedProtocols.map((protocol, index) => {
          const prevProtocol = index > 0 ? sortedProtocols[index - 1] : null;
          const isFirstDeprecated = protocol.status === 'deprecated' && prevProtocol?.status !== 'deprecated';
          const currentRange = getYearRange(protocol.year);
          const yearRangeChanged = protocol.status === 'deprecated' &&
            prevProtocol?.status === 'deprecated' &&
            currentRange !== getYearRange(prevProtocol.year);
          const shouldShowYearHeader = protocol.status === 'deprecated' &&
            (isFirstDeprecated || yearRangeChanged) &&
            !shownYearRanges.has(currentRange);
          if (shouldShowYearHeader) shownYearRanges.add(currentRange);

          return (
          <>
            {/* Main "Historical / Deprecated Protocols" header */}
            {isFirstDeprecated && (
              <div key="deprecated-divider" className={`${isRetro ? '' : 'col-span-full'} text-center py-4 ${isRetro ? '' : 'border-t border-slate-600 mt-2'}`}>
                <span className={`text-sm uppercase tracking-wider ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
                  {isRetro ? '--- ' : ''}Historical / Deprecated Protocols{isRetro ? ' ---' : ''}
                </span>
              </div>
            )}

            {/* Year range headers for deprecated protocols */}
            {shouldShowYearHeader && (
              <div key={`year-range-${currentRange}`} className={`${isRetro ? '' : 'col-span-full'} text-center py-2 ${isRetro ? '' : 'mt-4'}`}>
                <span className={`text-xs font-semibold ${isRetro ? 'retro-text' : 'text-slate-400'}`}>
                  {isRetro ? '[ ' : ''}📅 {currentRange}{isRetro ? ' ]' : ''}
                </span>
              </div>
            )}
            <button
              key={protocol.id}
              onClick={() => onSelect(protocol.id)}
              className={isRetro
                ? `retro-card retro-button text-left ${protocol.status === 'deprecated' ? 'opacity-50' : ''}`
                : `bg-slate-800 hover:bg-slate-700 ${
                    protocol.status === 'deprecated'
                      ? 'border border-dashed border-slate-500 opacity-60'
                      : 'border border-slate-600'
                  } rounded-xl p-6 text-left transition-all duration-200 hover:scale-105 hover:shadow-2xl group`
              }
              aria-label={`Connect to ${protocol.name} on port ${protocol.port}${
                protocol.status === 'deprecated' ? ' (deprecated)' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="text-5xl" aria-hidden="true">{protocol.icon}</div>
                <div className="flex items-center gap-2">
                  {protocol.status === 'deprecated' && (
                    <span className={isRetro
                      ? 'retro-text-amber text-xs'
                      : 'bg-red-900/50 text-red-400 border border-red-800 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold'
                    }>
                      {isRetro ? '[DEPRECATED]' : 'Deprecated'}
                    </span>
                  )}
                  {protocol.status === 'niche' && (
                    <span className={isRetro
                      ? 'retro-text-amber text-xs'
                      : 'bg-purple-900/50 text-purple-400 border border-purple-800 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold'
                    }>
                      {isRetro ? '[NICHE]' : 'Niche'}
                    </span>
                  )}
                  <div className="bg-slate-700 px-3 py-1 rounded-full text-xs text-slate-300">
                    Port {protocol.port}
                  </div>
                </div>
              </div>

              <h3 className={`text-xl font-bold text-white mb-2 transition-colors ${
                protocol.status === 'deprecated'
                  ? 'group-hover:text-red-400'
                  : 'group-hover:text-blue-400'
              }`}>
                {protocol.name}
              </h3>

              {isRetro ? (
                <div className="retro-text text-xs mb-2">
                  [{retroBarChars(protocol.popularity)}] {popularityConfig[protocol.popularity].label}
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-2" aria-hidden="true">
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${popularityConfig[protocol.popularity].barColor}`}
                      style={{ width: `${popularityConfig[protocol.popularity].width}%` }}
                    />
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider font-medium ${popularityConfig[protocol.popularity].textColor}`}>
                    {popularityConfig[protocol.popularity].label}
                  </span>
                </div>
              )}

              <p className="text-slate-300 text-sm mb-4">
                {protocol.description}
              </p>

              <div className="space-y-1 mb-4">
                {protocol.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center text-xs text-slate-400">
                    <span className="text-green-400 mr-2" aria-hidden="true">✓</span>
                    {feature}
                  </div>
                ))}
              </div>

              <div className={`flex items-center justify-between text-xs pt-3 border-t ${isRetro ? 'retro-border' : 'border-slate-700'}`}>
                <div className={`flex flex-col gap-1 ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
                  <span>📅 Created: {protocol.year}</span>
                </div>
                <a
                  href={`https://github.com/pocc/portofcall/blob/main/src/worker/${protocol.id === '9p' ? 'ninep' : protocol.id.replace(/-/g, '')}.ts`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${isRetro ? 'retro-text retro-link' : 'text-blue-400 hover:text-blue-300'} flex items-center gap-1 transition-colors`}
                  onClick={(e) => e.stopPropagation()}
                >
                  View Code
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </button>
          </>
          );
        });
        })()}
      </div>
        </>
      )}

      {/* About Tab Content */}
      {activeTab === 'about' && (
        <div className="max-w-4xl mx-auto mt-8">
          <div className={`${isRetro ? 'retro-box' : 'bg-slate-800 border border-slate-600 rounded-xl'} p-8`}>
            <h2 className={`text-3xl font-bold mb-6 ${isRetro ? 'retro-text retro-glow' : 'text-white'}`}>
              About This Tool
            </h2>
            <p className={`${isRetro ? 'retro-text' : 'text-slate-300'} text-base leading-relaxed mb-6`}>
              This interface demonstrates TCP protocol implementations using Cloudflare Workers'
              <code className={`${isRetro ? 'retro-text-amber' : 'bg-slate-700'} px-2 py-1 rounded mx-1`}>connect()</code> API.
              Select a protocol from the Protocols tab to establish connections and interact with remote servers.
            </p>
            <div className={`${isRetro ? 'retro-box' : 'bg-green-900/30 border border-green-600/50 rounded-lg'} p-6 mb-6`}>
              <div className="flex items-start gap-3">
                <span className={`${isRetro ? 'retro-text' : 'text-green-400'} text-2xl`} aria-hidden="true">✓</span>
                <div>
                  <p className={`${isRetro ? 'retro-text font-bold' : 'text-green-200'} text-lg font-semibold mb-2`}>
                    Live Implementation
                  </p>
                  <p className={`${isRetro ? 'retro-text' : 'text-green-100/80'} text-sm leading-relaxed`}>
                    All {totalCount} protocols are fully functional with comprehensive testing.
                    Connect to remote servers directly from your browser. All connections
                    are proxied through Cloudflare's global network with Smart Placement for low latency.
                  </p>
                </div>
              </div>
            </div>
            <div className={`${isRetro ? 'retro-box' : 'bg-blue-900/30 border border-blue-600/50 rounded-lg'} p-6`}>
              <div className="flex items-start gap-3">
                <span className={`${isRetro ? 'retro-text' : 'text-blue-400'} text-2xl`} aria-hidden="true">🌐</span>
                <div>
                  <p className={`${isRetro ? 'retro-text font-bold' : 'text-blue-200'} text-lg font-semibold mb-2`}>
                    Cloudflare Workers TCP Sockets
                  </p>
                  <p className={`${isRetro ? 'retro-text' : 'text-blue-100/80'} text-sm leading-relaxed`}>
                    Built on Cloudflare Workers' TCP Sockets API, enabling direct TCP connections from the edge.
                    Each protocol implementation demonstrates real-world use cases and provides interactive testing capabilities.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RFCs Tab Content */}
      {activeTab === 'rfcs' && (() => {
        // Combine implemented protocols with non-implementable RFCs
        // Only include protocols that have an RFC number
        const allRFCEntries: Array<RFCEntry & { implemented?: boolean; protocolId?: string }> = [
          ...protocols
            .map(p => {
              const rfcMatch = p.description.match(/RFC\s*(\d+)/i);
              return {
                name: p.name,
                icon: p.icon,
                rfc: rfcMatch ? rfcMatch[1] : null,
                year: p.year,
                description: p.description.replace(/\s*\(RFC.*?\)\s*-?\s*/i, ' - '),
                workersCompatible: true,
                layer: 'Application' as const,
                implemented: true, // All protocols in the array are implemented, regardless of active/deprecated status
                protocolId: p.id, // Store the protocol ID for navigation
              };
            })
            .filter(entry => entry.rfc !== null), // Only include protocols with RFC numbers
          ...nonImplementableRFCs
            .filter(r => r.rfc !== null) // Only include non-implementable protocols with RFC numbers
            .map(r => ({ ...r, implemented: false })),
        ];

        // Sort RFC entries
        const sortedRFCEntries = [...allRFCEntries].sort((a, b) => {
          if (rfcSortBy === 'rfc') {
            const aNum = a.rfc ? parseInt(a.rfc) : 99999;
            const bNum = b.rfc ? parseInt(b.rfc) : 99999;
            return rfcSortDirection === 'asc' ? aNum - bNum : bNum - aNum;
          } else if (rfcSortBy === 'year') {
            return rfcSortDirection === 'asc' ? a.year - b.year : b.year - a.year;
          }
          // Default sort: Workers compatible first, then by name
          if (a.workersCompatible !== b.workersCompatible) {
            return a.workersCompatible ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const handleRFCSort = (column: 'rfc' | 'year') => {
          if (rfcSortBy === column) {
            setRfcSortDirection(rfcSortDirection === 'asc' ? 'desc' : 'asc');
          } else {
            setRfcSortBy(column);
            setRfcSortDirection('asc');
          }
        };

        const SortIndicator = ({ column }: { column: 'rfc' | 'year' }) => {
          if (rfcSortBy !== column) return <span className="opacity-30 ml-1">▼</span>;
          return <span className="ml-1">{rfcSortDirection === 'asc' ? '▲' : '▼'}</span>;
        };

        return (
          <div className="max-w-7xl mx-auto mt-8">
            <div className={`${isRetro ? 'retro-box' : 'bg-slate-800 border border-slate-600 rounded-xl'} p-6`}>
              <h2 className={`text-3xl font-bold mb-6 ${isRetro ? 'retro-text retro-glow' : 'text-white'}`}>
                Comprehensive Protocol RFC List
              </h2>
              <p className={`${isRetro ? 'retro-text' : 'text-slate-300'} text-sm mb-6`}>
                All protocol RFCs including Layer 2, 3, and 4 protocols. Shows implementation status on Cloudflare Workers TCP Sockets API.
                Click RFC or Year column headers to sort.
              </p>
              <div className="overflow-x-auto">
                <table className={`w-full ${isRetro ? 'retro-text' : 'text-sm'}`}>
                  <thead>
                    <tr className={isRetro ? 'retro-border' : 'border-b-2 border-slate-600'}>
                      <th className={`text-left py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'}`}>Protocol</th>
                      <th
                        className={`text-left py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'} cursor-pointer hover:text-blue-400`}
                        onClick={() => handleRFCSort('rfc')}
                      >
                        RFC <SortIndicator column="rfc" />
                      </th>
                      <th
                        className={`text-center py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'} cursor-pointer hover:text-blue-400`}
                        onClick={() => handleRFCSort('year')}
                      >
                        Year Created <SortIndicator column="year" />
                      </th>
                      <th className={`text-center py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'}`}>Layer</th>
                      <th className={`text-left py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'}`}>Description</th>
                      <th className={`text-center py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'}`}>Workers Compatible</th>
                      <th className={`text-center py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300 font-semibold'}`}>Implemented</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRFCEntries.map((entry, idx) => (
                      <tr
                        key={`${entry.name}-${entry.rfc}`}
                        className={`${isRetro ? 'retro-border' : 'border-b border-slate-700'} ${idx % 2 === 0 ? (isRetro ? '' : 'bg-slate-800/50') : ''}`}
                      >
                        <td className={`py-3 px-4 ${isRetro ? 'retro-text' : 'text-white font-medium'}`}>
                          {entry.implemented && entry.protocolId ? (
                            <button
                              onClick={() => onSelect(entry.protocolId as any)}
                              className={`flex items-center gap-2 ${isRetro ? 'retro-link' : 'hover:text-blue-400 transition-colors'} text-left`}
                            >
                              <span className="text-xl" aria-hidden="true">{entry.icon}</span>
                              <span className="whitespace-nowrap">{entry.name}</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xl" aria-hidden="true">{entry.icon}</span>
                              <span className="whitespace-nowrap">{entry.name}</span>
                            </div>
                          )}
                        </td>
                        <td className={`py-3 px-4 ${isRetro ? 'retro-text-amber' : 'text-blue-400'}`}>
                          {entry.rfc ? (
                            <a
                              href={`https://www.rfc-editor.org/rfc/rfc${entry.rfc}.html`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={isRetro ? 'retro-link' : 'hover:underline'}
                            >
                              RFC {entry.rfc}
                            </a>
                          ) : (
                            <span className={isRetro ? 'retro-text' : 'text-slate-500'}>N/A</span>
                          )}
                        </td>
                        <td className={`py-3 px-4 text-center ${isRetro ? 'retro-text' : 'text-slate-300'}`}>
                          {entry.year}
                        </td>
                        <td className={`py-3 px-4 text-center ${isRetro ? 'retro-text' : 'text-slate-400'}`}>
                          <span className={`px-2 py-1 rounded text-xs ${
                            entry.layer === 'L2' ? (isRetro ? '' : 'bg-red-900/30 text-red-300') :
                            entry.layer === 'L3' ? (isRetro ? '' : 'bg-orange-900/30 text-orange-300') :
                            entry.layer === 'L4/L7' ? (isRetro ? '' : 'bg-yellow-900/30 text-yellow-300') :
                            (isRetro ? '' : 'bg-green-900/30 text-green-300')
                          }`}>
                            {entry.layer}
                          </span>
                        </td>
                        <td className={`py-3 px-4 ${isRetro ? 'retro-text' : 'text-slate-300'} text-xs`}>
                          {entry.description}
                          {entry.reason && (
                            <div className={`mt-1 ${isRetro ? 'retro-text-amber' : 'text-slate-500 italic'}`}>
                              {entry.reason}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {entry.workersCompatible ? (
                            <span className={`inline-flex items-center ${isRetro ? 'retro-text' : 'text-green-400'}`}>
                              ✓ Yes
                            </span>
                          ) : (
                            <span className={`inline-flex items-center ${isRetro ? 'retro-text-amber' : 'text-red-400'}`}>
                              ✗ No
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {entry.implemented ? (
                            <span className={`inline-flex items-center ${isRetro ? 'retro-text' : 'text-green-400'}`}>
                              ✓ Yes
                            </span>
                          ) : (
                            <span className={`inline-flex items-center ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
                              ✗ No
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={`mt-6 ${isRetro ? 'retro-box' : 'bg-slate-700/50 rounded-lg'} p-4`}>
                <p className={`text-xs ${isRetro ? 'retro-text' : 'text-slate-400'} mb-2`}>
                  <strong className={isRetro ? 'retro-text' : 'text-slate-300'}>Legend:</strong>
                </p>
                <ul className={`text-xs ${isRetro ? 'retro-text' : 'text-slate-400'} space-y-1 ml-4`}>
                  <li>• <strong>Workers Compatible:</strong> Whether the protocol can be implemented using Cloudflare Workers TCP Sockets API</li>
                  <li>• <strong>Implemented:</strong> Whether this protocol has been implemented in this application (includes both active and deprecated protocols)</li>
                  <li>• <strong>Layer:</strong> OSI model layer - L2 (Data Link), L3 (Network), L4/L7 (Transport/Application), Application (TCP-based)</li>
                  <li>• Workers only supports TCP connections via connect() API - UDP and raw Layer 2/3 protocols cannot be implemented</li>
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Checklist Tab Content */}
      {activeTab === 'checklist' && <ChecklistTab />}
    </div>
  );
}
