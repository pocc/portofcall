# Kafka Protocol (Apache Kafka)

## Overview

**Kafka Protocol** is a binary protocol used by Apache Kafka for distributed event streaming. It enables high-throughput, fault-tolerant, publish-subscribe messaging between producers and consumers.

**Port:** 9092 (plaintext), 9093 (SSL)
**Transport:** TCP
**Type:** Binary protocol

## Protocol Specification

### Message Format

Kafka uses a binary wire protocol with request/response pattern:

```
Size (4 bytes) | Request/Response (N bytes)
```

### Request Header

```
API Key (2 bytes) | API Version (2 bytes) | Correlation ID (4 bytes) | Client ID (string)
```

### API Keys

- `0` - Produce
- `1` - Fetch
- `2` - ListOffsets
- `3` - Metadata
- `8` - OffsetCommit
- `9` - OffsetFetch
- `18` - ApiVersions
- `19` - CreateTopics
- `20` - DeleteTopics

### Record Batch Format (v2)

```
Base Offset (8 bytes)
| Length (4 bytes)
| Partition Leader Epoch (4 bytes)
| Magic (1 byte = 2)
| CRC (4 bytes)
| Attributes (2 bytes)
| Last Offset Delta (4 bytes)
| First Timestamp (8 bytes)
| Max Timestamp (8 bytes)
| Producer ID (8 bytes)
| Producer Epoch (2 bytes)
| Base Sequence (4 bytes)
| Records Count (4 bytes)
| Records (variable)
```

## Resources

- [Kafka Protocol Guide](https://kafka.apache.org/protocol.html)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [KafkaJS](https://kafka.js.org/) - JavaScript client

## Notes

- **Topics & Partitions**: Messages organized in topics with partitions
- **Consumer Groups**: Load balancing across consumers
- **Replication**: Configurable replication factor
- **Retention**: Time or size-based message retention
- **Exactly-Once Semantics**: Idempotent producers + transactional writes
- **Compression**: GZIP, Snappy, LZ4, Zstd
- **Schema Registry**: Avro/Protobuf/JSON schema management
- **Streams API**: Real-time stream processing
