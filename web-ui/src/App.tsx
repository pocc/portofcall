import { useState } from 'react';
import ProtocolSelector from './components/ProtocolSelector';
import FTPClient from './components/FTPClient';
import SSHClient from './components/SSHClient';

type Protocol = 'ftp' | 'ssh' | null;

function App() {
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol>(null);

  const renderProtocolClient = () => {
    switch (selectedProtocol) {
      case 'ftp':
        return <FTPClient onBack={() => setSelectedProtocol(null)} />;
      case 'ssh':
        return <SSHClient onBack={() => setSelectedProtocol(null)} />;
      default:
        return <ProtocolSelector onSelect={setSelectedProtocol} />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {renderProtocolClient()}
      </div>
    </div>
  );
}

export default App;
