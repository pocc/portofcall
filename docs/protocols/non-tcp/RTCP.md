# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**RTCP (RTP Control Protocol)** is the control and monitoring companion protocol to RTP (Real-time Transport Protocol). While RTP delivers media streams, RTCP provides quality feedback, participant identification, and session control for multimedia sessions.

**Port:** RTP port + 1 (e.g., if RTP uses 5004, RTCP uses 5005)
**Transport:** UDP
**Status:** Active standard
**RFC:** 3550 (RTP/RTCP), 3551 (RTP Profile for Audio/Video)

## Protocol Specification

### Key Features

1. **Quality Monitoring**: Reports on packet loss, jitter, delay
2. **Participant Identification**: CNAME, NAME, SOURCE info
3. **Session Control**: BYE messages for leaving sessions
4. **Bandwidth Management**: Self-regulating traffic
5. **Feedback**: Real-time quality feedback to senders
6. **Minimal Overhead**: ~5% of RTP session bandwidth
7. **Scalable**: Works with unicast and multicast

### RTCP Packet Types

**SR (Sender Report) - Type 200:**
- Sent by active senders
- Includes transmission statistics
- RTP timestamp to NTP timestamp mapping
- Packet count and byte count sent

**RR (Receiver Report) - Type 201:**
- Sent by receivers (non-senders)
- Reports reception quality
- Fraction lost, cumulative lost
- Jitter, delay since last SR

**SDES (Source Description) - Type 202:**
- Participant identification
- CNAME (canonical name - required)
- NAME (user's display name)
- EMAIL, PHONE, LOC, TOOL, NOTE

**BYE (Goodbye) - Type 203:**
- Participant leaving session
- Optional reason for leaving

**APP (Application-Defined) - Type 204:**
- Application-specific messages
- Vendor extensions

### Packet Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|    RC   |   PT=SR=200   |             length            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         SSRC of sender                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|              NTP timestamp, most significant word             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|             NTP timestamp, least significant word             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         RTP timestamp                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     sender's packet count                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      sender's octet count                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Fields:**
- **V**: Version (2)
- **P**: Padding
- **RC**: Reception report count
- **PT**: Packet type (200-204)
- **Length**: Packet length in 32-bit words minus one
- **SSRC**: Synchronization source identifier

### Reception Report Block

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                 SSRC_1 (SSRC of first source)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| fraction lost |       cumulative number of packets lost       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           extended highest sequence number received           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      interarrival jitter                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         last SR (LSR)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   delay since last SR (DLSR)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Quality Metrics:**
- **Fraction Lost**: Packets lost since last report (0-255 scale)
- **Cumulative Lost**: Total packets lost since session start
- **Jitter**: Statistical variance of RTP packet arrival times
- **Round-Trip Time**: Calculated from LSR and DLSR

### SDES Items

**CNAME (Canonical Name):**
- Required, globally unique
- Format: `user@host` or `user@ip-address`
- Example: `alice@192.168.1.100`

**NAME:**
- User's display name
- Example: `Alice Smith`

**EMAIL:**
- User's email address

**PHONE:**
- Phone number

**LOC:**
- Geographic location

**TOOL:**
- Application/tool name
- Example: `VLC 3.0.16`

**NOTE:**
- Transient status message

**PRIV:**
- Private/experimental extensions

### Bandwidth Rules

**RTCP Bandwidth Allocation:**
- Default: 5% of RTP session bandwidth
- 25% for senders (SR)
- 75% for receivers (RR)
- Minimum interval: 5 seconds
- Scales with number of participants

**Example:**
- RTP session: 64 kbps audio
- RTCP allocation: 3.2 kbps (5%)
- Sender RTCP: 800 bps (25%)
- Receiver RTCP: 2.4 kbps (75%)

### Timing and Intervals

**Transmission Interval:**
```
interval = participants × avg_rtcp_size / (0.05 × session_bandwidth)
interval = max(interval, 5 seconds)
```

**Randomization:**
- Actual interval: [0.5 × interval, 1.5 × interval]
- Prevents synchronized bursts

## Use Cases

**VoIP Quality Monitoring:**
- Track packet loss, jitter, delay
- Adjust codec, FEC, bandwidth

**Video Conferencing:**
- Participant management
- Quality feedback
- Lip-sync (NTP/RTP timestamp mapping)

**IPTV/Streaming:**
- Monitor stream quality
- Detect network issues
- Client-side buffering adjustments

**WebRTC:**
- Real-time quality metrics
- Congestion control feedback
- REMB (Receiver Estimated Maximum Bitrate)

## Resources

- **RFC 3550**: RTP: A Transport Protocol for Real-Time Applications
- **RFC 3551**: RTP Profile for Audio and Video Conferences
- **RFC 4585**: Extended RTP Profile for RTCP-Based Feedback
- **RFC 5506**: Support for Reduced-Size RTCP
- **RFC 6051**: Rapid Synchronization of RTP Flows
- [RTP Tools](https://www.cs.columbia.edu/~hgs/rtp/rtp-tools.html)

## Notes

- **Companion to RTP**: Always used with RTP
- **Port Convention**: RTP even port (e.g., 5004), RTCP odd port (5005)
- **Quality Feedback**: Real-time feedback loop for adaptation
- **SSRC**: Synchronization Source identifier (random 32-bit)
- **CNAME**: Required for identifying participants across sessions
- **Minimal Overhead**: Designed to use ~5% of session bandwidth
- **Scalability**: Self-regulating mechanism for large groups
- **Multicast**: Works with both unicast and multicast RTP
- **NTP Timestamps**: 64-bit NTP format for synchronization
- **Jitter**: Measured in timestamp units (e.g., 8000 Hz for audio)
- **Round-Trip Time**: LSR + DLSR calculation
- **RTCP XR**: Extended Reports (RFC 3611) for detailed metrics
- **AVPF**: Audio-Visual Profile with Feedback (RFC 4585)
- **Reduced-Size RTCP**: RFC 5506 allows smaller packets
- **WebRTC**: Uses RTCP extensively for quality adaptation
- **SRTCP**: Secure RTCP (encrypted, authenticated)
- **Bandwidth Adaptation**: Codec changes based on RTCP feedback
- **Lip Sync**: NTP/RTP timestamp mapping enables A/V synchronization
