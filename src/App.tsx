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
const POP3Client = lazy(() => import('./components/POP3Client'));
const IMAPClient = lazy(() => import('./components/IMAPClient'));
const MySQLClient = lazy(() => import('./components/MySQLClient'));
const PostgreSQLClient = lazy(() => import('./components/PostgreSQLClient'));
const RedisClient = lazy(() => import('./components/RedisClient'));
const MQTTClient = lazy(() => import('./components/MQTTClient'));
const LDAPClient = lazy(() => import('./components/LDAPClient'));
const SMBClient = lazy(() => import('./components/SMBClient'));
const IRCClient = lazy(() => import('./components/IRCClient'));
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
  | 'pop3'
  | 'imap'
  | 'mysql'
  | 'postgres'
  | 'redis'
  | 'mqtt'
  | 'ldap'
  | 'smb'
  | 'irc'
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
      case 'smb':
        return <SMBClient onBack={handleBack} />;
      case 'irc':
        return <IRCClient onBack={handleBack} />;
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
