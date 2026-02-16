import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface SLPProps {
  onBack: () => void;
}

interface ServiceTypesResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  version?: number;
  xid?: number;
  languageTag?: string;
  scope?: string;
  serviceTypes?: string[];
  serviceTypeCount?: number;
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

interface ServiceFindResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  version?: number;
  xid?: number;
  serviceType?: string;
  scope?: string;
  services?: Array<{ url: string; lifetime: number }>;
  serviceCount?: number;
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

interface AttributeResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  version?: number;
  xid?: number;
  serviceUrl?: string;
  scope?: string;
  attributes?: Record<string, string>;
  attributeCount?: number;
  rawAttributeList?: string;
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

type TabType = 'types' | 'find' | 'attributes';

export default function SLPClient({ onBack }: SLPProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  const [host, setHost] = useState('');
  const [port, setPort] = useState('427');
  const [scope, setScope] = useState('DEFAULT');
  const [activeTab, setActiveTab] = useState<TabType>('types');
  const [loading, setLoading] = useState(false);

  // Find-specific fields
  const [serviceType, setServiceType] = useState('service:printer:lpr');
  const [predicate, setPredicate] = useState('');

  // Attribute-specific fields
  const [serviceUrl, setServiceUrl] = useState('');

  // Results
  const [typesResult, setTypesResult] = useState<ServiceTypesResult | null>(null);
  const [findResult, setFindResult] = useState<ServiceFindResult | null>(null);
  const [attrResult, setAttrResult] = useState<AttributeResult | null>(null);

  const handleFindTypes = async () => {
    if (!host) return;
    setLoading(true);
    setTypesResult(null);

    try {
      const response = await fetch('/api/slp/types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 427,
          scope,
          timeout: 10000,
        }),
      });
      setTypesResult(await response.json());
    } catch (err) {
      setTypesResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleFindServices = async () => {
    if (!host || !serviceType) return;
    setLoading(true);
    setFindResult(null);

    try {
      const response = await fetch('/api/slp/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 427,
          serviceType,
          scope,
          predicate: predicate || undefined,
          timeout: 10000,
        }),
      });
      setFindResult(await response.json());
    } catch (err) {
      setFindResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleGetAttributes = async () => {
    if (!host || !serviceUrl) return;
    setLoading(true);
    setAttrResult(null);

    try {
      const response = await fetch('/api/slp/attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 427,
          url: serviceUrl,
          scope,
          timeout: 10000,
        }),
      });
      setAttrResult(await response.json());
    } catch (err) {
      setAttrResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const selectServiceType = (type: string) => {
    setServiceType(type);
    setActiveTab('find');
  };

  const selectServiceUrl = (url: string) => {
    setServiceUrl(url);
    setActiveTab('attributes');
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className={`${isRetro ? 'retro-button' : 'bg-slate-700 hover:bg-slate-600'} text-white px-3 py-2 rounded-lg transition-colors`}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 ${isRetro ? 'retro-card' : 'bg-gradient-to-br from-teal-500 to-teal-700'} rounded-xl flex items-center justify-center`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <path d="M12 8v4l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white" />
              <path d="M4 12h2M18 12h2M12 4v2M12 18v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-white/60" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" className="text-white" />
            </svg>
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>SLP Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              Service Location Protocol · Port 427 · RFC 2608
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['types', 'find', 'attributes'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === tab
                ? isRetro
                  ? 'retro-button-active'
                  : 'bg-teal-600 text-white'
                : isRetro
                ? 'retro-button'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'types' ? 'Service Types' : tab === 'find' ? 'Find Services' : 'Attributes'}
          </button>
        ))}
      </div>

      {/* Connection Form */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          Connection Settings
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="slp-server.example.com"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-teal-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="427"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-teal-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Scope</label>
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="DEFAULT"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-teal-500`}
            />
          </div>
        </div>

        {/* Tab-specific fields */}
        {activeTab === 'find' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Service Type</label>
              <input
                type="text"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="service:printer:lpr"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                Predicate (LDAP filter, optional)
              </label>
              <input
                type="text"
                value={predicate}
                onChange={(e) => setPredicate(e.target.value)}
                placeholder="(location=floor3)"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
            </div>
          </div>
        )}

        {activeTab === 'attributes' && (
          <div className="mb-4">
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Service URL</label>
            <input
              type="text"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              placeholder="service:printer:lpr://printer.example.com/queue1"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-teal-500`}
            />
          </div>
        )}

        <button
          onClick={
            activeTab === 'types'
              ? handleFindTypes
              : activeTab === 'find'
              ? handleFindServices
              : handleGetAttributes
          }
          disabled={
            loading ||
            !host ||
            (activeTab === 'find' && !serviceType) ||
            (activeTab === 'attributes' && !serviceUrl)
          }
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            loading || !host || (activeTab === 'find' && !serviceType) || (activeTab === 'attributes' && !serviceUrl)
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : isRetro
              ? 'retro-button'
              : 'bg-teal-600 hover:bg-teal-500 text-white'
          }`}
        >
          {loading
            ? 'Discovering...'
            : activeTab === 'types'
            ? 'Discover Service Types'
            : activeTab === 'find'
            ? 'Find Services'
            : 'Get Attributes'}
        </button>
      </div>

      {/* Service Types Result */}
      {activeTab === 'types' && typesResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Service Types
          </h2>

          {!typesResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{typesResult.error}</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Version</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>{typesResult.version}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Types Found</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-teal-400'}`}>{typesResult.serviceTypeCount}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{typesResult.connectTimeMs}ms</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{typesResult.totalTimeMs}ms</p>
                </div>
              </div>

              {/* Service Types List */}
              {typesResult.serviceTypes && typesResult.serviceTypes.length > 0 ? (
                <div className="space-y-2">
                  {typesResult.serviceTypes.map((type, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                        isRetro ? 'retro-card hover:border-green-400/50' : 'bg-slate-900/50 border border-slate-700 hover:border-teal-500/50'
                      }`}
                      onClick={() => selectServiceType(type)}
                    >
                      <span className={`font-mono ${isRetro ? 'retro-text' : 'text-teal-300'}`}>{type}</span>
                      <span className={`text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>→ Find</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>No service types found in scope "{typesResult.scope}"</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Find Services Result */}
      {activeTab === 'find' && findResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Services Found
          </h2>

          {!findResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{findResult.error}</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Service Type</p>
                  <p className={`text-sm font-bold ${isRetro ? 'retro-text' : 'text-white'} truncate`}>{findResult.serviceType}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Found</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-teal-400'}`}>{findResult.serviceCount}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{findResult.connectTimeMs}ms</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{findResult.totalTimeMs}ms</p>
                </div>
              </div>

              {/* Services List */}
              {findResult.services && findResult.services.length > 0 ? (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Service URL</th>
                        <th className={`px-4 py-2 text-right ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Lifetime</th>
                        <th className={`px-4 py-2 text-right ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findResult.services.map((svc, i) => (
                        <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                          <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text' : 'text-teal-300'}`}>{svc.url}</td>
                          <td className={`px-4 py-2 text-right ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>{svc.lifetime}s</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => selectServiceUrl(svc.url)}
                              className={`text-xs px-2 py-1 rounded ${
                                isRetro ? 'retro-button' : 'bg-teal-600/30 text-teal-300 hover:bg-teal-600/50'
                              }`}
                            >
                              Attrs →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>No services found for type "{findResult.serviceType}"</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Attributes Result */}
      {activeTab === 'attributes' && attrResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Service Attributes
          </h2>

          {!attrResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{attrResult.error}</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Service URL</p>
                  <p className={`text-xs font-bold ${isRetro ? 'retro-text' : 'text-white'} truncate`}>{attrResult.serviceUrl}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Attributes</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-teal-400'}`}>{attrResult.attributeCount}</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{attrResult.connectTimeMs}ms</p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>{attrResult.totalTimeMs}ms</p>
                </div>
              </div>

              {/* Attributes Table */}
              {attrResult.attributes && Object.keys(attrResult.attributes).length > 0 ? (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Attribute</th>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(attrResult.attributes).map(([key, value], i) => (
                        <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                          <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text' : 'text-teal-300'}`}>{key}</td>
                          <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>No attributes found</p>
              )}

              {/* Raw Attribute List */}
              {attrResult.rawAttributeList && (
                <div className="mt-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Raw Attribute List
                  </h3>
                  <pre className={`p-3 rounded-lg text-xs overflow-x-auto ${
                    isRetro ? 'retro-card font-mono' : 'bg-slate-900/50 border border-slate-700 text-slate-300'
                  }`}>
                    {attrResult.rawAttributeList}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Protocol Info */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          About SLP
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            SLP (Service Location Protocol) provides
            <strong className={isRetro ? 'retro-text' : 'text-white'}> automatic service discovery</strong> on
            networks, enabling clients to find services without prior configuration.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Automatic service discovery</li>
                <li>Service type enumeration</li>
                <li>Attribute-based service queries</li>
                <li>LDAP predicate filtering</li>
                <li>Scope-based grouping</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Service Types</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>service:printer:lpr - LPR printers</li>
                <li>service:http - HTTP servers</li>
                <li>service:ftp - FTP servers</li>
                <li>service:nfs - NFS file systems</li>
                <li>service:ipp - IPP printers</li>
              </ul>
            </div>
          </div>
          <div className={`mt-3 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
            <p className="text-yellow-300 text-xs">
              <strong>Note:</strong> SLP is commonly used in enterprise networks for service discovery.
              It has largely been replaced by mDNS/DNS-SD (Bonjour) in consumer devices.
              This tool uses TCP unicast (not UDP multicast) to query SLP agents.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
