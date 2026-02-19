# SpamAssassin spamd — Power User Reference

**Port:** 783 (default) | **Protocol:** SPAMC/SPAMD Protocol (SpamAssassin) | **Tests:** Deployed

Port of Call implements the SpamAssassin daemon (spamd) protocol from scratch, providing spam checking, rule analysis, and Bayes learning via direct TCP connections from Cloudflare Workers to your SpamAssassin server.

**No TLS support.** Plain TCP only; for encryption, use SSH tunneling or VPN.

---

## API Endpoints

### `POST /api/spamd/ping` — Test connectivity and version detection

Sends a PING command to verify the SpamAssassin daemon is reachable and responsive. Returns server version and round-trip time.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Hostname or IP (validates format) |
| `port` | number | `783` | 1-65535 |
| `username` | string | — | Optional User header for per-user configuration |
| `timeout` | number (ms) | `10000` | 1-300000 ms |

**Example:**
```json
{ "host": "spam.example.com", "port": 783, "timeout": 10000 }
```

**Success (200):**
```json
{
  "success": true,
  "host": "spam.example.com",
  "port": 783,
  "version": "1.5",
  "rtt": 142
}
```

**Error (500):**
```json
{ "success": false, "error": "Connection timeout" }
```

**Notes:**
- The `version` field is extracted from the `SPAMD/<version>` response line
- Most SpamAssassin deployments use protocol version `1.5`
- RTT includes full connection handshake + command + response
- Host validation accepts domain names, IPv4, and IPv6 addresses

---

### `POST /api/spamd/check` — Analyze email for spam

Sends CHECK, SYMBOLS, or REPORT commands to analyze an email message and return spam scoring, matched rules, or detailed analysis reports.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `783` | |
| `message` | string | required | Full email content (headers + body) |
| `command` | string | `"SYMBOLS"` | `CHECK`, `SYMBOLS`, or `REPORT` |
| `username` | string | — | Optional User header for per-user rules |
| `timeout` | number (ms) | `30000` | Total timeout including connect + analysis |

**Command types:**
- **CHECK**: Returns spam score and threshold only (no rule details)
- **SYMBOLS**: Returns score + list of matched SpamAssassin rules (default)
- **REPORT**: Returns score + human-readable analysis report

**Example request:**
```json
{
  "host": "spam.example.com",
  "message": "From: spammer@evil.com\nSubject: Buy now!\n\nClick here for free money!",
  "command": "SYMBOLS"
}
```

**Success (200) — SYMBOLS:**
```json
{
  "success": true,
  "host": "spam.example.com",
  "port": 783,
  "command": "SYMBOLS",
  "responseCode": 0,
  "responseMessage": "EX_OK",
  "isSpam": true,
  "score": 15.2,
  "threshold": 5.0,
  "symbols": ["BAYES_99", "DKIM_INVALID", "FREEMAIL_FROM", "HTML_MESSAGE", "MISSING_HEADERS"],
  "rtt": 458
}
```

**Success (200) — REPORT:**
```json
{
  "success": true,
  "host": "spam.example.com",
  "port": 783,
  "command": "REPORT",
  "isSpam": true,
  "score": 15.2,
  "threshold": 5.0,
  "report": "pts rule name              description\n---- ---------------------- --------------------------------------------------\n 3.5 BAYES_99               Message has bayes score of 0.99 to 1.00\n 2.1 DKIM_INVALID           DKIM signature exists but is not valid\n 1.0 FREEMAIL_FROM          Sender email is commonly abused enduser mail provider",
  "rtt": 512
}
```

**Success (200) — CHECK (ham):**
```json
{
  "success": true,
  "command": "CHECK",
  "isSpam": false,
  "score": 2.1,
  "threshold": 5.0,
  "rtt": 234
}
```

**Error (500):**
```json
{ "success": false, "error": "Unexpected response: SPAMD/1.5 76 EX_PROTOCOL" }
```

**Response code reference:**

| Code | Constant | Meaning |
|---|---|---|
| 0 | EX_OK | Success |
| 64 | EX_USAGE | Command syntax error |
| 65 | EX_DATAERR | Data format error |
| 66 | EX_NOINPUT | Input missing |
| 68 | EX_NOHOST | Host unreachable |
| 69 | EX_UNAVAILABLE | Service unavailable |
| 74 | EX_IOERR | I/O error |
| 76 | EX_PROTOCOL | Protocol error |

**Notes:**
- **Message size limit:** 512KB (string length pre-encoding)
- **Spam threshold:** Default is 5.0, configurable in SpamAssassin server config
- **isSpam determination:** `score >= threshold` (extracted from `Spam:` header)
- **Symbol format:** Comma-separated list (e.g., `RULE1,RULE2,RULE3`)
- **User header usage:** Per-user Bayes databases, AWL scores, and custom rules require `username` parameter

**Common SpamAssassin rules (symbols):**

| Symbol | Points | Description |
|---|---|---|
| BAYES_99 | 3.5 | Bayesian filter thinks spam (99-100% confidence) |
| BAYES_00 | -1.9 | Bayesian filter thinks ham (0-1% confidence) |
| DKIM_VALID | -0.1 | Valid DKIM signature |
| DKIM_INVALID | 2.1 | DKIM signature exists but invalid |
| SPF_PASS | -0.0 | SPF check passed |
| SPF_FAIL | 0.9 | SPF check failed |
| FREEMAIL_FROM | 1.0 | Sender from free email provider |
| HTML_MESSAGE | 0.0 | Message contains HTML (info only) |
| MISSING_HEADERS | 1.0 | Missing standard email headers |
| URIBL_BLOCKED | 0.0 | URIBL lookup blocked by service |

Full rule list: [SpamAssassin Default Rules](https://spamassassin.apache.org/old/tests_3_3_x.html)

---

### `POST /api/spamd/tell` — Train Bayes classifier (learn/forget spam or ham)

Uses the TELL command to teach SpamAssassin's Bayes database to recognize messages as spam or legitimate email (ham). This updates per-user Bayes scores for future classifications.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `783` | |
| `message` | string | required | Full email content |
| `messageType` | string | `"spam"` | `"spam"` or `"ham"` |
| `action` | string | `"learn"` | `"learn"` or `"forget"` |
| `username` | string | — | Required for per-user Bayes DB |
| `timeout` | number (ms) | `30000` | |

**Actions:**
- **learn**: Teach SpamAssassin that this message is spam/ham
- **forget**: Remove previous learning for this message

**Example — Learn spam:**
```json
{
  "host": "spam.example.com",
  "message": "From: spammer@evil.com\n\nBuy cheap watches!",
  "messageType": "spam",
  "action": "learn",
  "username": "alice"
}
```

**Success (200):**
```json
{
  "success": true,
  "host": "spam.example.com",
  "port": 783,
  "messageType": "spam",
  "action": "learn",
  "didSet": true,
  "didRemove": false,
  "rtt": 345
}
```

**Success (200) — Forget:**
```json
{
  "success": true,
  "messageType": "ham",
  "action": "forget",
  "didSet": false,
  "didRemove": true,
  "rtt": 298
}
```

**Error (500):**
```json
{
  "success": false,
  "error": "TELL failed: SPAMD/1.5 69 EX_UNAVAILABLE",
  "messageType": "spam",
  "action": "learn"
}
```

**Notes:**
- **Bayes learning requires:** At least 200 spam + 200 ham messages for statistical accuracy
- **Username requirement:** Most SpamAssassin setups use per-user Bayes databases; omitting `username` may result in server rejections
- **didSet/didRemove:** Server confirms action via response headers (`DidSet: local`, `DidRemove: local`)
- **Message-class header:** Set to `spam` or `ham` per SPAMC protocol
- **Set/Remove headers:** `Set: local` for learn, `Remove: local` for forget

**Bayes database notes:**
- Auto-learn threshold: SpamAssassin auto-learns messages scoring > 12 (spam) or < -5 (ham)
- Tokens extracted: Subject, body, headers (From/To/CC)
- Database location: Typically `~/.spamassassin/bayes_*` files
- sa-learn command-line equivalent: `sa-learn --spam message.txt` or `sa-learn --ham message.txt`

---

## Wire Protocol Details

### Protocol Format

**Request (SPAMC → spamd):**
```
<COMMAND> SPAMC/<version>\r\n
[Header: value\r\n]*
\r\n
[message body]
```

**Response (spamd → SPAMC):**
```
SPAMD/<version> <code> <message>\r\n
[Header: value\r\n]*
\r\n
[response body]
```

**Example — SYMBOLS request:**
```
SYMBOLS SPAMC/1.5\r\n
Content-length: 128\r\n
User: alice\r\n
\r\n
From: test@example.com\r\n
Subject: Test\r\n
\r\n
Body content here
```

**Example — SYMBOLS response:**
```
SPAMD/1.5 0 EX_OK\r\n
Spam: True ; 8.4 / 5.0\r\n
Content-length: 45\r\n
\r\n
BAYES_99,DKIM_INVALID,FREEMAIL_FROM,HTML_MESSAGE
```

### Headers Reference

**Request headers:**

| Header | Commands | Format | Notes |
|---|---|---|---|
| Content-length | CHECK, SYMBOLS, REPORT, TELL | `<bytes>` | Message size in bytes (required) |
| User | All | `<username>` | Per-user preferences (optional) |
| Message-class | TELL | `spam` or `ham` | Classification target (required for TELL) |
| Set | TELL | `local` | Learn action (mutually exclusive with Remove) |
| Remove | TELL | `local` | Forget action (mutually exclusive with Set) |

**Response headers:**

| Header | Format | Notes |
|---|---|---|
| Spam | `True ; <score> / <threshold>` or `False ; <score> / <threshold>` | Spam verdict and scores |
| Content-length | `<bytes>` | Response body size |
| DidSet | `local` | Confirmation of Bayes learn action |
| DidRemove | `local` | Confirmation of Bayes forget action |

### Commands Supported

| Command | Description | Response Body |
|---|---|---|
| PING | Connectivity test | None (just "PONG" status) |
| CHECK | Spam check with score only | None |
| SYMBOLS | Spam check with matched rules | Comma-separated rule names |
| REPORT | Spam check with detailed report | Human-readable rule table |
| TELL | Bayes training (learn/forget) | None |

**Commands NOT implemented:**
- **PROCESS**: Modify message to add spam headers/rewrite (requires message parsing)
- **REPORT_IFSPAM**: Conditional report generation
- **SKIP**: Protocol negotiation
- **HEADERS**: Extract/modify headers only

---

## Known Quirks and Limitations

### 1. **No TLS/SSL support**
spamd uses plain TCP (port 783). For secure communication, tunnel via SSH (`ssh -L 783:localhost:783 server`) or VPN.

### 2. **No connection reuse**
Each API call opens a fresh TCP connection. High-volume deployments should use persistent connections via SSH multiplexing or local spamd instance.

### 3. **No PROCESS command**
The PROCESS command (which modifies the message to add `X-Spam-*` headers) is not implemented. Use SYMBOLS or REPORT to get analysis, then modify messages client-side.

### 4. **Timeout applies to entire operation**
The `timeout` parameter covers connection + authentication + command + response. For large messages or slow servers, increase timeout accordingly.

### 5. **Message size validation before encoding**
The 512KB limit checks JavaScript string length, not encoded byte count. Multi-byte UTF-8 messages may exceed wire protocol limits. Pre-validate message size if handling international content.

### 6. **No Compress header support**
The SPAMC protocol supports `Compress: zlib` for large messages, but this implementation does not compress payloads.

### 7. **Spam header parsing is strict**
The `Spam:` header must match format `True|False ; <score> / <threshold>`. Malformed responses return `isSpam: undefined`.

### 8. **SYMBOLS split on comma only**
Symbol parsing uses simple comma split. If SpamAssassin ever introduces rule names containing commas, parsing will break. (Current rules are alphanumeric with underscores only.)

### 9. **TELL requires spamd -L or --allow-tell**
By default, spamd rejects TELL commands. Start with `spamd -L` or `spamd --allow-tell` to enable Bayes training.

### 10. **No privilege separation handling**
If spamd runs with privilege separation (`-u spamc` flag), User header must match system user. Mismatched usernames return `EX_UNAVAILABLE`.

### 11. **Body byte count calculation uses UTF-8 re-encoding**
The `readSpamdResponse()` function calculates body bytes by re-encoding header text, which is fragile if headers contain multi-byte characters. Fixed in review to use correct offset tracking.

### 12. **No Content-type validation**
Email messages should be 7-bit ASCII or MIME-encoded, but the implementation accepts arbitrary UTF-8 strings. Binary content may corrupt message structure.

### 13. **No REPORT_IFSPAM optimization**
The REPORT_IFSPAM command generates reports only for spam (score >= threshold), saving CPU on legitimate email. Not implemented; use REPORT and discard if `isSpam: false`.

### 14. **Timeout handles leaked on early resolution**
**Fixed in review:** Timeout handles created with `setTimeout()` were not cleared if socket operations completed first, causing timers to run unnecessarily. Now uses `clearTimeout()` in finally blocks.

### 15. **Reader/writer locks not released on error**
**Fixed in review:** Stream locks were not released if errors occurred before cleanup code. Now wrapped in try-catch with exception suppression.

### 16. **Socket closed multiple times**
**Fixed in review:** `socket.close()` was called in both try and catch blocks, potentially throwing exceptions. Now consolidated to finally block with error suppression.

### 17. **Non-PONG responses treated as success**
**Fixed in review:** PING command responses that weren't "PONG" still returned `success: true`. Now validates response message and fails on unexpected responses.

### 18. **No User header sent**
**Fixed in review:** SpamAssassin uses the `User:` header for per-user Bayes databases, AWL scores, and custom rules. Now accepts optional `username` parameter in all endpoints.

### 19. **No host format validation**
**Fixed in review:** No regex validation for host parameter. Now rejects invalid domain/IP formats.

---

## Performance Notes

### Typical response times (local network):
- **PING**: 50-150 ms
- **CHECK/SYMBOLS**: 200-800 ms (depends on rule count)
- **REPORT**: 300-1200 ms (includes text formatting)
- **TELL**: 200-600 ms (Bayes DB write)

### Optimization strategies:
1. **Use CHECK instead of SYMBOLS** if you only need the spam score
2. **Cache results** by message hash to avoid re-checking duplicates
3. **Run spamd locally** on the same server as your application to minimize network latency
4. **Tune SpamAssassin rules** to disable slow network checks (URIBL, DNSBL) for latency-sensitive apps
5. **Pre-filter obvious spam** (empty From, no headers) before calling spamd
6. **Use Bayes auto-learn** instead of manual TELL commands where possible

### SpamAssassin server tuning:
- `--max-children=N`: Parallel processing capacity (default 5)
- `--timeout-child=N`: Kill slow rule evaluations after N seconds (default 300)
- `--max-conn-per-child=N`: Restart workers after N connections to prevent memory leaks
- `--round-robin`: Load balance across multiple spamd instances

---

## Use Cases

### 1. Email Gateway Spam Filtering
```javascript
const response = await fetch('/api/spamd/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'spam.example.com',
    message: emailContent,
    command: 'CHECK',
    username: recipientAddress,
    timeout: 5000
  })
});

const result = await response.json();
if (result.isSpam && result.score > 10) {
  // Reject high-confidence spam
  return { action: 'reject', reason: 'Message scored as spam' };
} else if (result.isSpam) {
  // Quarantine borderline spam
  return { action: 'quarantine', score: result.score };
} else {
  // Deliver clean messages
  return { action: 'accept' };
}
```

### 2. Spam Reporting Interface
```javascript
// User reports message as spam
async function reportSpam(emailContent, username) {
  // First learn as spam
  await fetch('/api/spamd/tell', {
    method: 'POST',
    body: JSON.stringify({
      host: 'spam.example.com',
      message: emailContent,
      messageType: 'spam',
      action: 'learn',
      username: username
    })
  });

  // Then get analysis for logging
  const analysis = await fetch('/api/spamd/check', {
    method: 'POST',
    body: JSON.stringify({
      host: 'spam.example.com',
      message: emailContent,
      command: 'SYMBOLS',
      username: username
    })
  });

  const result = await analysis.json();
  console.log('Reported spam matched rules:', result.symbols);
}
```

### 3. Bayes Training Pipeline
```javascript
// Train on email corpus
async function trainBayesDatabase(messages) {
  for (const msg of messages.spam) {
    await fetch('/api/spamd/tell', {
      method: 'POST',
      body: JSON.stringify({
        host: 'localhost',
        message: msg.content,
        messageType: 'spam',
        action: 'learn',
        username: msg.recipient
      })
    });
  }

  for (const msg of messages.ham) {
    await fetch('/api/spamd/tell', {
      method: 'POST',
      body: JSON.stringify({
        host: 'localhost',
        message: msg.content,
        messageType: 'ham',
        action: 'learn',
        username: msg.recipient
      })
    });
  }
}
```

### 4. Monitoring and Health Checks
```javascript
// Health check for SpamAssassin servers
async function checkSpamAssassinHealth(servers) {
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        const response = await fetch('/api/spamd/ping', {
          method: 'POST',
          body: JSON.stringify({ host: server, timeout: 3000 })
        });
        const data = await response.json();
        return {
          server,
          status: data.success ? 'up' : 'down',
          version: data.version,
          rtt: data.rtt
        };
      } catch (error) {
        return { server, status: 'error', error: error.message };
      }
    })
  );
  return results;
}
```

---

## Security Considerations

### 1. **No authentication mechanism**
The SPAMC protocol has no built-in authentication. Protect spamd with:
- **Firewall rules**: Restrict port 783 to trusted IPs
- **SSH tunneling**: `ssh -L 783:localhost:783 spamserver`
- **VPN**: Place spamd on internal network only

### 2. **Message content exposure**
Email content is sent in plaintext over TCP. Never use spamd across untrusted networks without encryption (SSH, VPN, or TLS proxy).

### 3. **Bayes database poisoning**
Malicious TELL commands can corrupt Bayes databases. Recommendations:
- Require authentication before accepting user spam reports
- Rate-limit TELL commands per user
- Run `sa-learn --rebuild` periodically to clean corrupted tokens
- Use `--allow-tell=<IP>` to restrict TELL to specific sources

### 4. **Denial of service via large messages**
The 512KB message limit prevents some DoS attacks, but:
- Pre-validate message sizes before calling API
- Set aggressive spamd `--timeout-child` values (e.g., 30s)
- Use `--max-children` to limit concurrent processing
- Monitor spamd CPU/memory usage

### 5. **User header injection**
Username values are passed directly to spamd. Validate usernames match expected format (email addresses, alphanumeric IDs) to prevent configuration injection.

### 6. **No rate limiting**
The API endpoints have no built-in rate limiting. Implement per-IP or per-user limits to prevent abuse.

---

## References

- **SpamAssassin Documentation**: https://spamassassin.apache.org/full/
- **SPAMC Protocol Spec**: https://svn.apache.org/repos/asf/spamassassin/trunk/spamd/PROTOCOL
- **SpamAssassin Wiki**: https://wiki.apache.org/spamassassin/
- **Rule Descriptions**: https://spamassassin.apache.org/old/tests_3_3_x.html
- **Bayes Learning Guide**: https://wiki.apache.org/spamassassin/BayesInSpamAssassin

---

## Example: Full Email Analysis Workflow

```javascript
// Complete spam analysis pipeline
async function analyzeEmail(emailContent, recipient) {
  // Step 1: Check connectivity
  const ping = await fetch('/api/spamd/ping', {
    method: 'POST',
    body: JSON.stringify({ host: 'spam.example.com' })
  });

  if (!ping.ok) {
    throw new Error('SpamAssassin server unreachable');
  }

  // Step 2: Get detailed analysis
  const analysis = await fetch('/api/spamd/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: 'spam.example.com',
      message: emailContent,
      command: 'REPORT',
      username: recipient,
      timeout: 15000
    })
  });

  const result = await analysis.json();

  if (!result.success) {
    throw new Error(`Analysis failed: ${result.error}`);
  }

  // Step 3: Make filtering decision
  const decision = {
    isSpam: result.isSpam,
    score: result.score,
    threshold: result.threshold,
    confidence: Math.min(100, (result.score / result.threshold) * 100),
    action: 'unknown'
  };

  if (result.score >= result.threshold * 2) {
    decision.action = 'reject'; // High-confidence spam
  } else if (result.score >= result.threshold) {
    decision.action = 'quarantine'; // Borderline spam
  } else if (result.score < 0) {
    decision.action = 'whitelist'; // Negative scores are very clean
  } else {
    decision.action = 'accept'; // Clean message
  }

  // Step 4: Log analysis for review
  console.log('Email Analysis:', {
    recipient,
    decision: decision.action,
    score: result.score,
    report: result.report
  });

  return decision;
}
```

---

**Last updated:** 2026-02-18 (code review and bug fixes)
