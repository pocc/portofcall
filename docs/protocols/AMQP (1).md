# AMQP (Advanced Message Queuing Protocol)

## Overview

**AMQP** is an open standard application layer protocol for message-oriented middleware. It's the protocol underlying RabbitMQ and other message brokers, providing reliable message delivery, routing, queuing, and security.

**Port:** 5672 (AMQP), 5671 (AMQPS)
**Transport:** TCP
**Version:** AMQP 0-9-1 (most common), AMQP 1.0 (OASIS standard)

## Protocol Specification

### Frame Structure

AMQP uses a frame-based protocol:

```
Frame Type (1 byte) | Channel (2 bytes) | Size (4 bytes) | Payload | Frame-End (1 byte = 0xCE)
```

### Frame Types

- `1` - METHOD frame (method invocation)
- `2` - HEADER frame (content header)
- `3` - BODY frame (content body)
- `4` - HEARTBEAT frame (connection health check)

### Connection Flow

1. **Protocol Header**: Client sends `AMQP\x00\x00\x09\x01`
2. **Connection.Start**: Server responds with supported mechanisms
3. **Connection.StartOk**: Client selects mechanism and credentials
4. **Connection.Tune**: Server proposes channel/frame limits
5. **Connection.TuneOk**: Client agrees or proposes different values
6. **Connection.Open**: Client opens connection to vhost
7. **Connection.OpenOk**: Server confirms

### Channel Operations

**Basic Publish** (send message):
```
Basic.Publish (exchange, routing-key, mandatory, immediate)
Header (properties)
Body (message content)
```

**Basic Consume** (receive messages):
```
Basic.Consume (queue, consumer-tag, no-ack, exclusive)
Basic.ConsumeOk (consumer-tag)
Basic.Deliver (consumer-tag, delivery-tag, exchange, routing-key)
Header (properties)
Body (message content)
```

### Exchange Types

- **Direct**: Routes to queues with exact routing key match
- **Fanout**: Broadcasts to all bound queues
- **Topic**: Routes based on pattern matching (wildcards)
- **Headers**: Routes based on message headers

## Resources

- **AMQP 0-9-1 Specification**: RabbitMQ reference
- **AMQP 1.0**: OASIS standard
- [RabbitMQ Tutorials](https://www.rabbitmq.com/tutorials.html)
- [amqp.node](https://github.com/amqp-node/amqplib) - Node.js AMQP client

## Notes

- **Reliable Delivery**: Publisher confirms, consumer acknowledgments
- **Routing Flexibility**: Multiple exchange types and binding patterns
- **Queues**: Durable, transient, exclusive, auto-delete
- **Prefetch**: Control how many messages are sent to consumer
- **Dead Letter Exchanges**: Handle undeliverable messages
- **TTL**: Message and queue time-to-live
- **Priority Queues**: Message prioritization support
- **RabbitMQ**: Most popular AMQP broker
