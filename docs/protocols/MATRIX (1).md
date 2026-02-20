# Matrix Protocol

## Overview

**Matrix** is an open standard for decentralized, real-time communication. It provides a framework for secure, interoperable messaging, VoIP, and IoT, using HTTP JSON APIs for client-server and server-server communication.

**Port:** 8448 (federation), 443 (client-server)
**Transport:** HTTPS (JSON over HTTP)
**Type:** RESTful HTTP API

## Protocol Specification

Matrix uses HTTP JSON APIs:

### Client-Server API

- `POST /_matrix/client/r0/login` - Authenticate
- `GET /_matrix/client/r0/sync` - Long-poll for updates
- `PUT /_matrix/client/r0/rooms/{roomId}/send/{eventType}/{txnId}` - Send message
- `POST /_matrix/client/r0/rooms/{roomId}/join` - Join room

### Server-Server API (Federation)

- `GET /_matrix/federation/v1/event/{eventId}` - Fetch event
- `PUT /_matrix/federation/v1/send/{txnId}` - Send events
- `POST /_matrix/federation/v1/make_join/{roomId}/{userId}` - Initiate join

## Resources

- [Matrix.org](https://matrix.org/)
- [Matrix Spec](https://spec.matrix.org/)
- [Element](https://element.io/) - Popular Matrix client

## Notes

- **Decentralized**: No single point of control
- **Federation**: Servers communicate peer-to-peer
- **E2EE**: End-to-end encryption (Olm/Megolm)
- **Bridges**: Connect to Slack, Discord, IRC, etc.
- **VoIP**: Voice and video calls built-in
- **Open Standard**: Anyone can implement
- **Rooms**: Communication happens in rooms
- **Event DAG**: Messages form a directed acyclic graph
