# MongoDB Protocol Implementation Plan

## Overview

**Protocol:** MongoDB Wire Protocol
**Port:** 27017
**Specification:** [MongoDB Wire Protocol](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/)
**Complexity:** High
**Purpose:** NoSQL document database

MongoDB is the **leading NoSQL database**. A browser-based client enables document querying, collection management, and aggregation pipelines from anywhere.

### Use Cases
- NoSQL database administration
- Document query development
- Collection schema inspection
- Aggregation pipeline testing
- Real-time data exploration
- Educational - learn MongoDB

## Protocol Specification

### Wire Protocol Messages

MongoDB uses BSON (Binary JSON) over TCP.

```
┌────────────────────────────────┐
│  Message Header (16 bytes)      │
│  - messageLength (int32)        │
│  - requestID (int32)            │
│  - responseTo (int32)           │
│  - opCode (int32)               │
├────────────────────────────────┤
│  Message Body (BSON)            │
└────────────────────────────────┘
```

### Operation Codes

| OpCode | Value | Description |
|--------|-------|-------------|
| OP_MSG | 2013 | Generic message (MongoDB 3.6+) |
| OP_QUERY | 2004 | Query (deprecated) |
| OP_INSERT | 2002 | Insert (deprecated) |
| OP_UPDATE | 2001 | Update (deprecated) |
| OP_DELETE | 2006 | Delete (deprecated) |

**Modern MongoDB (3.6+)** uses OP_MSG for everything.

## Worker Implementation

### Use mongodb Library

```bash
npm install mongodb
```

```typescript
// src/worker/protocols/mongodb/client.ts

import { MongoClient as NodeMongoClient } from 'mongodb';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface MongoDBConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  database?: string;
  authSource?: string;
}

export class MongoDBClient {
  private client: NodeMongoClient;
  private db: any;

  constructor(private config: MongoDBConfig) {}

  async connect(): Promise<void> {
    // Build connection URL
    let url = 'mongodb://';

    if (this.config.username && this.config.password) {
      url += `${this.config.username}:${this.config.password}@`;
    }

    url += `${this.config.host}:${this.config.port}`;

    if (this.config.database) {
      url += `/${this.config.database}`;
    }

    if (this.config.authSource) {
      url += `?authSource=${this.config.authSource}`;
    }

    this.client = new NodeMongoClient(url);
    await this.client.connect();

    this.db = this.client.db(this.config.database || 'test');
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.client.db().admin().listDatabases();
    return result.databases.map((db: any) => db.name);
  }

  async listCollections(database?: string): Promise<string[]> {
    const db = database ? this.client.db(database) : this.db;
    const collections = await db.listCollections().toArray();
    return collections.map((col: any) => col.name);
  }

  async find(
    collection: string,
    query: any = {},
    options: { limit?: number; skip?: number } = {}
  ): Promise<any[]> {
    const coll = this.db.collection(collection);

    return coll
      .find(query)
      .limit(options.limit || 100)
      .skip(options.skip || 0)
      .toArray();
  }

  async insertOne(collection: string, document: any): Promise<any> {
    const coll = this.db.collection(collection);
    const result = await coll.insertOne(document);
    return result;
  }

  async updateOne(
    collection: string,
    filter: any,
    update: any
  ): Promise<any> {
    const coll = this.db.collection(collection);
    const result = await coll.updateOne(filter, update);
    return result;
  }

  async deleteOne(collection: string, filter: any): Promise<any> {
    const coll = this.db.collection(collection);
    const result = await coll.deleteOne(filter);
    return result;
  }

  async aggregate(collection: string, pipeline: any[]): Promise<any[]> {
    const coll = this.db.collection(collection);
    return coll.aggregate(pipeline).toArray();
  }

  async countDocuments(collection: string, query: any = {}): Promise<number> {
    const coll = this.db.collection(collection);
    return coll.countDocuments(query);
  }

  async getCollectionStats(collection: string): Promise<any> {
    const coll = this.db.collection(collection);
    return coll.stats();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

## Web UI Design

### MongoDB Query Interface

```typescript
// src/components/MongoDBClient.tsx

export function MongoDBClient() {
  const [connected, setConnected] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');

  const [query, setQuery] = useState('{}');
  const [results, setResults] = useState<any[]>([]);

  const ws = useRef<WebSocket | null>(null);

  const executeQuery = () => {
    try {
      const parsedQuery = JSON.parse(query);

      ws.current?.send(JSON.stringify({
        type: 'find',
        collection: selectedCollection,
        query: parsedQuery,
      }));
    } catch (error) {
      alert('Invalid JSON query');
    }
  };

  return (
    <div className="mongodb-client">
      <div className="sidebar">
        <h3>Databases</h3>
        <ul>
          {databases.map(db => (
            <li key={db}>{db}</li>
          ))}
        </ul>

        <h3>Collections</h3>
        <ul>
          {collections.map(col => (
            <li
              key={col}
              className={selectedCollection === col ? 'selected' : ''}
              onClick={() => setSelectedCollection(col)}
            >
              {col}
            </li>
          ))}
        </ul>
      </div>

      <div className="main-panel">
        <div className="query-editor">
          <h3>{selectedCollection}</h3>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='{"status": "active"}'
          />
          <button onClick={executeQuery}>Find</button>
        </div>

        <div className="results">
          {results.map((doc, i) => (
            <div key={i} className="document">
              <pre>{JSON.stringify(doc, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Aggregation Pipeline Builder

```typescript
// Visual aggregation pipeline builder
export function AggregationBuilder() {
  const [stages, setStages] = useState<any[]>([]);

  const addStage = (type: string) => {
    const newStage = {
      [`$${type}`]: {},
    };
    setStages([...stages, newStage]);
  };

  return (
    <div className="aggregation-builder">
      <h3>Aggregation Pipeline</h3>

      {stages.map((stage, i) => (
        <div key={i} className="pipeline-stage">
          <span>{Object.keys(stage)[0]}</span>
          <textarea
            value={JSON.stringify(stage, null, 2)}
            onChange={(e) => {
              // Update stage
            }}
          />
        </div>
      ))}

      <button onClick={() => addStage('match')}>$match</button>
      <button onClick={() => addStage('group')}>$group</button>
      <button onClick={() => addStage('sort')}>$sort</button>
      <button onClick={() => addStage('project')}>$project</button>
    </div>
  );
}
```

## Security

### Authentication

```typescript
// Always use authentication in production
const config = {
  host: 'mongodb.example.com',
  port: 27017,
  username: 'admin',
  password: 'secret',
  authSource: 'admin', // Usually 'admin'
};
```

### Read-Only User

```javascript
// Create read-only user in MongoDB
db.createUser({
  user: 'readonly',
  pwd: 'password',
  roles: [{ role: 'read', db: 'mydatabase' }]
});
```

## Testing

### Docker MongoDB

```bash
docker run -d \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=secret \
  mongo:7
```

### Test Queries

```javascript
// Insert test data
db.users.insertOne({ name: 'Alice', age: 30 });

// Query
db.users.find({ age: { $gte: 25 } });

// Aggregation
db.users.aggregate([
  { $match: { age: { $gte: 25 } } },
  { $group: { _id: null, avgAge: { $avg: '$age' } } }
]);
```

## Resources

- **MongoDB Docs**: [mongodb.com/docs](https://www.mongodb.com/docs/)
- **Wire Protocol**: [Wire Protocol Spec](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/)
- **BSON Spec**: [bsonspec.org](http://bsonspec.org/)
- **Node.js Driver**: [mongodb npm](https://www.npmjs.com/package/mongodb)

## Next Steps

1. Integrate mongodb library
2. Build document explorer UI
3. Add aggregation pipeline builder
4. Support GridFS (file storage)
5. Add index visualization
6. Create query history
7. Add explain plan viewer

## Notes

- MongoDB uses **BSON** (Binary JSON) for documents
- Modern versions use **OP_MSG** for all operations
- Aggregation pipelines are powerful but complex
- Consider adding **Compass-like** GUI features
- Support **GeoJSON** queries for location data
