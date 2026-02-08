# BitTorrent Protocol

## Overview

**BitTorrent** is a peer-to-peer file sharing protocol for distributing large amounts of data efficiently. Uses a decentralized model where files are split into pieces and shared among peers.

**Port:** 6881-6889 (default range), 6969 (tracker)
**Transport:** TCP (data), UDP (DHT, tracker)
**Type:** Peer-to-peer

## Protocol Specification

### Components

- **Torrent File**: Metadata (.torrent file with tracker URLs and file hashes)
- **Tracker**: Coordinator providing peer lists
- **Peers**: Clients downloading/uploading
- **Seeds**: Clients with complete file
- **Leechers**: Clients downloading

### Protocol Messages

- **Handshake**: Initial connection (19 + "BitTorrent protocol" + reserved + info_hash + peer_id)
- **Keep-alive**: Empty message
- **Choke/Unchoke**: Flow control
- **Interested/Not Interested**: Interest in peer's pieces
- **Have**: Announce piece availability
- **Bitfield**: Announce all available pieces
- **Request**: Request a piece
- **Piece**: Send a piece
- **Cancel**: Cancel a request

### DHT (Distributed Hash Table)

Trackerless operation using Kademlia DHT on UDP port 6881.

### Piece Selection

- **Rarest First**: Download rarest pieces first
- **End Game**: Request all remaining pieces from all peers

## Resources

- [BitTorrent Protocol Specification](http://www.bittorrent.org/beps/bep_0003.html)
- [libtorrent](https://www.libtorrent.org/)

## Notes

- **Efficient Distribution**: Reduces server bandwidth
- **Resilient**: No single point of failure
- **Incentive System**: Tit-for-tat to encourage sharing
- **Magnet Links**: Torrent without .torrent file
- **DHT**: Trackerless torrents
- **PEX**: Peer Exchange
- **uTP**: Micro Transport Protocol (UDP-based)
- **Legal Uses**: Linux ISOs, software distribution, updates
- **Throttling**: Often throttled by ISPs
