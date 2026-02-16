import { useState, lazy, Suspense } from 'react';
import './App.css';
import ProtocolSelector from './components/ProtocolSelector';
import ThemeToggle from './components/ThemeToggle';
import { useTheme } from './contexts/ThemeContext';

// Lazy load all protocol clients for better performance
const EchoClient = lazy(() => import('./components/EchoClient'));
const WhoisClient = lazy(() => import('./components/WhoisClient'));
const SyslogClient = lazy(() => import('./components/SyslogClient'));
const Socks4Client = lazy(() => import('./components/Socks4Client'));
const DaytimeClient = lazy(() => import('./components/DaytimeClient'));
const FingerClient = lazy(() => import('./components/FingerClient'));
const TimeClient = lazy(() => import('./components/TimeClient'));
const ChargenClient = lazy(() => import('./components/ChargenClient'));
const GeminiClient = lazy(() => import('./components/GeminiClient'));
const FTPClient = lazy(() => import('./components/FTPClient'));
const SSHClient = lazy(() => import('./components/SSHClient'));
const TelnetClient = lazy(() => import('./components/TelnetClient'));
const SMTPClient = lazy(() => import('./components/SMTPClient'));
const SubmissionClient = lazy(() => import('./components/SubmissionClient'));
const POP3Client = lazy(() => import('./components/POP3Client'));
const IMAPClient = lazy(() => import('./components/IMAPClient'));
const MySQLClient = lazy(() => import('./components/MySQLClient'));
const PostgreSQLClient = lazy(() => import('./components/PostgreSQLClient'));
const RedisClient = lazy(() => import('./components/RedisClient'));
const MQTTClient = lazy(() => import('./components/MQTTClient'));
const LDAPClient = lazy(() => import('./components/LDAPClient'));
const LDAPSClient = lazy(() => import('./components/LDAPSClient'));
const SMBClient = lazy(() => import('./components/SMBClient'));
const IRCClient = lazy(() => import('./components/IRCClient'));
const IRCSClient = lazy(() => import('./components/IRCSClient'));
const GopherClient = lazy(() => import('./components/GopherClient'));
const MemcachedClient = lazy(() => import('./components/MemcachedClient'));
const DNSClient = lazy(() => import('./components/DNSClient'));
const StompClient = lazy(() => import('./components/StompClient'));
const Socks5Client = lazy(() => import('./components/Socks5Client'));
const ModbusClient = lazy(() => import('./components/ModbusClient'));
const MongoDBClient = lazy(() => import('./components/MongoDBClient'));
const GraphiteClient = lazy(() => import('./components/GraphiteClient'));
const GitClient = lazy(() => import('./components/GitClient'));
const ZooKeeperClient = lazy(() => import('./components/ZooKeeperClient'));
const AMQPClient = lazy(() => import('./components/AMQPClient'));
const CassandraClient = lazy(() => import('./components/CassandraClient'));
const KafkaClient = lazy(() => import('./components/KafkaClient'));
const RtspClient = lazy(() => import('./components/RtspClient'));
const RsyncClient = lazy(() => import('./components/RsyncClient'));
const TDSClient = lazy(() => import('./components/TDSClient'));
const VNCClient = lazy(() => import('./components/VNCClient'));
const SPICEClient = lazy(() => import('./components/SPICEClient'));
const Neo4jClient = lazy(() => import('./components/Neo4jClient'));
const RTMPClient = lazy(() => import('./components/RTMPClient'));
const TacacsClient = lazy(() => import('./components/TacacsClient'));
const HL7Client = lazy(() => import('./components/HL7Client'));
const ElasticsearchClient = lazy(() => import('./components/ElasticsearchClient'));
const AJPClient = lazy(() => import('./components/AJPClient'));
const RCONClient = lazy(() => import('./components/RCONClient'));
const NNTPClient = lazy(() => import('./components/NNTPClient'));
const RDPClient = lazy(() => import('./components/RDPClient'));
const XMPPClient = lazy(() => import('./components/XMPPClient'));
const NATSClient = lazy(() => import('./components/NATSClient'));
const JetDirectClient = lazy(() => import('./components/JetDirectClient'));
const FastCGIClient = lazy(() => import('./components/FastCGIClient'));
const DiameterClient = lazy(() => import('./components/DiameterClient'));
const EtcdClient = lazy(() => import('./components/EtcdClient'));
const ConsulClient = lazy(() => import('./components/ConsulClient'));
const InfluxDBClient = lazy(() => import('./components/InfluxDBClient'));
const BGPClient = lazy(() => import('./components/BGPClient'));
const DockerClient = lazy(() => import('./components/DockerClient'));
const PPTPClient = lazy(() => import('./components/PPTPClient'));
const DICOMClient = lazy(() => import('./components/DICOMClient'));
const JsonRpcClient = lazy(() => import('./components/JsonRpcClient'));
const ThriftClient = lazy(() => import('./components/ThriftClient'));
const SLPClient = lazy(() => import('./components/SLPClient'));
const BitTorrentClient = lazy(() => import('./components/BitTorrentClient'));
const X11Client = lazy(() => import('./components/X11Client'));
const NinePClient = lazy(() => import('./components/NinePClient'));
const KerberosClient = lazy(() => import('./components/KerberosClient'));
const SCCPClient = lazy(() => import('./components/SCCPClient'));
const MatrixClient = lazy(() => import('./components/MatrixClient'));
const ISCSIClient = lazy(() => import('./components/ISCSIClient'));
const WebSocketClient = lazy(() => import('./components/WebSocketClient'));
const H323Client = lazy(() => import('./components/H323Client'));
const DoTClient = lazy(() => import('./components/DoTClient'));
const SOAPClient = lazy(() => import('./components/SOAPClient'));
const OpenVPNClient = lazy(() => import('./components/OpenVPNClient'));
const AFPClient = lazy(() => import('./components/AFPClient'));
const NFSClient = lazy(() => import('./components/NFSClient'));
const MGCPClient = lazy(() => import('./components/MGCPClient'));
const FTPSClient = lazy(() => import('./components/FTPSClient'));
const DICTClient = lazy(() => import('./components/DICTClient'));
const SIPClient = lazy(() => import('./components/SIPClient'));
const QOTDClient = lazy(() => import('./components/QOTDClient'));
const LPDClient = lazy(() => import('./components/LPDClient'));
const DiscardClient = lazy(() => import('./components/DiscardClient'));
const MinecraftClient = lazy(() => import('./components/MinecraftClient'));
const ZabbixClient = lazy(() => import('./components/ZabbixClient'));
const IdentClient = lazy(() => import('./components/IdentClient'));
const OracleTNSClient = lazy(() => import('./components/OracleTNSClient'));
const MPDClient = lazy(() => import('./components/MPDClient'));
const BeanstalkdClient = lazy(() => import('./components/BeanstalkdClient'));
const ClamAVClient = lazy(() => import('./components/ClamAVClient'));
const LMTPClient = lazy(() => import('./components/LMTPClient'));
const ManageSieveClient = lazy(() => import('./components/ManageSieveClient'));
const CouchDBClient = lazy(() => import('./components/CouchDBClient'));
const IPPClient = lazy(() => import('./components/IPPClient'));
const SMPPClient = lazy(() => import('./components/SMPPClient'));
const SVNClient = lazy(() => import('./components/SVNClient'));
const TeamSpeakClient = lazy(() => import('./components/TeamSpeakClient'));
const RadiusClient = lazy(() => import('./components/RadiusClient'));
const NRPEClient = lazy(() => import('./components/NRPEClient'));
const RloginClient = lazy(() => import('./components/RloginClient'));
const S7commClient = lazy(() => import('./components/S7commClient'));
const SNPPClient = lazy(() => import('./components/SNPPClient'));
const RethinkDBClient = lazy(() => import('./components/RethinkDBClient'));
const ClickHouseClient = lazy(() => import('./components/ClickHouseClient'));
const GearmanClient = lazy(() => import('./components/GearmanClient'));
const EtherNetIPClient = lazy(() => import('./components/EtherNetIPClient'));
const PrometheusClient = lazy(() => import('./components/PrometheusClient'));
const PortmapperClient = lazy(() => import('./components/PortmapperClient'));
const RelpClient = lazy(() => import('./components/RelpClient'));
const ADBClient = lazy(() => import('./components/ADBClient'));
const DNP3Client = lazy(() => import('./components/DNP3Client'));
const STUNClient = lazy(() => import('./components/STUNClient'));
const FluentdClient = lazy(() => import('./components/FluentdClient'));
const RexecClient = lazy(() => import('./components/RexecClient'));
const FIXClient = lazy(() => import('./components/FIXClient'));
const AerospikeClient = lazy(() => import('./components/AerospikeClient'));
const EPMDClient = lazy(() => import('./components/EPMDClient'));
const TarantoolClient = lazy(() => import('./components/TarantoolClient'));
const VaultClient = lazy(() => import('./components/VaultClient'));
const SolrClient = lazy(() => import('./components/SolrClient'));
const IEC104Client = lazy(() => import('./components/IEC104Client'));
const RiakClient = lazy(() => import('./components/RiakClient'));
const OpenTSDBClient = lazy(() => import('./components/OpenTSDBClient'));
const BitcoinNodeClient = lazy(() => import('./components/BitcoinClient'));
const SpamAssassinClient = lazy(() => import('./components/SpamAssassinClient'));
const NSQClient = lazy(() => import('./components/NSQClient'));
const OPCUAClient = lazy(() => import('./components/OPCUAClient'));
const ZMTPClient = lazy(() => import('./components/ZMTPClient'));
const MuninClient = lazy(() => import('./components/MuninClient'));
const SANEClient = lazy(() => import('./components/SANEClient'));
const CephClient = lazy(() => import('./components/CephClient'));
const HTTPProxyClient = lazy(() => import('./components/HTTPProxyClient'));
const VarnishClient = lazy(() => import('./components/VarnishClient'));
const FINSClient = lazy(() => import('./components/FINSClient'));
const CouchbaseClient = lazy(() => import('./components/CouchbaseClient'));
const AMIClient = lazy(() => import('./components/AMIClient'));
const JDWPClient = lazy(() => import('./components/JDWPClient'));
const DRDAClient = lazy(() => import('./components/DRDAClient'));
const LivestatusClient = lazy(() => import('./components/LivestatusClient'));
const DCERPCClient = lazy(() => import('./components/DCERPCClient'));
const NSCAClient = lazy(() => import('./components/NSCAClient'));
const PJLinkClient = lazy(() => import('./components/PJLinkClient'));
const IMAPSClient = lazy(() => import('./components/IMAPSClient'));
const IcecastClient = lazy(() => import('./components/IcecastClient'));
const LokiClient = lazy(() => import('./components/LokiClient'));
const MeilisearchClient = lazy(() => import('./components/MeilisearchClient'));
const OpenFlowClient = lazy(() => import('./components/OpenFlowClient'));
const HAProxyClient = lazy(() => import('./components/HAProxyClient'));
const RMIClient = lazy(() => import('./components/RMIClient'));
const NBDClient = lazy(() => import('./components/NBDClient'));
const GangliaClient = lazy(() => import('./components/GangliaClient'));
const NetBIOSClient = lazy(() => import('./components/NetBIOSClient'));
const POP3SClient = lazy(() => import('./components/POP3SClient'));
const SMTPSClient = lazy(() => import('./components/SMTPSClient'));
const PCEPClient = lazy(() => import('./components/PCEPClient'));
const UWSGIClient = lazy(() => import('./components/UWSGIClient'));
const TorControlClient = lazy(() => import('./components/TorControlClient'));
const WinRMClient = lazy(() => import('./components/WinRMClient'));
const KibanaClient = lazy(() => import('./components/KibanaClient'));
const GrafanaClient = lazy(() => import('./components/GrafanaClient'));
const GPSDClient = lazy(() => import('./components/GPSDClient'));
const RserveClient = lazy(() => import('./components/RserveClient'));
const SentinelClient = lazy(() => import('./components/SentinelClient'));
const RabbitMQClient = lazy(() => import('./components/RabbitMQClient'));
const CVSClient = lazy(() => import('./components/CVSClient'));
const AMQPSClient = lazy(() => import('./components/AMQPSClient'));
const NNTPSClient = lazy(() => import('./components/NNTPSClient'));
const SonicClient = lazy(() => import('./components/SonicClient'));
const NomadClient = lazy(() => import('./components/NomadClient'));
const LDPClient = lazy(() => import('./components/LDPClient'));
const FirebirdClient = lazy(() => import('./components/FirebirdClient'));
const HazelcastClient = lazy(() => import('./components/HazelcastClient'));
const IgniteClient = lazy(() => import('./components/IgniteClient'));
type Protocol =
  | 'echo'
  | 'whois'
  | 'syslog'
  | 'socks4'
  | 'daytime'
  | 'finger'
  | 'time'
  | 'chargen'
  | 'gemini'
  | 'ftp'
  | 'ssh'
  | 'telnet'
  | 'smtp'
  | 'submission'
  | 'pop3'
  | 'imap'
  | 'mysql'
  | 'postgres'
  | 'redis'
  | 'mqtt'
  | 'ldap'
  | 'ldaps'
  | 'smb'
  | 'irc'
  | 'ircs'
  | 'gopher'
  | 'memcached'
  | 'dns'
  | 'stomp'
  | 'socks5'
  | 'modbus'
  | 'mongodb'
  | 'graphite'
  | 'git'
  | 'zookeeper'
  | 'amqp'
  | 'cassandra'
  | 'kafka'
  | 'rtsp'
  | 'rsync'
  | 'tds'
  | 'vnc'
  | 'spice'
  | 'neo4j'
  | 'rtmp'
  | 'tacacs'
  | 'hl7'
  | 'elasticsearch'
  | 'ajp'
  | 'rcon'
  | 'nntp'
  | 'rdp'
  | 'xmpp'
  | 'nats'
  | 'jetdirect'
  | 'fastcgi'
  | 'diameter'
  | 'etcd'
  | 'consul'
  | 'influxdb'
  | 'bgp'
  | 'docker'
  | 'pptp'
  | 'dicom'
  | 'jsonrpc'
  | 'thrift'
  | 'slp'
  | '9p'
  | 'bittorrent'
  | 'x11'
  | 'kerberos'
  | 'sccp'
  | 'matrix'
  | 'iscsi'
  | 'websocket'
  | 'h323'
  | 'dot'
  | 'soap'
  | 'openvpn'
  | 'afp'
  | 'nfs'
  | 'mgcp'
  | 'ftps'
  | 'dict'
  | 'sip'
  | 'qotd'
  | 'lpd'
  | 'discard'
  | 'minecraft'
  | 'zabbix'
  | 'ident'
  | 'oracle-tns'
  | 'mpd'
  | 'beanstalkd'
  | 'clamav'
  | 'lmtp'
  | 'managesieve'
  | 'couchdb'
  | 'ipp'
  | 'smpp'
  | 'svn'
  | 'teamspeak'
  | 'radius'
  | 'nrpe'
  | 'rlogin'
  | 's7comm'
  | 'snpp'
  | 'rethinkdb'
  | 'clickhouse'
  | 'gearman'
  | 'ethernetip'
  | 'prometheus'
  | 'portmapper'
  | 'relp'
  | 'adb'
  | 'dnp3'
  | 'fluentd'
  | 'stun'
  | 'rexec'
  | 'fix'
  | 'aerospike'
  | 'epmd'
  | 'tarantool'
  | 'vault'
  | 'solr'
  | 'iec104'
  | 'riak'
  | 'opentsdb'
  | 'bitcoin'
  | 'spamd'
  | 'nsq'
  | 'opcua'
  | 'zmtp'
  | 'munin'
  | 'sane'
  | 'ceph'
  | 'httpproxy'
  | 'varnish'
  | 'fins'
  | 'couchbase'
  | 'ami'
  | 'jdwp'
  | 'drda'
  | 'livestatus'
  | 'dcerpc'
  | 'nsca'
  | 'pjlink'
  | 'imaps'
  | 'icecast'
  | 'loki'
  | 'openflow'
  | 'meilisearch'
  | 'haproxy'
  | 'rmi'
  | 'nbd'
  | 'ganglia'
  | 'netbios'
  | 'pop3s'
  | 'smtps'
  | 'pcep'
  | 'winrm'
  | 'uwsgi'
  | 'torcontrol'
  | 'kibana'
  | 'grafana'
  | 'gpsd'
  | 'rserve'
  | 'sentinel'
  | 'nntps'
  | 'sonic'
  | 'rabbitmq'
  | 'cvs'
  | 'amqps'
  | 'nomad'
  | 'ircs'
  | 'ldp-mpls'
  | 'firebird'
  | 'hazelcast'
  | 'ignite'
  | null;

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-12 text-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          ></div>
          <p className="text-slate-300 text-lg">Loading protocol client...</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol>(null);
  const { theme } = useTheme();

  const renderProtocolClient = () => {
    const handleBack = () => setSelectedProtocol(null);

    switch (selectedProtocol) {
      case 'echo':
        return <EchoClient onBack={handleBack} />;
      case 'whois':
        return <WhoisClient onBack={handleBack} />;
      case 'syslog':
        return <SyslogClient onBack={handleBack} />;
      case 'socks4':
        return <Socks4Client onBack={handleBack} />;
      case 'daytime':
        return <DaytimeClient onBack={handleBack} />;
      case 'finger':
        return <FingerClient onBack={handleBack} />;
      case 'time':
        return <TimeClient onBack={handleBack} />;
      case 'chargen':
        return <ChargenClient onBack={handleBack} />;
      case 'gemini':
        return <GeminiClient onBack={handleBack} />;
      case 'ftp':
        return <FTPClient onBack={handleBack} />;
      case 'ssh':
        return <SSHClient onBack={handleBack} />;
      case 'telnet':
        return <TelnetClient onBack={handleBack} />;
      case 'smtp':
        return <SMTPClient onBack={handleBack} />;
      case 'submission':
        return <SubmissionClient onBack={handleBack} />;
      case 'pop3':
        return <POP3Client onBack={handleBack} />;
      case 'imap':
        return <IMAPClient onBack={handleBack} />;
      case 'mysql':
        return <MySQLClient onBack={handleBack} />;
      case 'postgres':
        return <PostgreSQLClient onBack={handleBack} />;
      case 'redis':
        return <RedisClient onBack={handleBack} />;
      case 'mqtt':
        return <MQTTClient onBack={handleBack} />;
      case 'ldap':
        return <LDAPClient onBack={handleBack} />;
      case 'ldaps':
        return <LDAPSClient onBack={handleBack} />;
      case 'smb':
        return <SMBClient onBack={handleBack} />;
      case 'irc':
        return <IRCClient onBack={handleBack} />;
      case 'ircs':
        return <IRCSClient onBack={handleBack} />;
      case 'gopher':
        return <GopherClient onBack={handleBack} />;
      case 'memcached':
        return <MemcachedClient onBack={handleBack} />;
      case 'dns':
        return <DNSClient onBack={handleBack} />;
      case 'stomp':
        return <StompClient onBack={handleBack} />;
      case 'socks5':
        return <Socks5Client onBack={handleBack} />;
      case 'modbus':
        return <ModbusClient onBack={handleBack} />;
      case 'mongodb':
        return <MongoDBClient onBack={handleBack} />;
      case 'graphite':
        return <GraphiteClient onBack={handleBack} />;
      case 'git':
        return <GitClient onBack={handleBack} />; // eslint-disable-line
      case 'zookeeper':
        return <ZooKeeperClient onBack={handleBack} />;
      case 'amqp':
        return <AMQPClient onBack={handleBack} />;
      case 'cassandra':
        return <CassandraClient onBack={handleBack} />;
      case 'kafka':
        return <KafkaClient onBack={handleBack} />;
      case 'rtsp':
        return <RtspClient onBack={handleBack} />;
      case 'rsync':
        return <RsyncClient onBack={handleBack} />;
      case 'tds':
        return <TDSClient onBack={handleBack} />;
      case 'vnc':
        return <VNCClient onBack={handleBack} />;
      case 'spice':
        return <SPICEClient onBack={handleBack} />;
      case 'neo4j':
        return <Neo4jClient onBack={handleBack} />;
      case 'rtmp':
        return <RTMPClient onBack={handleBack} />;
      case 'tacacs':
        return <TacacsClient onBack={handleBack} />;
      case 'hl7':
        return <HL7Client onBack={handleBack} />;
      case 'elasticsearch':
        return <ElasticsearchClient onBack={handleBack} />;
      case 'ajp':
        return <AJPClient onBack={handleBack} />;
      case 'rcon':
        return <RCONClient onBack={handleBack} />;
      case 'nntp':
        return <NNTPClient onBack={handleBack} />;
      case 'rdp':
        return <RDPClient onBack={handleBack} />;
      case 'xmpp':
        return <XMPPClient onBack={handleBack} />;
      case 'nats':
        return <NATSClient onBack={handleBack} />;
      case 'jetdirect':
        return <JetDirectClient onBack={handleBack} />;
      case 'fastcgi':
        return <FastCGIClient onBack={handleBack} />;
      case 'diameter':
        return <DiameterClient onBack={handleBack} />;
      case 'etcd':
        return <EtcdClient onBack={handleBack} />;
      case 'consul':
        return <ConsulClient onBack={handleBack} />;
      case 'influxdb':
        return <InfluxDBClient onBack={handleBack} />;
      case 'bgp':
        return <BGPClient onBack={handleBack} />;
      case 'docker':
        return <DockerClient onBack={handleBack} />;
      case 'pptp':
        return <PPTPClient onBack={handleBack} />;
      case 'dicom':
        return <DICOMClient onBack={handleBack} />;
      case 'jsonrpc':
        return <JsonRpcClient onBack={handleBack} />;
      case 'thrift':
        return <ThriftClient onBack={handleBack} />;
      case 'slp':
        return <SLPClient onBack={handleBack} />;
      case 'bittorrent':
        return <BitTorrentClient onBack={handleBack} />;
      case 'x11':
        return <X11Client onBack={handleBack} />;
      case '9p':
        return <NinePClient onBack={handleBack} />;
      case 'kerberos':
        return <KerberosClient onBack={handleBack} />;
      case 'sccp':
        return <SCCPClient onBack={handleBack} />;
      case 'matrix':
        return <MatrixClient onBack={handleBack} />;
      case 'iscsi':
        return <ISCSIClient onBack={handleBack} />;
      case 'websocket':
        return <WebSocketClient onBack={handleBack} />;
      case 'h323':
        return <H323Client onBack={handleBack} />;
      case 'dot':
        return <DoTClient onBack={handleBack} />;
      case 'soap':
        return <SOAPClient onBack={handleBack} />;
      case 'openvpn':
        return <OpenVPNClient onBack={handleBack} />;
      case 'afp':
        return <AFPClient onBack={handleBack} />;
      case 'nfs':
        return <NFSClient onBack={handleBack} />;
      case 'mgcp':
        return <MGCPClient onBack={handleBack} />;
      case 'ftps':
        return <FTPSClient onBack={handleBack} />;
      case 'dict':
        return <DICTClient onBack={handleBack} />;
      case 'sip':
        return <SIPClient onBack={handleBack} />;
      case 'qotd':
        return <QOTDClient onBack={handleBack} />;
      case 'lpd':
        return <LPDClient onBack={handleBack} />;
      case 'discard':
        return <DiscardClient onBack={handleBack} />;
      case 'minecraft':
        return <MinecraftClient onBack={handleBack} />;
      case 'zabbix':
        return <ZabbixClient onBack={handleBack} />;
      case 'ident':
        return <IdentClient onBack={handleBack} />;
      case 'oracle-tns':
        return <OracleTNSClient onBack={handleBack} />;
      case 'mpd':
        return <MPDClient onBack={handleBack} />;
      case 'beanstalkd':
        return <BeanstalkdClient onBack={handleBack} />;
      case 'clamav':
        return <ClamAVClient onBack={handleBack} />;
      case 'lmtp':
        return <LMTPClient onBack={handleBack} />;
      case 'managesieve':
        return <ManageSieveClient onBack={handleBack} />;
      case 'couchdb':
        return <CouchDBClient onBack={handleBack} />;
      case 'ipp':
        return <IPPClient onBack={handleBack} />;
      case 'svn':
        return <SVNClient onBack={handleBack} />;
      case 'smpp':
        return <SMPPClient onBack={handleBack} />;
      case 'teamspeak':
        return <TeamSpeakClient onBack={handleBack} />;
      case 'radius':
        return <RadiusClient onBack={handleBack} />;
      case 'nrpe':
        return <NRPEClient onBack={handleBack} />;
      case 'rlogin':
        return <RloginClient onBack={handleBack} />;
      case 's7comm':
        return <S7commClient onBack={handleBack} />;
      case 'snpp':
        return <SNPPClient onBack={handleBack} />;
      case 'rethinkdb':
        return <RethinkDBClient onBack={handleBack} />;
      case 'clickhouse':
        return <ClickHouseClient onBack={handleBack} />;
      case 'gearman':
        return <GearmanClient onBack={handleBack} />;
      case 'ethernetip':
        return <EtherNetIPClient onBack={handleBack} />;
      case 'prometheus':
        return <PrometheusClient onBack={handleBack} />;
      case 'portmapper':
        return <PortmapperClient onBack={handleBack} />;
      case 'relp':
        return <RelpClient onBack={handleBack} />;
      case 'adb':
        return <ADBClient onBack={handleBack} />;
      case 'dnp3':
        return <DNP3Client onBack={handleBack} />;
      case 'fluentd':
        return <FluentdClient onBack={handleBack} />;
      case 'stun':
        return <STUNClient onBack={handleBack} />;
      case 'rexec':
        return <RexecClient onBack={handleBack} />;
      case 'fix':
        return <FIXClient onBack={handleBack} />;
      case 'aerospike':
        return <AerospikeClient onBack={handleBack} />;
      case 'epmd':
        return <EPMDClient onBack={handleBack} />;
      case 'tarantool':
        return <TarantoolClient onBack={handleBack} />;
      case 'vault':
        return <VaultClient onBack={handleBack} />;
      case 'solr':
        return <SolrClient onBack={handleBack} />;
      case 'iec104':
        return <IEC104Client onBack={handleBack} />;
      case 'riak':
        return <RiakClient onBack={handleBack} />;
      case 'opentsdb':
        return <OpenTSDBClient onBack={handleBack} />;
      case 'bitcoin':
        return <BitcoinNodeClient onBack={handleBack} />;
      case 'spamd':
        return <SpamAssassinClient onBack={handleBack} />;
      case 'nsq':
        return <NSQClient onBack={handleBack} />;
      case 'opcua':
        return <OPCUAClient onBack={handleBack} />;
      case 'zmtp':
        return <ZMTPClient onBack={handleBack} />;
      case 'munin':
        return <MuninClient onBack={handleBack} />;
      case 'sane':
        return <SANEClient onBack={handleBack} />;
      case 'ceph':
        return <CephClient onBack={handleBack} />;
      case 'httpproxy':
        return <HTTPProxyClient onBack={handleBack} />;
      case 'varnish':
        return <VarnishClient onBack={handleBack} />;
      case 'fins':
        return <FINSClient onBack={handleBack} />;
      case 'couchbase':
        return <CouchbaseClient onBack={handleBack} />;
      case 'ami':
        return <AMIClient onBack={handleBack} />;
      case 'jdwp':
        return <JDWPClient onBack={handleBack} />;
      case 'drda':
        return <DRDAClient onBack={handleBack} />;
      case 'livestatus':
        return <LivestatusClient onBack={handleBack} />;
      case 'dcerpc':
        return <DCERPCClient onBack={handleBack} />;
      case 'nsca':
        return <NSCAClient onBack={handleBack} />;
      case 'imaps':
        return <IMAPSClient onBack={handleBack} />;
      case 'loki':
        return <LokiClient onBack={handleBack} />;
      case 'pjlink':
        return <PJLinkClient onBack={handleBack} />;
      case 'icecast':
        return <IcecastClient onBack={handleBack} />;
      case 'meilisearch':
        return <MeilisearchClient onBack={handleBack} />;
      case 'openflow':
        return <OpenFlowClient onBack={handleBack} />;
      case 'haproxy':
        return <HAProxyClient onBack={handleBack} />;
      case 'rmi':
        return <RMIClient onBack={handleBack} />;
      case 'nbd':
        return <NBDClient onBack={handleBack} />;
      case 'ganglia':
        return <GangliaClient onBack={handleBack} />;
      case 'netbios':
        return <NetBIOSClient onBack={handleBack} />;
      case 'pop3s':
        return <POP3SClient onBack={handleBack} />;
      case 'smtps':
        return <SMTPSClient onBack={handleBack} />;
      case 'pcep':
        return <PCEPClient onBack={handleBack} />;
      case 'winrm':
        return <WinRMClient onBack={handleBack} />;
      case 'uwsgi':
        return <UWSGIClient onBack={handleBack} />;
      case 'torcontrol':
        return <TorControlClient onBack={handleBack} />;
      case 'gpsd':
        return <GPSDClient onBack={handleBack} />;
      case 'kibana':
        return <KibanaClient onBack={handleBack} />;
      case 'grafana':
        return <GrafanaClient onBack={handleBack} />;
      case 'rserve':
        return <RserveClient onBack={handleBack} />;
      case 'sentinel':
        return <SentinelClient onBack={handleBack} />;
      case 'sonic':
        return <SonicClient onBack={handleBack} />;
      case 'nntps':
        return <NNTPSClient onBack={handleBack} />;
      case 'rabbitmq':
        return <RabbitMQClient onBack={handleBack} />;
      case 'nomad':
        return <NomadClient onBack={handleBack} />;
      case 'ircs':
        return <IRCSClient onBack={handleBack} />;
      case 'ldp-mpls':
        return <LDPClient onBack={handleBack} />;
      case 'firebird':
        return <FirebirdClient onBack={handleBack} />;
      case 'hazelcast':
        return <HazelcastClient onBack={handleBack} />;
      case 'ignite':
        return <IgniteClient onBack={handleBack} />;
      case 'cvs':
        return <CVSClient onBack={handleBack} />;
      case 'amqps':
        return <AMQPSClient onBack={handleBack} />;
      default:
        return <ProtocolSelector onSelect={setSelectedProtocol} />;
    }
  };

  return (
    <div className={`min-h-screen ${theme === 'retro' ? 'retro-screen retro-boot' : 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900'}`}>
      <ThemeToggle />
      <div className="container mx-auto px-4 py-8">
        <Suspense fallback={<LoadingFallback />}>{renderProtocolClient()}</Suspense>
      </div>
    </div>
  );
}

export default App;
