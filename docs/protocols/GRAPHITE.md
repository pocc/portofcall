# Graphite Protocol Implementation Plan

## Overview

**Protocol:** Graphite Plaintext Protocol
**Port:** 2003 (plaintext), 2004 (pickle)
**Specification:** [Graphite Documentation](https://graphite.readthedocs.io/)
**Complexity:** Low
**Purpose:** Metrics collection and time-series storage

Graphite enables **sending metrics data** from the browser - collect and visualize application performance, system metrics, and business analytics.

### Use Cases
- Application performance monitoring
- System metrics collection
- Business metrics tracking
- Real-time dashboards
- Time-series data visualization
- Custom monitoring solutions

## Protocol Specification

### Plaintext Format

```
metric_name value timestamp\n
```

**That's it!** Three space-separated fields:
1. **Metric name** (dot-separated path)
2. **Value** (numeric)
3. **Timestamp** (Unix epoch, optional - defaults to now)

### Example Metrics

```
servers.web01.cpu.usage 45.2 1640000000
servers.web01.memory.used 8589934592 1640000000
app.requests.total 12345 1640000000
app.response.time.p95 123.45 1640000000
```

### Metric Naming Convention

Use dot-separated hierarchy:
```
<namespace>.<group>.<server>.<metric>
```

Examples:
- `app.api.prod.requests.count`
- `infra.database.db01.connections`
- `business.sales.revenue.daily`

## Worker Implementation

```typescript
// src/worker/protocols/graphite/client.ts

import { connect } from 'cloudflare:sockets';

export interface GraphiteConfig {
  host: string;
  port: number;
}

export interface Metric {
  name: string;
  value: number;
  timestamp?: number; // Unix epoch, defaults to now
}

export class GraphiteClient {
  constructor(private config: GraphiteConfig) {}

  async send(metric: Metric): Promise<void> {
    const metrics = [metric];
    await this.sendBatch(metrics);
  }

  async sendBatch(metrics: Metric[]): Promise<void> {
    const socket = connect(`${this.config.host}:${this.config.port}`);
    await socket.opened;

    const lines: string[] = [];

    for (const metric of metrics) {
      const timestamp = metric.timestamp || Math.floor(Date.now() / 1000);
      lines.push(`${metric.name} ${metric.value} ${timestamp}`);
    }

    const data = lines.join('\n') + '\n';

    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(data));
    writer.releaseLock();

    await socket.close();
  }

  // Helper methods for common metrics

  async counter(name: string, value: number = 1): Promise<void> {
    await this.send({ name, value });
  }

  async gauge(name: string, value: number): Promise<void> {
    await this.send({ name, value });
  }

  async timing(name: string, milliseconds: number): Promise<void> {
    await this.send({ name, value: milliseconds });
  }

  // Time a function execution
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      await this.timing(name, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      await this.timing(`${name}.error`, duration);
      throw error;
    }
  }
}

// Metric builder for complex metrics

export class MetricBuilder {
  private prefix: string[] = [];

  constructor(namespace?: string) {
    if (namespace) {
      this.prefix.push(namespace);
    }
  }

  with(segment: string): MetricBuilder {
    const builder = new MetricBuilder();
    builder.prefix = [...this.prefix, segment];
    return builder;
  }

  metric(name: string, value: number): Metric {
    const fullName = [...this.prefix, name].join('.');
    return { name: fullName, value };
  }
}

// Usage example:
// const metrics = new MetricBuilder('myapp');
// const webMetrics = metrics.with('web').with('prod');
// const metric = webMetrics.metric('requests.total', 100);
```

## Web UI Design

```typescript
// src/components/GraphiteMonitor.tsx

export function GraphiteMonitor() {
  const [host, setHost] = useState('graphite.example.com');
  const [port, setPort] = useState(2003);
  const [metricName, setMetricName] = useState('app.test.metric');
  const [metricValue, setMetricValue] = useState<number>(0);
  const [history, setHistory] = useState<Metric[]>([]);

  const sendMetric = async () => {
    const metric: Metric = {
      name: metricName,
      value: metricValue,
      timestamp: Math.floor(Date.now() / 1000),
    };

    await fetch('/api/graphite/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        port,
        metric,
      }),
    });

    setHistory([...history, metric]);
  };

  const sendRandomMetric = () => {
    setMetricValue(Math.random() * 100);
    setTimeout(sendMetric, 100);
  };

  return (
    <div className="graphite-monitor">
      <h2>Graphite Metrics</h2>

      <div className="config">
        <input
          type="text"
          placeholder="Graphite Host"
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

      <div className="metric-input">
        <input
          type="text"
          placeholder="Metric name (e.g., app.requests.count)"
          value={metricName}
          onChange={(e) => setMetricName(e.target.value)}
        />
        <input
          type="number"
          placeholder="Value"
          value={metricValue}
          onChange={(e) => setMetricValue(Number(e.target.value))}
        />
        <button onClick={sendMetric}>Send</button>
        <button onClick={sendRandomMetric}>Send Random</button>
      </div>

      <div className="history">
        <h3>Sent Metrics</h3>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(-10).reverse().map((metric, i) => (
              <tr key={i}>
                <td>{new Date(metric.timestamp! * 1000).toLocaleTimeString()}</td>
                <td>{metric.name}</td>
                <td>{metric.value.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MetricTemplates onSelect={(name, value) => {
        setMetricName(name);
        setMetricValue(value);
      }} />
    </div>
  );
}

function MetricTemplates({ onSelect }: {
  onSelect: (name: string, value: number) => void
}) {
  const templates = [
    { name: 'app.requests.count', value: 1, label: 'Request Counter' },
    { name: 'app.response.time', value: 45.2, label: 'Response Time (ms)' },
    { name: 'app.errors.count', value: 1, label: 'Error Counter' },
    { name: 'system.cpu.usage', value: 65.5, label: 'CPU Usage (%)' },
    { name: 'system.memory.used', value: 8589934592, label: 'Memory Used (bytes)' },
  ];

  return (
    <div className="metric-templates">
      <h3>Templates</h3>
      {templates.map(template => (
        <button
          key={template.name}
          onClick={() => onSelect(template.name, template.value)}
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
```

## Real-World Integration

### Browser Performance Metrics

```typescript
// Send page load time
const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart;
await graphite.timing('app.pageload.home', loadTime);

// Send API response times
const start = Date.now();
const response = await fetch('/api/data');
const duration = Date.now() - start;
await graphite.timing('app.api.data.response', duration);
```

### Application Metrics

```typescript
// Counter
await graphite.counter('app.button.clicks');

// Gauge
await graphite.gauge('app.users.active', activeUsers);

// Batch metrics
await graphite.sendBatch([
  { name: 'app.requests.total', value: 1000 },
  { name: 'app.requests.success', value: 950 },
  { name: 'app.requests.error', value: 50 },
]);
```

## Security

### Input Validation

```typescript
function validateMetricName(name: string): boolean {
  // Only alphanumeric, dots, underscores, hyphens
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

function validateValue(value: number): boolean {
  return !isNaN(value) && isFinite(value);
}
```

### Rate Limiting

```typescript
// Limit metrics sent per minute
const METRIC_RATE_LIMIT = 1000; // metrics per minute
```

## Testing

### Docker Graphite

```bash
docker run -d \
  -p 2003:2003 \
  -p 8080:80 \
  graphiteapp/graphite-statsd

# Send test metric
echo "test.metric 42 $(date +%s)" | nc localhost 2003

# View in browser
open http://localhost:8080
```

### Test with Netcat

```bash
# Send metrics
echo "test.cpu.usage 45.2 $(date +%s)" | nc graphite.example.com 2003
echo "test.memory.used 1024 $(date +%s)" | nc graphite.example.com 2003
```

## Resources

- **Graphite Docs**: [Official Documentation](https://graphite.readthedocs.io/)
- **Carbon**: [Graphite storage backend](https://github.com/graphite-project/carbon)
- **Grafana**: [Visualization tool](https://grafana.com/) (integrates with Graphite)

## Common Metric Patterns

### Counters (cumulative)
```
app.requests.total 12345
app.errors.total 42
```

### Gauges (current value)
```
system.cpu.usage 65.5
system.memory.free 2048000000
app.users.active 150
```

### Timers (milliseconds)
```
app.response.time.p50 45.2
app.response.time.p95 123.4
app.response.time.p99 256.7
```

### Rates (per second)
```
app.requests.rate 100.5
app.bytes.sent.rate 1048576
```

## Next Steps

1. Implement Graphite client
2. Add metric batching
3. Create metric builder DSL
4. Build real-time dashboard
5. Add Grafana integration
6. Support pickle protocol (more efficient)
7. Create metric aggregation

## Notes

- **Extremely simple** protocol - just text lines
- **Fire and forget** - no response from server
- **UDP option** available for even lower overhead
- Works great with **StatsD** as a frontend
- **Grafana** is the most popular visualization tool
- Metric names are **hierarchical** (dot-separated)
