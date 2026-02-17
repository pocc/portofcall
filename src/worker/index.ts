/**
 * Port of Call - Cloudflare Worker
 *
 * A worker that leverages Cloudflare's Sockets API (released May 16, 2023)
 * to enable browser-based access to TCP protocols like SSH.
 *
 * The name "Port of Call" is a nautical pun:
 * - Literal: You're calling a port (like 22 for SSH) from the browser
 * - Metaphorical: A transitional stop where data moves between worlds
 */

import { connect } from 'cloudflare:sockets';
import {
  handleFTPConnect,
  handleFTPList,
  handleFTPUpload,
  handleFTPDownload,
  handleFTPDelete,
  handleFTPMkdir,
  handleFTPRename,
} from './ftp';
import { handleSSHConnect, handleSSHExecute, handleSSHDisconnect, handleSSHTerminal } from './ssh';
import {
  handleSFTPConnect,
  handleSFTPList,
  handleSFTPDownload,
  handleSFTPUpload,
  handleSFTPDelete,
  handleSFTPMkdir,
  handleSFTPRename,
} from './sftp';
import { handleTelnetConnect, handleTelnetWebSocket } from './telnet';
import { handleSMTPConnect, handleSMTPSend } from './smtp';
import { handleSubmissionConnect, handleSubmissionSend } from './submission';
import { handlePOP3Connect, handlePOP3List, handlePOP3Retrieve } from './pop3';
import { handleIMAPConnect, handleIMAPList, handleIMAPSelect, handleIMAPSession } from './imap';
import { handleMySQLConnect, handleMySQLQuery } from './mysql';
import { handlePostgreSQLConnect, handlePostgreSQLQuery } from './postgres';
import { handleOracleConnect } from './oracle';
import { handleMaxDBConnect } from './maxdb';
import { handleRedisConnect, handleRedisCommand, handleRedisSession } from './redis';
import { handleMQTTConnect } from './mqtt';
import { handleLDAPConnect, handleLDAPSearch, handleLDAPAdd, handleLDAPModify, handleLDAPDelete } from './ldap';
import { handleLDAPSConnect, handleLDAPSSearch, handleLDAPSAdd, handleLDAPSModify, handleLDAPSDelete } from './ldaps';
import { handleSMBConnect } from './smb';
import { handleEchoTest, handleEchoWebSocket } from './echo';
import { handleTcpSend } from './tcp';
import { handleActiveUsersTest } from './activeusers';
import { handleWhoisLookup } from './whois';
import { handleSyslogSend } from './syslog';
import { handleSocks4Connect } from './socks4';
import { handleDaytimeGet } from './daytime';
import { handleFingerQuery } from './finger';
import { handleTimeGet } from './time';
import { handleChargenStream } from './chargen';
import { handleDiscardSend } from './discard';
import { handleGaduGaduConnect } from './gadugadu';
import { handleGeminiFetch } from './gemini';
import { handleGopherFetch } from './gopher';
import { handleIRCConnect, handleIRCWebSocket } from './irc';
import { handleIRCSConnect, handleIRCSWebSocket } from './ircs';
import { handleMemcachedConnect, handleMemcachedCommand, handleMemcachedStats, handleMemcachedSession } from './memcached';
import { handleDNSQuery } from './dns';
import { handleNNTPConnect, handleNNTPGroup, handleNNTPArticle, handleNNTPList, handleNNTPPost, handleNNTPAuth } from './nntp';
import { handleStompConnect, handleStompSend, handleStompSubscribe } from './stomp';
import { handleSocks5Connect } from './socks5';
import { handleModbusConnect, handleModbusRead, handleModbusWriteCoil, handleModbusWriteRegisters } from './modbus';
import { handleMongoDBConnect, handleMongoDBPing, handleMongoDBFind, handleMongoDBInsert } from './mongodb';
import { handleGraphiteSend } from './graphite';
import { handleRCONConnect, handleRCONCommand } from './rcon';
import { handleGitRefs } from './git';
import { handleZooKeeperConnect, handleZooKeeperCommand, handleZooKeeperGet, handleZooKeeperSet, handleZooKeeperCreate } from './zookeeper';
import { handleCassandraConnect, handleCassandraQuery } from './cassandra';
import { handleAMQPConnect, handleAMQPPublish } from './amqp';
import { handleKafkaApiVersions, handleKafkaMetadata, handleKafkaProduceMessage } from './kafka';
import { handleRtspOptions, handleRtspDescribe, handleRTSPSession } from './rtsp';
import { handleRsyncConnect, handleRsyncModule } from './rsync';
import { handleTDSConnect } from './tds';
import { handleVNCConnect } from './vnc';
import { handleSPICEConnect } from './spice';
import { handleBattlenetConnect, handleBattlenetAuthInfo, handleBattlenetStatus } from './battlenet';
import { handleNeo4jConnect, handleNeo4jQuery } from './neo4j';
import { handleRTMPConnect } from './rtmp';
import { handleTacacsProbe, handleTacacsAuthenticate } from './tacacs';
import { handleHL7Connect, handleHL7Send } from './hl7';
import { handleElasticsearchHealth, handleElasticsearchQuery } from './elasticsearch';
import { handleAJPConnect, handleAJPRequest } from './ajp';
import { handleXMPPConnect, handleXMPPLogin, handleXMPPRoster, handleXMPPMessage } from './xmpp';
import { handleRDPConnect } from './rdp';
import { handleNATSConnect, handleNATSPublish, handleNATSSubscribe, handleNATSRequest } from './nats';
import { handleJetDirectConnect } from './jetdirect';
import { handleBGPConnect } from './bgp';
import { handleDiameterConnect, handleDiameterWatchdog } from './diameter';
import { handleFastCGIProbe, handleFastCGIRequest } from './fastcgi';
import { handleEtcdHealth, handleEtcdQuery } from './etcd';
import { handleConsulHealth, handleConsulServices, handleConsulKVGet, handleConsulKVPut, handleConsulKVList, handleConsulKVDelete, handleConsulServiceHealth, handleConsulSessionCreate } from './consul';
import { handleInfluxDBHealth, handleInfluxDBWrite, handleInfluxDBQuery } from './influxdb';
import { handleDICOMConnect, handleDICOMEcho } from './dicom';
import { handleDockerHealth, handleDockerQuery } from './docker';
import { handleJupyterHealth, handleJupyterQuery } from './jupyter';
import { handlePPTPConnect } from './pptp';
import { handleJsonRpcCall, handleJsonRpcBatch } from './jsonrpc';
import { handleLspConnect } from './lsp';
import { handle9PConnect } from './ninep';
import { handleThriftProbe, handleThriftCall } from './thrift';
import { handleSLPServiceTypes, handleSLPServiceFind, handleSLPAttributes } from './slp';
import { handleBitTorrentHandshake } from './bittorrent';
import { handleX11Connect } from './x11';
import { handleKerberosConnect } from './kerberos';
import { handleSCCPProbe, handleSCCPRegister } from './sccp';
import { handleMatrixHealth, handleMatrixQuery, handleMatrixLogin, handleMatrixRooms, handleMatrixSend } from './matrix';
import { handleCDPHealth, handleCDPQuery, handleCDPTunnel } from './cdp';
import { handleNodeInspectorHealth, handleNodeInspectorQuery, handleNodeInspectorTunnel } from './node-inspector';
import { handleDAPHealth, handleDAPTunnel } from './dap';
import { handleISCSIDiscover } from './iscsi';
import { handleWebSocketProbe } from './websocket';
import { handleH323Connect } from './h323';
import { handleDoTQuery } from './dot';
import { handleSoapCall, handleSoapWsdl } from './soap';
import { handleOpenVPNHandshake } from './openvpn';
import { handleShadowsocksProbe } from './shadowsocks';
import { handleAFPConnect } from './afp';
import { handleNFSProbe, handleNFSExports } from './nfs';
import { handleMGCPAudit, handleMGCPCommand } from './mgcp';
import { handleFTPSConnect, handleFTPSLogin, handleFTPSList, handleFTPSDownload, handleFTPSUpload } from './ftps';
import { handleDictDefine, handleDictMatch, handleDictDatabases } from './dict';
import { handleSipOptions, handleSipRegister } from './sip';
import { handleSipsOptions, handleSipsRegister } from './sips';
import { handleQotdFetch } from './qotd';
import { handleLPDProbe, handleLPDQueue } from './lpd';
import { handleMinecraftStatus, handleMinecraftPing } from './minecraft';
import { handleOracleTNSConnect, handleOracleTNSProbe } from './oracle-tns';
import { handleIdentQuery } from './ident';
import { handleZabbixConnect, handleZabbixAgent } from './zabbix';
import { handleMpdStatus, handleMpdCommand } from './mpd';
import { handleBeanstalkdConnect, handleBeanstalkdCommand, handleBeanstalkdPut, handleBeanstalkdReserve } from './beanstalkd';
import { handleBeatsSend, handleBeatsConnect } from './beats';
import { handleClamAVPing, handleClamAVVersion, handleClamAVStats, handleClamAVScan } from './clamav';
import { handleLMTPConnect, handleLMTPSend } from './lmtp';
import { handleManageSieveConnect, handleManageSieveList, handleManageSievePutScript, handleManageSieveGetScript, handleManageSieveDeleteScript, handleManageSieveSetActive } from './managesieve';
import { handleCouchDBHealth, handleCouchDBQuery } from './couchdb';
import { handleIPPProbe } from './ipp';
import { handleSMPPConnect, handleSMPPProbe, handleSMPPSubmit } from './smpp';
import { handleSVNConnect } from './svn';
import { handleTeamSpeakConnect, handleTeamSpeakCommand } from './teamspeak';
import { handleRadiusProbe, handleRadiusAuth } from './radius';
import { handleRadsecAuth, handleRadsecConnect } from './radsec';
import { handleXmppS2SPing, handleXmppS2SConnect } from './xmpp-s2s';
import { handleNRPEQuery, handleNRPEVersion } from './nrpe';
import { handleRloginConnect, handleRloginWebSocket } from './rlogin';
import { handleS7commConnect } from './s7comm';
import { handleSNPPProbe, handleSNPPPage } from './snpp';
import { handleRethinkDBConnect, handleRethinkDBProbe } from './rethinkdb';
import { handleClickHouseHealth, handleClickHouseQuery } from './clickhouse';
import { handleGearmanConnect, handleGearmanCommand, handleGearmanSubmit } from './gearman';
import { handleEtherNetIPIdentity } from './ethernetip';
import { handlePrometheusHealth, handlePrometheusQuery, handlePrometheusMetrics, handlePrometheusRangeQuery } from './prometheus';
import { handlePortmapperProbe, handlePortmapperDump } from './portmapper';
import { handleRelpConnect, handleRelpSend } from './relp';
import { handleADBCommand, handleADBVersion, handleADBDevices } from './adb';
import { handleDNP3Connect, handleDNP3Read } from './dnp3';
import { handleStunBinding, handleStunProbe } from './stun';
import { handleFluentdConnect, handleFluentdSend } from './fluentd';
import { handleAerospikeConnect, handleAerospikeInfo } from './aerospike';
import { handleRexecExecute, handleRexecWebSocket } from './rexec';
import { handleRshExecute, handleRshWebSocket } from './rsh';
import { handleFIXProbe, handleFIXHeartbeat } from './fix';
import { handleEPMDNames, handleEPMDPort } from './epmd';
import { handleTarantoolConnect, handleTarantoolProbe, handleTarantoolEval, handleTarantoolSQL } from './tarantool';
import { handleVaultHealth, handleVaultQuery, handleVaultSecretRead, handleVaultSecretWrite } from './vault';
import { handleSolrHealth, handleSolrQuery, handleSolrIndex, handleSolrDelete } from './solr';
import { handleIEC104Probe } from './iec104';
import { handleRiakPing, handleRiakInfo, handleRiakGet, handleRiakPut } from './riak';
import { handleOpenTSDBVersion, handleOpenTSDBStats, handleOpenTSDBSuggest, handleOpenTSDBPut, handleOpenTSDBQuery } from './opentsdb';
import { handleSpamdPing, handleSpamdCheck, handleSpamdTell } from './spamd';
import { handleBitcoinConnect, handleBitcoinGetAddr } from './bitcoin';
import { handleNSQConnect, handleNSQPublish, handleNSQSubscribe, handleNSQMultiPublish } from './nsq';
import { handleZMTPProbe, handleZMTPHandshake } from './zmtp';
import { handleOPCUAHello, handleOPCUAEndpoints, handleOPCUARead } from './opcua';
import { handleMuninConnect, handleMuninFetch } from './munin';
import { handleSANEProbe } from './sane';
import { handleCephConnect, handleCephProbe } from './ceph';
import { handleHTTPProxyProbe, handleHTTPProxyConnect } from './httpproxy';
import { handleVarnishProbe, handleVarnishCommand } from './varnish';
import { handleFINSConnect } from './fins';
import { handleCouchbasePing, handleCouchbaseVersion, handleCouchbaseStats, handleCouchbaseGet, handleCouchbaseSet } from './couchbase';
import { handleAMIProbe, handleAMICommand } from './ami';
import { handleJDWPProbe, handleJDWPVersion } from './jdwp';
import { handleDRDAConnect, handleDRDAProbe } from './drda';
import { handleDCERPCConnect, handleDCERPCProbe } from './dcerpc';
import { handleLivestatusStatus, handleLivestatusHosts, handleLivestatusQuery } from './livestatus';
import { handleNSCAProbe, handleNSCASend } from './nsca';
import { handlePJLinkProbe, handlePJLinkPower } from './pjlink';
import { handleIMAPSConnect, handleIMAPSList, handleIMAPSSelect } from './imaps';
import { handleLokiHealth, handleLokiQuery, handleLokiMetrics, handleLokiPush, handleLokiRangeQuery } from './loki';
import { handleMeilisearchHealth, handleMeilisearchSearch, handleMeilisearchDocuments, handleMeilisearchDelete } from './meilisearch';
import { handleIcecastStatus, handleIcecastAdmin } from './icecast';
import { handleOpenFlowProbe, handleOpenFlowEcho } from './openflow';
import { handleRMIProbe, handleRMIList } from './rmi';
import { handleHAProxyInfo, handleHAProxyStat, handleHAProxyCommand } from './haproxy';
import { handleNBDConnect, handleNBDProbe, handleNBDRead } from './nbd';
import { handleGangliaConnect, handleGangliaProbe } from './ganglia';
import { handlePOP3SConnect, handlePOP3SList, handlePOP3SRetrieve } from './pop3s';
import { handleNetBIOSConnect, handleNetBIOSProbe } from './netbios';
import { handleSMTPSConnect, handleSMTPSSend } from './smtps';
import { handlePCEPConnect, handlePCEPProbe } from './pcep';
import { handleUwsgiProbe, handleUwsgiRequest } from './uwsgi';
import { handleTorControlProbe, handleTorControlGetInfo } from './torcontrol';
import { handleWinRMIdentify, handleWinRMAuth } from './winrm';
import { handleKibanaStatus, handleKibanaSavedObjects, handleKibanaIndexPatterns, handleKibanaAlerts, handleKibanaQuery } from './kibana';
import { handleGrafanaHealth, handleGrafanaDatasources, handleGrafanaDashboards, handleGrafanaFolders, handleGrafanaAlertRules, handleGrafanaOrg, handleGrafanaDashboard } from './grafana';
import { handleGPSDVersion, handleGPSDDevices, handleGPSDPoll, handleGPSDCommand } from './gpsd';
import { handleRserveProbe, handleRserveEval } from './rserve';
import { handleHazelcastProbe, handleHazelcastMapGet } from './hazelcast';
import { handleSentinelProbe, handleSentinelQuery } from './sentinel';
import { handleNNTPSConnect, handleNNTPSGroup, handleNNTPSArticle, handleNNTPSList, handleNNTPSPost, handleNNTPSAuth } from './nntps';
import { handleSonicProbe, handleSonicPing } from './sonic';
import { handleNomadHealth, handleNomadJobs, handleNomadNodes, handleNomadAllocations, handleNomadDeployments, handleNomadJobDispatch } from './nomad';
import { handleRabbitMQHealth, handleRabbitMQQuery } from './rabbitmq';
import { handleLDPConnect, handleLDPProbe } from './ldp';
import { handleIgniteConnect, handleIgniteProbe, handleIgniteListCaches, handleIgniteCacheGet } from './ignite';
import { handleFirebirdProbe, handleFirebirdVersion } from './firebird';
import { handleCVSConnect, handleCVSLogin } from './cvs';
import { handleAMQPSConnect, handleAMQPSPublish } from './amqps';
import { handleTFTPConnect, handleTFTPRead, handleTFTPWrite } from './tftp';
import { handleSNMPGet, handleSNMPWalk } from './snmp';
import { handleNTPQuery, handleNTPSync } from './ntp';
import { handleMsrpSend, handleMsrpConnect } from './msrp';
import { handleL2TPConnect, handleL2TPHello } from './l2tp';
import { handleTURNAllocate, handleTURNProbe } from './turn';
import { handleCoAPRequest, handleCoAPDiscover } from './coap';
import { handleIKEProbe, handleIKEVersionDetect } from './ike';
import { handleRIPRequest, handleRIPProbe } from './rip';
import { handleMDNSQuery, handleMDNSDiscover } from './mdns';
import { handleHSRPProbe, handleHSRPListen } from './hsrp';
import { handleVentriloStatus, handleVentriloConnect } from './ventrilo';
import { handleNapsterConnect, handleNapsterLogin, handleNapsterStats } from './napster';
import { handleXMPPS2SProbe, handleXMPPS2SFederationTest } from './xmpps2s';
import { handleMSNProbe, handleMSNClientVersion } from './msn';
import { handleYMSGProbe, handleYMSGVersionDetect } from './ymsg';
import { handleOSCARProbe, handleOSCARPing } from './oscar';
import { handleJabberComponentProbe, handleJabberComponentHandshake } from './jabber-component';
import { handleMMSProbe, handleMMSDescribe } from './mms';
import { handleRealAudioProbe, handleRealAudioDescribe } from './realaudio';
import { handleShoutCastProbe, handleShoutCastInfo } from './shoutcast';
import { handleMumbleProbe, handleMumbleVersion } from './mumble';
import { handleSybaseProbe, handleSybaseVersion, handleSybaseLogin, handleSybaseQuery } from './sybase';
import { handleInformixProbe, handleInformixVersion } from './informix';
import { eppConnect, eppLogin, eppDomainCheck } from './epp';
import { handleHTTPRequest, handleHTTPHead, handleHTTPOptions } from './http';
import { handleUUCPProbe } from './uucp';
import { handlePerforceProbe, handlePerforceInfo } from './perforce';
import { handleQuake3Status, handleQuake3Info } from './quake3';
import { handleCollectdProbe, handleCollectdSend } from './collectd';
import { handleEthereumProbe } from './ethereum';
import { handleIPFSProbe } from './ipfs';
import { handleKubernetesProbe, handleKubernetesQuery } from './kubernetes';
import { handleActiveMQProbe } from './activemq';
import { handleCIFSConnect } from './cifs';
import { handleDOHQuery } from './doh';
import { handleIPMIConnect } from './ipmi';
import { handleSCPConnect } from './scp';
import { handleSPDYConnect } from './spdy';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface Env {
  ENVIRONMENT: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API endpoint for TCP ping
    if (url.pathname === '/api/ping') {
      return handleTcpPing(request);
    }

    // Raw TCP send/receive
    if (url.pathname === '/api/tcp/send') {
      return handleTcpSend(request);
    }

    // ECHO API endpoints
    if (url.pathname === '/api/echo/test') {
      return handleEchoTest(request);
    }

    if (url.pathname === '/api/echo/connect') {
      // Check for WebSocket upgrade for interactive sessions
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleEchoWebSocket(request);
      }
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // Active Users API endpoint
    if (url.pathname === '/api/activeusers/test') {
      return handleActiveUsersTest(request);
    }

    // WHOIS API endpoint
    if (url.pathname === '/api/whois/lookup') {
      return handleWhoisLookup(request);
    }

    // Syslog API endpoint
    if (url.pathname === '/api/syslog/send') {
      return handleSyslogSend(request);
    }

    // SOCKS4 API endpoint
    if (url.pathname === '/api/socks4/connect') {
      return handleSocks4Connect(request);
    }

    // SOCKS5 API endpoint
    if (url.pathname === '/api/socks5/connect') {
      return handleSocks5Connect(request);
    }

    // Daytime API endpoint
    if (url.pathname === '/api/daytime/get') {
      return handleDaytimeGet(request);
    }

    // Finger API endpoint
    if (url.pathname === '/api/finger/query') {
      return handleFingerQuery(request);
    }

    // TIME API endpoint
    if (url.pathname === '/api/time/get') {
      return handleTimeGet(request);
    }

    // CHARGEN API endpoint
    if (url.pathname === '/api/chargen/stream') {
      return handleChargenStream(request);
    }

    // DISCARD API endpoint
    if (url.pathname === '/api/discard/send') {
      return handleDiscardSend(request);
    }

    // Gadu-Gadu API endpoint
    if (url.pathname === '/api/gadugadu/connect') {
      return handleGaduGaduConnect(request);
    }

    // GEMINI API endpoint
    if (url.pathname === '/api/gemini/fetch') {
      return handleGeminiFetch(request);
    }

    // Gopher API endpoint
    if (url.pathname === '/api/gopher/fetch') {
      return handleGopherFetch(request);
    }

    // IRC API endpoints
    if (url.pathname === '/api/irc/connect') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleIRCWebSocket(request);
      }
      return handleIRCConnect(request);
    }

    // IRCS (IRC over TLS) API endpoints
    if (url.pathname === '/api/ircs/connect') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleIRCSWebSocket(request);
      }
      return handleIRCSConnect(request);
    }

    // DNS API endpoint
    if (url.pathname === '/api/dns/query') {
      return handleDNSQuery(request);
    }

    // Memcached API endpoints
    if (url.pathname === '/api/memcached/connect') {
      return handleMemcachedConnect(request);
    }

    if (url.pathname === '/api/memcached/command') {
      return handleMemcachedCommand(request);
    }

    if (url.pathname === '/api/memcached/stats') {
      return handleMemcachedStats(request);
    }

    if (url.pathname === '/api/memcached/session') {
      return handleMemcachedSession(request);
    }

    // Modbus TCP API endpoints
    if (url.pathname === '/api/modbus/connect') {
      return handleModbusConnect(request);
    }

    if (url.pathname === '/api/modbus/read') {
      return handleModbusRead(request);
    }

    if (url.pathname === '/api/modbus/write/coil') {
      return handleModbusWriteCoil(request);
    }

    if (url.pathname === '/api/modbus/write/registers') {
      return handleModbusWriteRegisters(request);
    }

    // Graphite API endpoint
    if (url.pathname === '/api/graphite/send') {
      return handleGraphiteSend(request);
    }

    // Git Protocol API endpoint
    if (url.pathname === '/api/git/refs') {
      return handleGitRefs(request);
    }

    // Kafka API endpoints
    if (url.pathname === '/api/kafka/versions') {
      return handleKafkaApiVersions(request);
    }

    if (url.pathname === '/api/kafka/metadata') {
      return handleKafkaMetadata(request);
    }

    if (url.pathname === '/api/kafka/produce') {
      return handleKafkaProduceMessage(request);
    }

    // NNTP API endpoints
    if (url.pathname === '/api/nntp/connect') {
      return handleNNTPConnect(request);
    }

    if (url.pathname === '/api/nntp/group') {
      return handleNNTPGroup(request);
    }

    if (url.pathname === '/api/nntp/article') {
      return handleNNTPArticle(request);
    }

    if (url.pathname === '/api/nntp/list') {
      return handleNNTPList(request);
    }

    if (url.pathname === '/api/nntp/post') {
      return handleNNTPPost(request);
    }

    if (url.pathname === '/api/nntp/auth') {
      return handleNNTPAuth(request);
    }

    // API endpoint for socket connections
    if (url.pathname === '/api/connect') {
      return handleSocketConnection(request);
    }

    // FTP API endpoints
    if (url.pathname === '/api/ftp/connect') {
      return handleFTPConnect(request);
    }

    if (url.pathname === '/api/ftp/list') {
      return handleFTPList(request);
    }

    if (url.pathname === '/api/ftp/upload') {
      return handleFTPUpload(request);
    }

    if (url.pathname === '/api/ftp/download') {
      return handleFTPDownload(request);
    }

    if (url.pathname === '/api/ftp/delete') {
      return handleFTPDelete(request);
    }

    if (url.pathname === '/api/ftp/mkdir') {
      return handleFTPMkdir(request);
    }

    if (url.pathname === '/api/ftp/rename') {
      return handleFTPRename(request);
    }

    // SSH API endpoints
    if (url.pathname === '/api/ssh/connect') {
      return handleSSHConnect(request);
    }

    if (url.pathname === '/api/ssh/execute') {
      return handleSSHExecute(request);
    }

    if (url.pathname === '/api/ssh/disconnect') {
      return handleSSHDisconnect(request);
    }

    if (url.pathname === '/api/ssh/terminal') {
      return handleSSHTerminal(request);
    }

    // SFTP API endpoints
    if (url.pathname === '/api/sftp/connect') {
      return handleSFTPConnect(request);
    }

    if (url.pathname === '/api/sftp/list') {
      return handleSFTPList(request);
    }

    if (url.pathname === '/api/sftp/download') {
      return handleSFTPDownload(request);
    }

    if (url.pathname === '/api/sftp/upload') {
      return handleSFTPUpload(request);
    }

    if (url.pathname === '/api/sftp/delete') {
      return handleSFTPDelete(request);
    }

    if (url.pathname === '/api/sftp/mkdir') {
      return handleSFTPMkdir(request);
    }

    if (url.pathname === '/api/sftp/rename') {
      return handleSFTPRename(request);
    }

    // Telnet API endpoints
    if (url.pathname === '/api/telnet/connect') {
      // Check for WebSocket upgrade
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleTelnetWebSocket(request);
      }
      return handleTelnetConnect(request);
    }

    // SMTP API endpoints
    if (url.pathname === '/api/smtp/connect') {
      return handleSMTPConnect(request);
    }

    if (url.pathname === '/api/smtp/send') {
      return handleSMTPSend(request);
    }

    // Message Submission Protocol (RFC 6409) API endpoints
    if (url.pathname === '/api/submission/connect') {
      return handleSubmissionConnect(request);
    }

    if (url.pathname === '/api/submission/send') {
      return handleSubmissionSend(request);
    }

    // POP3 API endpoints
    if (url.pathname === '/api/pop3/connect') {
      return handlePOP3Connect(request);
    }

    if (url.pathname === '/api/pop3/list') {
      return handlePOP3List(request);
    }

    if (url.pathname === '/api/pop3/retrieve') {
      return handlePOP3Retrieve(request);
    }

    // IMAP API endpoints
    if (url.pathname === '/api/imap/connect') {
      return handleIMAPConnect(request);
    }

    if (url.pathname === '/api/imap/list') {
      return handleIMAPList(request);
    }

    if (url.pathname === '/api/imap/select') {
      return handleIMAPSelect(request);
    }

    if (url.pathname === '/api/imap/session') {
      return handleIMAPSession(request);
    }

    // MySQL API endpoints
    if (url.pathname === '/api/mysql/connect') {
      return handleMySQLConnect(request);
    }

    if (url.pathname === '/api/mysql/query') {
      return handleMySQLQuery(request);
    }

    // Oracle TNS
    if (url.pathname === '/api/oracle/connect') {
      return handleOracleConnect(request);
    }

    // MaxDB API endpoints
    if (url.pathname === '/api/maxdb/connect') {
      return handleMaxDBConnect(request);
    }

    // PostgreSQL API endpoints
    if (url.pathname === '/api/postgres/connect') {
      return handlePostgreSQLConnect(request);
    }
    if (url.pathname === '/api/postgres/query') {
      return handlePostgreSQLQuery(request);
    }

    // Redis API endpoints
    if (url.pathname === '/api/redis/connect') {
      return handleRedisConnect(request);
    }

    if (url.pathname === '/api/redis/command') {
      return handleRedisCommand(request);
    }

    if (url.pathname === '/api/redis/session') {
      return handleRedisSession(request);
    }

    // MQTT API endpoints
    if (url.pathname === '/api/mqtt/connect') {
      return handleMQTTConnect(request);
    }

    // LDAP API endpoints
    if (url.pathname === '/api/ldap/connect') {
      return handleLDAPConnect(request);
    }
    if (url.pathname === '/api/ldap/search') {
      return handleLDAPSearch(request);
    }
    if (url.pathname === '/api/ldap/add') {
      return handleLDAPAdd(request);
    }
    if (url.pathname === '/api/ldap/modify') {
      return handleLDAPModify(request);
    }
    if (url.pathname === '/api/ldap/delete') {
      return handleLDAPDelete(request);
    }

    // LDAPS API endpoints
    if (url.pathname === '/api/ldaps/connect') {
      return handleLDAPSConnect(request);
    }
    if (url.pathname === '/api/ldaps/search') {
      return handleLDAPSSearch(request);
    }
    if (url.pathname === '/api/ldaps/add') {
      return handleLDAPSAdd(request);
    }
    if (url.pathname === '/api/ldaps/modify') {
      return handleLDAPSModify(request);
    }
    if (url.pathname === '/api/ldaps/delete') {
      return handleLDAPSDelete(request);
    }

    // SMB API endpoints
    if (url.pathname === '/api/smb/connect') {
      return handleSMBConnect(request);
    }

    // CIFS API endpoints
    if (url.pathname === '/api/cifs/connect') {
      return handleCIFSConnect(request);
    }

    // DoH API endpoints
    if (url.pathname === '/api/doh/query') {
      return handleDOHQuery(request);
    }

    // IPMI API endpoints
    if (url.pathname === '/api/ipmi/connect') {
      return handleIPMIConnect(request);
    }

    // SCP API endpoints
    if (url.pathname === '/api/scp/connect') {
      return handleSCPConnect(request);
    }

    // SPDY API endpoints
    if (url.pathname === '/api/spdy/connect') {
      return handleSPDYConnect(request);
    }

    // MongoDB API endpoints
    if (url.pathname === '/api/mongodb/connect') {
      return handleMongoDBConnect(request);
    }

    if (url.pathname === '/api/mongodb/ping') {
      return handleMongoDBPing(request);
    }

    if (url.pathname === '/api/mongodb/find') {
      return handleMongoDBFind(request);
    }

    if (url.pathname === '/api/mongodb/insert') {
      return handleMongoDBInsert(request);
    }

    // STOMP API endpoints
    if (url.pathname === '/api/stomp/connect') {
      return handleStompConnect(request);
    }

    if (url.pathname === '/api/stomp/send') {
      return handleStompSend(request);
    }

    if (url.pathname === '/api/stomp/subscribe') {
      return handleStompSubscribe(request);
    }

    // Minecraft RCON API endpoints
    if (url.pathname === '/api/rcon/connect') {
      return handleRCONConnect(request);
    }

    if (url.pathname === '/api/rcon/command') {
      return handleRCONCommand(request);
    }

    // ZooKeeper API endpoints
    if (url.pathname === '/api/zookeeper/connect') {
      return handleZooKeeperConnect(request);
    }

    if (url.pathname === '/api/zookeeper/command') {
      return handleZooKeeperCommand(request);
    }

    if (url.pathname === '/api/zookeeper/get') {
      return handleZooKeeperGet(request);
    }

    if (url.pathname === '/api/zookeeper/set') {
      return handleZooKeeperSet(request);
    }

    if (url.pathname === '/api/zookeeper/create') {
      return handleZooKeeperCreate(request);
    }

    // AMQP API endpoint
    if (url.pathname === '/api/amqp/connect') {
      return handleAMQPConnect(request);
    }
    if (url.pathname === '/api/amqp/publish') {
      return handleAMQPPublish(request);
    }

    // Cassandra CQL API endpoint
    if (url.pathname === '/api/cassandra/connect') {
      return handleCassandraConnect(request);
    }

    if (url.pathname === '/api/cassandra/query') {
      return handleCassandraQuery(request, env);
    }

    // RTSP API endpoints
    if (url.pathname === '/api/rtsp/options') {
      return handleRtspOptions(request);
    }

    if (url.pathname === '/api/rtsp/describe') {
      return handleRtspDescribe(request);
    }

    if (url.pathname === '/api/rtsp/session') {
      return handleRTSPSession(request);
    }

    // Rsync API endpoints
    if (url.pathname === '/api/rsync/connect') {
      return handleRsyncConnect(request);
    }

    if (url.pathname === '/api/rsync/module') {
      return handleRsyncModule(request);
    }

    // TDS (SQL Server) API endpoint
    if (url.pathname === '/api/tds/connect') {
      return handleTDSConnect(request);
    }

    // VNC (RFB) API endpoint
    if (url.pathname === '/api/vnc/connect') {
      return handleVNCConnect(request);
    }

    // SPICE API endpoint
    if (url.pathname === '/api/spice/connect') {
      return handleSPICEConnect(request);
    }

    // Battle.net BNCS API endpoint
    if (url.pathname === '/api/battlenet/connect') {
      return handleBattlenetConnect(request);
    }
    if (url.pathname === '/api/battlenet/authinfo') {
      return handleBattlenetAuthInfo(request);
    }
    if (url.pathname === '/api/battlenet/status') {
      return handleBattlenetStatus(request);
    }

    // Neo4j Bolt API endpoint
    if (url.pathname === '/api/neo4j/connect') {
      return handleNeo4jConnect(request);
    }

    if (url.pathname === '/api/neo4j/query') {
      return handleNeo4jQuery(request);
    }

    // RTMP API endpoint
    if (url.pathname === '/api/rtmp/connect') {
      return handleRTMPConnect(request);
    }

    // TACACS+ API endpoints
    if (url.pathname === '/api/tacacs/probe') {
      return handleTacacsProbe(request);
    }

    if (url.pathname === '/api/tacacs/authenticate') {
      return handleTacacsAuthenticate(request);
    }

    // Elasticsearch API endpoints
    if (url.pathname === '/api/elasticsearch/health') {
      return handleElasticsearchHealth(request);
    }

    if (url.pathname === '/api/elasticsearch/query') {
      return handleElasticsearchQuery(request);
    }

    // AJP API endpoint
    if (url.pathname === '/api/ajp/connect') {
      return handleAJPConnect(request);
    }

    if (url.pathname === '/api/ajp/request') {
      return handleAJPRequest(request);
    }

    // HL7 v2.x API endpoints
    if (url.pathname === '/api/hl7/connect') {
      return handleHL7Connect(request);
    }

    if (url.pathname === '/api/hl7/send') {
      return handleHL7Send(request);
    }

    // XMPP API endpoints
    if (url.pathname === '/api/xmpp/connect') {
      return handleXMPPConnect(request);
    }

    if (url.pathname === '/api/xmpp/login') {
      return handleXMPPLogin(request);
    }

    if (url.pathname === '/api/xmpp/roster') {
      return handleXMPPRoster(request);
    }

    if (url.pathname === '/api/xmpp/message') {
      return handleXMPPMessage(request);
    }

    // RDP API endpoint
    if (url.pathname === '/api/rdp/connect') {
      return handleRDPConnect(request);
    }

    // NATS API endpoints
    if (url.pathname === '/api/nats/connect') {
      return handleNATSConnect(request);
    }

    if (url.pathname === '/api/nats/publish') {
      return handleNATSPublish(request);
    }

    if (url.pathname === '/api/nats/subscribe') {
      return handleNATSSubscribe(request);
    }

    if (url.pathname === '/api/nats/request') {
      return handleNATSRequest(request);
    }

    // JetDirect API endpoint
    if (url.pathname === '/api/jetdirect/connect') {
      return handleJetDirectConnect(request);
    }

    // BGP API endpoint
    if (url.pathname === '/api/bgp/connect') {
      return handleBGPConnect(request);
    }

    // Diameter API endpoints
    if (url.pathname === '/api/diameter/connect') {
      return handleDiameterConnect(request);
    }

    if (url.pathname === '/api/diameter/watchdog') {
      return handleDiameterWatchdog(request);
    }

    // FastCGI API endpoints
    if (url.pathname === '/api/fastcgi/probe') {
      return handleFastCGIProbe(request);
    }

    if (url.pathname === '/api/fastcgi/request') {
      return handleFastCGIRequest(request);
    }

    // Consul API endpoints
    if (url.pathname === '/api/consul/health') {
      return handleConsulHealth(request);
    }

    if (url.pathname === '/api/consul/services') {
      return handleConsulServices(request);
    }

    if (url.pathname === '/api/consul/kv-list') {
      return handleConsulKVList(request);
    }

    if (url.pathname.startsWith('/api/consul/kv/')) {
      if (request.method === 'GET') return handleConsulKVGet(request);
      if (request.method === 'POST') return handleConsulKVPut(request);
      if (request.method === 'DELETE') return handleConsulKVDelete(request);
    }

    if (url.pathname === '/api/consul/service/health') {
      return handleConsulServiceHealth(request);
    }

    if (url.pathname === '/api/consul/session/create') {
      return handleConsulSessionCreate(request);
    }

    // etcd API endpoints
    if (url.pathname === '/api/etcd/health') {
      return handleEtcdHealth(request);
    }

    if (url.pathname === '/api/etcd/query') {
      return handleEtcdQuery(request);
    }

    // InfluxDB API endpoints
    if (url.pathname === '/api/influxdb/health') {
      return handleInfluxDBHealth(request);
    }

    if (url.pathname === '/api/influxdb/write') {
      return handleInfluxDBWrite(request);
    }

    if (url.pathname === '/api/influxdb/query') {
      return handleInfluxDBQuery(request);
    }

    // DICOM API endpoints
    if (url.pathname === '/api/dicom/connect') {
      return handleDICOMConnect(request);
    }

    if (url.pathname === '/api/dicom/echo') {
      return handleDICOMEcho(request);
    }

    // Docker Engine API endpoints
    if (url.pathname === '/api/docker/health') {
      return handleDockerHealth(request);
    }

    if (url.pathname === '/api/docker/query') {
      return handleDockerQuery(request);
    }

    // Jupyter REST API endpoints
    if (url.pathname === '/api/jupyter/health') {
      return handleJupyterHealth(request);
    }

    if (url.pathname === '/api/jupyter/query') {
      return handleJupyterQuery(request);
    }

    // PPTP API endpoint
    if (url.pathname === '/api/pptp/connect') {
      return handlePPTPConnect(request);
    }

    // JSON-RPC API endpoints
    if (url.pathname === '/api/jsonrpc/call') {
      return handleJsonRpcCall(request);
    }

    if (url.pathname === '/api/jsonrpc/batch') {
      return handleJsonRpcBatch(request);
    }

    // LSP API endpoint
    if (url.pathname === '/api/lsp/connect') {
      return handleLspConnect(request);
    }

    // 9P API endpoint
    if (url.pathname === '/api/9p/connect') {
      return handle9PConnect(request);
    }

    // Thrift API endpoints
    if (url.pathname === '/api/thrift/probe') {
      return handleThriftProbe(request);
    }

    if (url.pathname === '/api/thrift/call') {
      return handleThriftCall(request);
    }

    // SLP API endpoints
    if (url.pathname === '/api/slp/types') {
      return handleSLPServiceTypes(request);
    }

    if (url.pathname === '/api/slp/find') {
      return handleSLPServiceFind(request);
    }

    if (url.pathname === '/api/slp/attributes') {
      return handleSLPAttributes(request);
    }

    // BitTorrent API endpoint
    if (url.pathname === '/api/bittorrent/handshake') {
      return handleBitTorrentHandshake(request);
    }

    // X11 API endpoint
    if (url.pathname === '/api/x11/connect') {
      return handleX11Connect(request);
    }

    // Kerberos API endpoint
    if (url.pathname === '/api/kerberos/connect') {
      return handleKerberosConnect(request);
    }

    // SCCP API endpoints
    if (url.pathname === '/api/sccp/probe') {
      return handleSCCPProbe(request);
    }

    if (url.pathname === '/api/sccp/register') {
      return handleSCCPRegister(request);
    }

    // Matrix API endpoints
    if (url.pathname === '/api/matrix/health') {
      return handleMatrixHealth(request);
    }

    if (url.pathname === '/api/matrix/query') {
      return handleMatrixQuery(request);
    }

    if (url.pathname === '/api/matrix/login') {
      return handleMatrixLogin(request);
    }

    if (url.pathname === '/api/matrix/rooms') {
      return handleMatrixRooms(request);
    }

    if (url.pathname === '/api/matrix/send') {
      return handleMatrixSend(request);
    }

    // Chrome DevTools Protocol endpoints
    if (url.pathname === '/api/cdp/health') {
      return handleCDPHealth(request);
    }

    if (url.pathname === '/api/cdp/query') {
      return handleCDPQuery(request);
    }

    if (url.pathname === '/api/cdp/tunnel') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleCDPTunnel(request);
      }
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // Node Inspector Protocol endpoints
    if (url.pathname === '/api/node-inspector/health') {
      return handleNodeInspectorHealth(request);
    }

    if (url.pathname === '/api/node-inspector/query') {
      return handleNodeInspectorQuery(request);
    }

    if (url.pathname === '/api/node-inspector/tunnel') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleNodeInspectorTunnel(request);
      }
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // DAP (Debug Adapter Protocol) endpoints
    if (url.pathname === '/api/dap/health') {
      return handleDAPHealth(request);
    }

    if (url.pathname === '/api/dap/tunnel') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleDAPTunnel(request);
      }
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // WebSocket API endpoint
    if (url.pathname === '/api/websocket/probe') {
      return handleWebSocketProbe(request);
    }

    // iSCSI API endpoint
    if (url.pathname === '/api/iscsi/discover') {
      return handleISCSIDiscover(request);
    }

    // H.323 API endpoint
    if (url.pathname === '/api/h323/connect') {
      return handleH323Connect(request);
    }

    // DoT (DNS over TLS) API endpoint
    if (url.pathname === '/api/dot/query') {
      return handleDoTQuery(request);
    }

    // SOAP API endpoints
    if (url.pathname === '/api/soap/call') {
      return handleSoapCall(request);
    }

    if (url.pathname === '/api/soap/wsdl') {
      return handleSoapWsdl(request);
    }

    // OpenVPN API endpoint
    if (url.pathname === '/api/openvpn/handshake') {
      return handleOpenVPNHandshake(request);
    }

    // Shadowsocks API endpoint
    if (url.pathname === '/api/shadowsocks/probe') {
      return handleShadowsocksProbe(request);
    }

    // AFP API endpoint
    if (url.pathname === '/api/afp/connect') {
      return handleAFPConnect(request);
    }

    // NFS API endpoints
    if (url.pathname === '/api/nfs/probe') {
      return handleNFSProbe(request);
    }

    if (url.pathname === '/api/nfs/exports') {
      return handleNFSExports(request);
    }

    // MGCP API endpoints
    if (url.pathname === '/api/mgcp/audit') {
      return handleMGCPAudit(request);
    }

    if (url.pathname === '/api/mgcp/command') {
      return handleMGCPCommand(request);
    }

    // FTPS API endpoints
    if (url.pathname === '/api/ftps/connect') {
      return handleFTPSConnect(request);
    }
    if (url.pathname === '/api/ftps/login') {
      return handleFTPSLogin(request);
    }
    if (url.pathname === '/api/ftps/list') {
      return handleFTPSList(request);
    }
    if (url.pathname === '/api/ftps/download') {
      return handleFTPSDownload(request);
    }
    if (url.pathname === '/api/ftps/upload') {
      return handleFTPSUpload(request);
    }

    // DICT API endpoints
    if (url.pathname === '/api/dict/define') {
      return handleDictDefine(request);
    }

    if (url.pathname === '/api/dict/match') {
      return handleDictMatch(request);
    }

    if (url.pathname === '/api/dict/databases') {
      return handleDictDatabases(request);
    }

    // SIP API endpoints
    if (url.pathname === '/api/sip/options') {
      return handleSipOptions(request);
    }

    if (url.pathname === '/api/sip/register') {
      return handleSipRegister(request);
    }

    // SIPS (SIP over TLS) API endpoints
    if (url.pathname === '/api/sips/options') {
      return handleSipsOptions(request);
    }

    if (url.pathname === '/api/sips/register') {
      return handleSipsRegister(request);
    }

    // MSRP API endpoints
    if (url.pathname === '/api/msrp/send') {
      return handleMsrpSend(request);
    }

    if (url.pathname === '/api/msrp/connect') {
      return handleMsrpConnect(request);
    }

    // QOTD API endpoint
    if (url.pathname === '/api/qotd/fetch') {
      return handleQotdFetch(request);
    }

    // LPD API endpoints
    if (url.pathname === '/api/lpd/probe') {
      return handleLPDProbe(request);
    }

    if (url.pathname === '/api/lpd/queue') {
      return handleLPDQueue(request);
    }

    // Minecraft SLP API endpoints
    if (url.pathname === '/api/minecraft/status') {
      return handleMinecraftStatus(request);
    }

    if (url.pathname === '/api/minecraft/ping') {
      return handleMinecraftPing(request);
    }

    // IDENT API endpoint
    if (url.pathname === '/api/ident/query') {
      return handleIdentQuery(request);
    }

    // Zabbix API endpoints
    if (url.pathname === '/api/zabbix/connect') {
      return handleZabbixConnect(request);
    }

    if (url.pathname === '/api/zabbix/agent') {
      return handleZabbixAgent(request);
    }

    // Oracle TNS API endpoints
    if (url.pathname === '/api/oracle-tns/connect') {
      return handleOracleTNSConnect(request);
    }

    if (url.pathname === '/api/oracle-tns/probe') {
      return handleOracleTNSProbe(request);
    }

    // MPD API endpoints
    if (url.pathname === '/api/mpd/status') {
      return handleMpdStatus(request);
    }

    if (url.pathname === '/api/mpd/command') {
      return handleMpdCommand(request);
    }

    // Beanstalkd API endpoints
    if (url.pathname === '/api/beanstalkd/connect') {
      return handleBeanstalkdConnect(request);
    }

    if (url.pathname === '/api/beanstalkd/command') {
      return handleBeanstalkdCommand(request);
    }

    if (url.pathname === '/api/beanstalkd/put') {
      return handleBeanstalkdPut(request);
    }

    if (url.pathname === '/api/beanstalkd/reserve') {
      return handleBeanstalkdReserve(request);
    }

    // Beats (Elastic Beats/Lumberjack) API endpoints
    if (url.pathname === '/api/beats/send') {
      return handleBeatsSend(request);
    }

    if (url.pathname === '/api/beats/connect') {
      return handleBeatsConnect(request);
    }

    // ClamAV API endpoints
    if (url.pathname === '/api/clamav/ping') {
      return handleClamAVPing(request);
    }

    if (url.pathname === '/api/clamav/version') {
      return handleClamAVVersion(request);
    }

    if (url.pathname === '/api/clamav/stats') {
      return handleClamAVStats(request);
    }

    if (url.pathname === '/api/clamav/scan') {
      return handleClamAVScan(request);
    }

    // LMTP API endpoints
    if (url.pathname === '/api/lmtp/connect') {
      return handleLMTPConnect(request);
    }

    if (url.pathname === '/api/lmtp/send') {
      return handleLMTPSend(request);
    }

    // ManageSieve API endpoints
    if (url.pathname === '/api/managesieve/connect') {
      return handleManageSieveConnect(request);
    }

    if (url.pathname === '/api/managesieve/list') {
      return handleManageSieveList(request);
    }

    if (url.pathname === '/api/managesieve/putscript') {
      return handleManageSievePutScript(request);
    }

    if (url.pathname === '/api/managesieve/getscript') {
      return handleManageSieveGetScript(request);
    }

    if (url.pathname === '/api/managesieve/deletescript') {
      return handleManageSieveDeleteScript(request);
    }

    if (url.pathname === '/api/managesieve/setactive') {
      return handleManageSieveSetActive(request);
    }

    // CouchDB API endpoints
    if (url.pathname === '/api/couchdb/health') {
      return handleCouchDBHealth(request);
    }

    if (url.pathname === '/api/couchdb/query') {
      return handleCouchDBQuery(request);
    }

    // IPP API endpoint
    if (url.pathname === '/api/ipp/probe') {
      return handleIPPProbe(request);
    }

    // SMPP API endpoints
    if (url.pathname === '/api/smpp/connect') {
      return handleSMPPConnect(request);
    }

    if (url.pathname === '/api/smpp/probe') {
      return handleSMPPProbe(request);
    }

    if (url.pathname === '/api/smpp/submit') {
      return handleSMPPSubmit(request);
    }

    // SVN API endpoint
    if (url.pathname === '/api/svn/connect') {
      return handleSVNConnect(request);
    }

    // TeamSpeak ServerQuery API endpoints
    if (url.pathname === '/api/teamspeak/connect') {
      return handleTeamSpeakConnect(request);
    }

    if (url.pathname === '/api/teamspeak/command') {
      return handleTeamSpeakCommand(request);
    }

    // RADIUS API endpoints
    if (url.pathname === '/api/radius/probe') {
      return handleRadiusProbe(request);
    }

    if (url.pathname === '/api/radius/auth') {
      return handleRadiusAuth(request);
    }

    // RADSEC (RADIUS over TLS) API endpoints
    if (url.pathname === '/api/radsec/auth') {
      return handleRadsecAuth(request);
    }

    if (url.pathname === '/api/radsec/connect') {
      return handleRadsecConnect(request);
    }

    // XMPP S2S API endpoints
    if (url.pathname === '/api/xmpp-s2s/ping') {
      return handleXmppS2SPing(request);
    }

    if (url.pathname === '/api/xmpp-s2s/connect') {
      return handleXmppS2SConnect(request);
    }

    // NRPE API endpoints
    if (url.pathname === '/api/nrpe/query') {
      return handleNRPEQuery(request);
    }

    if (url.pathname === '/api/nrpe/version') {
      return handleNRPEVersion(request);
    }

    // Rlogin API endpoints
    if (url.pathname === '/api/rlogin/connect') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleRloginWebSocket(request);
      }
      return handleRloginConnect(request);
    }

    // S7comm API endpoint
    if (url.pathname === '/api/s7comm/connect') {
      return handleS7commConnect(request);
    }

    // SNPP API endpoints
    if (url.pathname === '/api/snpp/probe') {
      return handleSNPPProbe(request);
    }

    if (url.pathname === '/api/snpp/page') {
      return handleSNPPPage(request);
    }

    // RethinkDB API endpoints
    if (url.pathname === '/api/rethinkdb/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleRethinkDBConnect(request);
    }

    if (url.pathname === '/api/rethinkdb/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleRethinkDBProbe(request);
    }

    // ClickHouse API endpoints
    if (url.pathname === '/api/clickhouse/health') {
      return handleClickHouseHealth(request);
    }

    if (url.pathname === '/api/clickhouse/query') {
      return handleClickHouseQuery(request);
    }

    // Gearman API endpoints
    if (url.pathname === '/api/gearman/connect') {
      return handleGearmanConnect(request);
    }

    if (url.pathname === '/api/gearman/command') {
      return handleGearmanCommand(request);
    }

    if (url.pathname === '/api/gearman/submit') {
      return handleGearmanSubmit(request);
    }

    // EtherNet/IP API endpoint
    if (url.pathname === '/api/ethernetip/identity') {
      return handleEtherNetIPIdentity(request);
    }

    // Prometheus API endpoints
    if (url.pathname === '/api/prometheus/health') {
      return handlePrometheusHealth(request);
    }

    if (url.pathname === '/api/prometheus/query') {
      return handlePrometheusQuery(request);
    }

    if (url.pathname === '/api/prometheus/metrics') {
      return handlePrometheusMetrics(request);
    }

    if (url.pathname === '/api/prometheus/range') {
      return handlePrometheusRangeQuery(request);
    }

    // Portmapper / rpcbind API endpoints
    if (url.pathname === '/api/portmapper/probe') {
      return handlePortmapperProbe(request);
    }

    if (url.pathname === '/api/portmapper/dump') {
      return handlePortmapperDump(request);
    }

    // RELP API endpoints
    if (url.pathname === '/api/relp/connect') {
      return handleRelpConnect(request);
    }

    if (url.pathname === '/api/relp/send') {
      return handleRelpSend(request);
    }

    // ADB API endpoints
    if (url.pathname === '/api/adb/command') {
      return handleADBCommand(request);
    }

    if (url.pathname === '/api/adb/version') {
      return handleADBVersion(request);
    }

    if (url.pathname === '/api/adb/devices') {
      return handleADBDevices(request);
    }

    // DNP3 API endpoints
    if (url.pathname === '/api/dnp3/connect') {
      return handleDNP3Connect(request);
    }

    if (url.pathname === '/api/dnp3/read') {
      return handleDNP3Read(request);
    }

    // STUN API endpoints
    if (url.pathname === '/api/stun/binding') {
      return handleStunBinding(request);
    }

    if (url.pathname === '/api/stun/probe') {
      return handleStunProbe(request);
    }

    // Fluentd Forward Protocol API endpoints
    if (url.pathname === '/api/fluentd/connect') {
      return handleFluentdConnect(request);
    }

    if (url.pathname === '/api/fluentd/send') {
      return handleFluentdSend(request);
    }

    // Aerospike API endpoints
    if (url.pathname === '/api/aerospike/connect') {
      return handleAerospikeConnect(request);
    }

    if (url.pathname === '/api/aerospike/info') {
      return handleAerospikeInfo(request);
    }

    // Rexec API endpoints
    if (url.pathname === '/api/rexec/execute') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleRexecWebSocket(request);
      }
      return handleRexecExecute(request);
    }

    // RSH API endpoints
    if (url.pathname === '/api/rsh/execute') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        return handleRshWebSocket(request);
      }
      return handleRshExecute(request);
    }

    // FIX Protocol API endpoints
    if (url.pathname === '/api/fix/probe') {
      return handleFIXProbe(request);
    }

    if (url.pathname === '/api/fix/heartbeat') {
      return handleFIXHeartbeat(request);
    }

    // EPMD API endpoints
    if (url.pathname === '/api/epmd/names') {
      return handleEPMDNames(request);
    }

    if (url.pathname === '/api/epmd/port') {
      return handleEPMDPort(request);
    }

    // Tarantool API endpoints
    if (url.pathname === '/api/tarantool/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleTarantoolConnect(request);
    }

    if (url.pathname === '/api/tarantool/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleTarantoolProbe(request);
    }

    if (url.pathname === '/api/tarantool/eval') {
      return handleTarantoolEval(request, env);
    }

    if (url.pathname === '/api/tarantool/sql') {
      return handleTarantoolSQL(request, env);
    }

    // Vault API endpoints
    if (url.pathname === '/api/vault/health') {
      return handleVaultHealth(request);
    }

    if (url.pathname === '/api/vault/query') {
      return handleVaultQuery(request);
    }

    if (url.pathname === '/api/vault/secret/read') {
      return handleVaultSecretRead(request);
    }

    if (url.pathname === '/api/vault/secret/write') {
      return handleVaultSecretWrite(request);
    }

    // Solr API endpoints
    if (url.pathname === '/api/solr/health') {
      return handleSolrHealth(request);
    }

    if (url.pathname === '/api/solr/query') {
      return handleSolrQuery(request);
    }

    if (url.pathname === '/api/solr/index') {
      return handleSolrIndex(request);
    }

    if (url.pathname === '/api/solr/delete') {
      return handleSolrDelete(request);
    }

    // IEC 60870-5-104 API endpoint
    if (url.pathname === '/api/iec104/probe') {
      return handleIEC104Probe(request);
    }

    // Riak API endpoints
    if (url.pathname === '/api/riak/ping') {
      return handleRiakPing(request);
    }

    if (url.pathname === '/api/riak/info') {
      return handleRiakInfo(request);
    }

    if (url.pathname === '/api/riak/get') {
      return handleRiakGet(request);
    }

    if (url.pathname === '/api/riak/put') {
      return handleRiakPut(request);
    }

    // OpenTSDB API endpoints
    if (url.pathname === '/api/opentsdb/version') {
      return handleOpenTSDBVersion(request);
    }

    if (url.pathname === '/api/opentsdb/stats') {
      return handleOpenTSDBStats(request);
    }

    if (url.pathname === '/api/opentsdb/suggest') {
      return handleOpenTSDBSuggest(request);
    }

    if (url.pathname === '/api/opentsdb/put') {
      return handleOpenTSDBPut(request);
    }

    if (url.pathname === '/api/opentsdb/query') {
      return handleOpenTSDBQuery(request);
    }

    // SpamAssassin spamd API endpoints
    if (url.pathname === '/api/spamd/ping') {
      return handleSpamdPing(request);
    }

    if (url.pathname === '/api/spamd/check') {
      return handleSpamdCheck(request);
    }

    if (url.pathname === '/api/spamd/tell') {
      return handleSpamdTell(request);
    }

    // Bitcoin API endpoints
    if (url.pathname === '/api/bitcoin/connect') {
      return handleBitcoinConnect(request);
    }

    if (url.pathname === '/api/bitcoin/getaddr') {
      return handleBitcoinGetAddr(request);
    }

    // NSQ API endpoints
    if (url.pathname === '/api/nsq/connect') {
      return handleNSQConnect(request);
    }

    if (url.pathname === '/api/nsq/publish') {
      return handleNSQPublish(request);
    }

    if (url.pathname === '/api/nsq/subscribe') {
      return handleNSQSubscribe(request);
    }

    if (url.pathname === '/api/nsq/mpub') {
      return handleNSQMultiPublish(request);
    }

    // ZMTP / ZeroMQ API endpoints
    if (url.pathname === '/api/zmtp/probe') {
      return handleZMTPProbe(request);
    }

    if (url.pathname === '/api/zmtp/handshake') {
      return handleZMTPHandshake(request);
    }

    // OPC UA API endpoints
    if (url.pathname === '/api/opcua/hello') {
      return handleOPCUAHello(request);
    }

    if (url.pathname === '/api/opcua/endpoints') {
      return handleOPCUAEndpoints(request);
    }

    if (url.pathname === '/api/opcua/read') {
      return handleOPCUARead(request);
    }

    // Munin API endpoints
    if (url.pathname === '/api/munin/connect') {
      return handleMuninConnect(request);
    }

    if (url.pathname === '/api/munin/fetch') {
      return handleMuninFetch(request);
    }

    // SANE API endpoint
    if (url.pathname === '/api/sane/probe') {
      return handleSANEProbe(request);
    }

    // Ceph Monitor API endpoints
    if (url.pathname === '/api/ceph/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleCephConnect(request);
    }

    if (url.pathname === '/api/ceph/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleCephProbe(request);
    }

    // HTTP Proxy API endpoints
    if (url.pathname === '/api/httpproxy/probe') {
      return handleHTTPProxyProbe(request);
    }

    if (url.pathname === '/api/httpproxy/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleHTTPProxyConnect(request);
    }

    // Varnish CLI API endpoints
    if (url.pathname === '/api/varnish/probe') {
      return handleVarnishProbe(request);
    }

    if (url.pathname === '/api/varnish/command') {
      return handleVarnishCommand(request);
    }

    // Omron FINS API endpoint
    if (url.pathname === '/api/fins/connect') {
      return handleFINSConnect(request);
    }

    // Couchbase API endpoints
    if (url.pathname === '/api/couchbase/ping') {
      return handleCouchbasePing(request);
    }

    if (url.pathname === '/api/couchbase/version') {
      return handleCouchbaseVersion(request);
    }

    if (url.pathname === '/api/couchbase/stats') {
      return handleCouchbaseStats(request);
    }

    if (url.pathname === '/api/couchbase/get') {
      return handleCouchbaseGet(request);
    }

    if (url.pathname === '/api/couchbase/set') {
      return handleCouchbaseSet(request);
    }

    // Asterisk AMI API endpoints
    if (url.pathname === '/api/ami/probe') {
      return handleAMIProbe(request);
    }

    if (url.pathname === '/api/ami/command') {
      return handleAMICommand(request);
    }

    // JDWP API endpoints
    if (url.pathname === '/api/jdwp/probe') {
      return handleJDWPProbe(request);
    }

    if (url.pathname === '/api/jdwp/version') {
      return handleJDWPVersion(request);
    }

    // DRDA / DB2 API endpoints
    if (url.pathname === '/api/drda/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleDRDAConnect(request);
    }

    if (url.pathname === '/api/drda/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleDRDAProbe(request);
    }

    // Livestatus API endpoints
    if (url.pathname === '/api/livestatus/status') {
      return handleLivestatusStatus(request);
    }

    if (url.pathname === '/api/livestatus/hosts') {
      return handleLivestatusHosts(request);
    }

    if (url.pathname === '/api/livestatus/query') {
      return handleLivestatusQuery(request);
    }

    // DCERPC / MS-RPC API endpoints
    if (url.pathname === '/api/dcerpc/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleDCERPCConnect(request);
    }

    if (url.pathname === '/api/dcerpc/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleDCERPCProbe(request);
    }

    // PJLink API endpoints
    if (url.pathname === '/api/pjlink/probe') {
      return handlePJLinkProbe(request);
    }

    if (url.pathname === '/api/pjlink/power') {
      return handlePJLinkPower(request);
    }

    // NSCA API endpoints
    if (url.pathname === '/api/nsca/probe') {
      return handleNSCAProbe(request);
    }

    if (url.pathname === '/api/nsca/send') {
      return handleNSCASend(request);
    }

    // Meilisearch API endpoints
    if (url.pathname === '/api/meilisearch/health') {
      return handleMeilisearchHealth(request);
    }

    if (url.pathname === '/api/meilisearch/search') {
      return handleMeilisearchSearch(request);
    }

    if (url.pathname === '/api/meilisearch/documents') {
      return handleMeilisearchDocuments(request);
    }

    if (url.pathname === '/api/meilisearch/delete') {
      return handleMeilisearchDelete(request);
    }

    // IMAPS API endpoints
    if (url.pathname === '/api/imaps/connect') {
      return handleIMAPSConnect(request);
    }

    if (url.pathname === '/api/imaps/list') {
      return handleIMAPSList(request);
    }

    if (url.pathname === '/api/imaps/select') {
      return handleIMAPSSelect(request);
    }

    // Icecast Streaming Server API endpoints
    if (url.pathname === '/api/icecast/status') {
      return handleIcecastStatus(request);
    }

    if (url.pathname === '/api/icecast/admin') {
      return handleIcecastAdmin(request);
    }

    // Loki API endpoints
    if (url.pathname === '/api/loki/health') {
      return handleLokiHealth(request);
    }
    if (url.pathname === '/api/loki/query') {
      return handleLokiQuery(request);
    }
    if (url.pathname === '/api/loki/metrics') {
      return handleLokiMetrics(request);
    }

    if (url.pathname === '/api/loki/push') {
      return handleLokiPush(request);
    }

    if (url.pathname === '/api/loki/range') {
      return handleLokiRangeQuery(request);
    }

    // OpenFlow SDN API endpoints
    if (url.pathname === '/api/openflow/probe') {
      return handleOpenFlowProbe(request);
    }

    if (url.pathname === '/api/openflow/echo') {
      return handleOpenFlowEcho(request);
    }

    // RMI API endpoints
    if (url.pathname === '/api/rmi/probe') {
      return handleRMIProbe(request);
    }

    if (url.pathname === '/api/rmi/list') {
      return handleRMIList(request);
    }

    // HAProxy Runtime API endpoints
    if (url.pathname === '/api/haproxy/info') {
      return handleHAProxyInfo(request);
    }

    if (url.pathname === '/api/haproxy/stat') {
      return handleHAProxyStat(request);
    }

    if (url.pathname === '/api/haproxy/command') {
      return handleHAProxyCommand(request);
    }

    // NBD API endpoints
    if (url.pathname === '/api/nbd/connect') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleNBDConnect(request);
    }

    if (url.pathname === '/api/nbd/probe') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleNBDProbe(request);
    }

    if (url.pathname === '/api/nbd/read') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleNBDRead(request);
    }

    // Ganglia gmond API endpoints
    if (url.pathname === '/api/ganglia/connect') {
      return handleGangliaConnect(request);
    }

    if (url.pathname === '/api/ganglia/probe') {
      return handleGangliaProbe(request);
    }

    // NetBIOS Session Service API endpoints
    if (url.pathname === '/api/netbios/connect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleNetBIOSConnect(request);
    }

    if (url.pathname === '/api/netbios/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleNetBIOSProbe(request);
    }

    // POP3S API endpoints
    if (url.pathname === '/api/pop3s/connect') {
      return handlePOP3SConnect(request);
    }

    if (url.pathname === '/api/pop3s/list') {
      return handlePOP3SList(request);
    }

    if (url.pathname === '/api/pop3s/retrieve') {
      return handlePOP3SRetrieve(request);
    }

    // SMTPS API endpoints
    if (url.pathname === '/api/smtps/connect') {
      return handleSMTPSConnect(request);
    }

    if (url.pathname === '/api/smtps/send') {
      return handleSMTPSSend(request);
    }

    // NNTPS API endpoints
    if (url.pathname === '/api/nntps/connect') {
      return handleNNTPSConnect(request);
    }

    if (url.pathname === '/api/nntps/group') {
      return handleNNTPSGroup(request);
    }

    if (url.pathname === '/api/nntps/article') {
      return handleNNTPSArticle(request);
    }

    if (url.pathname === '/api/nntps/list') {
      return handleNNTPSList(request);
    }

    if (url.pathname === '/api/nntps/post') {
      return handleNNTPSPost(request);
    }

    if (url.pathname === '/api/nntps/auth') {
      return handleNNTPSAuth(request);
    }

    // PCEP API endpoints
    if (url.pathname === '/api/pcep/connect') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handlePCEPConnect(request);
    }

    if (url.pathname === '/api/pcep/probe') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handlePCEPProbe(request);
    }

    // uWSGI API endpoints
    if (url.pathname === '/api/uwsgi/probe') {
      return handleUwsgiProbe(request);
    }

    if (url.pathname === '/api/uwsgi/request') {
      return handleUwsgiRequest(request);
    }

    // WinRM API endpoints
    if (url.pathname === '/api/winrm/identify') {
      return handleWinRMIdentify(request);
    }

    if (url.pathname === '/api/winrm/auth') {
      return handleWinRMAuth(request);
    }

    // Hazelcast API endpoints
    if (url.pathname === '/api/hazelcast/probe') {
      return handleHazelcastProbe(request);
    }
    if (url.pathname === '/api/hazelcast/map-get') {
      return handleHazelcastMapGet(request);
    }

    // Kibana API endpoints
    if (url.pathname === '/api/kibana/status') {
      return handleKibanaStatus(request);
    }
    if (url.pathname === '/api/kibana/saved-objects') {
      return handleKibanaSavedObjects(request);
    }

    if (url.pathname === '/api/kibana/index-patterns') {
      return handleKibanaIndexPatterns(request);
    }

    if (url.pathname === '/api/kibana/alerts') {
      return handleKibanaAlerts(request);
    }

    if (url.pathname === '/api/kibana/query') {
      return handleKibanaQuery(request);
    }

    // Grafana API endpoints
    if (url.pathname === '/api/grafana/health') {
      return handleGrafanaHealth(request);
    }
    if (url.pathname === '/api/grafana/datasources') {
      return handleGrafanaDatasources(request);
    }
    if (url.pathname === '/api/grafana/dashboards') {
      return handleGrafanaDashboards(request);
    }
    if (url.pathname === '/api/grafana/folders') {
      return handleGrafanaFolders(request);
    }
    if (url.pathname === '/api/grafana/alert-rules') {
      return handleGrafanaAlertRules(request);
    }
    if (url.pathname === '/api/grafana/org') {
      return handleGrafanaOrg(request);
    }
    if (url.pathname === '/api/grafana/dashboard') {
      return handleGrafanaDashboard(request);
    }

    // GPSD API endpoints
    if (url.pathname === '/api/gpsd/version') {
      return handleGPSDVersion(request);
    }
    if (url.pathname === '/api/gpsd/devices') {
      return handleGPSDDevices(request);
    }
    if (url.pathname === '/api/gpsd/poll') {
      return handleGPSDPoll(request);
    }
    if (url.pathname === '/api/gpsd/command') {
      return handleGPSDCommand(request);
    }

    // Rserve API endpoints
    if (url.pathname === '/api/rserve/probe') {
      return handleRserveProbe(request);
    }

    if (url.pathname === '/api/rserve/eval') {
      return handleRserveEval(request);
    }

    // Redis Sentinel API endpoints
    if (url.pathname === '/api/sentinel/probe') {
      return handleSentinelProbe(request);
    }

    if (url.pathname === '/api/sentinel/query') {
      return handleSentinelQuery(request);
    }

    // Sonic API endpoints
    if (url.pathname === '/api/sonic/probe') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleSonicProbe(request);
    }

    if (url.pathname === '/api/sonic/ping') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleSonicPing(request);
    }


    // RabbitMQ Management API endpoints
    if (url.pathname === '/api/rabbitmq/health') {
      return handleRabbitMQHealth(request);
    }

    if (url.pathname === '/api/rabbitmq/query') {
      return handleRabbitMQQuery(request);
    }

    // Nomad API endpoints
    if (url.pathname === '/api/nomad/health') {
      return handleNomadHealth(request);
    }

    if (url.pathname === '/api/nomad/jobs') {
      return handleNomadJobs(request);
    }

    if (url.pathname === '/api/nomad/nodes') {
      return handleNomadNodes(request);
    }

    if (url.pathname === '/api/nomad/allocations') {
      return handleNomadAllocations(request);
    }

    if (url.pathname === '/api/nomad/deployments') {
      return handleNomadDeployments(request);
    }

    if (url.pathname === '/api/nomad/dispatch') {
      return handleNomadJobDispatch(request);
    }

    // LDP API endpoints
    if (url.pathname === '/api/ldp/connect') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleLDPConnect(request);
    }

    if (url.pathname === '/api/ldp/probe') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleLDPProbe(request);
    }

    // Apache Ignite Thin Client API endpoints
    if (url.pathname === '/api/ignite/connect') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleIgniteConnect(request);
    }

    if (url.pathname === '/api/ignite/probe') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return handleIgniteProbe(request);
    }
    if (url.pathname === '/api/ignite/list-caches') {
      return handleIgniteListCaches(request);
    }
    if (url.pathname === '/api/ignite/cache-get') {
      return handleIgniteCacheGet(request);
    }

    // Firebird SQL API endpoints
    if (url.pathname === '/api/firebird/probe') {
      return handleFirebirdProbe(request);
    }

    if (url.pathname === '/api/firebird/version') {
      return handleFirebirdVersion(request);
    }

    // Tor Control API endpoints
    if (url.pathname === '/api/torcontrol/probe') {
      return handleTorControlProbe(request);
    }

    if (url.pathname === '/api/torcontrol/getinfo') {
      return handleTorControlGetInfo(request);
    }


    // CVS pserver API endpoints
    if (url.pathname === '/api/cvs/connect') {
      return handleCVSConnect(request);
    }

    if (url.pathname === '/api/cvs/login') {
      return handleCVSLogin(request);
    }

    // TFTP API endpoints
    if (url.pathname === '/api/tftp/connect') {
      return handleTFTPConnect(request);
    }

    if (url.pathname === '/api/tftp/read') {
      return handleTFTPRead(request);
    }

    if (url.pathname === '/api/tftp/write') {
      return handleTFTPWrite(request);
    }


    // AMQPS API endpoint
    if (url.pathname === '/api/amqps/connect') {
      return handleAMQPSConnect(request);
    }
    if (url.pathname === '/api/amqps/publish') {
      return handleAMQPSPublish(request);
    }

    // SNMP API endpoints
    if (url.pathname === '/api/snmp/get') {
      return handleSNMPGet(request);
    }

    if (url.pathname === '/api/snmp/walk') {
      return handleSNMPWalk(request);
    }

    // NTP API endpoints
    if (url.pathname === '/api/ntp/query') {
      return handleNTPQuery(request);
    }

    if (url.pathname === '/api/ntp/sync') {
      return handleNTPSync(request);
    }

    // L2TP API endpoints
    if (url.pathname === '/api/l2tp/connect') {
      return handleL2TPConnect(request);
    }

    if (url.pathname === '/api/l2tp/hello') {
      return handleL2TPHello(request);
    }

    // TURN API endpoints
    if (url.pathname === '/api/turn/allocate') {
      return handleTURNAllocate(request);
    }

    if (url.pathname === '/api/turn/probe') {
      return handleTURNProbe(request);
    }

    // CoAP API endpoints
    if (url.pathname === '/api/coap/request') {
      return handleCoAPRequest(request);
    }

    if (url.pathname === '/api/coap/discover') {
      return handleCoAPDiscover(request);
    }

    // IKE/ISAKMP API endpoints
    if (url.pathname === '/api/ike/probe') {
      return handleIKEProbe(request);
    }

    if (url.pathname === '/api/ike/version') {
      return handleIKEVersionDetect(request);
    }

    // RIP API endpoints
    if (url.pathname === '/api/rip/request') {
      return handleRIPRequest(request);
    }

    if (url.pathname === '/api/rip/probe') {
      return handleRIPProbe(request);
    }

    // mDNS API endpoints
    if (url.pathname === '/api/mdns/query') {
      return handleMDNSQuery(request);
    }

    if (url.pathname === '/api/mdns/discover') {
      return handleMDNSDiscover(request);
    }

    // HSRP API endpoints
    if (url.pathname === '/api/hsrp/probe') {
      return handleHSRPProbe(request);
    }

    if (url.pathname === '/api/hsrp/listen') {
      return handleHSRPListen(request);
    }

    // XMPP S2S API endpoints
    if (url.pathname === '/api/xmpps2s/probe') {
      return handleXMPPS2SProbe(request);
    }

    if (url.pathname === '/api/xmpps2s/federation') {
      return handleXMPPS2SFederationTest(request);
    }

    // MSN/MSNP API endpoints
    if (url.pathname === '/api/msn/probe') {
      return handleMSNProbe(request);
    }

    if (url.pathname === '/api/msn/version') {
      return handleMSNClientVersion(request);
    }

    // YMSG (Yahoo Messenger) API endpoints
    if (url.pathname === '/api/ymsg/probe') {
      return handleYMSGProbe(request);
    }

    if (url.pathname === '/api/ymsg/version') {
      return handleYMSGVersionDetect(request);
    }

    // OSCAR (AIM/ICQ) API endpoints
    if (url.pathname === '/api/oscar/probe') {
      return handleOSCARProbe(request);
    }

    if (url.pathname === '/api/oscar/ping') {
      return handleOSCARPing(request);
    }

    // Jabber Component API endpoints
    if (url.pathname === '/api/jabber-component/probe') {
      return handleJabberComponentProbe(request);
    }

    if (url.pathname === '/api/jabber-component/handshake') {
      return handleJabberComponentHandshake(request);
    }

    // MMS (Microsoft Media Server) API endpoints
    if (url.pathname === '/api/mms/probe') {
      return handleMMSProbe(request);
    }

    if (url.pathname === '/api/mms/describe') {
      return handleMMSDescribe(request);
    }

    // RealAudio API endpoints
    if (url.pathname === '/api/realaudio/probe') {
      return handleRealAudioProbe(request);
    }

    if (url.pathname === '/api/realaudio/describe') {
      return handleRealAudioDescribe(request);
    }

    // SHOUTcast API endpoints
    if (url.pathname === '/api/shoutcast/probe') {
      return handleShoutCastProbe(request);
    }

    if (url.pathname === '/api/shoutcast/info') {
      return handleShoutCastInfo(request);
    }

    // Mumble API endpoints
    if (url.pathname === '/api/mumble/probe') {
      return handleMumbleProbe(request);
    }

    if (url.pathname === '/api/mumble/version') {
      return handleMumbleVersion(request);
    }

    // Sybase API endpoints
    if (url.pathname === '/api/sybase/probe') {
      return handleSybaseProbe(request);
    }

    if (url.pathname === '/api/sybase/version') {
      return handleSybaseVersion(request);
    }

    if (url.pathname === '/api/sybase/login') {
      return handleSybaseLogin(request);
    }

    if (url.pathname === '/api/sybase/query') {
      return handleSybaseQuery(request);
    }

    // Ventrilo API endpoints
    if (url.pathname === '/api/ventrilo/status') {
      return handleVentriloStatus(request);
    }

    if (url.pathname === '/api/ventrilo/connect') {
      return handleVentriloConnect(request);
    }

    // Napster API endpoints
    if (url.pathname === '/api/napster/connect') {
      return handleNapsterConnect(request);
    }

    if (url.pathname === '/api/napster/login') {
      return handleNapsterLogin(request);
    }

    if (url.pathname === '/api/napster/stats') {
      return handleNapsterStats(request);
    }

    // Informix API endpoints
    if (url.pathname === '/api/informix/probe') {
      return handleInformixProbe(request);
    }

    if (url.pathname === '/api/informix/version') {
      return handleInformixVersion(request);
    }

    // EPP (Extensible Provisioning Protocol) API endpoints
    if (url.pathname === '/api/epp/connect') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      try {
        const data = await request.json<{ host: string; port: number; timeout?: number }>();
        const result = await eppConnect({ host: data.host, port: data.port });
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
          status: result.success ? 200 : 500,
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/api/epp/login') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      try {
        const data = await request.json<{ host: string; port: number; clid: string; pw: string; timeout?: number }>();
        const result = await eppLogin({ host: data.host, port: data.port, clid: data.clid, pw: data.pw });
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
          status: result.success ? 200 : 500,
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/api/epp/domain-check') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      try {
        const data = await request.json<{ host: string; port: number; clid: string; pw: string; domain: string; timeout?: number }>();
        const result = await eppDomainCheck({ host: data.host, port: data.port, clid: data.clid, pw: data.pw }, data.domain);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
          status: result.success ? 200 : 500,
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // HTTP/1.1 API endpoints
    if (url.pathname === '/api/http/request') {
      return handleHTTPRequest(request);
    }

    if (url.pathname === '/api/http/head') {
      return handleHTTPHead(request);
    }

    if (url.pathname === '/api/http/options') {
      return handleHTTPOptions(request);
    }

    // UUCP API endpoints
    if (url.pathname === '/api/uucp/probe') {
      return handleUUCPProbe(request);
    }

    // Perforce API endpoints
    if (url.pathname === '/api/perforce/probe') {
      return handlePerforceProbe(request);
    }

    if (url.pathname === '/api/perforce/info') {
      return handlePerforceInfo(request);
    }

    // Quake 3 API endpoints
    if (url.pathname === '/api/quake3/status') {
      return handleQuake3Status(request);
    }

    if (url.pathname === '/api/quake3/info') {
      return handleQuake3Info(request);
    }

    // collectd API endpoints
    if (url.pathname === '/api/collectd/probe') {
      return handleCollectdProbe(request);
    }

    if (url.pathname === '/api/collectd/send') {
      return handleCollectdSend(request);
    }

    // Ethereum P2P API endpoints
    if (url.pathname === '/api/ethereum/probe') {
      return handleEthereumProbe(request);
    }

    // IPFS API endpoints
    if (url.pathname === '/api/ipfs/probe') {
      return handleIPFSProbe(request);
    }

    // Kubernetes API endpoints
    if (url.pathname === '/api/kubernetes/probe') {
      return handleKubernetesProbe(request);
    }

    if (url.pathname === '/api/kubernetes/query') {
      return handleKubernetesQuery(request);
    }

    if (url.pathname === '/api/activemq/probe') {
      return handleActiveMQProbe(request);
    }

    // Serve static assets (built React app)
    return env.ASSETS.fetch(request);
  },
};

/**
 * TCP Ping Handler
 *
 * Performs a "TCP ping" by opening a connection and measuring round-trip time.
 * Note: This is NOT an ICMP ping - it's a TCP handshake check.
 */
async function handleTcpPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port, timeout = 10000 } = await request.json<{ host: string; port: number; timeout?: number }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const rtt = Date.now() - start;

    await socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      message: `TCP Ping Success: ${rtt}ms`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'TCP Ping Failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Socket Connection Handler
 *
 * Establishes a WebSocket tunnel to a TCP socket.
 * This enables browser-based SSH and other TCP protocol access.
 */
async function handleSocketConnection(request: Request): Promise<Response> {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    const { host, port } = await request.json<{ host: string; port: number }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Connect to TCP socket
    const socket = connect(`${host}:${port}`);

    // Pipe data between WebSocket and TCP socket
    await Promise.all([
      pipeWebSocketToSocket(server, socket),
      pipeSocketToWebSocket(socket, server),
    ]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Pipe data from WebSocket to TCP socket
 */
async function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): Promise<void> {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      await writer.write(new TextEncoder().encode(event.data));
    } else if (event.data instanceof ArrayBuffer) {
      await writer.write(new Uint8Array(event.data));
    }
  });

  ws.addEventListener('close', () => {
    writer.close();
  });
}

/**
 * Pipe data from TCP socket to WebSocket
 */
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      ws.close();
      break;
    }

    ws.send(value);
  }
}
