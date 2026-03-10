#!/usr/bin/env node
/**
 * One-shot script to prettify curl -d JSON in api-examples.ts
 * Transforms compact JSON into indented, readable format.
 */
import { readFileSync, writeFileSync } from 'fs';

const file = new URL('../src/data/api-examples.ts', import.meta.url).pathname;
let src = readFileSync(file, 'utf8');

// Match each command template literal:
//   command: `curl ... -d '...'`
// The -d payload is always single-quoted JSON on the last line before '`
src = src.replace(
  /command: `(curl -X \w+ '[^']+') \\\n\s+-H '([^']+)' \\\n\s+-d '([^']*)'`/g,
  (_match, curlLine, header, jsonStr) => {
    // Try to parse and prettify the JSON
    let pretty;
    try {
      // The JSON may contain escaped quotes like \" from template literals
      const parsed = JSON.parse(jsonStr);
      pretty = JSON.stringify(parsed, null, 2);
    } catch {
      // If it fails to parse (nested escaped JSON etc), do manual prettification
      pretty = manualPrettify(jsonStr);
    }

    return `command: \`${curlLine} \\\\\n    -H '${header}' \\\\\n    -d '${pretty}'\``;
  }
);

function manualPrettify(json) {
  // Handle JSON with escaped inner JSON strings like {\"key\":\"val\"}
  // Strategy: add newlines and indentation around top-level keys
  let result = json
    // Add space after colons that aren't inside escaped strings
    .replace(/^{/, '{\n ')
    .replace(/}$/, '\n}');

  // Split by top-level commas (not inside nested braces/quotes)
  // Simple approach: replace ," with ,\n  "
  let depth = 0;
  let inStr = false;
  let out = '';
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    const prev = result[i - 1];

    if (ch === '"' && prev !== '\\') inStr = !inStr;
    if (!inStr) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }

    out += ch;

    // After a comma at depth 1 (top level object), add newline
    if (ch === ',' && depth === 1 && !inStr) {
      out += '\n  ';
    }
  }

  // Add spaces after top-level colons: "key":"value" -> "key": "value"
  // Only for the top-level (lines starting with  ")
  out = out.replace(/^(\s*"[^"]+"):/gm, '$1:');
  // Actually let's use a smarter approach - add space after : when followed by " or digit or { or [
  out = out.replace(/":/g, '": ');

  // Ensure opening brace has newline
  if (!out.startsWith('{\n')) {
    out = out.replace(/^{/, '{\n  ');
  }
  // Ensure closing brace has newline
  if (!out.endsWith('\n}')) {
    out = out.replace(/}$/, '\n}');
  }

  return out;
}

writeFileSync(file, src, 'utf8');
console.log('Done. Prettified all curl commands.');
