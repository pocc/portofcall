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
import { handleSSHConnect, handleSSHExecute, handleSSHDisconnect } from './ssh';
import { handleTelnetConnect, handleTelnetWebSocket } from './telnet';
import { handleSMTPConnect, handleSMTPSend } from './smtp';
import { handlePOP3Connect, handlePOP3List, handlePOP3Retrieve } from './pop3';
import { handleIMAPConnect, handleIMAPList, handleIMAPSelect } from './imap';
import { handleMySQLConnect, handleMySQLQuery } from './mysql';
import { handlePostgreSQLConnect } from './postgres';
import { handleRedisConnect, handleRedisCommand } from './redis';
import { handleMQTTConnect } from './mqtt';
import { handleLDAPConnect } from './ldap';
import { handleSMBConnect } from './smb';
import { handleEchoTest, handleEchoWebSocket } from './echo';
import { handleWhoisLookup } from './whois';
import { handleSyslogSend } from './syslog';
import { handleSocks4Connect } from './socks4';
import { handleDaytimeGet } from './daytime';
import { handleFingerQuery } from './finger';
import { handleTimeGet } from './time';
import { handleChargenStream } from './chargen';
import { handleGeminiFetch } from './gemini';
import { handleGopherFetch } from './gopher';
import { handleIRCConnect, handleIRCWebSocket } from './irc';
import { handleMemcachedConnect, handleMemcachedCommand, handleMemcachedStats } from './memcached';
import { handleDNSQuery } from './dns';
import { handleNNTPConnect, handleNNTPGroup, handleNNTPArticle } from './nntp';
import { handleStompConnect, handleStompSend } from './stomp';
import { handleSocks5Connect } from './socks5';
import { handleModbusConnect, handleModbusRead } from './modbus';
import { handleMongoDBConnect, handleMongoDBPing } from './mongodb';
import { handleGraphiteSend } from './graphite';
import { handleRCONConnect, handleRCONCommand } from './rcon';
import { handleGitRefs } from './git';
import { handleZooKeeperConnect, handleZooKeeperCommand } from './zookeeper';
import { handleCassandraConnect } from './cassandra';
import { handleAMQPConnect } from './amqp';
import { handleKafkaApiVersions, handleKafkaMetadata } from './kafka';
import { handleRtspOptions, handleRtspDescribe } from './rtsp';
import { handleRsyncConnect, handleRsyncModule } from './rsync';
import { handleTDSConnect } from './tds';
import { handleVNCConnect } from './vnc';
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

    // Modbus TCP API endpoints
    if (url.pathname === '/api/modbus/connect') {
      return handleModbusConnect(request);
    }

    if (url.pathname === '/api/modbus/read') {
      return handleModbusRead(request);
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

    // MySQL API endpoints
    if (url.pathname === '/api/mysql/connect') {
      return handleMySQLConnect(request);
    }

    if (url.pathname === '/api/mysql/query') {
      return handleMySQLQuery(request);
    }

    // PostgreSQL API endpoints
    if (url.pathname === '/api/postgres/connect') {
      return handlePostgreSQLConnect(request);
    }

    // Redis API endpoints
    if (url.pathname === '/api/redis/connect') {
      return handleRedisConnect(request);
    }

    if (url.pathname === '/api/redis/command') {
      return handleRedisCommand(request);
    }

    // MQTT API endpoints
    if (url.pathname === '/api/mqtt/connect') {
      return handleMQTTConnect(request);
    }

    // LDAP API endpoints
    if (url.pathname === '/api/ldap/connect') {
      return handleLDAPConnect(request);
    }

    // SMB API endpoints
    if (url.pathname === '/api/smb/connect') {
      return handleSMBConnect(request);
    }

    // MongoDB API endpoints
    if (url.pathname === '/api/mongodb/connect') {
      return handleMongoDBConnect(request);
    }

    if (url.pathname === '/api/mongodb/ping') {
      return handleMongoDBPing(request);
    }

    // STOMP API endpoints
    if (url.pathname === '/api/stomp/connect') {
      return handleStompConnect(request);
    }

    if (url.pathname === '/api/stomp/send') {
      return handleStompSend(request);
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

    // AMQP API endpoint
    if (url.pathname === '/api/amqp/connect') {
      return handleAMQPConnect(request);
    }

    // Cassandra CQL API endpoint
    if (url.pathname === '/api/cassandra/connect') {
      return handleCassandraConnect(request);
    }

    // RTSP API endpoints
    if (url.pathname === '/api/rtsp/options') {
      return handleRtspOptions(request);
    }

    if (url.pathname === '/api/rtsp/describe') {
      return handleRtspDescribe(request);
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
    const { host, port } = await request.json<{ host: string; port: number }>();

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

    await socket.opened;
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
