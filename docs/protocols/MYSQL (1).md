# MySQL Protocol Implementation Plan

## Overview

**Protocol:** MySQL Client/Server Protocol
**Port:** 3306
**Specification:** [MySQL Protocol Docs](https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html)
**Complexity:** Medium
**Purpose:** Relational database queries and administration

MySQL is one of the **most popular** databases. A browser-based client enables database administration, query execution, and schema exploration from anywhere.

### Use Cases
- Emergency database administration
- Query testing and development
- Database schema exploration
- Quick data exports
- Educational SQL learning tool
- DevOps troubleshooting

## Protocol Specification

### Connection Flow

1. **TCP Connect**: Port 3306
2. **Server Greeting**: Version, auth method, capabilities
3. **Client Auth**: Username, password (hashed), database
4. **Auth Response**: OK or ERR packet
5. **Command Phase**: Queries, commands
6. **Close**: COM_QUIT packet

### Packet Format

```
┌──────────────────────────────┐
│  Length (3 bytes)             │ Payload length
│  Sequence ID (1 byte)         │ Packet counter
├──────────────────────────────┤
│  Payload                      │ Command or response
└──────────────────────────────┘
```

### Command Types

| Command | Byte | Description |
|---------|------|-------------|
| COM_QUIT | 0x01 | Close connection |
| COM_INIT_DB | 0x02 | Switch database |
| COM_QUERY | 0x03 | Execute SQL query |
| COM_PING | 0x0e | Keepalive |
| COM_STMT_PREPARE | 0x16 | Prepared statement |

### Response Packets

- **OK Packet**: Success (0x00), affected rows, last insert ID
- **ERR Packet**: Error (0xff), error code, message
- **ResultSet**: Column definitions + data rows
- **EOF Packet**: End of results (deprecated in MySQL 8.0)

## Worker Implementation

### Strategy: Use mysql2 Library

```bash
npm install mysql2
```

```typescript
// src/worker/protocols/mysql/client.ts

import mysql from 'mysql2/promise';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

export interface QueryResult {
  columns: string[];
  rows: any[];
  affectedRows?: number;
  insertId?: number;
}

export class MySQLClient {
  private connection: mysql.Connection;

  constructor(private config: MySQLConfig) {}

  async connect(): Promise<void> {
    // Create TCP socket
    const socket = tcpConnect(`${this.config.host}:${this.config.port}`);
    await socket.opened;

    this.connection = await mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      stream: socket as any, // Use our TCP socket
    });
  }

  async query(sql: string): Promise<QueryResult> {
    const [rows, fields] = await this.connection.query(sql);

    if (Array.isArray(rows)) {
      // SELECT query
      return {
        columns: fields?.map(f => f.name) || [],
        rows: rows,
      };
    } else {
      // INSERT/UPDATE/DELETE
      const result = rows as any;
      return {
        columns: [],
        rows: [],
        affectedRows: result.affectedRows,
        insertId: result.insertId,
      };
    }
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.query('SHOW DATABASES');
    return result.rows.map(row => row.Database);
  }

  async listTables(database?: string): Promise<string[]> {
    const result = await this.query(
      database ? `SHOW TABLES FROM ${database}` : 'SHOW TABLES'
    );
    return result.rows.map(row => Object.values(row)[0] as string);
  }

  async describeTable(table: string): Promise<any[]> {
    const result = await this.query(`DESCRIBE ${table}`);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.connection.end();
  }
}
```

### WebSocket Tunnel

```typescript
// src/worker/protocols/mysql/tunnel.ts

export async function mysqlTunnel(
  request: Request,
  config: MySQLConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const mysql = new MySQLClient(config);
      await mysql.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'query':
              const result = await mysql.query(msg.sql);
              server.send(JSON.stringify({
                type: 'result',
                result,
              }));
              break;

            case 'listDatabases':
              const databases = await mysql.listDatabases();
              server.send(JSON.stringify({
                type: 'databases',
                databases,
              }));
              break;

            case 'listTables':
              const tables = await mysql.listTables(msg.database);
              server.send(JSON.stringify({
                type: 'tables',
                tables,
              }));
              break;

            case 'describeTable':
              const schema = await mysql.describeTable(msg.table);
              server.send(JSON.stringify({
                type: 'tableSchema',
                schema,
              }));
              break;
          }
        } catch (error) {
          server.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Query failed',
          }));
        }
      });

      server.addEventListener('close', () => {
        mysql.close();
      });

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

## Web UI Design

### SQL Query Interface

```typescript
// src/components/MySQLClient.tsx

export function MySQLClient() {
  const [connected, setConnected] = useState(false);
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 10');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);

  const ws = useRef<WebSocket | null>(null);

  const executeQuery = () => {
    ws.current?.send(JSON.stringify({
      type: 'query',
      sql,
    }));
  };

  return (
    <div className="mysql-client">
      <div className="sidebar">
        <DatabaseExplorer
          databases={databases}
          tables={tables}
          onSelectTable={(table) => setSql(`SELECT * FROM ${table} LIMIT 10`)}
        />
      </div>

      <div className="main-panel">
        <div className="query-editor">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="Enter SQL query..."
          />
          <button onClick={executeQuery}>Execute</button>
        </div>

        {result && (
          <div className="results">
            {result.rows.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    {result.columns.map(col => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map(col => (
                        <td key={col}>{JSON.stringify(row[col])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="info">
                {result.affectedRows !== undefined &&
                  `${result.affectedRows} rows affected`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

## Security

### Read-Only Mode

```typescript
// Block dangerous queries
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE'];

function isReadOnlyQuery(sql: string): boolean {
  const upper = sql.toUpperCase().trim();
  return upper.startsWith('SELECT') || upper.startsWith('SHOW') || upper.startsWith('DESCRIBE');
}
```

### Connection Pooling

```typescript
// Use connection pooling for better performance
const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  connectionLimit: 5,
});
```

## Testing

### Test Database

```bash
# Docker MySQL
docker run -d \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=testpass \
  -e MYSQL_DATABASE=testdb \
  mysql:8.0
```

## Resources

- **MySQL Protocol**: [MySQL Internals](https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html)
- **mysql2**: [Node.js driver](https://github.com/sidorares/node-mysql2)
- **SQL.js**: [SQLite in WebAssembly](https://github.com/sql-js/sql.js/) (alternative approach)

## Next Steps

1. Integrate mysql2 library
2. Build query editor with syntax highlighting
3. Add database/table explorer
4. Implement query history
5. Add export to CSV/JSON
6. Create visual query builder
7. Add performance metrics (query time, rows scanned)

## Notes

- Similar implementation patterns apply to PostgreSQL (port 5432)
- Consider read-only mode by default for safety
- Query results should be paginated for large datasets
- Connection pooling reduces overhead for multiple queries
