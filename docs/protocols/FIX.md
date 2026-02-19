# FIX Protocol Reference (Financial Information eXchange)

## Overview

FIX (Financial Information eXchange) is a text-based, session-oriented TCP protocol used globally for electronic trading. It handles order routing, execution reporting, market data distribution, and post-trade processing. FIX has been the backbone of institutional electronic trading since the early 1990s.

The protocol is maintained by FIX Trading Community (fixtrading.org). This document covers FIX 4.0 through FIX 4.4 and FIXT.1.1 (the transport layer for FIX 5.0+).

## Wire Format

### Field Structure

Every FIX field is a tag=value pair. Fields are delimited by SOH (ASCII 0x01, Start of Header). The SOH character is never valid within field values for standard fields.

```
tag=value<SOH>tag=value<SOH>tag=value<SOH>
```

In documentation, SOH is typically represented as `|` for readability:

```
8=FIX.4.4|9=126|35=A|49=SENDER|56=TARGET|34=1|52=20260217-14:30:00.000|98=0|108=30|141=Y|10=087|
```

### Message Structure

Every FIX message has three parts:

```
[ Standard Header ] [ Body ] [ Standard Trailer ]
```

**Standard Header** (required, must appear in this order):
| Tag | Name | Description |
|-----|------|-------------|
| 8 | BeginString | FIX version. Must be FIRST field. Values: `FIX.4.0`, `FIX.4.1`, `FIX.4.2`, `FIX.4.3`, `FIX.4.4`, `FIXT.1.1` |
| 9 | BodyLength | Byte count from after tag 9's delimiter through the delimiter immediately preceding tag 10. Must be SECOND field. |
| 35 | MsgType | Message type identifier. Must be THIRD field. |
| 49 | SenderCompID | Sender's identifier |
| 56 | TargetCompID | Receiver's identifier |
| 34 | MsgSeqNum | Sequence number (monotonically increasing per session) |
| 52 | SendingTime | UTC timestamp: `YYYYMMDD-HH:MM:SS` or `YYYYMMDD-HH:MM:SS.sss` |

**Standard Trailer** (required, must be LAST):
| Tag | Name | Description |
|-----|------|-------------|
| 10 | CheckSum | Three-character, zero-padded checksum. Must be LAST field. |

### BodyLength Calculation (Tag 9)

BodyLength counts the number of bytes starting from the first byte after the SOH delimiter following tag 9, up to and including the SOH delimiter immediately before tag 10.

In other words: everything between `9=NNN<SOH>` and `10=NNN<SOH>`, not including the `9=NNN<SOH>` prefix or the `10=NNN<SOH>` trailer.

**Example:**
```
8=FIX.4.4<SOH>9=70<SOH>35=A<SOH>49=SENDER<SOH>56=TARGET<SOH>34=1<SOH>52=20260217-14:30:00.000<SOH>98=0<SOH>108=30<SOH>10=087<SOH>
                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                         This portion is 70 bytes (including all SOH delimiters within it)
```

### CheckSum Calculation (Tag 10)

The checksum is the sum of every byte in the message from `8=...` through the SOH delimiter before `10=`, modulo 256, zero-padded to 3 digits.

**Algorithm:**
```
sum = 0
for each byte in message (from 8= through the SOH before 10=):
    sum += byte_value
checksum = sum % 256
result = zero-pad to 3 digits (e.g., "087", "003", "256" -> "000")
```

**Critical:** The checksum input includes tag 8, tag 9, their values, and all SOH delimiters -- everything up to but NOT including `10=NNN<SOH>`.

## Message Types (Tag 35)

### Session-Level Messages

| MsgType | Name | Direction | Purpose |
|---------|------|-----------|---------|
| A | Logon | Both | Initiate/acknowledge session |
| 0 | Heartbeat | Both | Keep-alive; response to TestRequest |
| 1 | TestRequest | Both | Probe counterparty liveness |
| 2 | ResendRequest | Both | Request retransmission of messages |
| 3 | Reject | Both | Session-level rejection of a message |
| 4 | SequenceReset | Both | Reset sequence numbers (GapFill or Reset mode) |
| 5 | Logout | Both | Terminate session |

### Application-Level Messages

| MsgType | Name | Direction | Purpose |
|---------|------|-----------|---------|
| D | NewOrderSingle | Client->Server | Submit a new order |
| F | OrderCancelRequest | Client->Server | Cancel an existing order |
| G | OrderCancelReplaceRequest | Client->Server | Modify an existing order |
| 8 | ExecutionReport | Server->Client | Order acknowledgment, fill, rejection |
| 9 | OrderCancelReject | Server->Client | Cancel/replace request rejected |
| j | BusinessMessageReject | Server->Client | Application-level rejection |
| W | MarketDataSnapshot | Server->Client | Full market data refresh |
| X | MarketDataIncRefresh | Server->Client | Incremental market data update |
| Y | MarketDataRequestReject | Server->Client | Market data request rejected |

## Session Lifecycle

### 1. Logon (MsgType=A)

The initiator sends a Logon message. The acceptor responds with its own Logon message to confirm the session.

**Required Logon fields:**
| Tag | Name | Typical Value | Notes |
|-----|------|---------------|-------|
| 8 | BeginString | FIX.4.4 | Protocol version |
| 35 | MsgType | A | |
| 49 | SenderCompID | (your ID) | Pre-agreed identifier |
| 56 | TargetCompID | (their ID) | Pre-agreed identifier |
| 34 | MsgSeqNum | 1 | First message of session (or continuing) |
| 52 | SendingTime | (UTC time) | |
| 98 | EncryptMethod | 0 | 0=None (most common) |
| 108 | HeartBtInt | 30 | Heartbeat interval in seconds |

**Optional Logon fields:**
| Tag | Name | Value | Notes |
|-----|------|-------|-------|
| 141 | ResetSeqNumFlag | Y | Reset both sides' sequence numbers to 1 |
| 553 | Username | (string) | FIX 4.3+ |
| 554 | Password | (string) | FIX 4.3+ |
| 789 | NextExpectedMsgSeqNum | (int) | FIX 4.4+ |
| 1137 | DefaultApplVerID | 9 | FIXT.1.1 only (9 = FIX50SP2) |

**Example Logon message (human-readable):**
```
8=FIX.4.4|9=84|35=A|49=MYSYSTEM|56=EXCHANGE|34=1|52=20260217-14:30:00.000|98=0|108=30|141=Y|10=174|
```

### 2. Heartbeat / TestRequest

After logon, both sides send Heartbeat (35=0) messages at the agreed `HeartBtInt` interval if no other messages have been sent. If no message is received within `HeartBtInt + reasonable transmission time`, a TestRequest (35=1) is sent. The counterparty must respond with a Heartbeat containing the TestReqID (tag 112) from the request.

**TestRequest:**
```
8=FIX.4.4|9=65|35=1|49=SENDER|56=TARGET|34=5|52=20260217-14:31:00.000|112=PROBE-123|10=xxx|
```

**Expected Heartbeat response:**
```
8=FIX.4.4|9=65|35=0|49=TARGET|56=SENDER|34=5|52=20260217-14:31:00.500|112=PROBE-123|10=xxx|
```

### 3. Sequence Numbers (Tag 34)

- Every message has a monotonically increasing MsgSeqNum.
- Both sides maintain independent inbound and outbound sequence counters.
- Sequence gaps trigger ResendRequest (35=2).
- Sequence numbers persist across TCP reconnects within a FIX session (unless ResetSeqNumFlag=Y).

### 4. Logout (MsgType=5)

Either side sends Logout to terminate the session gracefully. The counterparty should acknowledge with its own Logout and then disconnect TCP.

```
8=FIX.4.4|9=60|35=5|49=SENDER|56=TARGET|34=10|52=20260217-15:00:00.000|10=xxx|
```

Optional tag 58 (Text) may contain a reason string.

## Order Flow

### NewOrderSingle (MsgType=D)

**Required fields:**
| Tag | Name | Example | Notes |
|-----|------|---------|-------|
| 11 | ClOrdID | ORD-001 | Client-assigned order ID (unique per session) |
| 21 | HandlInst | 1 | 1=Automated, no intervention; 2=Automated, intervention OK; 3=Manual |
| 55 | Symbol | AAPL | Instrument identifier |
| 54 | Side | 1 | 1=Buy, 2=Sell, 5=Sell Short |
| 60 | TransactTime | (UTC) | Time the order was created |
| 38 | OrderQty | 100 | Number of shares/contracts |
| 40 | OrdType | 2 | 1=Market, 2=Limit, 3=Stop, 4=Stop Limit |
| 44 | Price | 150.25 | Required for Limit orders (OrdType=2,4) |

### ExecutionReport (MsgType=8)

The server responds to orders with ExecutionReports. Key fields:

| Tag | Name | Notes |
|-----|------|-------|
| 17 | ExecID | Server-assigned execution ID |
| 39 | OrdStatus | Order status (see below) |
| 150 | ExecType | Execution event type (see below) |
| 11 | ClOrdID | Echo of client's order ID |
| 58 | Text | Human-readable description (optional) |

**OrdStatus (Tag 39) values:**
| Value | Status |
|-------|--------|
| 0 | New |
| 1 | Partially Filled |
| 2 | Filled |
| 3 | Done for Day |
| 4 | Canceled |
| 5 | Replaced |
| 6 | Pending Cancel |
| 7 | Stopped |
| 8 | Rejected |
| 9 | Suspended |
| A | Pending New |
| B | Calculated |
| C | Expired |
| D | Accepted for Bidding |
| E | Pending Replace |

**ExecType (Tag 150) values:**
| Value | Type |
|-------|------|
| 0 | New |
| 1 | Partial Fill (deprecated in 4.3+, use F) |
| 2 | Fill (deprecated in 4.3+, use F) |
| 4 | Canceled |
| 5 | Replaced |
| 8 | Rejected |
| F | Trade (fill or partial fill in 4.3+) |
| I | Order Status |

## Network Configuration

### Ports

FIX has no single IANA-assigned port. Common conventions:

| Port | Usage |
|------|-------|
| 9878 | Common default for many FIX engines |
| 9010 | Alternative common port |
| 4500-4599 | Range used by some venues |
| Custom | Most production deployments use venue-specific ports |

### Transport

- **TCP**: The standard transport. FIX messages are framed by the protocol itself (BeginString through CheckSum), not by TCP framing.
- **TLS/SSL**: Many venues require TLS. The FIX protocol rides inside the TLS tunnel unchanged.
- **FIXS**: FIX over TLS (formally specified in the FIX Session Protocol extensions).

## FIX Versions

| Version | Year | Key Changes |
|---------|------|-------------|
| FIX.4.0 | 1996 | Original specification |
| FIX.4.1 | 1997 | Added market data messages (W, X) |
| FIX.4.2 | 2000 | Most widely deployed version; added many order types |
| FIX.4.3 | 2001 | Added Username/Password logon; ExecType changes |
| FIX.4.4 | 2003 | Added NextExpectedMsgSeqNum; most feature-complete 4.x |
| FIXT.1.1 + FIX.5.0 | 2006 | Split transport (FIXT) from application layer |
| FIX.5.0SP2 | 2009+ | Latest application version; used with FIXT.1.1 |

For `FIXT.1.1`, the BeginString is `FIXT.1.1` and tag 1137 (DefaultApplVerID) specifies the application version (e.g., `9` for FIX 5.0 SP2).

## Common Tag Reference

### Session Tags

| Tag | Name | Type | Description |
|-----|------|------|-------------|
| 8 | BeginString | String | FIX version identifier |
| 9 | BodyLength | Int | Message body length in bytes |
| 10 | CheckSum | String(3) | Three-digit zero-padded checksum |
| 34 | MsgSeqNum | SeqNum | Message sequence number |
| 35 | MsgType | String | Message type |
| 43 | PossDupFlag | Boolean | Y if possible duplicate |
| 49 | SenderCompID | String | Sender identifier |
| 50 | SenderSubID | String | Sender sub-identifier |
| 52 | SendingTime | UTCTimestamp | Message creation time |
| 56 | TargetCompID | String | Target identifier |
| 57 | TargetSubID | String | Target sub-identifier |
| 58 | Text | String | Free-form text (errors, reasons) |
| 97 | PossResend | Boolean | Y if possible resend |
| 98 | EncryptMethod | Int | 0=None |
| 108 | HeartBtInt | Int | Heartbeat interval (seconds) |
| 112 | TestReqID | String | Test request identifier |
| 122 | OrigSendingTime | UTCTimestamp | Original sending time for PossDup |
| 141 | ResetSeqNumFlag | Boolean | Y to reset sequence numbers |
| 553 | Username | String | Logon username (4.3+) |
| 554 | Password | String | Logon password (4.3+) |
| 789 | NextExpectedMsgSeqNum | SeqNum | Expected next inbound SeqNum (4.4+) |
| 1137 | DefaultApplVerID | String | Application version for FIXT.1.1 |

### Order Tags

| Tag | Name | Type | Description |
|-----|------|------|-------------|
| 1 | Account | String | Trading account |
| 11 | ClOrdID | String | Client-assigned order ID |
| 14 | CumQty | Qty | Cumulative filled quantity |
| 15 | Currency | Currency | Order currency |
| 17 | ExecID | String | Execution report ID |
| 21 | HandlInst | Char | 1=Auto/no intervention, 2=Auto/intervention OK, 3=Manual |
| 31 | LastPx | Price | Price of last fill |
| 32 | LastQty | Qty | Quantity of last fill |
| 37 | OrderID | String | Server-assigned order ID |
| 38 | OrderQty | Qty | Order quantity |
| 39 | OrdStatus | Char | Order status |
| 40 | OrdType | Char | 1=Market, 2=Limit, 3=Stop, 4=StopLimit |
| 44 | Price | Price | Limit price |
| 54 | Side | Char | 1=Buy, 2=Sell, 5=SellShort |
| 55 | Symbol | String | Instrument symbol |
| 59 | TimeInForce | Char | 0=Day, 1=GTC, 3=IOC, 4=FOK, 6=GTD |
| 60 | TransactTime | UTCTimestamp | Order transaction time |
| 150 | ExecType | Char | Execution type |
| 151 | LeavesQty | Qty | Remaining order quantity |

## Implementation Notes

### portofcall Implementation

The implementation in `src/worker/fix.ts` provides three operations:

1. **FIX Probe** (`handleFIXProbe`): Sends a Logon, reads the response, sends Logout. Used for detecting FIX engines and gathering version/identity info.

2. **FIX Order** (`handleFIXOrder`): Full Logon -> NewOrderSingle -> ExecutionReport -> Logout flow. Supports Market and Limit orders with configurable SenderCompID, TargetCompID, and SenderSubID.

3. **FIX Heartbeat Test** (`handleFIXHeartbeat`): Logon -> TestRequest -> Heartbeat response -> Logout. Verifies engine liveness and round-trip time.

### Checksum Implementation

```typescript
function fixChecksum(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  return String(sum % 256).padStart(3, '0');
}
```

The checksum input is all bytes from `8=...` through the SOH before `10=` (inclusive).

### Message Construction

Messages are built by:
1. Filtering out tags 8, 9, 10 from the field list
2. Joining remaining fields as `tag=value<SOH>` to form the body
3. Prepending `8=<version><SOH>9=<body_length><SOH>`
4. Computing the checksum over everything built so far
5. Appending `10=<checksum><SOH>`

### Timestamp Format

SendingTime (tag 52) uses UTC format: `YYYYMMDD-HH:MM:SS.sss`

Example: `20260217-14:30:00.123`

### Session Defaults

| Parameter | Default |
|-----------|---------|
| FIX Version | FIX.4.4 |
| HeartBtInt | 30 seconds |
| EncryptMethod | 0 (None) |
| ResetSeqNumFlag | Y (reset on connect) |
| SenderCompID | PORTOFCALL |
| TargetCompID | TARGET |

## Security Considerations

- FIX transmits data in plaintext over TCP. Production systems should use TLS.
- Credentials (Username/Password in tags 553/554) are sent in cleartext unless TLS is used.
- SenderCompID and TargetCompID are pre-shared identifiers, not authentication mechanisms.
- The probe implementation is read-only: it sends a Logon, observes the response, and disconnects.
- The order implementation can submit live orders -- use only against test/sandbox environments.

## References

- FIX Trading Community: https://www.fixtrading.org/
- FIX 4.4 Specification: https://www.fixtrading.org/standards/fix-4-4/
- FIX 5.0 SP2 with FIXT 1.1: https://www.fixtrading.org/standards/fix-5-0-sp-2/
- FIXimate (online tag browser): https://fiximate.fixtrading.org/
