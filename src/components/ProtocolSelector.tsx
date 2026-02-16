import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type ProtocolStatus = 'active' | 'deprecated' | 'niche';
type PopularityTier = 'critical' | 'high' | 'moderate' | 'minimal';
type ProtocolCategory = 'databases' | 'messaging' | 'email' | 'remote' | 'files' | 'web' | 'network' | 'specialty';

interface ProtocolSelectorProps {
  onSelect: (protocol: 'echo' | 'whois' | 'syslog' | 'socks4' | 'daytime' | 'finger' | 'time' | 'chargen' | 'gemini' | 'ftp' | 'ssh' | 'telnet' | 'smtp' | 'submission' | 'pop3' | 'imap' | 'mysql' | 'postgres' | 'redis' | 'mqtt' | 'ldap' | 'smb' | 'irc' | 'ircs' | 'gopher' | 'memcached' | 'dns' | 'stomp' | 'socks5' | 'modbus' | 'mongodb' | 'graphite' | 'git' | 'zookeeper' | 'amqp' | 'cassandra' | 'kafka' | 'rtsp' | 'rsync' | 'tds' | 'vnc' | 'spice' | 'neo4j' | 'rtmp' | 'tacacs' | 'hl7' | 'elasticsearch' | 'ajp' | 'rcon' | 'nntp' | 'rdp' | 'xmpp' | 'nats' | 'jetdirect' | 'fastcgi' | 'diameter' | 'etcd' | 'consul' | 'influxdb' | 'bgp' | 'docker' | 'pptp' | 'dicom' | 'jsonrpc' | '9p' | 'thrift' | 'slp' | 'bittorrent' | 'x11' | 'kerberos' | 'sccp' | 'matrix' | 'iscsi' | 'websocket' | 'h323' | 'dot' | 'soap' | 'openvpn' | 'dict' | 'sip' | 'qotd' | 'lpd' | 'discard' | 'minecraft' | 'zabbix' | 'ident' | 'oracle-tns' | 'mpd' | 'beanstalkd' | 'clamav' | 'lmtp' | 'managesieve' | 'couchdb' | 'ipp' | 'svn' | 'smpp' | 'teamspeak' | 'radius' | 'nrpe' | 'rlogin' | 's7comm' | 'snpp' | 'rethinkdb' | 'clickhouse' | 'gearman' | 'ethernetip' | 'prometheus' | 'portmapper' | 'relp' | 'adb' | 'dnp3' | 'fluentd' | 'stun' | 'rexec' | 'fix' | 'aerospike' | 'epmd' | 'tarantool' | 'vault' | 'solr' | 'iec104' | 'riak' | 'opentsdb' | 'bitcoin' | 'spamd' | 'nsq' | 'opcua' | 'zmtp' | 'munin' | 'sane' | 'ceph' | 'httpproxy' | 'varnish' | 'fins' | 'couchbase' | 'ami' | 'jdwp' | 'drda' | 'livestatus' | 'dcerpc' | 'nsca' | 'imaps' | 'loki' | 'openflow' | 'pjlink' | 'icecast' | 'meilisearch' | 'haproxy' | 'rmi' | 'nbd' | 'ganglia' | 'netbios' | 'pop3s' | 'smtps' | 'pcep' | 'winrm' | 'uwsgi' | 'torcontrol' | 'gpsd' | 'ldaps' | 'kibana' | 'grafana' | 'rserve' | 'sonic' | 'sentinel' | 'nntps' | 'rabbitmq' | 'cvs' | 'amqps' | 'nomad' | 'ldp-mpls' | 'firebird' | 'hazelcast' | 'ignite') => void;
}

const popularityConfig: Record<PopularityTier, { width: number; barColor: string; textColor: string; label: string }> = {
  critical: { width: 100, barColor: 'bg-green-500', textColor: 'text-green-400', label: 'Critical' },
  high:     { width: 70,  barColor: 'bg-blue-500',  textColor: 'text-blue-400',  label: 'High' },
  moderate: { width: 40,  barColor: 'bg-yellow-500', textColor: 'text-yellow-500', label: 'Moderate' },
  minimal:  { width: 10,  barColor: 'bg-slate-500', textColor: 'text-slate-500', label: 'Minimal' },
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
  const fills: Record<PopularityTier, number> = { critical: 10, high: 7, moderate: 4, minimal: 1 };
  const filled = fills[tier];
  return '#'.repeat(filled) + '.'.repeat(10 - filled);
};

const sortKey = (p: { status: ProtocolStatus; popularity: PopularityTier }): number => {
  if (p.status === 'deprecated') return 100;
  if (p.status === 'niche') return 50;
  const popOrder: Record<PopularityTier, number> = { critical: 0, high: 10, moderate: 20, minimal: 30 };
  return popOrder[p.popularity];
};

const protocols = [
  { id: 'echo' as const, name: 'ECHO', description: 'ECHO Protocol (RFC 862) - The simplest TCP test protocol', port: 7, icon: '🔊', features: ['Network testing', 'Latency measurement', 'Connectivity verification'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'whois' as const, name: 'WHOIS', description: 'WHOIS Protocol (RFC 3912) - Domain registration information lookup', port: 43, icon: '🔍', features: ['Domain registration info', 'Auto-detect WHOIS server', 'IP/ASN lookup'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'syslog' as const, name: 'Syslog', description: 'Syslog Protocol (RFC 5424/3164) - Centralized logging and event forwarding', port: 514, icon: '📝', features: ['8 severity levels', 'RFC 5424 & 3164 formats', 'SIEM integration'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'socks4' as const, name: 'SOCKS4', description: 'SOCKS4 Protocol - TCP connection proxying through firewalls', port: 1080, icon: '🔀', features: ['Proxy testing', 'SOCKS4a hostname support', 'SSH tunneling'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'daytime' as const, name: 'Daytime', description: 'Daytime Protocol (RFC 867) - Human-readable time from remote servers', port: 13, icon: '🕐', features: ['Simplest time protocol', 'Educational', 'Clock synchronization check'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'finger' as const, name: 'Finger', description: 'Finger Protocol (RFC 1288) - Legacy user information lookup', port: 79, icon: '👤', features: ['User information', 'Educational', 'Internet archaeology'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'time' as const, name: 'TIME', description: 'TIME Protocol (RFC 868) - Binary time synchronization since 1900', port: 37, icon: '⏰', features: ['32-bit binary time', 'Clock synchronization', 'Y2K36 problem demonstration'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'chargen' as const, name: 'CHARGEN', description: 'CHARGEN Protocol (RFC 864) - Continuous ASCII character stream', port: 19, icon: '🔤', features: ['Bandwidth testing', '72-char rotating pattern', 'Network testing'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'gemini' as const, name: 'Gemini', description: 'Gemini Protocol - Modern privacy-focused alternative to HTTP/HTML', port: 1965, icon: '💎', features: ['TLS mandatory', 'Simple Gemtext markup', 'No tracking/cookies'], status: 'niche' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'ftp' as const, name: 'FTP (Passive Mode)', description: 'File Transfer Protocol - Transfer files to/from FTP servers', port: 21, icon: '📁', features: ['Directory listing', 'File upload/download', 'Passive mode support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'ssh' as const, name: 'SSH', description: 'Secure Shell - Execute commands on remote servers', port: 22, icon: '🔐', features: ['Private key authentication', 'Password authentication', 'Encrypted connection'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'telnet' as const, name: 'Telnet', description: 'Telnet Protocol - Unencrypted text-based terminal protocol', port: 23, icon: '📟', features: ['Interactive terminal', 'Command execution', 'WebSocket tunnel'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'smtp' as const, name: 'SMTP', description: 'Simple Mail Transfer Protocol - Send emails via SMTP servers', port: 587, icon: '📧', features: ['Email sending', 'AUTH LOGIN support', 'Multiple ports (25/587/465)'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'submission' as const, name: 'Submission', description: 'Message Submission Protocol (RFC 6409) - Authenticated mail submission on port 587 with STARTTLS', port: 587, icon: '📮', features: ['STARTTLS support', 'Authenticated submission', 'AUTH before MAIL FROM', 'RFC 6409 compliance'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'pop3' as const, name: 'POP3', description: 'Post Office Protocol v3 - Retrieve emails from mail servers', port: 110, icon: '📬', features: ['Email retrieval', 'Message listing', 'Mailbox management'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'imap' as const, name: 'IMAP', description: 'Internet Message Access Protocol - Advanced email management', port: 143, icon: '📮', features: ['Multiple folders', 'Server-side organization', 'Message flags'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'mysql' as const, name: 'MySQL', description: 'MySQL Database - Connectivity testing for MySQL servers', port: 3306, icon: '🗄️', features: ['Server handshake', 'Version detection', 'Connection testing'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'postgres' as const, name: 'PostgreSQL', description: 'PostgreSQL Database - Connectivity testing for PostgreSQL servers', port: 5432, icon: '🐘', features: ['Startup message', 'Authentication check', 'Connection testing'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'redis' as const, name: 'Redis', description: 'Redis In-Memory Store - Key-value store and cache server', port: 6379, icon: '⚡', features: ['RESP protocol', 'Command execution', 'AUTH & database selection'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'mqtt' as const, name: 'MQTT', description: 'MQTT Protocol - Lightweight IoT messaging protocol', port: 1883, icon: '📡', features: ['Publish/subscribe', 'MQTT 3.1.1', 'Username/password auth'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'ldap' as const, name: 'LDAP', description: 'LDAP Protocol - Directory services and authentication', port: 389, icon: '📂', features: ['BIND operation', 'Anonymous/authenticated bind', 'ASN.1/BER encoding'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'ldaps' as const, name: 'LDAPS', description: 'LDAP over TLS - Secure directory services with implicit TLS', port: 636, icon: '🔒', features: ['Implicit TLS encryption', 'Secure bind (anonymous/authenticated)', 'Base DN search over TLS'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'smb' as const, name: 'SMB', description: 'SMB Protocol - Windows file sharing and network communication', port: 445, icon: '💾', features: ['SMB2/SMB3 negotiation', 'Protocol dialect detection', 'Connectivity testing'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'irc' as const, name: 'IRC', description: 'IRC Protocol (RFC 2812) - Real-time internet relay chat', port: 6667, icon: '💬', features: ['Channel chat', 'Private messaging', 'Interactive WebSocket session'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'ircs' as const, name: 'IRCS', description: 'IRC over TLS (RFC 7194) - Encrypted real-time internet relay chat with implicit TLS on port 6697', port: 6697, icon: '🔐', features: ['Implicit TLS encryption', 'Channel chat', 'Private messaging', 'Interactive WebSocket session'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'gopher' as const, name: 'Gopher', description: 'Gopher Protocol (RFC 1436) - Pre-Web hypertext browsing from 1991', port: 70, icon: '🐿️', features: ['Menu browsing', 'Search servers', 'Internet archaeology'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'memcached' as const, name: 'Memcached', description: 'Memcached Protocol - Distributed memory caching system', port: 11211, icon: '🧊', features: ['Cache inspection', 'Key-value operations', 'Stats monitoring'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'dns' as const, name: 'DNS', description: 'DNS over TCP (RFC 1035) - Domain name resolution and debugging', port: 53, icon: '🌐', features: ['A/AAAA/MX/NS/TXT records', 'Multiple DNS servers', 'Raw response parsing'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'stomp' as const, name: 'STOMP', description: 'STOMP Protocol (v1.2) - Simple text messaging for brokers', port: 61613, icon: '📨', features: ['Queue & topic messaging', 'RabbitMQ/ActiveMQ support', 'Text-based framing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'socks5' as const, name: 'SOCKS5', description: 'SOCKS5 Protocol (RFC 1928) - Authenticated TCP proxy with IPv6 support', port: 1080, icon: '🛡️', features: ['Username/password auth', 'Domain name resolution', 'IPv6 & IPv4 support'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'modbus' as const, name: 'Modbus TCP', description: 'Modbus TCP Protocol - Industrial automation and SCADA monitoring', port: 502, icon: '🏭', features: ['Read registers & coils', 'PLC/sensor monitoring', 'Read-only safety mode'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'mongodb' as const, name: 'MongoDB', description: 'MongoDB Wire Protocol - NoSQL document database connectivity testing', port: 27017, icon: '🍃', features: ['BSON wire protocol', 'Server version detection', 'Wire version & status check'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'graphite' as const, name: 'Graphite', description: 'Graphite Plaintext Protocol - Time-series metrics collection and monitoring', port: 2003, icon: '📊', features: ['Metric batch sending', 'Dot-separated naming', 'Fire-and-forget protocol'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'git' as const, name: 'Git Protocol', description: 'Git Protocol (git://) - Read-only repository browsing via native protocol', port: 9418, icon: '🔀', features: ['Branch & tag listing', 'Pkt-line format', 'Server capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'zookeeper' as const, name: 'ZooKeeper', description: 'Apache ZooKeeper - Distributed coordination service health checking', port: 2181, icon: '🐘', features: ['Four-letter word commands', 'Health check (ruok/imok)', 'Server stats & monitoring'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'amqp' as const, name: 'AMQP', description: 'AMQP 0-9-1 Protocol - Message broker connectivity (RabbitMQ)', port: 5672, icon: '🐇', features: ['Broker detection', 'Version & platform info', 'Auth mechanism discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'cassandra' as const, name: 'Cassandra', description: 'Apache Cassandra CQL Protocol - Wide-column NoSQL database connectivity', port: 9042, icon: '👁️', features: ['CQL Binary Protocol v4', 'Version & compression detection', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'kafka' as const, name: 'Kafka', description: 'Apache Kafka Protocol - Distributed event streaming and message broker', port: 9092, icon: '📊', features: ['API version discovery', 'Cluster metadata', 'Topic & partition inspection'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'rtsp' as const, name: 'RTSP', description: 'RTSP Protocol (RFC 2326) - Streaming media server control and IP cameras', port: 554, icon: '🎥', features: ['OPTIONS capability discovery', 'SDP stream description', 'IP camera & surveillance'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'rsync' as const, name: 'Rsync', description: 'Rsync Daemon Protocol - File synchronization and module discovery', port: 873, icon: '🔄', features: ['Version detection', 'Module listing', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'tds' as const, name: 'TDS / SQL Server', description: 'TDS Protocol (MS-TDS) - Microsoft SQL Server connectivity testing', port: 1433, icon: '🗃️', features: ['Pre-Login handshake', 'Version & encryption detection', 'MARS capability check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'vnc' as const, name: 'VNC', description: 'VNC / RFB Protocol (RFC 6143) - Remote desktop server discovery and testing', port: 5900, icon: '🖥️', features: ['RFB version detection', 'Security type enumeration', 'Auth requirement check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'spice' as const, name: 'SPICE', description: 'Simple Protocol for Independent Computing Environments - Red Hat VDI protocol for KVM/QEMU', port: 5900, icon: '🖥️', features: ['Protocol version detection', 'Capability enumeration', 'Channel discovery'], status: 'active' as ProtocolStatus, popularity: 'niche' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'neo4j' as const, name: 'Neo4j', description: 'Neo4j Bolt Protocol - Graph database connectivity and version detection', port: 7687, icon: '🔗', features: ['Bolt handshake', 'Protocol version detection', 'PackStream encoding'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'rtmp' as const, name: 'RTMP', description: 'RTMP Protocol - Live video streaming server connectivity testing', port: 1935, icon: '📺', features: ['Handshake validation', 'Version detection', 'Twitch/YouTube/NGINX-RTMP'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'tacacs' as const, name: 'TACACS+', description: 'TACACS+ Protocol (RFC 8907) - Network device AAA for Cisco environments', port: 49, icon: '🔐', features: ['Server probe & detection', 'Authentication flow testing', 'MD5 encryption support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'hl7' as const, name: 'HL7 v2.x', description: 'HL7 v2.x Protocol - Healthcare data exchange via MLLP framing', port: 2575, icon: '🏥', features: ['MLLP connectivity testing', 'ADT & ORU message types', 'ACK response parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'elasticsearch' as const, name: 'Elasticsearch', description: 'Elasticsearch REST API - Distributed search and analytics engine over TCP', port: 9200, icon: '🔎', features: ['Cluster health & info', 'Query DSL search', 'Raw HTTP over TCP sockets'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'ajp' as const, name: 'AJP', description: 'Apache JServ Protocol (AJP/1.3) - Binary proxy for Tomcat/Jetty connectivity', port: 8009, icon: '🐱', features: ['CPing/CPong health check', 'Binary protocol detection', 'Tomcat/Jetty connector test'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'rcon' as const, name: 'Minecraft RCON', description: 'Source RCON Protocol - Minecraft/Source engine server remote administration', port: 25575, icon: '🎮', features: ['Server command execution', 'Password authentication', 'Player & world management'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'rdp' as const, name: 'RDP', description: 'Remote Desktop Protocol (MS-RDPBCGR) - Windows remote desktop connectivity testing', port: 3389, icon: '🖥️', features: ['X.224/TPKT handshake', 'Security protocol detection', 'NLA/CredSSP/TLS check'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'nntp' as const, name: 'NNTP', description: 'Network News Transfer Protocol (RFC 3977) - Usenet newsgroup browsing and article reading', port: 119, icon: '📰', features: ['Newsgroup browsing', 'Article retrieval', 'OVER header fetching'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'nats' as const, name: 'NATS', description: 'NATS Protocol - Ultra-fast cloud-native pub/sub messaging system', port: 4222, icon: '🚀', features: ['Pub/sub messaging', 'Server info & JetStream detection', 'Token & user/pass auth'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'xmpp' as const, name: 'XMPP', description: 'XMPP Protocol (RFC 6120) - Extensible messaging and presence (Jabber)', port: 5222, icon: '💬', features: ['TLS & SASL discovery', 'Server feature probing', 'XML stream negotiation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'jetdirect' as const, name: 'JetDirect', description: 'HP JetDirect Protocol - Raw network printing and PJL printer identification', port: 9100, icon: '🖨️', features: ['PJL status queries', 'Printer model identification', 'Port connectivity testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'fastcgi' as const, name: 'FastCGI', description: 'FastCGI Protocol - Binary web server to application server interface', port: 9000, icon: '🔧', features: ['Server capability probing', 'PHP-FPM health check', 'CGI request/response testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'diameter' as const, name: 'Diameter', description: 'Diameter Protocol (RFC 6733) - Modern AAA for 4G/5G mobile networks', port: 3868, icon: '📶', features: ['Capabilities exchange (CER/CEA)', 'Device watchdog (DWR/DWA)', 'AVP parsing & peer info'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'etcd' as const, name: 'etcd', description: 'etcd v3 API - Distributed key-value store powering Kubernetes coordination', port: 2379, icon: '🔑', features: ['Key-value CRUD operations', 'Cluster health & status', 'Lease & lock management'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'consul' as const, name: 'Consul', description: 'HashiCorp Consul HTTP API - Service discovery and health checking', port: 8500, icon: '🏛️', features: ['Service catalog discovery', 'Agent version & datacenter', 'ACL token support'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'influxdb' as const, name: 'InfluxDB', description: 'InfluxDB HTTP API - Purpose-built time-series database for metrics and IoT', port: 8086, icon: '📈', features: ['Health check & version detection', 'Line Protocol data writing', 'Flux query execution'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'bgp' as const, name: 'BGP', description: 'Border Gateway Protocol (RFC 4271) - Internet routing between autonomous systems', port: 179, icon: '🌍', features: ['OPEN handshake & version detection', 'AS number & capability discovery', 'Session establishment check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'docker' as const, name: 'Docker', description: 'Docker Engine API - HTTP REST API for container management over TCP', port: 2375, icon: '🐳', features: ['Ping connectivity check', 'Version & platform detection', 'Cloudflare protection detection'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'pptp' as const, name: 'PPTP', description: 'PPTP Protocol (RFC 2637) - Legacy VPN server discovery and fingerprinting', port: 1723, icon: '🔒', features: ['Version & capability detection', 'Hostname & vendor fingerprint', 'Framing/bearer enumeration'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'dicom' as const, name: 'DICOM', description: 'DICOM Protocol (ISO 12052) - Medical imaging communication and PACS connectivity', port: 104, icon: '🏥', features: ['A-ASSOCIATE handshake', 'C-ECHO verification (DICOM ping)', 'SOP Class negotiation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'jsonrpc' as const, name: 'JSON-RPC', description: 'JSON-RPC 2.0 Protocol - Lightweight RPC for Ethereum, Bitcoin, and custom APIs', port: 8545, icon: '🔗', features: ['Ethereum & Bitcoin RPC', 'Method call with params', 'Batch request support'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: '9p' as const, name: '9P', description: '9P Protocol (Plan 9) - Network filesystem where everything is a file', port: 564, icon: '📁', features: ['Version negotiation', 'Filesystem attach', 'Used by QEMU & WSL2'], status: 'niche' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'thrift' as const, name: 'Thrift', description: 'Apache Thrift Protocol - Cross-language binary RPC framework', port: 9090, icon: '⚙️', features: ['Binary protocol probe', 'Custom RPC method calls', 'Framed & buffered transport'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'slp' as const, name: 'SLP', description: 'Service Location Protocol (RFC 2608) - Automatic network service discovery', port: 427, icon: '🔍', features: ['Service type enumeration', 'Service URL discovery', 'Attribute-based queries'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'bittorrent' as const, name: 'BitTorrent', description: 'BitTorrent Peer Wire Protocol (BEP 3) - P2P file sharing handshake and peer detection', port: 6881, icon: '🌊', features: ['Protocol handshake', 'Client fingerprinting', 'Extension discovery (DHT/PEX)'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'x11' as const, name: 'X11', description: 'X Window System Protocol - Network-transparent graphical display server probing', port: 6000, icon: '🖼️', features: ['Setup handshake & auth', 'Vendor & version detection', 'Screen resolution discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'kerberos' as const, name: 'Kerberos', description: 'Kerberos v5 Protocol (RFC 4120) - Network authentication for Active Directory', port: 88, icon: '🔑', features: ['AS-REQ probe & KDC detection', 'Encryption type discovery', 'Realm & version info'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'sccp' as const, name: 'SCCP (Skinny)', description: 'Cisco Skinny Client Control Protocol - VoIP phone signaling for CUCM', port: 2000, icon: '📞', features: ['KeepAlive probe & detection', 'Device registration attempt', 'Binary message parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'matrix' as const, name: 'Matrix', description: 'Matrix Protocol - Decentralized real-time communication and federation', port: 8448, icon: '🔷', features: ['Homeserver discovery', 'Federation version detection', 'Login flow enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'iscsi' as const, name: 'iSCSI', description: 'iSCSI Protocol (RFC 7143) - Block-level storage over TCP/IP networks', port: 3260, icon: '💿', features: ['Login & session negotiation', 'SendTargets discovery', 'Target IQN enumeration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'websocket' as const, name: 'WebSocket', description: 'WebSocket Protocol (RFC 6455) - Full-duplex communication over TCP via HTTP Upgrade', port: 80, icon: '🔌', features: ['HTTP Upgrade handshake probe', 'Accept key validation', 'Ping/pong frame testing'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'h323' as const, name: 'H.323', description: 'H.323 Protocol (ITU-T) - Legacy VoIP call signaling via Q.931 over TCP', port: 1720, icon: '📞', features: ['Q.931 SETUP probe & response parsing', 'Call flow message detection', 'Gateway/gatekeeper fingerprinting'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'dot' as const, name: 'DNS over TLS', description: 'DoT Protocol (RFC 7858) - Encrypted DNS queries via TLS on port 853', port: 853, icon: '🔒', features: ['Encrypted DNS resolution', 'Public DoT server support', 'Full record type queries'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'soap' as const, name: 'SOAP', description: 'Simple Object Access Protocol - XML web services for enterprise integration', port: 80, icon: '🧼', features: ['SOAP 1.1/1.2 envelope support', 'WSDL discovery & operation listing', 'XML fault parsing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'openvpn' as const, name: 'OpenVPN', description: 'OpenVPN Protocol - SSL/TLS VPN server detection and TCP handshake testing', port: 1194, icon: '🔐', features: ['TCP mode handshake', 'Session ID exchange', 'Protocol version detection'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'dict' as const, name: 'DICT', description: 'DICT Protocol (RFC 2229) - Dictionary server for word definitions and thesaurus', port: 2628, icon: '📖', features: ['Word definitions', 'Pattern matching (prefix, soundex, regex)', 'Multi-dictionary search'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'sip' as const, name: 'SIP', description: 'SIP Protocol (RFC 3261) - VoIP and multimedia session signaling', port: 5060, icon: '📱', features: ['OPTIONS capability probe', 'REGISTER auth detection', 'Server agent fingerprinting'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'qotd' as const, name: 'QOTD', description: 'Quote of the Day (RFC 865) - Random quotes from remote servers', port: 17, icon: '💬', features: ['Zero-command protocol', 'Completes classic RFC simple services', 'Network connectivity test'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'lpd' as const, name: 'LPD', description: 'Line Printer Daemon (RFC 1179) - Classic Unix network printing protocol', port: 515, icon: '🖨️', features: ['Print queue status query', 'Short & long format listing', 'Printer name discovery'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'discard' as const, name: 'DISCARD', description: 'DISCARD Protocol (RFC 863) - Send data into a silent black hole for network testing', port: 9, icon: '🕳️', features: ['Bandwidth/throughput testing', 'Connection verification', 'Complement to ECHO (RFC 862)'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'minecraft' as const, name: 'Minecraft SLP', description: 'Minecraft Server List Ping - Query server status, players, version, and MOTD', port: 25565, icon: '⛏️', features: ['Server status & MOTD', 'Player count & list', 'Version & latency check'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'zabbix' as const, name: 'Zabbix', description: 'Zabbix Protocol - Network monitoring server and agent connectivity testing', port: 10051, icon: '📊', features: ['Server probe (active checks)', 'Agent item queries', 'ZBXD binary header protocol'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'ident' as const, name: 'IDENT', description: 'IDENT Protocol (RFC 1413) - TCP connection user identification for IRC and mail servers', port: 113, icon: '🪪', features: ['User ID lookup by port pair', 'OS type detection', 'IRC/SMTP auth verification'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'oracle-tns' as const, name: 'Oracle TNS', description: 'Oracle TNS Protocol - Oracle Database listener detection and service connectivity testing', port: 1521, icon: '🔶', features: ['TNS Connect handshake', 'Listener & version detection', 'Service name probe'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'mpd' as const, name: 'MPD', description: 'Music Player Daemon - Server-side music player with text-based control protocol', port: 6600, icon: '🎵', features: ['Playback status & stats', 'Current song metadata', 'Audio output discovery'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'beanstalkd' as const, name: 'Beanstalkd', description: 'Beanstalkd Work Queue - Fast text-based job queue for distributing time-consuming tasks', port: 11300, icon: '🫘', features: ['Server stats & version', 'Tube listing & stats', 'Read-only job inspection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'clamav' as const, name: 'ClamAV', description: 'ClamAV Daemon Protocol - Open-source antivirus engine health and version checking', port: 3310, icon: '🛡️', features: ['PING/PONG health check', 'Version & DB info', 'Thread pool statistics'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'lmtp' as const, name: 'LMTP', description: 'LMTP Protocol (RFC 2033) - Local mail delivery with per-recipient status', port: 24, icon: '📬', features: ['LHLO capability discovery', 'Per-recipient delivery status', 'Dovecot/Cyrus/Postfix local delivery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'couchdb' as const, name: 'CouchDB', description: 'Apache CouchDB - HTTP-native NoSQL document database with REST API', port: 5984, icon: '🛋️', features: ['Server info & version detection', 'Database listing & browsing', 'REST API query interface'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'managesieve' as const, name: 'ManageSieve', description: 'ManageSieve Protocol (RFC 5804) - Sieve email filtering script management', port: 4190, icon: '📧', features: ['Capability probing', 'SASL PLAIN authentication', 'Sieve script listing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'ipp' as const, name: 'IPP', description: 'Internet Printing Protocol (RFC 8011) - CUPS network printing and printer discovery', port: 631, icon: '🖨️', features: ['Get-Printer-Attributes probe', 'CUPS server detection', 'Printer capability discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'svn' as const, name: 'SVN', description: 'Subversion (svnserve) - Version control server greeting and capability detection', port: 3690, icon: '🔀', features: ['S-expression greeting parsing', 'Capability & auth detection', 'Protocol version discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'smpp' as const, name: 'SMPP', description: 'SMPP v3.4 Protocol - SMS gateway connectivity testing and SMSC detection', port: 2775, icon: '📱', features: ['Bind Transceiver handshake', 'Server authentication testing', 'Interface version detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'teamspeak' as const, name: 'TeamSpeak', description: 'TeamSpeak ServerQuery - Text-based administration for TeamSpeak 3 voice servers', port: 10011, icon: '🎧', features: ['Server info & version detection', 'Client & channel listing', 'Read-only admin commands'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'radius' as const, name: 'RADIUS', description: 'RADIUS Protocol (RFC 2865) - Network access authentication for ISPs, Wi-Fi, and VPNs', port: 1812, icon: '📡', features: ['Status-Server probe & detection', 'Access-Request authentication', 'MD5 password encryption & HMAC'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'nrpe' as const, name: 'NRPE', description: 'Nagios NRPE Protocol - Remote plugin execution for Nagios monitoring', port: 5666, icon: '📟', features: ['Version detection (_NRPE_CHECK)', 'CRC32 integrity validation', 'Binary 1036-byte packet format'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'rlogin' as const, name: 'Rlogin', description: 'Rlogin Protocol (RFC 1282) - BSD remote login, the predecessor to SSH', port: 513, icon: '👴', features: ['Handshake probe & detection', 'User identity passing', 'Internet archaeology (pre-SSH)'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 's7comm' as const, name: 'S7comm', description: 'Siemens S7 PLC Protocol - Industrial SCADA/automation over ISO-TSAP', port: 102, icon: '🏭', features: ['COTP/TPKT connection', 'S7 setup communication', 'CPU identification (SZL)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'snpp' as const, name: 'SNPP', description: 'Simple Network Paging Protocol (RFC 1861) - Text-based TCP pager messaging', port: 444, icon: '📟', features: ['Server probe & banner detection', 'PAGE/MESS/SEND command flow', 'SMTP-like numeric response codes'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'rethinkdb' as const, name: 'RethinkDB', description: 'RethinkDB ReQL Wire Protocol - Real-time document database with changefeed support', port: 28015, icon: '🔄', features: ['V0.4 & V1.0 handshake detection', 'SCRAM-SHA-256 auth probing', 'Auth key connectivity testing'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'clickhouse' as const, name: 'ClickHouse', description: 'ClickHouse - Columnar OLAP database with HTTP query interface for real-time analytics', port: 8123, icon: '🏠', features: ['Health check & version detection', 'SQL query execution', 'Database & table browsing'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'gearman' as const, name: 'Gearman', description: 'Gearman Job Queue - Distributed task processing with text-based admin protocol', port: 4730, icon: '⚙️', features: ['Server version & status', 'Function queue monitoring', 'Connected worker listing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'ethernetip' as const, name: 'EtherNet/IP', description: 'EtherNet/IP - CIP industrial protocol for PLC and automation device discovery', port: 44818, icon: '🏭', features: ['ListIdentity device discovery', 'Vendor & product identification', 'Firmware revision & serial number'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'portmapper' as const, name: 'Portmapper', description: 'ONC RPC Portmapper / rpcbind (RFC 1833) - Service discovery for NFS, NIS, and Unix RPC', port: 111, icon: '🗺️', features: ['RPC service enumeration (DUMP)', 'NULL ping probe', 'NFS/mountd/nlockmgr discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'adb' as const, name: 'ADB', description: 'Android Debug Bridge - Mobile development tool for device communication and debugging', port: 5037, icon: '📱', features: ['Protocol version detection', 'Device listing with properties', 'Text-based length-prefixed commands'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'relp' as const, name: 'RELP', description: 'Reliable Event Logging Protocol - Guaranteed syslog delivery with application-level ACKs', port: 20514, icon: '📋', features: ['Session open/close handshake', 'Guaranteed message delivery (ACK)', 'RFC 5424 syslog integration'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'prometheus' as const, name: 'Prometheus', description: 'Prometheus Monitoring - HTTP-based metrics collection, PromQL queries, and health checks', port: 9090, icon: '🔥', features: ['Health & readiness probes', 'PromQL query execution', 'Metrics scrape & parsing'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'dnp3' as const, name: 'DNP3', description: 'DNP3 Protocol (IEEE 1815) - SCADA protocol for electric utilities and water systems', port: 20000, icon: '⚡', features: ['Link status probe & detection', 'Class 0 data integrity poll', 'CRC-16/DNP frame validation'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'stun' as const, name: 'STUN', description: 'STUN Protocol (RFC 5389/8489) - NAT traversal for WebRTC, VoIP, and peer-to-peer', port: 3478, icon: '🔀', features: ['Binding Request/Response', 'Public IP discovery', 'Server software detection'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'fluentd' as const, name: 'Fluentd', description: 'Fluentd Forward Protocol - Log aggregation with MessagePack-encoded forwarding over TCP', port: 24224, icon: '📊', features: ['Server probe with ack verification', 'Custom log entry forwarding', 'MessagePack binary encoding'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'rexec' as const, name: 'Rexec', description: 'BSD Remote Execution (Port 512) - Execute commands on remote Unix hosts with password auth', port: 512, icon: '🖥️', features: ['Command execution with output', 'Password authentication (cleartext)', 'Internet archaeology (pre-SSH)'], status: 'deprecated' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'fix' as const, name: 'FIX', description: 'FIX Protocol (FIX.4.x) - Financial Information eXchange for electronic trading', port: 9878, icon: '💹', features: ['Logon/Logout handshake probe', 'Heartbeat & TestRequest', 'FIX version & CompID detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'aerospike' as const, name: 'Aerospike', description: 'Aerospike Info Protocol - High-performance NoSQL database cluster health and metadata', port: 3000, icon: '🚀', features: ['Build version & edition detection', 'Namespace enumeration', 'Cluster health & statistics'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'epmd' as const, name: 'EPMD', description: 'Erlang Port Mapper Daemon - Node discovery for RabbitMQ, CouchDB, and Elixir clusters', port: 4369, icon: '🐇', features: ['List registered Erlang nodes', 'Node port lookup', 'RabbitMQ/CouchDB cluster discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'tarantool' as const, name: 'Tarantool', description: 'Tarantool IPROTO Protocol - High-performance in-memory database with binary wire protocol', port: 3301, icon: '🔵', features: ['128-byte greeting banner detection', 'IPROTO_PING connectivity test', 'Version & instance UUID discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'vault' as const, name: 'Vault', description: 'HashiCorp Vault - Secret management with HTTP API for health, seal status, and system info', port: 8200, icon: '🔐', features: ['Health check & version detection', 'Seal/unseal status monitoring', 'Cluster & replication info'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'nomad' as const, name: 'Nomad', description: 'HashiCorp Nomad HTTP API - Workload orchestration and job scheduling for containers and VMs', port: 4646, icon: '🚀', features: ['Agent info & cluster status', 'Job listing & management', 'Node discovery & health'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'solr' as const, name: 'Apache Solr', description: 'Apache Solr - Open-source enterprise search platform with Lucene-based full-text search', port: 8983, icon: '🔎', features: ['System info & version detection', 'Core listing & status', 'Lucene query search interface'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'iec104' as const, name: 'IEC 104', description: 'IEC 60870-5-104 - Telecontrol protocol for power grid SCADA and substation automation', port: 2404, icon: '⚡', features: ['STARTDT/TESTFR connectivity probing', 'U-frame/I-frame/S-frame detection', 'RTU/IED availability testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'opentsdb' as const, name: 'OpenTSDB', description: 'OpenTSDB - Distributed time series database with telnet-style text protocol on HBase', port: 4242, icon: '📈', features: ['Server version detection', 'Internal statistics retrieval', 'Metric/tag name suggestion'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'riak' as const, name: 'Riak KV', description: 'Riak KV - Distributed NoSQL key-value database with Protocol Buffers binary wire protocol', port: 8087, icon: '🔑', features: ['PBC ping & pong health check', 'Server info & version detection', 'Binary length-prefixed framing'], status: 'niche' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'bitcoin' as const, name: 'Bitcoin', description: 'Bitcoin P2P Wire Protocol - Connect to Bitcoin nodes, version handshake, and network discovery', port: 8333, icon: '₿', features: ['Version handshake & node info', 'Service flag detection (SegWit, pruned)', 'Block height & user agent discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'spamd' as const, name: 'SpamAssassin', description: 'SpamAssassin spamd Protocol - Email spam analysis via the SpamAssassin daemon on port 783', port: 783, icon: '🛡️', features: ['PING/PONG connectivity test', 'CHECK/SYMBOLS/REPORT spam analysis', 'GTUBE test pattern support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'nsq' as const, name: 'NSQ', description: 'NSQ TCP Protocol - Realtime distributed messaging platform for high-throughput workloads', port: 4150, icon: '📬', features: ['V2 protocol handshake & IDENTIFY', 'Message publishing to topics', 'Server version & feature detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'opcua' as const, name: 'OPC UA', description: 'OPC Unified Architecture - Industrial IoT machine-to-machine communication protocol', port: 4840, icon: '🏭', features: ['Hello/Acknowledge handshake probe', 'Endpoint discovery & security policies', 'Server capability detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'zmtp' as const, name: 'ZMTP', description: 'ZeroMQ Message Transport Protocol - Binary wire protocol for high-performance distributed messaging', port: 5555, icon: '🔗', features: ['ZMTP 3.1 greeting handshake', 'NULL/PLAIN/CURVE mechanism detection', 'Socket type negotiation (REQ/REP/PUB/SUB)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'munin' as const, name: 'Munin', description: 'Munin Node Protocol - Text-based monitoring daemon for system metrics and plugin data', port: 4949, icon: '📊', features: ['Plugin listing & discovery', 'Plugin value fetching', 'Node version & capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'sane' as const, name: 'SANE', description: 'SANE (Scanner Access Now Easy) - Network scanner daemon protocol for Linux/Unix systems', port: 6566, icon: '📠', features: ['Daemon version detection', 'SANE_NET_INIT handshake', 'Connection status probing'], status: 'niche' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'ceph' as const, name: 'Ceph Monitor', description: 'Ceph MSGR Protocol - Distributed storage cluster monitor detection and version probing', port: 6789, icon: '🐙', features: ['MSGR v1/v2 banner detection', 'Entity address & feature flags', 'Cluster monitor reachability'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'httpproxy' as const, name: 'HTTP Proxy', description: 'HTTP Forward Proxy & CONNECT Tunnel (RFC 9110) - Test Squid, Nginx, and other HTTP proxies', port: 3128, icon: '🔀', features: ['Forward proxy probe & detection', 'CONNECT tunnel testing', 'Proxy type identification (Squid, Nginx, etc.)'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'varnish' as const, name: 'Varnish CLI', description: 'Varnish CLI Protocol - Administration interface for Varnish Cache reverse proxy servers', port: 6082, icon: '💨', features: ['Banner & auth detection', 'Backend health monitoring', 'VCL config listing & status'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'fins' as const, name: 'FINS', description: 'Omron FINS/TCP Protocol - Industrial PLC communication for CJ, CS, CP, NX series', port: 9600, icon: '🏭', features: ['FINS/TCP node address handshake', 'Controller model identification', 'PLC mode & error status read'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'couchbase' as const, name: 'Couchbase', description: 'Couchbase Server - Memcached binary protocol for high-performance NoSQL key-value operations', port: 11210, icon: '🔴', features: ['Binary NOOP ping health check', 'Server version detection', 'Key-value statistics retrieval'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'ami' as const, name: 'Asterisk AMI', description: 'Asterisk Manager Interface (Port 5038) - Text-based PBX control and monitoring protocol', port: 5038, icon: '📞', features: ['Banner & version detection', 'Authenticated action execution', 'Event stream collection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'jdwp' as const, name: 'JDWP', description: 'Java Debug Wire Protocol - Remote JVM debugging interface (JPDA)', port: 8000, icon: '☕', features: ['ASCII handshake detection', 'JVM version & name query', 'ID sizes & debug capabilities'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'drda' as const, name: 'DRDA (DB2)', description: 'IBM Distributed Relational Database Architecture - DB2/Derby EXCSAT handshake', port: 50000, icon: '🏢', features: ['EXCSAT handshake', 'Server attribute exchange', 'Manager level detection'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'livestatus' as const, name: 'Livestatus', description: 'MK Livestatus - Text-based monitoring query protocol for Checkmk, Naemon, and Icinga', port: 6557, icon: '📊', features: ['Engine status & version detection', 'Host & service state queries', 'LQL query language (SQL-like)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'dcerpc' as const, name: 'DCE/RPC', description: 'MS-RPC Endpoint Mapper - Windows service discovery via DCE/RPC Bind handshake', port: 135, icon: '🪟', features: ['EPM Bind/Bind Ack handshake', 'RPC interface probing (8 built-in)', 'Custom UUID testing'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'imaps' as const, name: 'IMAPS', description: 'IMAP over TLS (RFC 8314) - Secure email access with implicit TLS encryption', port: 993, icon: '🔒', features: ['TLS from first byte (implicit)', 'Capability & auth probing', 'Mailbox listing & selection'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'loki' as const, name: 'Loki', description: 'Grafana Loki - Horizontally-scalable log aggregation with LogQL queries', port: 3100, icon: '🪵', features: ['Health & readiness probes', 'LogQL query execution', 'Metrics scrape & label discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'pjlink' as const, name: 'PJLink', description: 'PJLink Protocol - Unified projector/display control for AV and digital signage', port: 4352, icon: '📽️', features: ['Projector identification & status', 'Power on/off control', 'Lamp hours & error diagnostics'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'openflow' as const, name: 'OpenFlow', description: 'SDN control protocol for programmable network switches (ONF standard)', port: 6653, icon: '🔀', features: ['HELLO version negotiation', 'Switch feature discovery', 'Echo keepalive testing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'nsca' as const, name: 'NSCA', description: 'Nagios Service Check Acceptor - Binary passive check protocol for monitoring infrastructure', port: 5667, icon: '📡', features: ['132-byte init packet detection', 'Passive check result submission', 'XOR encryption support'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'meilisearch' as const, name: 'Meilisearch', description: 'Meilisearch - Lightning-fast typo-tolerant full-text search engine with REST API', port: 7700, icon: '🔎', features: ['Health & version checks', 'Index listing & statistics', 'Full-text search queries'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'icecast' as const, name: 'Icecast', description: 'Icecast Streaming Server - HTTP-based audio/video streaming with mount point monitoring', port: 8000, icon: '📻', features: ['Server status & mount points', 'Listener count monitoring', 'Stream metadata detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'haproxy' as const, name: 'HAProxy', description: 'HAProxy Runtime API - Text-based administration for the world\'s most popular load balancer', port: 9999, icon: '⚖️', features: ['Process info & version detection', 'CSV frontend/backend statistics', 'Server state & health monitoring'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'rmi' as const, name: 'Java RMI', description: 'Java Remote Method Invocation - JRMI wire protocol for remote object registry', port: 1099, icon: '☕', features: ['JRMI handshake & ProtocolAck', 'Registry binding discovery', 'Server endpoint identification'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'nbd' as const, name: 'NBD', description: 'Network Block Device - Linux block storage over TCP with NBDMAGIC handshake', port: 10809, icon: '💾', features: ['NBDMAGIC handshake detection', 'Export listing', 'Newstyle negotiation flags'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'ganglia' as const, name: 'Ganglia', description: 'Ganglia gmond - Cluster monitoring with XML dump of CPU, memory, disk, and network metrics', port: 8649, icon: '📊', features: ['Full XML cluster dump on connect', 'Host & metric enumeration', 'Cluster topology discovery'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'pop3s' as const, name: 'POP3S', description: 'POP3 over TLS (RFC 8314) - Encrypted email retrieval with implicit TLS on port 995', port: 995, icon: '🔒', features: ['Implicit TLS encryption', 'Email message listing', 'Authenticated mailbox access'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'netbios' as const, name: 'NetBIOS', description: 'RFC 1002 NetBIOS Session Service - Windows networking transport for SMB/CIFS over NetBIOS', port: 139, icon: '🖧', features: ['Session Request/Response handshake', 'Service suffix discovery (6 types)', 'NetBIOS name encoding/decoding'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'smtps' as const, name: 'SMTPS', description: 'SMTP over TLS (RFC 8314) - Secure email submission with implicit TLS encryption', port: 465, icon: '🔐', features: ['Implicit TLS from first byte', 'AUTH LOGIN authentication', 'Email sending over TLS'], status: 'active' as ProtocolStatus, popularity: 'critical' as PopularityTier, category: 'email' as ProtocolCategory },
  { id: 'pcep' as const, name: 'PCEP', description: 'RFC 5440 Path Computation Element Protocol - SDN/MPLS path computation for network orchestration', port: 4189, icon: '🛤️', features: ['OPEN handshake detection', 'Session parameter exchange', 'Capability TLV parsing'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'winrm' as const, name: 'WinRM', description: 'Windows Remote Management - HTTP/SOAP-based remote management for PowerShell and Ansible', port: 5985, icon: '🪟', features: ['WSMAN Identify probe (anonymous)', 'Auth method detection', 'Product vendor & version discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'remote' as ProtocolCategory },
  { id: 'uwsgi' as const, name: 'uWSGI', description: 'uWSGI Binary Wire Protocol - High-performance Python/WSGI application server communication', port: 3031, icon: '🐍', features: ['Binary packet probe & detection', 'WSGI request with HTTP response', 'Server software identification'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'torcontrol' as const, name: 'Tor Control', description: 'Tor Control Protocol - Text-based control interface for Tor process management and monitoring', port: 9051, icon: '🧅', features: ['PROTOCOLINFO probe (no auth)', 'Auth method discovery', 'GETINFO query for status/stats'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'gpsd' as const, name: 'GPSD', description: 'GPS Service Daemon - JSON-based protocol for querying GPS receivers and location data', port: 2947, icon: '📡', features: ['Version & protocol detection', 'GPS device enumeration', 'Position fix polling (lat/lon/alt)'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'kibana' as const, name: 'Kibana', description: 'Kibana - Elastic data visualization dashboard with saved objects and plugin discovery', port: 5601, icon: '📊', features: ['Server status & health check', 'Saved objects browsing', 'Plugin & version discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'grafana' as const, name: 'Grafana', description: 'Grafana Observability Platform - Monitoring dashboards, datasources, and visualization engine', port: 3000, icon: '📈', features: ['Health & server info', 'Datasource enumeration', 'Dashboard search & discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'web' as ProtocolCategory },
  { id: 'rserve' as const, name: 'Rserve', description: 'Rserve Protocol (QAP1) - R Statistical Computing server for remote expression evaluation', port: 6311, icon: '📊', features: ['32-byte banner & version detection', 'R expression evaluation', 'Auth & TLS capability probing'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'sonic' as const, name: 'Sonic', description: 'Sonic Search Backend - Lightweight text-based search engine with TCP protocol', port: 1491, icon: '🔍', features: ['Instance & protocol detection', 'Control mode server stats', 'PING/PONG health check'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'nntps' as const, name: 'NNTPS', description: 'NNTP over TLS (RFC 4642) - Encrypted Usenet newsgroup access with implicit TLS', port: 563, icon: '🔒', features: ['Implicit TLS from first byte', 'Newsgroup browsing & article retrieval', 'Capability & posting detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'specialty' as ProtocolCategory },
  { id: 'sentinel' as const, name: 'Redis Sentinel', description: 'Redis Sentinel (Port 26379) - High availability monitoring and automatic failover for Redis', port: 26379, icon: '🛡️', features: ['Master/replica topology discovery', 'Quorum health checking', 'Sentinel cluster monitoring'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'ldp-mpls' as const, name: 'LDP', description: 'RFC 5036 Label Distribution Protocol - MPLS label binding exchange between LSRs', port: 646, icon: '🏷️', features: ['Initialization handshake', 'Session parameter exchange', 'LSR-ID discovery'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'network' as ProtocolCategory },
  { id: 'firebird' as const, name: 'Firebird SQL', description: 'Firebird Database Protocol - Open-source relational database with custom binary wire protocol', port: 3050, icon: '🔥', features: ['op_connect handshake', 'Protocol version detection', 'Architecture & server info'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'hazelcast' as const, name: 'Hazelcast', description: 'Hazelcast IMDG - Binary client protocol for distributed caching and in-memory data grid', port: 5701, icon: '⚡', features: ['Authentication & cluster probe', 'Version & member count detection', 'Cluster name discovery'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'ignite' as const, name: 'Apache Ignite', description: 'Apache Ignite Thin Client - Distributed in-memory computing platform with version-negotiated handshake', port: 10800, icon: '🔥', features: ['Thin client handshake (v1.7)', 'Protocol version probing (5 versions)', 'Node UUID & feature detection'], status: 'active' as ProtocolStatus, popularity: 'moderate' as PopularityTier, category: 'databases' as ProtocolCategory },
  { id: 'rabbitmq' as const, name: 'RabbitMQ Management', description: 'RabbitMQ Management HTTP API - Message broker health monitoring and queue management', port: 15672, icon: '🐰', features: ['Health check & overview', 'Queue, exchange, channel stats', 'Node metrics & management'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
  { id: 'cvs' as const, name: 'CVS pserver', description: 'CVS Password Server - Legacy version control with text-based repository access', port: 2401, icon: '📦', features: ['Repository connection probe', 'Password authentication (scrambled)', '"I LOVE YOU/I HATE YOU" responses'], status: 'active' as ProtocolStatus, popularity: 'minimal' as PopularityTier, category: 'files' as ProtocolCategory },
  { id: 'amqps' as const, name: 'AMQPS', description: 'AMQP 0-9-1 over TLS - Secure message broker connectivity for RabbitMQ and others', port: 5671, icon: '🔒', features: ['Implicit TLS encryption', 'Broker properties & version', 'Authentication mechanisms'], status: 'active' as ProtocolStatus, popularity: 'high' as PopularityTier, category: 'messaging' as ProtocolCategory },
];

export default function ProtocolSelector({ onSelect }: ProtocolSelectorProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';
  const [selectedCategory, setSelectedCategory] = useState<'all' | ProtocolCategory>('all');

  const filteredProtocols = selectedCategory === 'all'
    ? protocols
    : protocols.filter(p => p.category === selectedCategory);

  const sortedProtocols = [...filteredProtocols].sort((a, b) => sortKey(a) - sortKey(b));
  const activeCount = protocols.filter(p => p.status !== 'deprecated').length;
  const deprecatedCount = protocols.filter(p => p.status === 'deprecated').length;

  const categoryKeys = Object.keys(categoryConfig) as ('all' | ProtocolCategory)[];

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
        <p className={`text-xl ${isRetro ? 'retro-text' : 'text-slate-300'}`}>
          {isRetro ? '> ' : ''}TCP PROTOCOL CLIENT TESTING INTERFACE
        </p>
        <p className={`text-sm mt-2 ${isRetro ? 'retro-text-amber' : 'text-slate-400'}`}>
          {isRetro ? '[ ' : ''}POWERED BY CLOUDFLARE WORKERS SOCKETS API{isRetro ? ' ]' : ''}
        </p>
        <div className="mt-4 inline-flex gap-3">
          <div className={`px-4 py-2 ${isRetro ? 'retro-box' : 'bg-blue-600 rounded-full'}`}>
            <span className={`font-semibold text-sm ${isRetro ? 'retro-text' : 'text-white'}`}>
              {isRetro ? '>> ' : ''}{activeCount} Active{isRetro ? ' <<' : ''}
            </span>
          </div>
          <div className={`px-4 py-2 ${isRetro ? 'retro-box' : 'bg-slate-600 rounded-full'}`}>
            <span className={`font-semibold text-sm ${isRetro ? 'retro-text-amber' : 'text-slate-300'}`}>
              {isRetro ? '>> ' : ''}{deprecatedCount} Historical{isRetro ? ' <<' : ''}
            </span>
          </div>
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

      <div className={isRetro ? 'retro-grid' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'}>
        {sortedProtocols.map((protocol, index) => (
          <>
            {protocol.status === 'deprecated' && (index === 0 || sortedProtocols[index - 1].status !== 'deprecated') && (
              <div key="deprecated-divider" className={`${isRetro ? '' : 'col-span-full'} text-center py-4 ${isRetro ? '' : 'border-t border-slate-600 mt-2'}`}>
                <span className={`text-sm uppercase tracking-wider ${isRetro ? 'retro-text-amber' : 'text-slate-500'}`}>
                  {isRetro ? '--- ' : ''}Historical / Deprecated Protocols{isRetro ? ' ---' : ''}
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

              <div className="space-y-1">
                {protocol.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center text-xs text-slate-400">
                    <span className="text-green-400 mr-2" aria-hidden="true">✓</span>
                    {feature}
                  </div>
                ))}
              </div>
            </button>
          </>
        ))}
      </div>

      <div className="mt-12 bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About This Tool</h3>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">
          This interface demonstrates TCP protocol implementations using Cloudflare Workers'
          <code className="bg-slate-700 px-2 py-1 rounded mx-1">connect()</code> API.
          Select a protocol above to establish connections and interact with remote servers.
        </p>
        <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
            <div>
              <p className="text-green-200 text-sm font-semibold mb-1">Live Implementation</p>
              <p className="text-green-100/80 text-xs leading-relaxed">
                All {protocols.length} protocols are fully functional with comprehensive testing.
                Connect to remote servers directly from your browser. All connections
                are proxied through Cloudflare's global network with Smart Placement for low latency.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
