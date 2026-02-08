# Elasticsearch Protocol Implementation Plan

## Overview

**Protocol:** Elasticsearch REST API (HTTP)
**Port:** 9200 (HTTP), 9300 (Transport - internal)
**Specification:** [Elasticsearch API](https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html)
**Complexity:** Medium
**Purpose:** Search and analytics engine

Elasticsearch enables **powerful search and analytics** - query documents, aggregate data, and visualize results from the browser.

### Use Cases
- Log analysis and debugging
- Full-text search
- Data analytics and visualization
- Application monitoring (APM)
- Security analytics (SIEM)
- Business intelligence

## Protocol Specification

### REST API Endpoints

Elasticsearch uses HTTP/REST (not a custom binary protocol):

```
GET /_cluster/health - Cluster health
GET /_cat/indices - List indices
GET /myindex/_search - Search documents
POST /myindex/_doc - Index document
DELETE /myindex - Delete index
```

### Query DSL (JSON)

```json
{
  "query": {
    "match": {
      "message": "error"
    }
  },
  "aggs": {
    "by_severity": {
      "terms": { "field": "severity" }
    }
  }
}
```

## Worker Implementation

```typescript
// src/worker/protocols/elasticsearch/client.ts

export interface ElasticsearchConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface SearchQuery {
  query?: any;
  aggs?: any;
  size?: number;
  from?: number;
  sort?: any[];
}

export class ElasticsearchClient {
  private baseUrl: string;
  private headers: HeadersInit;

  constructor(private config: ElasticsearchConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;

    this.headers = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      this.headers['Authorization'] = `ApiKey ${config.apiKey}`;
    } else if (config.username && config.password) {
      const auth = btoa(`${config.username}:${config.password}`);
      this.headers['Authorization'] = `Basic ${auth}`;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async clusterHealth(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/_cluster/health`, {
      headers: this.headers,
    });
    return response.json();
  }

  async listIndices(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/_cat/indices?format=json`, {
      headers: this.headers,
    });

    const indices = await response.json();
    return indices.map((idx: any) => idx.index);
  }

  async search(index: string, query: SearchQuery): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}/_search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(query),
    });

    return response.json();
  }

  async getDocument(index: string, id: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}/_doc/${id}`, {
      headers: this.headers,
    });

    return response.json();
  }

  async indexDocument(index: string, document: any, id?: string): Promise<any> {
    const url = id
      ? `${this.baseUrl}/${index}/_doc/${id}`
      : `${this.baseUrl}/${index}/_doc`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(document),
    });

    return response.json();
  }

  async deleteDocument(index: string, id: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}/_doc/${id}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    return response.json();
  }

  async createIndex(index: string, settings?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}`, {
      method: 'PUT',
      headers: this.headers,
      body: settings ? JSON.stringify(settings) : undefined,
    });

    return response.json();
  }

  async deleteIndex(index: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    return response.json();
  }

  async aggregate(index: string, aggs: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${index}/_search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ size: 0, aggs }),
    });

    return response.json();
  }
}
```

## Web UI Design

```typescript
// src/components/ElasticsearchDashboard.tsx

export function ElasticsearchDashboard() {
  const [indices, setIndices] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<string>('');
  const [query, setQuery] = useState('{\n  "query": {\n    "match_all": {}\n  }\n}');
  const [results, setResults] = useState<any>(null);

  const loadIndices = async () => {
    const response = await fetch('/api/elasticsearch/indices');
    const data = await response.json();
    setIndices(data);
  };

  const executeSearch = async () => {
    try {
      const parsedQuery = JSON.parse(query);

      const response = await fetch('/api/elasticsearch/search', {
        method: 'POST',
        body: JSON.stringify({
          index: selectedIndex,
          query: parsedQuery,
        }),
      });

      const data = await response.json();
      setResults(data);
    } catch (error) {
      alert('Invalid JSON query');
    }
  };

  return (
    <div className="elasticsearch-dashboard">
      <h2>Elasticsearch Client</h2>

      <div className="sidebar">
        <h3>Indices</h3>
        <button onClick={loadIndices}>Refresh</button>
        <ul>
          {indices.map(index => (
            <li
              key={index}
              className={selectedIndex === index ? 'selected' : ''}
              onClick={() => setSelectedIndex(index)}
            >
              📊 {index}
            </li>
          ))}
        </ul>
      </div>

      <div className="main-panel">
        <div className="query-editor">
          <h3>Query: {selectedIndex}</h3>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={15}
            placeholder="Enter Elasticsearch query DSL..."
          />
          <button onClick={executeSearch} disabled={!selectedIndex}>
            Execute Query
          </button>
        </div>

        {results && (
          <div className="results">
            <h3>
              Results ({results.hits?.total?.value || 0} hits)
              in {results.took}ms
            </h3>

            {results.hits?.hits?.map((hit: any) => (
              <div key={hit._id} className="result-item">
                <div className="result-header">
                  <strong>ID:</strong> {hit._id}
                  <span className="score">Score: {hit._score}</span>
                </div>
                <pre>{JSON.stringify(hit._source, null, 2)}</pre>
              </div>
            ))}

            {results.aggregations && (
              <div className="aggregations">
                <h3>Aggregations</h3>
                <pre>{JSON.stringify(results.aggregations, null, 2)}</pre>
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

### Authentication

```typescript
// API Key (recommended)
const config = {
  host: 'elasticsearch.example.com',
  port: 9200,
  apiKey: 'base64_encoded_api_key',
};

// Or Basic Auth
const config = {
  host: 'elasticsearch.example.com',
  port: 9200,
  username: 'elastic',
  password: 'password',
};
```

### HTTPS

```typescript
// Always use HTTPS in production
const baseUrl = 'https://elasticsearch.example.com:9200';
```

## Testing

```bash
# Docker Elasticsearch
docker run -d \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# Test
curl http://localhost:9200
```

## Resources

- **Elasticsearch Docs**: [Official Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- **Query DSL**: [Query Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html)
- **Kibana**: [Visualization tool](https://www.elastic.co/kibana)

## Common Queries

### Match Query
```json
{
  "query": {
    "match": {
      "message": "error"
    }
  }
}
```

### Range Query
```json
{
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-1h"
      }
    }
  }
}
```

### Aggregation
```json
{
  "aggs": {
    "errors_by_host": {
      "terms": {
        "field": "host.keyword",
        "size": 10
      }
    }
  }
}
```

## Notes

- Elasticsearch is **HTTP-based** (not custom TCP protocol)
- **Query DSL** is powerful but complex
- Perfect for **log analysis** and full-text search
- Integrates with **Kibana** for visualization
- Part of **ELK Stack** (Elasticsearch, Logstash, Kibana)
