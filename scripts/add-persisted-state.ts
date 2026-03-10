/**
 * Codemod: Replace useState with usePersistedState for non-secret form fields.
 *
 * Usage: npx tsx scripts/add-persisted-state.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

// Secret field names — never persist these
const SECRET_FIELDS = new Set([
  'password', 'privateKey', 'passphrase', 'secret', 'token',
  'authToken', 'apiKey', 'apiSecret', 'accessKey', 'secretKey',
  'credential', 'authPassword', 'bindPassword', 'proxyPassword',
  'adminPassword', 'bearerToken', 'accessToken', 'authKey',
  'proxyAuth', 'authData',
  'keyData', 'certData', 'pfxData',
]);

// UI state fields — not user input, don't persist
const UI_STATE_FIELDS = new Set([
  'loading', 'result', 'error', 'status', 'statusMsg', 'output',
  'response', 'connected', 'logs', 'files', 'history', 'cmdHistory',
  'cmdHistoryIdx', 'showCommands', 'activeModal', 'selectedFiles',
  'selectedFile', 'newName', 'dirName', 'version', 'input', 'expanded',
  'visible', 'open', 'active', 'data', 'results', 'connecting',
  'isConnected', 'showAdvanced', 'showHelp', 'tab', 'activeTab',
  'currentPath', 'authMethod', 'mode', 'editing', 'subscription',
  'subscribed', 'publishing', 'consuming', 'responseData', 'sessions',
  'messages', 'lastResponse', 'autoScroll', 'terminalOutput',
  'selectedProtocol',
]);

// Match: const [name, setName] = useState('value')  or  useState("")
// Does NOT match: useState(false), useState<Type>(''), useState(0), useState([])
const USE_STATE_REGEX = /^(\s*)const \[(\w+), set\w+\] = useState\(('(?:[^']*)'|"(?:[^"]*)")\);$/;

function getProtocolPrefix(filename: string): string {
  // SSHClient.tsx -> ssh, MySQLClient.tsx -> mysql, PostgreSQLClient.tsx -> postgresql
  const base = path.basename(filename, '.tsx');
  return base.replace(/Client$/, '').toLowerCase();
}

function shouldPersist(fieldName: string): boolean {
  if (SECRET_FIELDS.has(fieldName)) return false;
  if (UI_STATE_FIELDS.has(fieldName)) return false;
  return true;
}

function processFile(filePath: string): { modified: boolean; changes: string[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const prefix = getProtocolPrefix(filePath);
  const changes: string[] = [];
  let modified = false;
  let needsImport = false;

  const newLines = lines.map((line) => {
    const match = line.match(USE_STATE_REGEX);
    if (!match) return line;

    const [, indent, fieldName, defaultValue] = match;
    if (!shouldPersist(fieldName)) return line;

    // Check that it's a FormField-style field (host, port, username, domain, etc.)
    // by verifying the field is used with onChange={setXxx} in the file
    const setterName = `set${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;
    if (!content.includes(`onChange={${setterName}}`)) {
      // Also check raw input patterns: onChange={(e) => setXxx(e.target.value)}
      if (!content.includes(`${setterName}(e.target.value)`)) {
        return line;
      }
    }

    needsImport = true;
    modified = true;
    const key = `${prefix}-${fieldName}`;
    const newLine = `${indent}const [${fieldName}, ${setterName}] = usePersistedState('${key}', ${defaultValue});`;
    changes.push(`  ${fieldName} -> '${key}'`);
    return newLine;
  });

  // Add import if needed
  if (needsImport) {
    const importLine = "import { usePersistedState } from '../hooks/usePersistedState';";

    // Check if import already exists
    if (!content.includes('usePersistedState')) {
      // Find the last import line and add after it
      let lastImportIdx = -1;
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].startsWith('import ') || newLines[i].match(/^import\s*{/)) {
          lastImportIdx = i;
        }
        // Handle multi-line imports
        if (lastImportIdx >= 0 && newLines[i].includes("} from '")) {
          lastImportIdx = i;
        }
      }
      if (lastImportIdx >= 0) {
        newLines.splice(lastImportIdx + 1, 0, importLine);
      }
    }

    // Remove usePersistedState fields from the React useState import if no useState calls remain
    const hasRemainingUseState = newLines.some(
      (l) => l.includes('useState(') && !l.includes('usePersistedState')
    );
    if (!hasRemainingUseState) {
      // Remove useState from the import
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].includes("from 'react'") && newLines[i].includes('useState')) {
          newLines[i] = newLines[i]
            .replace(/,?\s*useState\s*,?/, (m) => {
              // Clean up: "{ useState, useRef }" -> "{ useRef }" etc.
              if (m.startsWith(',')) return '';
              if (m.endsWith(',')) return '';
              return '';
            })
            .replace(/{\s*,/, '{ ')
            .replace(/,\s*}/, ' }')
            .replace(/{\s*}/, '{}');
          // If the import is now empty, mark for cleanup
          if (newLines[i].match(/import\s*{\s*}\s*from\s*'react'/)) {
            newLines[i] = ''; // Remove empty react import
          }
        }
      }
    }
  }

  if (modified && !DRY_RUN) {
    fs.writeFileSync(filePath, newLines.join('\n'));
  }

  return { modified, changes };
}

// Find all Client components
const componentsDir = path.join(process.cwd(), 'src/components');
const clientFiles = fs.readdirSync(componentsDir)
  .filter((f) => f.endsWith('Client.tsx'))
  .map((f) => path.join(componentsDir, f))
  .sort();

console.log(`Found ${clientFiles.length} client components`);
console.log(DRY_RUN ? '(DRY RUN — no files will be modified)\n' : '\n');

let totalModified = 0;
let totalChanges = 0;

for (const file of clientFiles) {
  const { modified, changes } = processFile(file);
  if (modified) {
    totalModified++;
    totalChanges += changes.length;
    console.log(`${path.basename(file)}:`);
    for (const c of changes) console.log(c);
    console.log();
  }
}

console.log(`\nDone: ${totalModified} files modified, ${totalChanges} fields persisted`);
