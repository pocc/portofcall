# PostgreSQL Protocol Implementation Plan

## Overview

**Protocol:** PostgreSQL Wire Protocol
**Port:** 5432
**Specification:** [PostgreSQL Protocol](https://www.postgresql.org/docs/current/protocol.html)
**Complexity:** Medium-High
**Purpose:** Advanced relational database queries

PostgreSQL is the **most advanced open-source database**. A browser-based client enables database administration, complex queries, and schema management from anywhere.

### Use Cases
- Database administration and monitoring
- Complex SQL query development
- Schema design and migration
- Data analysis and reporting
- Educational - learn PostgreSQL features
- Emergency database access

## Protocol Specification

### Connection Flow

1. **Startup Message**: Client sends version + parameters
2. **Authentication**: MD5, SCRAM-SHA-256, or cleartext
3. **Ready for Query**: Server indicates idle state
4. **Query/Command**: Client sends queries
5. **Response**: RowDescription + DataRow + CommandComplete
6. **Terminate**: Client sends Terminate message

### Message Format

```
┌────────────────────────────────┐
│  Type (1 byte)                  │ Message type code
│  Length (4 bytes, big-endian)   │ Including self
├────────────────────────────────┤
│  Payload                        │ Message-specific data
└────────────────────────────────┘
```

### Common Message Types

| Type | Code | Direction | Description |
|------|------|-----------|-------------|
| Query | Q | C→S | Simple query |
| RowDescription | T | S→C | Column metadata |
| DataRow | D | S→C | Query result row |
| CommandComplete | C | S→C | Query finished |
| ReadyForQuery | Z | S→C | Ready for next command |
| ErrorResponse | E | S→C | Error occurred |

## Worker Implementation

### Use pg Library

```bash
npm install pg
```

```typescript
// src/worker/protocols/postgresql/client.ts

import { Client } from 'pg';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface PostgreSQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  ssl?: boolean;
}

export interface QueryResult {
  command: string;
  rowCount: number;
  fields: Array<{ name: string; dataTypeID: number }>;
  rows: any[];
}

export class PostgreSQLClient {
  private client: Client;

  constructor(private config: PostgreSQLConfig) {}

  async connect(): Promise<void> {
    // Create TCP socket
    const socket = tcpConnect(`${this.config.host}:${this.config.port}`);
    await socket.opened;

    this.client = new Client({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      stream: socket as any, // Use our TCP socket
      ssl: this.config.ssl,
    });

    await this.client.connect();
  }

  async query(sql: string): Promise<QueryResult> {
    const result = await this.client.query(sql);

    return {
      command: result.command,
      rowCount: result.rowCount || 0,
      fields: result.fields.map(f => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
      })),
      rows: result.rows,
    };
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.query(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname`
    );
    return result.rows.map(row => row.datname);
  }

  async listSchemas(): Promise<string[]> {
    const result = await this.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
       ORDER BY schema_name`
    );
    return result.rows.map(row => row.schema_name);
  }

  async listTables(schema: string = 'public'): Promise<Array<{ name: string; type: string }>> {
    const result = await this.query(
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = '${schema}'
       ORDER BY table_name`
    );
    return result.rows.map(row => ({
      name: row.table_name,
      type: row.table_type,
    }));
  }

  async describeTable(table: string, schema: string = 'public'): Promise<any[]> {
    const result = await this.query(
      `SELECT
         column_name,
         data_type,
         is_nullable,
         column_default
       FROM information_schema.columns
       WHERE table_schema = '${schema}'
       AND table_name = '${table}'
       ORDER BY ordinal_position`
    );
    return result.rows;
  }

  async getTableIndexes(table: string, schema: string = 'public'): Promise<any[]> {
    const result = await this.query(
      `SELECT
         indexname,
         indexdef
       FROM pg_indexes
       WHERE schemaname = '${schema}'
       AND tablename = '${table}'`
    );
    return result.rows;
  }

  async explainQuery(sql: string): Promise<any[]> {
    const result = await this.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
```

### WebSocket Tunnel

```typescript
// src/worker/protocols/postgresql/tunnel.ts

export async function postgresqlTunnel(
  request: Request,
  config: PostgreSQLConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const pg = new PostgreSQLClient(config);
      await pg.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'query':
              const result = await pg.query(msg.sql);
              server.send(JSON.stringify({
                type: 'result',
                result,
              }));
              break;

            case 'listDatabases':
              const databases = await pg.listDatabases();
              server.send(JSON.stringify({
                type: 'databases',
                databases,
              }));
              break;

            case 'listTables':
              const tables = await pg.listTables(msg.schema);
              server.send(JSON.stringify({
                type: 'tables',
                tables,
              }));
              break;

            case 'describeTable':
              const columns = await pg.describeTable(msg.table, msg.schema);
              const indexes = await pg.getTableIndexes(msg.table, msg.schema);
              server.send(JSON.stringify({
                type: 'tableSchema',
                columns,
                indexes,
              }));
              break;

            case 'explain':
              const plan = await pg.explainQuery(msg.sql);
              server.send(JSON.stringify({
                type: 'queryPlan',
                plan,
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
        pg.close();
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

### PostgreSQL Client Component

```typescript
// src/components/PostgreSQLClient.tsx

export function PostgreSQLClient() {
  const [connected, setConnected] = useState(false);
  const [sql, setSql] = useState('SELECT version();');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<Array<{ name: string; type: string }>>([]);

  const ws = useRef<WebSocket | null>(null);

  // Similar to MySQL client but with PostgreSQL-specific features
  const executeQuery = () => {
    ws.current?.send(JSON.stringify({
      type: 'query',
      sql,
    }));
  };

  const explainQuery = () => {
    ws.current?.send(JSON.stringify({
      type: 'explain',
      sql,
    }));
  };

  return (
    <div className="postgresql-client">
      <div className="sidebar">
        <DatabaseExplorer
          databases={databases}
          schemas={schemas}
          tables={tables}
        />
      </div>

      <div className="main-panel">
        <div className="query-editor">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="Enter SQL query..."
          />
          <div className="actions">
            <button onClick={executeQuery}>Execute</button>
            <button onClick={explainQuery}>EXPLAIN</button>
          </div>
        </div>

        {result && (
          <QueryResultsTable result={result} />
        )}
      </div>
    </div>
  );
}
```

## Security

### Prepared Statements

```typescript
// Use parameterized queries to prevent SQL injection
async queryWithParams(sql: string, params: any[]): Promise<QueryResult> {
  const result = await this.client.query(sql, params);
  return this.formatResult(result);
}

// Example usage
await pg.queryWithParams(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);
```

### Read-Only Mode

```typescript
// Grant only SELECT permissions
const READ_ONLY_KEYWORDS = ['SELECT', 'SHOW', 'EXPLAIN', 'DESCRIBE'];

function isReadOnlyQuery(sql: string): boolean {
  const keyword = sql.trim().toUpperCase().split(/\s+/)[0];
  return READ_ONLY_KEYWORDS.includes(keyword);
}
```

## Testing

### Test Database

```bash
# Docker PostgreSQL
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  postgres:16
```

## Resources

- **PostgreSQL Protocol**: [Official Documentation](https://www.postgresql.org/docs/current/protocol.html)
- **node-postgres**: [pg library](https://github.com/brianc/node-postgres)
- **PostgreSQL Tutorial**: [PostgreSQL.org](https://www.postgresql.org/docs/current/tutorial.html)

## PostgreSQL-Specific Features

### JSON Support

```typescript
// Query JSONB columns
await pg.query(`
  SELECT data->>'name' as name, data->>'email' as email
  FROM users
  WHERE data @> '{"active": true}'
`);
```

### Array Operations

```typescript
// PostgreSQL array queries
await pg.query(`
  SELECT * FROM posts
  WHERE tags && ARRAY['javascript', 'typescript']
`);
```

### Full-Text Search

```typescript
// Use PostgreSQL's powerful text search
await pg.query(`
  SELECT * FROM articles
  WHERE to_tsvector('english', content) @@ to_tsquery('postgresql & query')
`);
```

## Next Steps

1. Implement PostgreSQL client with pg library
2. Build SQL editor with syntax highlighting
3. Add schema explorer with foreign key visualization
4. Implement query history and favorites
5. Add EXPLAIN visualization
6. Support PostgreSQL-specific types (JSONB, arrays, etc.)
7. Add database performance monitoring

## Notes

- PostgreSQL has **more advanced features** than MySQL (JSONB, arrays, full-text search)
- Consider supporting **COPY** command for bulk operations
- Add **psql-like shortcuts** (\d, \dt, \l, etc.)
- Implement **transaction management** (BEGIN, COMMIT, ROLLBACK)
- Support **multiple result sets** for procedures
