const fs = require('fs');
const path = require('path');

const dir = 'src/components';
const files = fs.readdirSync(dir).filter(f => f.endsWith('Client.tsx'));
let modified = 0;
const skipped = [];

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  const apiExamplesRegex = /^(\s*)<ApiExamples examples=\{apiExamples\.(\w+) \|\| \[\]\} \/>\n/m;
  const match = content.match(apiExamplesRegex);
  if (!match) {
    skipped.push(file);
    continue;
  }

  const [fullMatch, indent, protocolKey] = match;
  const protocolId = protocolKey.toLowerCase();
  const newTag = `${indent}<ApiExamples examples={apiExamples.${protocolKey} || []} protocolId="${protocolId}" />`;

  if (content.includes('</ProtocolClientLayout>')) {
    // Remove old line
    content = content.replace(fullMatch, '');
    // Insert before </ProtocolClientLayout>
    content = content.replace(
      /(\s*)<\/ProtocolClientLayout>/,
      `\n${newTag}\n$1</ProtocolClientLayout>`
    );
  } else {
    // Custom layout - just add protocolId in place
    content = content.replace(
      `<ApiExamples examples={apiExamples.${protocolKey} || []} />`,
      `<ApiExamples examples={apiExamples.${protocolKey} || []} protocolId="${protocolId}" />`
    );
  }

  fs.writeFileSync(filePath, content);
  modified++;
}

console.log('Modified:', modified);
console.log('Skipped:', skipped);
