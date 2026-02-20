# JetDirect Protocol Implementation Plan

## Overview

**Protocol:** HP JetDirect (Raw Printing)
**Port:** 9100
**Specification:** Proprietary (HP), but simple
**Complexity:** Low
**Purpose:** Direct network printing

JetDirect enables **sending print jobs directly to network printers** - the simplest way to print over TCP/IP without drivers or spoolers.

### Use Cases
- Direct network printing
- Label printer control
- Receipt printer integration
- Raw PCL/PostScript printing
- Printer testing and debugging
- Educational - learn printing protocols

## Protocol Specification

### Simplest Printing Protocol

```
Client connects → sends print data → closes connection
```

That's it! No handshake, no commands, just raw data.

### Print Data Formats

The printer accepts various formats:
- **PCL** (Printer Command Language) - HP printers
- **PostScript** - Adobe page description
- **ESC/P** - Epson format
- **ZPL** - Zebra label printers
- **Plain text** - Simple ASCII

### Example Session

```
Client connects to printer:9100
Client sends:
  Hello, World!\f
  (where \f = form feed = print page)
Client closes connection
Printer prints the text
```

## Worker Implementation

```typescript
// src/worker/protocols/jetdirect/client.ts

import { connect } from 'cloudflare:sockets';

export interface PrintJob {
  data: string | Uint8Array;
  format?: 'text' | 'pcl' | 'postscript' | 'zpl';
}

export class JetDirectClient {
  constructor(
    private host: string,
    private port: number = 9100
  ) {}

  async print(job: PrintJob): Promise<void> {
    const socket = connect(`${this.host}:${this.port}`);
    await socket.opened;

    const writer = socket.writable.getWriter();

    if (typeof job.data === 'string') {
      const encoder = new TextEncoder();
      let data = job.data;

      // Add form feed if not present (ejects page)
      if (job.format === 'text' && !data.endsWith('\f')) {
        data += '\f';
      }

      await writer.write(encoder.encode(data));
    } else {
      await writer.write(job.data);
    }

    writer.releaseLock();

    // Wait a moment for printer to receive all data
    await new Promise(resolve => setTimeout(resolve, 100));

    await socket.close();
  }

  async printText(text: string): Promise<void> {
    await this.print({
      data: text,
      format: 'text',
    });
  }

  async printPCL(pcl: string): Promise<void> {
    await this.print({
      data: pcl,
      format: 'pcl',
    });
  }

  async printPostScript(ps: string): Promise<void> {
    await this.print({
      data: ps,
      format: 'postscript',
    });
  }

  async printZPL(zpl: string): Promise<void> {
    // For Zebra label printers
    await this.print({
      data: zpl,
      format: 'zpl',
    });
  }
}

// Helper functions for common formats

export function generateTestPage(): string {
  return `
JetDirect Test Page
===================

Printer: Connected
Protocol: HP JetDirect (Port 9100)
Time: ${new Date().toLocaleString()}

This is a test page to verify network printing.

\f`;
}

export function generateZPLLabel(text: string): string {
  // Simple ZPL label
  return `
^XA
^FO50,50^ADN,36,20^FD${text}^FS
^XZ
`;
}

export function generatePCLTestPage(): string {
  // Simple PCL test page
  return '\x1BE' + // Reset
         'JetDirect Test Page\r\n' +
         '===================\r\n\r\n' +
         'PCL Format Test\r\n' +
         '\f'; // Form feed
}
```

## Web UI Design

```typescript
// src/components/PrinterClient.tsx

export function PrinterClient() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(9100);
  const [text, setText] = useState('Hello, Printer!');
  const [format, setFormat] = useState<'text' | 'pcl' | 'zpl'>('text');
  const [status, setStatus] = useState<string>('');

  const print = async () => {
    setStatus('Printing...');

    try {
      const response = await fetch('/api/jetdirect/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          text,
          format,
        }),
      });

      if (response.ok) {
        setStatus('✓ Print job sent successfully');
      } else {
        setStatus('✗ Print failed');
      }
    } catch (error) {
      setStatus(`✗ Error: ${error.message}`);
    }
  };

  const printTestPage = async () => {
    setText(generateTestPage());
    setTimeout(print, 100);
  };

  return (
    <div className="printer-client">
      <h2>Network Printer (JetDirect)</h2>

      <div className="printer-config">
        <input
          type="text"
          placeholder="Printer IP/Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
      </div>

      <div className="format-selector">
        <label>Format:</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
          <option value="text">Plain Text</option>
          <option value="pcl">PCL</option>
          <option value="zpl">ZPL (Labels)</option>
        </select>
      </div>

      <div className="print-content">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Enter text to print..."
        />
      </div>

      <div className="actions">
        <button onClick={print}>Print</button>
        <button onClick={printTestPage}>Print Test Page</button>
      </div>

      {status && (
        <div className={`status ${status.startsWith('✓') ? 'success' : 'error'}`}>
          {status}
        </div>
      )}

      <div className="info">
        <h3>Supported Printers</h3>
        <ul>
          <li>HP network printers</li>
          <li>Zebra label printers (ZPL)</li>
          <li>Most network printers with JetDirect support</li>
        </ul>
      </div>
    </div>
  );
}
```

## Common Print Formats

### Plain Text

```typescript
const plainText = `
Invoice #12345
Date: 2024-01-15

Item 1: $10.00
Item 2: $20.00
--------------
Total:  $30.00

\f`; // Form feed ejects page
```

### PCL (HP Printer Command Language)

```typescript
const pclDocument = `
\x1BE                    // Reset
\x1B&l0O                // Portrait
\x1B&l26A               // A4 paper
\x1B(s12V               // 12-point font
\x1B(s0S                // Upright
\x1B(s0B                // Medium weight
Hello, World!
\f`;
```

### ZPL (Zebra Label)

```typescript
const zplLabel = `
^XA                     // Start format
^FO50,50                // Field origin
^ADN,36,20              // Font
^FDShipping Label^FS    // Field data
^FO50,100
^BCN,100,Y,N,N          // Barcode
^FD123456789^FS
^XZ                     // End format
`;
```

## Security

### Network Access

```typescript
// Printers should be on isolated network
// Block access from public internet

// Validate printer IP is on local network
function isLocalNetwork(host: string): boolean {
  return host.startsWith('192.168.') ||
         host.startsWith('10.') ||
         host.startsWith('172.16.');
}
```

### Print Job Validation

```typescript
// Limit print job size
const MAX_PRINT_SIZE = 10 * 1024 * 1024; // 10MB

if (data.length > MAX_PRINT_SIZE) {
  throw new Error('Print job too large');
}
```

## Testing

### Test with Netcat

```bash
# Send text to printer
echo "Hello, Printer!\f" | nc printer.local 9100
```

### Test with CUPS

```bash
# Create raw printer queue pointing to JetDirect port
lpadmin -p TestPrinter -v socket://printer.local:9100 -E
```

### Virtual Printer

```bash
# Netcat as virtual printer (logs to console)
nc -l 9100 > print_output.txt
```

## Resources

- **HP JetDirect**: [HP Documentation](https://support.hp.com/)
- **PCL Reference**: [PCL Command Reference](https://developers.hp.com/hp-developers/pcl)
- **ZPL**: [Zebra Programming Language](https://www.zebra.com/us/en/support-downloads/knowledge-articles/zpl-programming-language.html)

## Common Use Cases

### Receipt Printing

```typescript
const receipt = `
     ACME STORE
     123 Main St

Date: ${new Date().toLocaleDateString()}

Item 1.........$10.00
Item 2.........$15.00
Tax.............$2.50
-------------------
TOTAL..........$27.50

Thank you!
\f`;

await client.printText(receipt);
```

### Label Printing

```typescript
const label = generateZPLLabel('SKU: 12345');
await client.printZPL(label);
```

### Test Page

```typescript
await client.printText(generateTestPage());
```

## Next Steps

1. Implement JetDirect client
2. Add PCL generator helpers
3. Build print preview
4. Support multiple printer formats
5. Add print queue management
6. Create label designer UI
7. Support bi-directional communication (if printer supports it)

## Notes

- **Simplest network protocol** - just send raw data
- **No feedback** - printer doesn't confirm receipt
- **No authentication** - open port = anyone can print
- Port **9100** is the default, some use 9101, 9102, etc.
- **One job per connection** - close connection after printing
- Perfect for **label printers** and **receipt printers**
- Some printers support **bidirectional** on port 9101/9102
