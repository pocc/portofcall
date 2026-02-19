# DICT Protocol — Power-User Reference

**Port:** 2628 (default)
**Transport:** TCP
**RFC:** [RFC 2229](https://tools.ietf.org/html/rfc2229) (1997)
**Implementation:** `src/worker/dict.ts`
**Routes:** `src/worker/index.ts` lines 1817-1827

## Overview

The Dictionary Server Protocol (DICT) provides network access to dictionary databases.  It supersedes the older Webster protocol and was designed for multi-database, multi-strategy lookups.  The protocol is text-based, uses CRLF line termination, and follows a command-response model similar to SMTP/FTP.

## Endpoints

### `POST /api/dict/define`

Look up definitions for a word across one or more dictionaries.

**Request:**

```json
{
  "host": "dict.org",
  "port": 2628,
  "word": "algorithm",
  "database": "*",
  "timeout": 15000
}
```

| Field      | Type   | Default      | Required | Validation                        |
|------------|--------|--------------|----------|-----------------------------------|
| `host`     | string | `"dict.org"` | no       | None                              |
| `port`     | number | `2628`       | no       | 1-65535 (HTTP 400)                |
| `word`     | string | —            | yes      | `/^[a-zA-Z0-9 .'-]+$/` (HTTP 400)|
| `database` | string | `"*"`        | no       | `/^[a-zA-Z0-9_*!-]+$/` (HTTP 400)|
| `timeout`  | number | `15000`      | no       | Not validated                     |

**Wire command:** `DEFINE <database> "<word>"\r\n`

**Response (success, word found):**

```json
{
  "success": true,
  "word": "algorithm",
  "server": "dict.org:2628",
  "banner": "220 dictd 1.12.1/rf on Linux 4.19.0-10-amd64 ...",
  "definitions": [
    {
      "word": "algorithm",
      "database": "wn",
      "databaseDesc": "WordNet (r) 3.0 (2006)",
      "text": "algorithm\n    n 1: a precise rule ..."
    }
  ],
  "count": 1
}
```

**Response (success, word not found):** HTTP 200, `count: 0`, `error: "No definitions found"` (server returned 552)

**Response (invalid database):** HTTP 400, `success: false`, `error: "Invalid database"` (server returned 550)

---

### `POST /api/dict/match`

Find words matching a pattern using a specified strategy.

**Request:**

```json
{
  "host": "dict.org",
  "port": 2628,
  "word": "algo",
  "database": "*",
  "strategy": "prefix",
  "timeout": 15000
}
```

| Field      | Type   | Default      | Required | Validation                         |
|------------|--------|--------------|----------|------------------------------------|
| `host`     | string | `"dict.org"` | no       | None                               |
| `port`     | number | `2628`       | no       | 1-65535 (HTTP 400)                 |
| `word`     | string | —            | yes      | `/^[a-zA-Z0-9 .'-]+$/` (HTTP 400) |
| `database` | string | `"*"`        | no       | `/^[a-zA-Z0-9_*!.-]+$/` (HTTP 400)|
| `strategy` | string | `"."`        | no       | `/^[a-zA-Z0-9_.-]+$/` (HTTP 400)  |
| `timeout`  | number | `15000`      | no       | Not validated                      |

**Wire command:** `MATCH <database> <strategy> "<word>"\r\n`

**Response (success):**

```json
{
  "success": true,
  "word": "algo",
  "server": "dict.org:2628",
  "strategy": "prefix",
  "matches": [
    { "database": "wn", "word": "algorithm" },
    { "database": "wn", "word": "algorithmic" }
  ],
  "count": 2
}
```

**Response (no matches):** HTTP 200, `count: 0`, empty `matches` array (server returned 552)

**Response (invalid strategy):** HTTP 400, `success: false`, `error: "Invalid matching strategy"` (server returned 551)

---

### `POST /api/dict/databases`

List all dictionaries available on the server.

**Request:**

```json
{
  "host": "dict.org",
  "port": 2628,
  "timeout": 15000
}
```

| Field     | Type   | Default      | Required | Validation          |
|-----------|--------|--------------|----------|---------------------|
| `host`    | string | `"dict.org"` | no       | None                |
| `port`    | number | `2628`       | no       | 1-65535 (HTTP 400)  |
| `timeout` | number | `15000`      | no       | Not validated       |

**Wire command:** `SHOW DB\r\n`

**Response (success):**

```json
{
  "success": true,
  "server": "dict.org:2628",
  "banner": "220 dictd 1.12.1/rf on Linux ...",
  "databases": [
    { "name": "gcide", "description": "The Collaborative International Dictionary of English v.0.48" },
    { "name": "wn", "description": "WordNet (r) 3.0 (2006)" },
    { "name": "moby-thesaurus", "description": "Moby Thesaurus II by Grady Ward, 1.0" }
  ],
  "count": 3
}
```

**Response (no databases):** HTTP 200, `count: 0`, `error: "No databases present on server"` (server returned 554)

---

## RFC 2229 Protocol Details

### Session Flow

```
Client                              Server
  |                                    |
  |------------- TCP connect --------->|  (port 2628)
  |                                    |
  |<------------ 220 banner -----------|
  |                                    |
  |-- CLIENT Port of Call DICT ... --->|
  |<------------ 250 ok --------------|
  |                                    |
  |-- DEFINE * "word" --------------->|
  |<------------ 150 n definitions ---|
  |<------------ 151 "word" db ... ---|
  |<------------ (definition text) ---|
  |<------------ . -------------------|
  |<------------ 250 ok --------------|
  |                                    |
  |-- QUIT -------------------------->|
  |<------------ 221 bye -------------|
```

### Response Status Codes

The DICT protocol uses three-digit status codes in the same family scheme as SMTP/FTP:

| Code | Meaning                                    | Terminal? |
|------|--------------------------------------------|-----------|
| 110  | n databases present (SHOW DB)              | No        |
| 111  | n strategies available (SHOW STRAT)        | No        |
| 150  | n definitions retrieved (DEFINE)           | No        |
| 151  | definition follows — word db "desc"        | No        |
| 152  | n matches found (MATCH)                    | No        |
| 210  | timing/stat info (optional after command)  | Yes       |
| 220  | banner/greeting on connect                 | Yes       |
| 221  | closing connection (QUIT response)         | Yes       |
| 250  | ok — command completed                     | Yes       |
| 330  | SASL authentication challenge              | Yes       |
| 420  | server temporarily unavailable             | Yes       |
| 421  | server shutting down at operator request   | Yes       |
| 530  | access denied                              | Yes       |
| 531  | access denied — use SHOW INFO for auth     | Yes       |
| 532  | access denied — auth mechanism rejected    | Yes       |
| 550  | invalid database                           | Yes       |
| 551  | invalid strategy                           | Yes       |
| 552  | no match found                             | Yes       |
| 554  | no databases present                       | Yes       |
| 555  | no strategies available                    | Yes       |

1xx codes are **informational/intermediate** and are always followed by a dot-terminated text body.  The implementation correctly treats them as non-terminal, reading through the text body until it encounters a 2xx/4xx/5xx terminal line.

### Special Database Names

| Name | Meaning |
|------|---------|
| `*`  | Search all databases, return all matches |
| `!`  | Search all databases, stop after first match |

The `*` database is the default used by this implementation.

### Special Strategy Names

| Name | Meaning |
|------|---------|
| `.`  | Use the server's default matching strategy |

The `.` strategy is the default used by this implementation (RFC 2229 Section 3.3).

### Common Matching Strategies

These are server-dependent; use `SHOW STRAT` to discover them.  Common ones on dict.org:

| Strategy  | Description                                    |
|-----------|------------------------------------------------|
| `exact`   | Match headwords exactly                        |
| `prefix`  | Match prefixes                                 |
| `substring`| Match substrings anywhere in headwords        |
| `suffix`  | Match suffixes                                 |
| `re`      | POSIX 1003.2 regular expression match          |
| `regexp`  | Old-style regular expression match             |
| `soundex` | Soundex phonetic algorithm                     |
| `lev`     | Levenshtein edit distance (fuzzy match)        |
| `word`    | Match separate words within headwords          |

### Dot-Stuffing (RFC 2229 Section 2.4.1)

Text responses (definitions, database lists, strategy lists) are terminated by a line containing a single period (`.`).  To prevent a line in the actual text that starts with `.` from being confused with the terminator, the server "dot-stuffs" it by prepending an extra `.`.

The client (this implementation) reverses dot-stuffing:
- A line starting with `..` has the leading `.` stripped, yielding a line starting with `.`
- A line that is exactly `.` signals end-of-text

### Command Formats

Per RFC 2229, commands are case-insensitive and use the following syntax:

```
CLIENT text                          -- identify client (no quotes around text)
DEFINE database word                 -- look up a word (word may be quoted)
MATCH database strategy word         -- find matching words
SHOW DB                              -- list databases
SHOW STRAT                           -- list matching strategies
SHOW INFO database                   -- database details
SHOW SERVER                          -- server info
QUIT                                 -- close session
STATUS                               -- show timing/statistics
HELP                                 -- list commands
OPTION MIME                          -- enable MIME headers in responses
AUTH username auth-string            -- simple auth
SASLAUTH mechanism initial-response  -- SASL auth
SASLRESP response                    -- SASL response
```

This implementation sends `DEFINE`, `MATCH`, `SHOW DB`, `CLIENT`, and `QUIT`.  It does not implement `AUTH`, `SASLAUTH`, `OPTION MIME`, or `SHOW STRAT` (though the database parser also handles `111` responses from `SHOW STRAT`).

### 220 Banner Format

The server greeting contains a capabilities string in angle brackets:

```
220 dictd 1.12.1/rf on Linux 4.19.0-10-amd64 <auth.mime> <serverid@host>
```

The `<auth.mime>` portion advertises optional capabilities.  The `<serverid@host>` is a message-id used for AUTH.  This implementation captures the full banner line but does not parse capabilities.

### Word Quoting

Per RFC 2229, words sent in `DEFINE` and `MATCH` commands can be:
- Unquoted single words: `DEFINE * algorithm`
- Quoted phrases: `DEFINE * "ice cream"`

This implementation always quotes the word in double quotes, which is valid for both single words and phrases.

## Implementation Notes

### TCP Socket Handling

Uses Cloudflare's `connect()` Sockets API for raw TCP connections.  A `ReadBuffer` tracks leftover bytes when a TCP chunk contains data from multiple protocol messages (e.g., banner + CLIENT response in a single chunk).

### Timeout Strategy

Each operation (connect, banner read, command send/read) runs against a shared timeout.  Timeouts are implemented as `Promise.race` between the socket read and a `setTimeout` rejection.

### Input Validation

All user inputs are validated with restrictive regexes before being sent over the wire:
- **Words:** `/^[a-zA-Z0-9 .'-]+$/` — prevents command injection
- **Database names:** `/^[a-zA-Z0-9_*!-]+$/` — includes special names `*` and `!`
- **Strategy names:** `/^[a-zA-Z0-9_.-]+$/` — includes special name `.`
- **Port:** 1-65535 numeric range check

### Error Mapping

| Server Code | HTTP Status | `success` | `error` field                |
|-------------|-------------|-----------|------------------------------|
| 150+151+250 | 200         | true      | —                            |
| 152+250     | 200         | true      | —                            |
| 110+250     | 200         | true      | —                            |
| 550         | 400         | false     | `"Invalid database"`         |
| 551         | 400         | false     | `"Invalid matching strategy"`|
| 552         | 200         | true      | `"No definitions found"`     |
| 554         | 200         | true      | `"No databases present..."`  |
| (timeout)   | 500         | false     | `"Command timeout"`          |
| (exception) | 500         | false     | (error message)              |

Note: 552 (no match) is treated as `success: true` with an empty result set, not as an error.  This is intentional — a valid search that returns no results is still a successful operation.

## Testing

Integration tests in `tests/dict.test.ts` query the live `dict.org` server.  They cover:
- Defining common words (`hello`)
- Defining from a specific database (`wn`)
- Handling nonsense words (expects empty results)
- Prefix matching
- Listing databases (expects `wn` to be present)
- Input validation (empty word, invalid characters, out-of-range port)
- Soundex matching
- Default host/port usage
