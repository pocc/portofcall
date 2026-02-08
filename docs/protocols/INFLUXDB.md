# InfluxDB Protocol Implementation Plan

## Overview

**Protocol:** InfluxDB Line Protocol (HTTP) / Flux
**Port:** 8086 (HTTP API)
**Specification:** [InfluxDB Docs](https://docs.influxdata.com/)
**Complexity:** Medium
**Purpose:** Time-series database

InfluxDB enables **time-series data storage and querying** - collect metrics, IoT sensor data, and analytics with powerful temporal queries from the browser.

### Use Cases
- System monitoring and metrics
- IoT sensor data collection
- Application performance monitoring
- DevOps metrics and alerting
- Financial market data
- Real-time analytics

## Protocol Specification

### Line Protocol Format

```
measurement[,tag=value,...] field=value[,field=value,...] [timestamp]
```

**Examples:**
```
cpu,host=server01,region=us-west usage=75.2 1640000000000000000
temperature,sensor=basement,location=home value=22.5
stock,symbol=AAPL price=150.25,volume=1000000 1640000000000000000
```

### Components
- **Measurement**: Table/metric name (required)
- **Tags**: Indexed metadata (optional, comma-separated)
- **Fields**: Actual data values (required, at least one)
- **Timestamp**: Nanosecond precision Unix timestamp (optional)

### HTTP API Endpoints

```
POST /api/v2/write     - Write data points
POST /api/v2/query     - Query with Flux
GET  /api/v2/buckets   - List buckets (databases)
POST /api/v2/delete    - Delete data
GET  /health           - Health check
```

## Worker Implementation

```typescript
// src/worker/protocols/influxdb/client.ts

export interface InfluxDBConfig {
  host: string;
  port: number;
  token: string;
  org: string;
  bucket: string;
}

export interface Point {
  measurement: string;
  tags?: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp?: Date | number; // Date or nanoseconds
}

export interface FluxQuery {
  query: string;
}

export interface QueryResult {
  tables: FluxTable[];
}

export interface FluxTable {
  columns: string[];
  records: Record<string, any>[];
}

export class InfluxDBClient {
  private baseUrl: string;
  private headers: HeadersInit;

  constructor(private config: InfluxDBConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.headers = {
      'Authorization': `Token ${config.token}`,
      'Content-Type': 'application/json',
    };
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async writePoint(point: Point): Promise<void> {
    await this.writePoints([point]);
  }

  async writePoints(points: Point[]): Promise<void> {
    const lines = points.map(p => this.pointToLineProtocol(p));
    const body = lines.join('\n');

    const url = `${this.baseUrl}/api/v2/write?org=${this.config.org}&bucket=${this.config.bucket}&precision=ns`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'text/plain',
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Write failed: ${error}`);
    }
  }

  async query(flux: string): Promise<QueryResult> {
    const response = await fetch(`${this.baseUrl}/api/v2/query?org=${this.config.org}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/vnd.flux',
      },
      body: flux,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Query failed: ${error}`);
    }

    const csv = await response.text();
    return this.parseFluxResponse(csv);
  }

  async queryRange(
    measurement: string,
    start: string | Date,
    stop?: string | Date,
    filters?: Record<string, string>
  ): Promise<QueryResult> {
    const startStr = this.formatTime(start);
    const stopStr = stop ? this.formatTime(stop) : 'now()';

    let flux = `
from(bucket: "${this.config.bucket}")
  |> range(start: ${startStr}, stop: ${stopStr})
  |> filter(fn: (r) => r._measurement == "${measurement}")`;

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        flux += `\n  |> filter(fn: (r) => r.${key} == "${value}")`;
      }
    }

    return this.query(flux);
  }

  async aggregate(
    measurement: string,
    window: string,
    fn: 'mean' | 'sum' | 'count' | 'min' | 'max',
    start: string | Date = '-1h'
  ): Promise<QueryResult> {
    const startStr = this.formatTime(start);

    const flux = `
from(bucket: "${this.config.bucket}")
  |> range(start: ${startStr})
  |> filter(fn: (r) => r._measurement == "${measurement}")
  |> aggregateWindow(every: ${window}, fn: ${fn})`;

    return this.query(flux);
  }

  async listMeasurements(): Promise<string[]> {
    const flux = `
import "influxdata/influxdb/schema"
schema.measurements(bucket: "${this.config.bucket}")`;

    const result = await this.query(flux);
    return result.tables[0]?.records.map(r => r._value) || [];
  }

  async deleteMeasurement(
    measurement: string,
    start: string | Date,
    stop: string | Date
  ): Promise<void> {
    const startStr = this.formatTime(start);
    const stopStr = this.formatTime(stop);

    const predicate = `_measurement="${measurement}"`;

    const response = await fetch(
      `${this.baseUrl}/api/v2/delete?org=${this.config.org}&bucket=${this.config.bucket}`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          start: startStr,
          stop: stopStr,
          predicate,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Delete failed');
    }
  }

  private pointToLineProtocol(point: Point): string {
    let line = this.escapeKey(point.measurement);

    // Add tags
    if (point.tags) {
      for (const [key, value] of Object.entries(point.tags)) {
        line += `,${this.escapeKey(key)}=${this.escapeKey(value)}`;
      }
    }

    // Add fields
    const fields = Object.entries(point.fields)
      .map(([key, value]) => {
        const escapedKey = this.escapeKey(key);
        const formattedValue = this.formatFieldValue(value);
        return `${escapedKey}=${formattedValue}`;
      })
      .join(',');

    line += ` ${fields}`;

    // Add timestamp
    if (point.timestamp) {
      const ns = this.toNanoseconds(point.timestamp);
      line += ` ${ns}`;
    }

    return line;
  }

  private escapeKey(str: string): string {
    return str
      .replace(/,/g, '\\,')
      .replace(/=/g, '\\=')
      .replace(/ /g, '\\ ');
  }

  private formatFieldValue(value: number | string | boolean): string {
    if (typeof value === 'string') {
      // String values must be quoted
      return `"${value.replace(/"/g, '\\"')}"`;
    } else if (typeof value === 'boolean') {
      return value ? 't' : 'f';
    } else if (Number.isInteger(value)) {
      return `${value}i`; // Integer
    } else {
      return String(value); // Float
    }
  }

  private toNanoseconds(timestamp: Date | number): number {
    if (timestamp instanceof Date) {
      return timestamp.getTime() * 1_000_000;
    }
    return timestamp;
  }

  private formatTime(time: string | Date): string {
    if (typeof time === 'string') {
      return time; // Relative time like '-1h' or '2024-01-01T00:00:00Z'
    }
    return time.toISOString();
  }

  private parseFluxResponse(csv: string): QueryResult {
    const lines = csv.split('\n').filter(line => line.trim());
    const tables: FluxTable[] = [];
    let currentTable: FluxTable | null = null;
    let headers: string[] = [];

    for (const line of lines) {
      if (line.startsWith('#')) {
        // Comment or annotation
        continue;
      }

      const values = this.parseCSVLine(line);

      if (!currentTable) {
        // First line is headers
        headers = values;
        currentTable = {
          columns: headers,
          records: [],
        };
      } else {
        // Data row
        const record: Record<string, any> = {};
        for (let i = 0; i < headers.length; i++) {
          record[headers[i]] = values[i];
        }
        currentTable.records.push(record);
      }
    }

    if (currentTable) {
      tables.push(currentTable);
    }

    return { tables };
  }

  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current);
    return values;
  }
}

// Helper functions

export function createPoint(
  measurement: string,
  fields: Record<string, number | string | boolean>,
  tags?: Record<string, string>
): Point {
  return {
    measurement,
    fields,
    tags,
    timestamp: new Date(),
  };
}

export class PointBuilder {
  private point: Point;

  constructor(measurement: string) {
    this.point = {
      measurement,
      fields: {},
    };
  }

  tag(key: string, value: string): PointBuilder {
    if (!this.point.tags) {
      this.point.tags = {};
    }
    this.point.tags[key] = value;
    return this;
  }

  field(key: string, value: number | string | boolean): PointBuilder {
    this.point.fields[key] = value;
    return this;
  }

  timestamp(ts: Date | number): PointBuilder {
    this.point.timestamp = ts;
    return this;
  }

  build(): Point {
    return this.point;
  }
}
```

## Web UI Design

```typescript
// src/components/InfluxDBClient.tsx

export function InfluxDBClient() {
  const [connected, setConnected] = useState(false);
  const [measurements, setMeasurements] = useState<string[]>([]);
  const [selectedMeasurement, setSelectedMeasurement] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [writeData, setWriteData] = useState({
    measurement: 'temperature',
    value: 22.5,
  });

  const loadMeasurements = async () => {
    const response = await fetch('/api/influxdb/measurements');
    const data = await response.json();
    setMeasurements(data);
  };

  const executeQuery = async () => {
    const response = await fetch('/api/influxdb/query', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    setResult(data);
  };

  const writePoint = async () => {
    await fetch('/api/influxdb/write', {
      method: 'POST',
      body: JSON.stringify({
        measurement: writeData.measurement,
        fields: { value: writeData.value },
        tags: { location: 'home' },
      }),
    });

    alert('Point written');
  };

  const quickQueries = [
    {
      label: 'Last Hour',
      query: `from(bucket: "my-bucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "${selectedMeasurement}")`,
    },
    {
      label: 'Mean (5m window)',
      query: `from(bucket: "my-bucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "${selectedMeasurement}")
  |> aggregateWindow(every: 5m, fn: mean)`,
    },
  ];

  return (
    <div className="influxdb-client">
      <h2>InfluxDB Time-Series Client</h2>

      <div className="sidebar">
        <h3>Measurements</h3>
        <button onClick={loadMeasurements}>Refresh</button>
        <ul>
          {measurements.map(m => (
            <li
              key={m}
              className={selectedMeasurement === m ? 'selected' : ''}
              onClick={() => setSelectedMeasurement(m)}
            >
              📊 {m}
            </li>
          ))}
        </ul>

        <h3>Write Data</h3>
        <input
          type="text"
          placeholder="Measurement"
          value={writeData.measurement}
          onChange={(e) => setWriteData({ ...writeData, measurement: e.target.value })}
        />
        <input
          type="number"
          placeholder="Value"
          value={writeData.value}
          onChange={(e) => setWriteData({ ...writeData, value: Number(e.target.value) })}
        />
        <button onClick={writePoint}>Write Point</button>
      </div>

      <div className="main-panel">
        <div className="query-editor">
          <h3>Flux Query</h3>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={10}
            placeholder="Enter Flux query..."
          />
          <button onClick={executeQuery}>Execute</button>

          <div className="quick-queries">
            {quickQueries.map(q => (
              <button
                key={q.label}
                onClick={() => setQuery(q.query)}
                disabled={!selectedMeasurement}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {result && (
          <div className="results">
            <h3>Results</h3>
            {result.tables.map((table, i) => (
              <div key={i} className="table">
                <table>
                  <thead>
                    <tr>
                      {table.columns.map(col => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.records.map((record, j) => (
                      <tr key={j}>
                        {table.columns.map(col => (
                          <td key={col}>{record[col]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

## Security

### API Tokens

```typescript
// Generate token in InfluxDB UI
const token = 'your-token-here';

// Read-only token
const readToken = 'read-token';

// Write-only token
const writeToken = 'write-token';
```

## Testing

```bash
# Docker InfluxDB 2.x
docker run -d \
  -p 8086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=password123 \
  -e DOCKER_INFLUXDB_INIT_ORG=myorg \
  -e DOCKER_INFLUXDB_INIT_BUCKET=mybucket \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=mytoken \
  influxdb:2

# Write test data
curl -XPOST "http://localhost:8086/api/v2/write?org=myorg&bucket=mybucket" \
  -H "Authorization: Token mytoken" \
  --data-raw "temperature,location=home value=22.5"

# Query
curl -XPOST "http://localhost:8086/api/v2/query?org=myorg" \
  -H "Authorization: Token mytoken" \
  -H "Content-Type: application/vnd.flux" \
  --data 'from(bucket:"mybucket") |> range(start:-1h)'
```

## Resources

- **InfluxDB Docs**: [Documentation](https://docs.influxdata.com/)
- **Line Protocol**: [Specification](https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/)
- **Flux**: [Query Language](https://docs.influxdata.com/flux/v0/)

## Common Flux Patterns

### Basic Query
```flux
from(bucket: "mybucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu")
  |> filter(fn: (r) => r._field == "usage")
```

### Aggregation
```flux
from(bucket: "mybucket")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "temperature")
  |> aggregateWindow(every: 1h, fn: mean)
```

### Downsampling
```flux
from(bucket: "mybucket")
  |> range(start: -7d)
  |> aggregateWindow(every: 1d, fn: mean)
  |> to(bucket: "mybucket-weekly")
```

## Notes

- **Time-series optimized** - excellent for metrics and IoT
- **Line Protocol** is simple and efficient
- **Flux** is powerful but complex query language
- **Nanosecond precision** timestamps
- **Tags** are indexed, **fields** are not
- Use **continuous queries** for downsampling
- **Retention policies** for automatic data expiration
