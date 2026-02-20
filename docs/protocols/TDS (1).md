# TDS (Tabular Data Stream)

## Overview

**TDS (Tabular Data Stream)** is the protocol used by Microsoft SQL Server and Sybase for client-server database communication. It's a binary application layer protocol that efficiently transmits database queries and results between clients and database servers.

**Port:** 1433 (SQL Server default)
**Transport:** TCP
**Status:** Active (TDS 7.4 current for SQL Server 2019+)
**Developer:** Sybase (later Microsoft)

## Protocol Specification

### Key Features

1. **Binary Protocol**: Efficient binary data encoding
2. **Tabular Results**: Optimized for relational data
3. **Bulk Operations**: Fast bulk insert/copy operations
4. **Multiple Result Sets**: Single query can return multiple result sets
5. **Attention Signals**: Cancel running queries
6. **TLS Encryption**: Supports encrypted connections
7. **Cursor Support**: Server-side cursors
8. **RPC Execution**: Remote procedure call execution

### TDS Versions

- **TDS 4.2**: Original Sybase version
- **TDS 5.0**: Sybase enhanced version
- **TDS 7.0**: SQL Server 7.0 (1998)
- **TDS 7.1**: SQL Server 2000
- **TDS 7.2**: SQL Server 2005
- **TDS 7.3**: SQL Server 2008
- **TDS 7.4**: SQL Server 2012-2019
- **TDS 8.0**: SQL Server 2022 (mandatory encryption)

### Packet Structure

```
+-----------------------------------+
| Header (8 bytes)                  |
+-----------------------------------+
| Type     | Status   | Length      |
| (1 byte) | (1 byte) | (2 bytes)   |
+-----------------------------------+
| SPID          | Packet ID | Window |
| (2 bytes)     | (1 byte)  | (1 byte)|
+-----------------------------------+
| Data (variable length)            |
+-----------------------------------+
```

### Packet Types

- `0x01` - SQL Batch (SQL query text)
- `0x02` - Pre-TDS7 Login
- `0x03` - RPC (Remote Procedure Call)
- `0x04` - Tabular Result (query results)
- `0x06` - Attention (cancel request)
- `0x07` - Bulk Load Data
- `0x0E` - Transaction Manager Request
- `0x10` - TDS7 Login
- `0x11` - SSPI (Windows authentication)
- `0x12` - Pre-Login (negotiation)

### Login Sequence

1. **Pre-Login**: Client sends encryption/version negotiation
2. **TLS Handshake**: If encryption enabled
3. **Login7**: Client sends authentication credentials
4. **Login Response**: Server accepts/rejects login
5. **Environment Change**: Server sends database context

### Data Types

**Fixed-Length:**
- INT1, INT2, INT4, INT8
- FLOAT4, FLOAT8
- BIT, DATETIME, MONEY

**Variable-Length:**
- VARCHAR, NVARCHAR (Unicode)
- VARBINARY
- TEXT, NTEXT, IMAGE

**Special:**
- NULL (absence of value)
- DECIMAL, NUMERIC (precise numbers)
- UNIQUEIDENTIFIER (GUID)

### Result Set Format

```
Columns Metadata:
+-----------------------------------+
| Column Count                      |
+-----------------------------------+
| Column 1 (Name, Type, Length...)  |
| Column 2 (Name, Type, Length...)  |
| ...                               |
+-----------------------------------+

Row Data:
+-----------------------------------+
| Row 1 (Value 1, Value 2, ...)     |
| Row 2 (Value 1, Value 2, ...)     |
| ...                               |
+-----------------------------------+

Done Token:
+-----------------------------------+
| Status | CurCmd | DoneRowCount   |
+-----------------------------------+
```

### Authentication Methods

- **SQL Authentication**: Username/password
- **Windows Authentication**: NTLM/Kerberos (SSPI)
- **Azure AD Authentication**: OAuth tokens
- **Integrated Security**: Current Windows user

## Connection String Examples

```
# SQL Authentication
Server=localhost,1433;Database=master;User Id=sa;Password=password;

# Windows Authentication
Server=localhost;Database=master;Integrated Security=true;

# Encrypted connection
Server=localhost;Database=master;Encrypt=true;TrustServerCertificate=false;

# Named instance
Server=localhost\SQLEXPRESS;Database=master;

# Azure SQL
Server=myserver.database.windows.net;Database=mydb;User Id=user@myserver;Password=pass;
```

## Resources

- [TDS Protocol Documentation](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/)
- [FreeTDS](https://www.freetds.org/) - Open-source TDS implementation
- [TDS Protocol Specification (MS-TDS)](https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-TDS/%5bMS-TDS%5d.pdf)
- [jTDS](http://jtds.sourceforge.net/) - Java JDBC driver

## Notes

- **SQL Server**: Primary use case for TDS protocol
- **Sybase ASE**: Also uses TDS (different version)
- **Default Port**: 1433 for SQL Server, 5000 for Sybase
- **Named Instances**: Use dynamic ports (query via UDP 1434)
- **TLS Encryption**: TDS 8.0 mandates encryption
- **vs MySQL Protocol**: TDS is more complex, supports more data types
- **vs PostgreSQL Protocol**: Similar complexity, different wire format
- **Bulk Copy**: BULK INSERT uses TDS bulk load packets
- **Cursors**: Server-side cursors for large result sets
- **Multiple Result Sets**: Single batch can return multiple result sets
- **Attention Packet**: Sends interrupt signal to cancel query
- **SPID**: Server Process ID identifies connection
- **Environment Changes**: Notifications for database/language changes
- **Collation**: Character set and sort order negotiation
- **Transaction Coordination**: Distributed transactions via DTC
- **Always Encrypted**: Column-level encryption support
- **Connection Pooling**: Improves performance for web apps
- **Compatibility Level**: Database compatibility affects TDS features
- **Azure SQL**: Uses TDS 7.4+ with mandatory encryption
