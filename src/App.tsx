import { useState, lazy, Suspense } from 'react';
import './App.css';
import ProtocolSelector from './components/ProtocolSelector';

// Lazy load all protocol clients for better performance
const EchoClient = lazy(() => import('./components/EchoClient'));
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

type Protocol =
  | 'echo'
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

  const renderProtocolClient = () => {
    const handleBack = () => setSelectedProtocol(null);

    switch (selectedProtocol) {
      case 'echo':
        return <EchoClient onBack={handleBack} />;
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
      default:
        return <ProtocolSelector onSelect={setSelectedProtocol} />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        <Suspense fallback={<LoadingFallback />}>{renderProtocolClient()}</Suspense>
      </div>
    </div>
  );
}

export default App;
