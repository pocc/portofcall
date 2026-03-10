const fs = require('fs');
const path = require('path');

// Custom layout files that need ApiExamples moved to bottom
const customFiles = [
  'AJPClient.tsx', 'AMQPClient.tsx', 'AerospikeClient.tsx', 'CephClient.tsx',
  'ConsulClient.tsx', 'DCERPCClient.tsx', 'DNP3Client.tsx', 'DNSClient.tsx',
  'DiameterClient.tsx', 'FTPClient.tsx', 'FastCGIClient.tsx', 'GitClient.tsx',
  'GraphiteClient.tsx', 'IMAPClient.tsx', 'IgniteClient.tsx', 'KafkaClient.tsx',
  'LDPClient.tsx', 'MemcachedClient.tsx', 'ModbusClient.tsx', 'NATSClient.tsx',
  'NBDClient.tsx', 'NSQClient.tsx', 'NetBIOSClient.tsx', 'OPCUAClient.tsx',
  'OracleTNSClient.tsx', 'PCEPClient.tsx', 'PPTPClient.tsx', 'RedisClient.tsx',
  'RethinkDBClient.tsx', 'SLPClient.tsx', 'SMPPClient.tsx', 'SSHClient.tsx',
  'Socks5Client.tsx', 'TDSClient.tsx', 'TacacsClient.tsx', 'TarantoolClient.tsx',
  'TelnetClient.tsx', 'ThriftClient.tsx', 'WebSocketClient.tsx', 'XMPPClient.tsx',
];

let modified = 0;
const errors = [];

for (const file of customFiles) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Find and extract the ApiExamples line
  const regex = /^(\s*)<ApiExamples examples=\{apiExamples\.(\w+) \|\| \[\]\} protocolId="[^"]*" \/>\n/m;
  const match = content.match(regex);
  if (!match) {
    errors.push(`${file}: no ApiExamples found`);
    continue;
  }

  const apiLine = match[0].trimEnd();

  // Remove the old line
  content = content.replace(match[0], '');

  // Insert before the outermost closing </div> (the one at indent level 4 spaces before ");\n}")
  // Pattern: "    </div>\n  );\n}"
  const insertPoint = content.lastIndexOf('\n    </div>\n  );\n}');
  if (insertPoint === -1) {
    errors.push(`${file}: could not find insertion point`);
    continue;
  }

  // Insert the ApiExamples line (with proper indentation) before the closing </div>
  const insertLine = '\n      <ApiExamples examples={apiExamples.' + match[2] + ' || []} protocolId="' + match[2].toLowerCase() + '" />';
  content = content.slice(0, insertPoint) + insertLine + content.slice(insertPoint);

  fs.writeFileSync(filePath, content);
  modified++;
}

console.log('Modified:', modified);
if (errors.length) console.log('Errors:', errors);
