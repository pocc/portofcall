import { protocols } from '../data/protocols';

export default function AboutPage() {
  const totalCount = protocols.length;

  const categories = [
    { name: 'Remote Access', icon: '🖥️', examples: 'SSH, Telnet, VNC, RDP, SPICE', color: 'text-purple-400' },
    { name: 'File Transfer', icon: '📁', examples: 'FTP, SFTP, FTPS, SCP, Rsync, NFS, SMB', color: 'text-blue-400' },
    { name: 'Databases', icon: '🗄️', examples: 'MySQL, PostgreSQL, Redis, MongoDB, Cassandra, ClickHouse', color: 'text-green-400' },
    { name: 'Messaging', icon: '📨', examples: 'MQTT, Kafka, RabbitMQ, NATS, XMPP, IRC', color: 'text-yellow-400' },
    { name: 'Email', icon: '✉️', examples: 'SMTP, POP3, IMAP, LMTP, Submission', color: 'text-red-400' },
    { name: 'Web & APIs', icon: '🌐', examples: 'HTTP, HTTPS, WebSocket, Gemini, FastCGI', color: 'text-cyan-400' },
    { name: 'Network', icon: '🔌', examples: 'DNS, Whois, NTP, BGP, SNMP, Syslog', color: 'text-orange-400' },
    { name: 'Specialty', icon: '⚙️', examples: 'Modbus, OPC-UA, Docker, Kubernetes, Git, BitTorrent', color: 'text-pink-400' },
  ];

  return (
    <div className="max-w-5xl mx-auto mt-8 space-y-8 pb-16">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          L4.FYI
        </h1>
        <p className="text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
          A browser-to-TCP bridge that lets you connect to <strong className="text-white">{totalCount} protocols</strong> directly
          from your browser, powered by Cloudflare Workers.
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-6 text-sm">
          <span className="bg-green-900/40 text-green-300 border border-green-700/50 px-3 py-1.5 rounded-full">
            {totalCount} protocols live
          </span>
          <span className="bg-blue-900/40 text-blue-300 border border-blue-700/50 px-3 py-1.5 rounded-full">
            Zero config
          </span>
          <span className="bg-purple-900/40 text-purple-300 border border-purple-700/50 px-3 py-1.5 rounded-full">
            curl-friendly
          </span>
          <span className="bg-orange-900/40 text-orange-300 border border-orange-700/50 px-3 py-1.5 rounded-full">
            Open source
          </span>
        </div>
      </div>

      {/* What is L4.FYI? */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-4">What is this?</h2>
        <p className="text-slate-300 leading-relaxed mb-4">
          L4.FYI uses Cloudflare Workers' <code className="bg-slate-700 px-1.5 py-0.5 rounded text-sm">connect()</code> TCP
          Sockets API to reach services that browsers normally can't touch. SSH into a server, query a Redis instance,
          send an SMTP email, browse an FTP directory — all from a single web page with no plugins or extensions.
        </p>
        <p className="text-slate-300 leading-relaxed mb-4">
          The Worker runs on Cloudflare's edge network with <strong className="text-white">Smart Placement</strong> enabled,
          meaning it automatically migrates closer to the backend you're connecting to. A connection to a database
          in Frankfurt routes through a nearby Cloudflare PoP, not one in Virginia.
        </p>
        <p className="text-slate-400 text-sm">
          L4 stands for Layer 4 (the transport layer) of the OSI model — where TCP lives.
          This tool bridges your browser to that layer, letting you reach any TCP service directly.
        </p>
      </section>

      {/* How it works */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-6">How it works</h2>
        <div className="flex justify-center py-4">
          <img src="/architecture.svg" alt="Architecture diagram: Browser → Cloudflare Worker → Target Server" className="max-w-xs w-full" />
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-6">
          <div className="bg-slate-900/50 rounded-lg p-4">
            <p className="text-white font-semibold mb-1">Request/Response</p>
            <p className="text-slate-400 text-sm">
              For protocols like Redis PING, MySQL queries, or DNS lookups — you send a request and get a response via a simple HTTP POST.
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <p className="text-white font-semibold mb-1">WebSocket Tunnel</p>
            <p className="text-slate-400 text-sm">
              For interactive protocols like SSH or Telnet — a WebSocket connection is bridged to a raw TCP socket for a full duplex stream.
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <p className="text-white font-semibold mb-1">TCP Ping</p>
            <p className="text-slate-400 text-sm">
              Measure TCP handshake round-trip time to any host:port. Like ICMP ping but over TCP, so it works through firewalls.
            </p>
          </div>
        </div>
      </section>

      {/* Protocol categories */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-6">{totalCount} Protocols across 8 categories</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {categories.map(cat => (
            <div key={cat.name} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
              <p className={`font-semibold mb-1 ${cat.color}`}>
                <span className="mr-2">{cat.icon}</span>{cat.name}
              </p>
              <p className="text-slate-400 text-sm">{cat.examples}</p>
            </div>
          ))}
        </div>
      </section>

      {/* curl / CLI */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-4">curl-friendly</h2>
        <p className="text-slate-300 mb-4">
          Every protocol has a short URL that returns plain text by default, JSON with <code className="bg-slate-700 px-1.5 py-0.5 rounded text-sm">?format=json</code>.
          No browser needed.
        </p>
        <div className="space-y-3 font-mono text-sm">
          <div className="bg-slate-900 rounded-lg p-4 text-slate-300">
            <div className="text-slate-500"># TCP ping</div>
            <div>curl l4.fyi/synping/example.com:80</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 text-slate-300">
            <div className="text-slate-500"># Redis PING</div>
            <div>curl l4.fyi/redis/your-server.com:6379</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 text-slate-300">
            <div className="text-slate-500"># DNS lookup</div>
            <div>curl "l4.fyi/dns/8.8.8.8:53?query=example.com&type=A"</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 text-slate-300">
            <div className="text-slate-500"># MySQL server info</div>
            <div>curl l4.fyi/mysql/your-db.example.com:3306</div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-4">Security</h2>
        <div className="space-y-3 text-slate-300">
          <div className="flex gap-3">
            <span className="text-green-400 shrink-0">&#x2713;</span>
            <p><strong className="text-white">SSRF Prevention</strong> — Private IP ranges (10.x, 172.16.x, 127.x, ::1) and cloud metadata endpoints are blocked.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 shrink-0">&#x2713;</span>
            <p><strong className="text-white">Cloudflare Detection</strong> — Connections to Cloudflare-proxied domains are blocked to prevent loop attacks.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 shrink-0">&#x2713;</span>
            <p><strong className="text-white">No Storage</strong> — Credentials are never stored. Connection data is proxied in-memory and discarded.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 shrink-0">&#x2713;</span>
            <p><strong className="text-white">Edge-only</strong> — Runs on Cloudflare Workers with no origin server, no database of user data, no logs.</p>
          </div>
        </div>
      </section>

      {/* Docker VPS Guide */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-2">Deploy Your Own Protocol Lab</h2>
        <p className="text-slate-300 mb-6">
          L4.FYI connects to <em>your</em> infrastructure. Set up a VPS with Docker to run protocol servers,
          then use L4.FYI (or curl) to interact with them. This is ideal for learning, testing, and experimenting
          with protocols in a safe environment.
        </p>

        {/* Prerequisites */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">Prerequisites</h3>
          <ul className="text-slate-300 space-y-1.5 text-sm">
            <li className="flex gap-2"><span className="text-slate-500">1.</span> A VPS with a public IP (DigitalOcean, Hetzner, Vultr, Linode — any provider works)</li>
            <li className="flex gap-2"><span className="text-slate-500">2.</span> Ubuntu 22.04+ or Debian 12+ (any Linux with Docker support)</li>
            <li className="flex gap-2"><span className="text-slate-500">3.</span> SSH access to the VPS</li>
            <li className="flex gap-2"><span className="text-slate-500">4.</span> A domain pointing to the VPS (optional but recommended — use a direct IP or gray-cloud DNS, <strong className="text-orange-300">not orange-cloud</strong>)</li>
          </ul>
        </div>

        {/* Step 1: Install Docker */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded mr-2">Step 1</span>
            Install Docker
          </h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 overflow-x-auto">
            <div className="text-slate-500"># Install Docker (official script)</div>
            <div>curl -fsSL https://get.docker.com | sh</div>
            <div className="mt-2 text-slate-500"># Add your user to the docker group</div>
            <div>sudo usermod -aG docker $USER</div>
            <div className="mt-2 text-slate-500"># Log out and back in, then verify</div>
            <div>docker --version</div>
            <div>docker compose version</div>
          </div>
        </div>

        {/* Step 2: Quick start */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded mr-2">Step 2</span>
            Start protocol servers
          </h3>
          <p className="text-slate-400 text-sm mb-3">
            Pick the protocols you want to experiment with. Each runs as a standalone Docker container.
          </p>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 overflow-x-auto">
            <div className="text-slate-500"># Databases</div>
            <div>docker run -d --name redis -p 6379:6379 redis:alpine</div>
            <div>docker run -d --name mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=testpass123 mysql:8</div>
            <div>docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=testpass123 postgres:16-alpine</div>
            <div>docker run -d --name mongo -p 27017:27017 mongo:7</div>
            <div className="mt-3 text-slate-500"># Messaging</div>
            <div>docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto:2</div>
            <div>docker run -d --name nats -p 4222:4222 nats:alpine</div>
            <div>docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:management-alpine</div>
            <div className="mt-3 text-slate-500"># SSH</div>
            <div>{'docker run -d --name ssh -p 2222:22 lscr.io/linuxserver/openssh-server \\'}</div>
            <div>{'  -e USER_NAME=testuser -e USER_PASSWORD=testpass123 -e PASSWORD_ACCESS=true'}</div>
            <div className="mt-3 text-slate-500"># Memcached</div>
            <div>docker run -d --name memcached -p 11211:11211 memcached:alpine</div>
          </div>
        </div>

        {/* Step 3: Full lab with compose */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded mr-2">Step 3</span>
            Or use docker-compose for a full lab
          </h3>
          <p className="text-slate-400 text-sm mb-3">
            The project includes 15 compose files covering 80+ containers across every protocol category.
            Clone the repo and spin up whichever stacks you need.
          </p>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 overflow-x-auto">
            <div>git clone https://github.com/rjpower/portofcall.git</div>
            <div>cd portofcall</div>
            <div className="mt-2 text-slate-500"># Core: SSH, FTP, MySQL, Postgres, Redis, MongoDB, MQTT, IRC, SMTP</div>
            <div>docker compose up -d</div>
            <div className="mt-2 text-slate-500"># Additional stacks (pick what you need)</div>
            <div>docker compose -f docker-compose.databases.yml up -d    <span className="text-slate-500"># Cassandra, ClickHouse, Neo4j, CouchDB, etc.</span></div>
            <div>docker compose -f docker-compose.queues.yml up -d       <span className="text-slate-500"># Kafka, RabbitMQ, NATS, Beanstalkd, etc.</span></div>
            <div>docker compose -f docker-compose.monitoring.yml up -d   <span className="text-slate-500"># Elasticsearch, Prometheus, Grafana, InfluxDB</span></div>
            <div>docker compose -f docker-compose.dns-network.yml up -d  <span className="text-slate-500"># BIND9 DNS, BGP, SNMP, Syslog</span></div>
            <div>docker compose -f docker-compose.directory.yml up -d    <span className="text-slate-500"># LDAP, RADIUS, Kerberos</span></div>
            <div>docker compose -f docker-compose.chat.yml up -d         <span className="text-slate-500"># XMPP, Matrix</span></div>
            <div>docker compose -f docker-compose.files.yml up -d        <span className="text-slate-500"># Samba, NFS, Rsync</span></div>
            <div>docker compose -f docker-compose.industrial.yml up -d   <span className="text-slate-500"># Modbus, OPC-UA</span></div>
            <div>docker compose -f docker-compose.vcs.yml up -d          <span className="text-slate-500"># Git (Gitea), SVN</span></div>
            <div>docker compose -f docker-compose.security.yml up -d     <span className="text-slate-500"># SOCKS5, Tor</span></div>
            <div className="mt-2 text-slate-500"># Or start everything at once</div>
            <div>{'for f in docker-compose*.yml; do docker compose -f "$f" up -d; done'}</div>
          </div>
        </div>

        {/* Step 4: Firewall */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded mr-2">Step 4</span>
            Open the ports
          </h3>
          <p className="text-slate-400 text-sm mb-3">
            L4.FYI connects from Cloudflare's network, so the target ports need to be reachable from the internet.
            Open only the ports you need.
          </p>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 overflow-x-auto">
            <div className="text-slate-500"># UFW example — open specific ports</div>
            <div>sudo ufw allow 6379/tcp   <span className="text-slate-500"># Redis</span></div>
            <div>sudo ufw allow 3306/tcp   <span className="text-slate-500"># MySQL</span></div>
            <div>sudo ufw allow 5432/tcp   <span className="text-slate-500"># PostgreSQL</span></div>
            <div>sudo ufw allow 2222/tcp   <span className="text-slate-500"># SSH (Docker)</span></div>
            <div>sudo ufw allow 1883/tcp   <span className="text-slate-500"># MQTT</span></div>
            <div className="mt-2 text-slate-500"># Don't forget to keep your real SSH port open!</div>
            <div>sudo ufw allow 22/tcp</div>
            <div>sudo ufw enable</div>
          </div>
          <div className="bg-amber-900/30 border border-amber-600/50 rounded-lg p-4 mt-4">
            <p className="text-amber-200 text-sm">
              <strong>Security note:</strong> These are test services with default credentials.
              Use strong passwords for anything exposed to the internet, or restrict access by IP with firewall rules.
              For production, always use TLS and authentication.
            </p>
          </div>
        </div>

        {/* Step 5: Connect */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded mr-2">Step 5</span>
            Connect from L4.FYI
          </h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 overflow-x-auto">
            <div className="text-slate-500"># From the browser: go to l4.fyi, pick a protocol, enter your VPS IP + port</div>
            <div className="mt-2 text-slate-500"># Or use curl</div>
            <div>curl l4.fyi/redis/YOUR_VPS_IP:6379</div>
            <div>curl l4.fyi/synping/YOUR_VPS_IP:3306</div>
            <div>curl "l4.fyi/dns/YOUR_VPS_IP:5353?query=example.com&type=A"</div>
          </div>
        </div>

        {/* Default credentials reference */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">Default credentials (docker-compose)</h3>
          <div className="bg-slate-900 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Password</th>
                </tr>
              </thead>
              <tbody className="text-slate-300 font-mono">
                <tr className="border-b border-slate-800"><td className="px-4 py-1.5">SSH / FTP</td><td className="px-4 py-1.5">testuser</td><td className="px-4 py-1.5">testpass123</td></tr>
                <tr className="border-b border-slate-800"><td className="px-4 py-1.5">MySQL (root)</td><td className="px-4 py-1.5">root</td><td className="px-4 py-1.5">rootpass123</td></tr>
                <tr className="border-b border-slate-800"><td className="px-4 py-1.5">PostgreSQL</td><td className="px-4 py-1.5">testuser</td><td className="px-4 py-1.5">testpass123</td></tr>
                <tr className="border-b border-slate-800"><td className="px-4 py-1.5">SMTP / IMAP</td><td className="px-4 py-1.5">testuser@test.local</td><td className="px-4 py-1.5">testpass123</td></tr>
                <tr><td className="px-4 py-1.5">Most others</td><td className="px-4 py-1.5">testuser</td><td className="px-4 py-1.5">testpass123</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Limitations */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-4">Limitations</h2>
        <div className="space-y-3 text-slate-300 text-sm">
          <div className="flex gap-3">
            <span className="text-slate-500 shrink-0">TCP only</span>
            <p>Cloudflare Workers' <code className="bg-slate-700 px-1.5 py-0.5 rounded">connect()</code> only supports TCP. UDP-only protocols (DHCP, TFTP, QUIC, RTP) and lower-layer protocols (ICMP, ARP) are not possible.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-slate-500 shrink-0">No Cloudflare targets</span>
            <p>Connections to domains behind Cloudflare's proxy (orange cloud) are blocked to prevent loop attacks. Use direct IPs or gray-cloud DNS records.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-slate-500 shrink-0">No private IPs</span>
            <p>SSRF protection blocks private ranges (10.x, 172.16.x, 127.x). You need publicly routable targets.</p>
          </div>
          <div className="flex gap-3">
            <span className="text-slate-500 shrink-0">CPU limits</span>
            <p>Workers have a 30-second CPU time limit. Long-running connections (like SSH sessions) use WebSocket tunneling to stay within limits.</p>
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="bg-slate-800 border border-slate-600 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-white mb-4">Built with</h2>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-slate-300">
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Frontend</span>
            <span>React 19 + TypeScript + Vite 7</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Styling</span>
            <span>Tailwind CSS v4</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Backend</span>
            <span>Cloudflare Workers</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Networking</span>
            <span>Workers TCP Sockets API</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Terminal</span>
            <span>xterm.js</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Deployment</span>
            <span>Wrangler + Workers Assets</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Domain</span>
            <span>l4.fyi (Layer 4 — get it?)</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-700/50">
            <span className="text-slate-400">Testing</span>
            <span>Vitest + Playwright</span>
          </div>
        </div>
      </section>
    </div>
  );
}
