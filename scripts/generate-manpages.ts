#!/usr/bin/env npx tsx
/**
 * Auto-generates src/worker/manpages.ts by extracting API endpoints
 * from src/worker/index.ts and merging with protocol metadata.
 *
 * Usage: npx tsx scripts/generate-manpages.ts
 *
 * The endpoint list is always derived from the source code.
 * Protocol metadata (fullName, defaultPort, shortRoute) is maintained
 * in the META table below — add new entries there when adding protocols.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- Step 1: Extract endpoints from index.ts ---
const indexSrc = readFileSync(join(ROOT, 'src/worker/index.ts'), 'utf-8');
const endpointPattern = /url\.pathname === '\/api\/([^']+)'/g;
const protocols = new Map<string, string[]>();

let match: RegExpExecArray | null;
while ((match = endpointPattern.exec(indexSrc)) !== null) {
  const path = match[1];
  const slash = path.indexOf('/');
  if (slash === -1) continue; // bare paths like /api/ping, /api/connect
  const proto = path.slice(0, slash);
  const endpoint = path.slice(slash + 1);
  if (!protocols.has(proto)) protocols.set(proto, []);
  protocols.get(proto)!.push(endpoint);
}

// --- Step 2: Protocol metadata (hand-maintained) ---
// Format: [fullName, defaultPort, shortRoute]
// Only needs updating when adding a NEW protocol.
const META: Record<string, [string, number | null, boolean]> = {
  '9p': ['Plan 9 File Protocol', 564, false],
  'activemq': ['Apache ActiveMQ Message Broker', 61616, false],
  'activeusers': ['Active Users Protocol (RFC 866)', 11, false],
  'adb': ['Android Debug Bridge', 5555, false],
  'aerospike': ['Aerospike Database', 3000, false],
  'afp': ['Apple Filing Protocol', 548, false],
  'ajp': ['Apache JServ Protocol', 8009, false],
  'ami': ['Asterisk Manager Interface', 5038, false],
  'amqp': ['Advanced Message Queuing Protocol', 5672, false],
  'amqps': ['AMQP over TLS', 5671, false],
  'battlenet': ['Battle.net Chat Protocol', 6112, false],
  'beanstalkd': ['Beanstalkd Work Queue', 11300, false],
  'beats': ['Elastic Beats Protocol', 5044, false],
  'bgp': ['Border Gateway Protocol', 179, false],
  'bitcoin': ['Bitcoin P2P Protocol', 8333, false],
  'bittorrent': ['BitTorrent Peer Protocol', 6881, false],
  'cassandra': ['Apache Cassandra CQL', 9042, false],
  'cdp': ['Chrome DevTools Protocol', 9222, false],
  'ceph': ['Ceph Distributed Storage', 6789, false],
  'chargen': ['Character Generator Protocol (RFC 864)', 19, false],
  'cifs': ['Common Internet File System', 445, false],
  'clamav': ['ClamAV Antivirus Daemon', 3310, false],
  'clickhouse': ['ClickHouse Database', 9000, false],
  'coap': ['Constrained Application Protocol', 5683, false],
  'collectd': ['Collectd Monitoring', 25826, false],
  'consul': ['HashiCorp Consul', 8500, false],
  'couchbase': ['Couchbase Database', 11210, false],
  'couchdb': ['Apache CouchDB', 5984, false],
  'cvs': ['Concurrent Versions System', 2401, false],
  'dap': ['Debug Adapter Protocol', null, false],
  'daytime': ['Daytime Protocol (RFC 867)', 13, false],
  'dcerpc': ['Distributed Computing Environment RPC', 135, false],
  'diameter': ['Diameter AAA Protocol', 3868, false],
  'dicom': ['Digital Imaging and Communications in Medicine', 104, false],
  'dict': ['Dictionary Server Protocol (RFC 2229)', 2628, false],
  'discard': ['Discard Protocol (RFC 863)', 9, false],
  'dnp3': ['Distributed Network Protocol', 20000, false],
  'dns': ['Domain Name System', 53, true],
  'docker': ['Docker Engine API', 2375, false],
  'doh': ['DNS over HTTPS', 443, false],
  'dot': ['DNS over TLS', 853, false],
  'drda': ['Distributed Relational Database Architecture', 50000, false],
  'echo': ['Echo Protocol (RFC 862)', 7, false],
  'elasticsearch': ['Elasticsearch Search Engine', 9200, false],
  'epmd': ['Erlang Port Mapper Daemon', 4369, false],
  'epp': ['Extensible Provisioning Protocol', 700, false],
  'etcd': ['etcd Key-Value Store', 2379, false],
  'ethereum': ['Ethereum Node', 30303, false],
  'ethernetip': ['EtherNet/IP Industrial Protocol', 44818, false],
  'fastcgi': ['Fast Common Gateway Interface', 9000, false],
  'finger': ['Finger Protocol (RFC 1288)', 79, false],
  'fins': ['Omron FINS Industrial Protocol', 9600, false],
  'firebird': ['Firebird Database', 3050, false],
  'fix': ['Financial Information eXchange', 9878, false],
  'fluentd': ['Fluentd Log Collector', 24224, false],
  'ftp': ['File Transfer Protocol', 21, true],
  'ftps': ['FTP over TLS', 990, false],
  'gadugadu': ['Gadu-Gadu Messenger', 8074, false],
  'ganglia': ['Ganglia Monitoring', 8649, false],
  'gearman': ['Gearman Job Server', 4730, false],
  'gelf': ['Graylog Extended Log Format', 12201, false],
  'gemini': ['Gemini Protocol', 1965, false],
  'git': ['Git Protocol', 9418, false],
  'gopher': ['Gopher Protocol (RFC 1436)', 70, false],
  'gpsd': ['GPS Daemon', 2947, false],
  'grafana': ['Grafana Monitoring Dashboard', 3000, false],
  'graphite': ['Graphite Metrics', 2003, false],
  'h323': ['H.323 VoIP Signaling', 1720, false],
  'haproxy': ['HAProxy Stats/Admin', 9999, false],
  'hazelcast': ['Hazelcast In-Memory Data Grid', 5701, false],
  'hl7': ['Health Level 7 MLLP', 2575, false],
  'hsrp': ['Hot Standby Router Protocol', 1985, false],
  'http': ['Hypertext Transfer Protocol', 80, true],
  'httpproxy': ['HTTP CONNECT Proxy', 8080, false],
  'icecast': ['Icecast Streaming Server', 8000, false],
  'ident': ['Identification Protocol (RFC 1413)', 113, false],
  'iec104': ['IEC 60870-5-104 SCADA', 2404, false],
  'ignite': ['Apache Ignite', 10800, false],
  'ike': ['Internet Key Exchange', 500, false],
  'imap': ['Internet Message Access Protocol', 143, false],
  'imaps': ['IMAP over TLS', 993, false],
  'influxdb': ['InfluxDB Time Series Database', 8086, false],
  'informix': ['IBM Informix Database', 9088, false],
  'ipfs': ['InterPlanetary File System', 5001, false],
  'ipmi': ['Intelligent Platform Management Interface', 623, false],
  'ipp': ['Internet Printing Protocol', 631, false],
  'irc': ['Internet Relay Chat', 6667, false],
  'ircs': ['IRC over TLS', 6697, false],
  'iscsi': ['Internet Small Computer Systems Interface', 3260, false],
  'jabber-component': ['XMPP Component Protocol (XEP-0114)', 5275, false],
  'jdwp': ['Java Debug Wire Protocol', 5005, false],
  'jetdirect': ['HP JetDirect Printing', 9100, false],
  'jsonrpc': ['JSON Remote Procedure Call', null, false],
  'jupyter': ['Jupyter Notebook Server', 8888, false],
  'kafka': ['Apache Kafka', 9092, false],
  'kerberos': ['Kerberos Authentication', 88, false],
  'kibana': ['Kibana Dashboard', 5601, false],
  'kubernetes': ['Kubernetes API Server', 6443, false],
  'l2tp': ['Layer 2 Tunneling Protocol', 1701, false],
  'ldap': ['Lightweight Directory Access Protocol', 389, false],
  'ldaps': ['LDAP over TLS', 636, false],
  'ldp': ['Label Distribution Protocol', 646, false],
  'livestatus': ['Nagios Livestatus', 6557, false],
  'llmnr': ['Link-Local Multicast Name Resolution', 5355, false],
  'lmtp': ['Local Mail Transfer Protocol', 24, false],
  'loki': ['Grafana Loki Log Aggregation', 3100, false],
  'lpd': ['Line Printer Daemon', 515, false],
  'lsp': ['Language Server Protocol', null, false],
  'managesieve': ['ManageSieve Protocol', 4190, false],
  'matrix': ['Matrix Communication Protocol', 8448, false],
  'maxdb': ['SAP MaxDB Database', 7210, false],
  'mdns': ['Multicast DNS', 5353, false],
  'meilisearch': ['Meilisearch Search Engine', 7700, false],
  'memcached': ['Memcached Cache Server', 11211, false],
  'mgcp': ['Media Gateway Control Protocol', 2427, false],
  'minecraft': ['Minecraft Server', 25565, false],
  'mms': ['Manufacturing Message Specification', 102, false],
  'modbus': ['Modbus TCP Industrial Protocol', 502, false],
  'mongodb': ['MongoDB Database', 27017, false],
  'mpd': ['Music Player Daemon', 6600, false],
  'mqtt': ['Message Queuing Telemetry Transport', 1883, false],
  'msn': ['MSN Messenger Protocol', 1863, false],
  'msrp': ['Message Session Relay Protocol', 2855, false],
  'mumble': ['Mumble Voice Chat', 64738, false],
  'munin': ['Munin Monitoring', 4949, false],
  'mysql': ['MySQL Database', 3306, true],
  'napster': ['Napster/OpenNAP Protocol', 8888, false],
  'nats': ['NATS Messaging System', 4222, false],
  'nbd': ['Network Block Device', 10809, false],
  'neo4j': ['Neo4j Graph Database', 7687, false],
  'netbios': ['NetBIOS Name Service', 137, false],
  'nfs': ['Network File System', 2049, false],
  'nntp': ['Network News Transfer Protocol', 119, false],
  'nntps': ['NNTP over TLS', 563, false],
  'node-inspector': ['Node.js Inspector Protocol', 9229, false],
  'nomad': ['HashiCorp Nomad', 4646, false],
  'nrpe': ['Nagios Remote Plugin Executor', 5666, false],
  'nsca': ['Nagios Service Check Acceptor', 5667, false],
  'nsq': ['NSQ Messaging Platform', 4150, false],
  'ntp': ['Network Time Protocol', 123, true],
  'opcua': ['OPC Unified Architecture', 4840, false],
  'openflow': ['OpenFlow SDN Protocol', 6653, false],
  'opentsdb': ['OpenTSDB Time Series Database', 4242, false],
  'openvpn': ['OpenVPN', 1194, false],
  'oracle': ['Oracle Database', 1521, false],
  'oracle-tns': ['Oracle TNS Listener', 1521, false],
  'oscar': ['Open System for Communication in Realtime (AIM/ICQ)', 5190, false],
  'pcep': ['Path Computation Element Protocol', 4189, false],
  'perforce': ['Perforce Version Control', 1666, false],
  'pjlink': ['PJLink Projector Control', 4352, false],
  'pop3': ['Post Office Protocol v3', 110, false],
  'pop3s': ['POP3 over TLS', 995, false],
  'portmapper': ['ONC RPC Portmapper', 111, false],
  'postgres': ['PostgreSQL Database', 5432, true],
  'pptp': ['Point-to-Point Tunneling Protocol', 1723, false],
  'prometheus': ['Prometheus Monitoring', 9090, false],
  'qotd': ['Quote of the Day (RFC 865)', 17, false],
  'quake3': ['Quake 3 Arena Server', 27960, false],
  'rabbitmq': ['RabbitMQ Management API', 15672, false],
  'radius': ['Remote Authentication Dial-In User Service', 1812, false],
  'radsec': ['RADIUS over TLS', 2083, false],
  'rcon': ['Remote Console (Valve/Source)', 27015, false],
  'rdp': ['Remote Desktop Protocol', 3389, false],
  'realaudio': ['RealAudio/RTSP Streaming', 554, false],
  'redis': ['Redis In-Memory Data Store', 6379, true],
  'relp': ['Reliable Event Logging Protocol', 2514, false],
  'rethinkdb': ['RethinkDB Database', 28015, false],
  'rexec': ['Remote Execution (RFC 512)', 512, false],
  'riak': ['Riak KV Database', 8087, false],
  'rip': ['Routing Information Protocol', 520, false],
  'rlogin': ['Remote Login', 513, false],
  'rmi': ['Java Remote Method Invocation', 1099, false],
  'rserve': ['R Statistical Computing Server', 6311, false],
  'rsh': ['Remote Shell', 514, false],
  'rsync': ['Rsync File Sync', 873, false],
  'rtmp': ['Real-Time Messaging Protocol', 1935, false],
  'rtsp': ['Real Time Streaming Protocol', 554, false],
  's7comm': ['Siemens S7 Communication', 102, false],
  'sane': ['Scanner Access Now Easy', 6566, false],
  'sccp': ['Skinny Client Control Protocol', 2000, false],
  'scp': ['Secure Copy Protocol', 22, false],
  'sentinel': ['Redis Sentinel', 26379, false],
  'sftp': ['SSH File Transfer Protocol', 22, false],
  'shadowsocks': ['Shadowsocks Proxy', 8388, false],
  'shoutcast': ['SHOUTcast Streaming', 8000, false],
  'sip': ['Session Initiation Protocol', 5060, false],
  'sips': ['SIP over TLS', 5061, false],
  'slp': ['Service Location Protocol', 427, false],
  'smb': ['Server Message Block', 445, false],
  'smpp': ['Short Message Peer-to-Peer', 2775, false],
  'smtp': ['Simple Mail Transfer Protocol', 25, true],
  'smtps': ['SMTP over TLS', 465, false],
  'snmp': ['Simple Network Management Protocol', 161, false],
  'snpp': ['Simple Network Paging Protocol', 444, false],
  'soap': ['Simple Object Access Protocol', null, false],
  'socks4': ['SOCKS v4 Proxy', 1080, false],
  'socks5': ['SOCKS v5 Proxy', 1080, false],
  'solr': ['Apache Solr Search', 8983, false],
  'sonic': ['Sonic Search Backend', 1491, false],
  'spamd': ['SpamAssassin Daemon', 783, false],
  'spdy': ['SPDY Protocol / HTTP/2 Probe', 443, false],
  'spice': ['Simple Protocol for Independent Computing Environments', 5900, false],
  'ssh': ['Secure Shell', 22, true],
  'stomp': ['Simple Text Oriented Messaging Protocol', 61613, false],
  'stun': ['Session Traversal Utilities for NAT', 3478, false],
  'submission': ['Mail Submission (RFC 4409)', 587, false],
  'svn': ['Subversion', 3690, false],
  'sybase': ['Sybase/SAP ASE Database', 5000, false],
  'syslog': ['System Logging Protocol', 514, false],
  'tacacs': ['Terminal Access Controller Access-Control System Plus', 49, false],
  'tarantool': ['Tarantool Database', 3301, false],
  'tcp': ['Raw TCP Connection', null, true],
  'tds': ['Tabular Data Stream (SQL Server)', 1433, false],
  'teamspeak': ['TeamSpeak Voice Server', 10011, false],
  'telnet': ['Telnet Protocol', 23, false],
  'thrift': ['Apache Thrift RPC', 9090, false],
  'time': ['Time Protocol (RFC 868)', 37, false],
  'torcontrol': ['Tor Control Protocol', 9051, false],
  'turn': ['Traversal Using Relays around NAT', 3478, false],
  'uucp': ['Unix-to-Unix Copy', 540, false],
  'uwsgi': ['uWSGI Application Server', 3031, false],
  'varnish': ['Varnish Cache Admin', 6082, false],
  'vault': ['HashiCorp Vault', 8200, false],
  'ventrilo': ['Ventrilo Voice Chat', 3784, false],
  'vnc': ['Virtual Network Computing', 5900, false],
  'websocket': ['WebSocket Protocol', 80, true],
  'whois': ['WHOIS Directory Service', 43, true],
  'winrm': ['Windows Remote Management', 5985, false],
  'x11': ['X Window System', 6000, false],
  'xmpp': ['Extensible Messaging and Presence Protocol', 5222, false],
  'xmpps2s': ['XMPP Server-to-Server', 5269, false],
  'ymsg': ['Yahoo Messenger Protocol', 5050, false],
  'zabbix': ['Zabbix Monitoring Agent', 10050, false],
  'zmtp': ['ZeroMQ Message Transport Protocol', 5555, false],
  'zookeeper': ['Apache ZooKeeper', 2181, false],
};

// --- Step 3: Merge and generate ---
const entries: string[] = [];
const missing: string[] = [];

for (const [proto, endpoints] of [...protocols.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const meta = META[proto];
  if (!meta) {
    missing.push(proto);
    continue;
  }
  const [fullName, defaultPort, shortRoute] = meta;
  const name = proto.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('-')
    .replace(/^Ssh$/, 'SSH').replace(/^Ftp/, 'FTP').replace(/^Http/, 'HTTP')
    .replace(/^Dns$/, 'DNS').replace(/^Tcp$/, 'TCP').replace(/^Ntp$/, 'NTP')
    .replace(/^Smtp$/, 'SMTP').replace(/^Irc$/, 'IRC').replace(/^Mqtt$/, 'MQTT')
    .replace(/^Ldap/, 'LDAP').replace(/^Smb$/, 'SMB').replace(/^Vnc$/, 'VNC')
    .replace(/^Rdp$/, 'RDP').replace(/^Nfs$/, 'NFS').replace(/^Snmp$/, 'SNMP');
  // Use the display name from meta fullName's short form, or derive from proto
  const displayName = fullName.includes('(') ? fullName.split('(')[0].trim().split(' ').pop()! : name;

  const endpointStr = endpoints.map(e => `'${e}'`).join(', ');
  entries.push(`  '${proto}': { name: '${displayName}', fullName: '${fullName}', defaultPort: ${defaultPort}, shortRoute: ${shortRoute}, endpoints: [${endpointStr}] },`);
}

if (missing.length > 0) {
  console.warn(`\n⚠ ${missing.length} protocols found in index.ts but missing from META table:`);
  for (const p of missing) {
    console.warn(`  '${p}': ['TODO Full Name', null, false],`);
  }
  console.warn('Add them to scripts/generate-manpages.ts META table.\n');
}

const output = `/**
 * Protocol manpage registry — AUTO-GENERATED.
 * Do not edit this file directly. Run: npx tsx scripts/generate-manpages.ts
 *
 * Generated from ${protocols.size} protocols, ${[...protocols.values()].reduce((a, b) => a + b.length, 0)} endpoints
 * at ${new Date().toISOString()}
 */

export interface ProtocolManpage {
  name: string;
  fullName: string;
  defaultPort: number | null;
  shortRoute: boolean;
  endpoints: string[];
}

const MANPAGES: Record<string, ProtocolManpage> = {
${entries.join('\n')}
};

export function getManpage(protocol: string): ProtocolManpage | undefined {
  return MANPAGES[protocol.toLowerCase()];
}

export function isKnownProtocol(protocol: string): boolean {
  return protocol.toLowerCase() in MANPAGES;
}
`;

const outPath = join(ROOT, 'src/worker/manpages.ts');
writeFileSync(outPath, output);
console.log(`✓ Generated ${outPath}`);
console.log(`  ${protocols.size} protocols, ${[...protocols.values()].reduce((a, b) => a + b.length, 0)} endpoints`);
