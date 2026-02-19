# MPD (Music Player Daemon) Protocol - Power User Guide

## Protocol Overview

MPD is a server-side application for playing music with a simple text-based protocol over TCP (default port 6600). The protocol is line-oriented, human-readable, and stateful.

## Connection Flow

### 1. Initial Handshake
```
Client → TCP connect to host:6600
Server → OK MPD 0.23.0\n
```

The banner format is `OK MPD <version>` where version is the protocol version (not daemon version).

### 2. Authentication (Optional)
```
Client → password "my secret pass"\n
Server → OK\n  (or)  ACK [3@0] {password} incorrect password\n
```

**Security Note**: Passwords are sent in plaintext. Use TLS tunneling or SSH port forwarding for production.

### 3. Command Exchange
```
Client → status\n
Server → volume: 80\n
         repeat: 0\n
         random: 1\n
         ...
         OK\n
```

### 4. Disconnection
```
Client → close\n
Server → OK\n
Client → TCP close
```

Alternatively, clients can simply close the socket without sending `close`.

## Command/Response Format

### Command Syntax
```
COMMAND [ARG1] [ARG2] ...\n
```

- Commands are case-sensitive lowercase
- Arguments with spaces MUST be double-quoted: `add "Music/My Song.mp3"`
- Escape sequences in quoted strings:
  - Backslash: `\\`
  - Quote: `\"`

### Response Format

**Success Response:**
```
key1: value1
key2: value2
...
OK
```

**Error Response:**
```
ACK [error@command_listNum] {current_command} message_text
```

Error codes (numeric):
- `3` - `ACK_ERROR_PASSWORD` - incorrect password
- `50` - `ACK_ERROR_NO_EXIST` - resource not found
- `5` - `ACK_ERROR_PERMISSION` - permission denied
- `2` - `ACK_ERROR_ARG` - incorrect arguments
- `1` - `ACK_ERROR_NOT_LIST` - not in command list
- (See official docs for complete list)

## Core Commands

### Status & Information

#### `status`
Get current playback state and settings.

**Response Fields:**
```
volume: 80              # 0-100, or -1 if unavailable
repeat: 0               # 0=off, 1=on
random: 0               # 0=off, 1=on
single: 0               # 0=off, 1=on, 2=oneshot
consume: 0              # 0=off, 1=on
playlist: 31            # playlist version number
playlistlength: 5       # number of songs in queue
mixrampdb: 0.000000     # mixramp threshold in dB
state: play             # play, stop, or pause
song: 2                 # current song position (0-based)
songid: 3               # current song ID
time: 45:234            # elapsed:total (deprecated, use elapsed)
elapsed: 45.123         # elapsed time in seconds (float)
duration: 234.567       # total duration in seconds (float)
bitrate: 320            # instantaneous bitrate in kbps
audio: 44100:16:2       # sampleRate:bits:channels
nextsong: 3             # next song position
nextsongid: 4           # next song ID
```

#### `stats`
Get music database statistics.

**Response Fields:**
```
artists: 150            # number of artists
albums: 500             # number of albums
songs: 5000             # number of songs
uptime: 86400           # daemon uptime in seconds
db_playtime: 1234567    # total playtime of all songs (seconds)
db_update: 1708371234   # Unix timestamp of last DB update
playtime: 12345         # total playback time (seconds)
```

#### `currentsong`
Get metadata for the currently playing song.

**Response Fields:**
```
file: Music/Artist/Album/01 - Song.mp3
Last-Modified: 2024-01-15T10:30:00Z
Format: 44100:16:2
Time: 234               # duration in seconds (deprecated)
duration: 234.567       # duration in seconds (float)
Pos: 2                  # position in queue (0-based)
Id: 3                   # song ID
Artist: Artist Name
Album: Album Name
Title: Song Title
Track: 01
Date: 2024
Genre: Rock
```

Tag names are case-insensitive. Common tags: `Artist`, `Album`, `Title`, `Track`, `Date`, `Genre`, `Composer`, `Performer`, `Disc`, `AlbumArtist`.

### Playback Control

#### `play [SONGPOS]`
Start playback. If `SONGPOS` provided (0-based integer), start at that queue position.

```
play        # resume playback at current position
play 0      # play first song in queue
play 5      # play sixth song in queue
```

#### `pause [PAUSE]`
Toggle pause state. If `PAUSE` provided: 0=resume, 1=pause.

```
pause       # toggle pause
pause 1     # pause playback
pause 0     # resume playback
```

#### `stop`
Stop playback.

#### `next`
Play next song in queue. Respects `repeat` and `random` settings.

#### `previous`
Play previous song. If more than a few seconds into current song, restarts current song.

#### `seek SONGPOS TIME`
Seek to `TIME` seconds in song at queue position `SONGPOS`.

```
seek 0 30.5     # seek to 30.5 seconds in first song
seek 2 120      # seek to 2:00 in third song
```

#### `seekcur TIME`
Seek in current song. `TIME` can be absolute (seconds) or relative (`+/-` prefix).

```
seekcur 60      # seek to 1:00
seekcur +10     # skip forward 10 seconds
seekcur -5      # rewind 5 seconds
```

### Queue Management

#### `add URI`
Add song/directory to end of queue. URI is relative to music directory.

```
add "Music/Artist/Album/Song.mp3"
add "Music/Playlists/Jazz"          # adds entire directory
```

**Note**: URIs with spaces MUST be quoted.

#### `addid URI [POSITION]`
Add song and return its queue ID. Optionally insert at `POSITION`.

```
addid "Music/Song.mp3"          # add at end
addid "Music/Song.mp3" 0        # insert at beginning
```

Response: `Id: 42`

#### `delete POS`
Remove song at queue position `POS` (0-based).

```
delete 0        # remove first song
delete 5        # remove sixth song
```

#### `deleteid SONGID`
Remove song by queue ID (more reliable than position).

```
deleteid 42
```

#### `clear`
Clear entire queue.

#### `playlistinfo [SONGPOS]`
List queue contents. If `SONGPOS` provided, show only that song.

**Response** (one song per block):
```
file: Music/Song1.mp3
Artist: Artist 1
Title: Song 1
Pos: 0
Id: 1
file: Music/Song2.mp3
Artist: Artist 2
Title: Song 2
Pos: 1
Id: 2
OK
```

### Stored Playlists

#### `listplaylists`
List saved playlists.

**Response:**
```
playlist: Jazz Favorites
Last-Modified: 2024-01-10T15:30:00Z
playlist: Rock Classics
Last-Modified: 2024-01-12T09:00:00Z
OK
```

#### `listplaylist NAME`
List files in stored playlist `NAME`.

```
listplaylist "Jazz Favorites"
```

**Response:**
```
file: Music/Miles Davis/Kind of Blue/01 So What.mp3
file: Music/John Coltrane/A Love Supreme/01 Acknowledgement.mp3
OK
```

#### `load NAME`
Load stored playlist `NAME` into current queue.

```
load "Jazz Favorites"
```

#### `save NAME`
Save current queue as stored playlist `NAME`.

```
save "My Mix"
```

#### `rm NAME`
Delete stored playlist `NAME`.

```
rm "Old Playlist"
```

### Search & Browse

#### `list TYPE [FILTER]`
List unique values of tag `TYPE`. Common types: `artist`, `album`, `genre`, `date`.

```
list artist                     # all artists
list album artist "Miles Davis" # albums by Miles Davis
```

#### `find TYPE VALUE`
Search for songs with exact tag match. Case-sensitive.

```
find artist "Miles Davis"
find album "Kind of Blue"
```

#### `search TYPE VALUE`
Search for songs with partial tag match. Case-insensitive.

```
search artist "davis"           # matches "Miles Davis"
search title "love"             # matches "A Love Supreme"
```

#### `lsinfo [URI]`
List contents of directory `URI`. If omitted, lists music root.

```
lsinfo                          # list root
lsinfo "Music/Jazz"             # list Jazz directory
```

**Response:**
```
directory: Music/Jazz/Miles Davis
Last-Modified: 2024-01-10T12:00:00Z
file: Music/Jazz/Some Song.mp3
Artist: Some Artist
Title: Some Song
OK
```

### Output Devices

#### `outputs`
List audio output devices.

**Response:**
```
outputid: 0
outputname: My ALSA Device
outputenabled: 1
plugin: alsa
outputid: 1
outputname: PulseAudio
outputenabled: 0
plugin: pulse
OK
```

#### `enableoutput ID`
Enable audio output `ID`.

```
enableoutput 0
```

#### `disableoutput ID`
Disable audio output `ID`.

```
disableoutput 1
```

#### `toggleoutput ID`
Toggle audio output `ID` enabled state.

```
toggleoutput 0
```

### Options

#### `setvol VOL`
Set volume to `VOL` (0-100).

```
setvol 80
```

#### `volume CHANGE`
Change volume by `CHANGE` (-100 to +100).

```
volume +5       # increase by 5
volume -10      # decrease by 10
```

#### `repeat [REPEAT]`
Get/set repeat mode. `0` = off, `1` = on.

```
repeat          # query current state
repeat 1        # enable repeat
repeat 0        # disable repeat
```

#### `random [RANDOM]`
Get/set random mode. `0` = off, `1` = on.

```
random 1        # enable shuffle
```

#### `single [SINGLE]`
Get/set single mode. `0` = off, `1` = on, `2` = oneshot (play once, then disable).

```
single 1        # play single track and stop
single 2        # play single track and disable single mode
```

#### `consume [CONSUME]`
Get/set consume mode. `0` = off, `1` = on. When on, played songs are removed from queue.

```
consume 1       # enable consume mode
```

## Command Lists (Batch Commands)

Execute multiple commands atomically. All succeed or all fail.

### Syntax
```
command_list_begin
  command1 [args]
  command2 [args]
  ...
command_list_end
```

### Example
```
command_list_begin
  clear
  add "Music/Playlist/Song1.mp3"
  add "Music/Playlist/Song2.mp3"
  play
command_list_end
```

**Response:**
```
OK
```

### With Individual OK Responses
```
command_list_ok_begin
  status
  currentsong
command_list_end
```

**Response:**
```
volume: 80
state: play
list_OK
file: Music/Song.mp3
Title: Song Title
list_OK
OK
```

Each command's response ends with `list_OK` instead of `OK`.

## Binary Responses

Some commands return binary data (e.g., `albumart`, `readpicture`).

**Format:**
```
size: 12345
type: image/jpeg
binary: 12345
[12345 bytes of binary data]
OK
```

The `binary:` line specifies byte count. Following data is raw bytes (not line-oriented).

## Advanced Commands

### `idle [SUBSYSTEM...]`
Wait for change in one or more subsystems. Blocks until event occurs.

**Subsystems:**
- `database` - music DB changed
- `update` - DB update in progress
- `stored_playlist` - stored playlist modified
- `playlist` - current queue changed
- `player` - playback state changed
- `mixer` - volume changed
- `output` - audio output changed
- `options` - options (repeat, random, etc.) changed
- `sticker` - sticker DB changed
- `subscription` - client subscribed/unsubscribed
- `message` - message received on channel

**Example:**
```
idle player mixer
```

**Response** (when playback starts):
```
changed: player
OK
```

**Warning**: `idle` blocks the connection. Use a dedicated connection for idle monitoring or use `noidle` to cancel.

#### `noidle`
Cancel pending `idle` command. Send on same connection to interrupt `idle` wait.

### `update [URI]`
Trigger music database update. If `URI` provided, update only that path.

```
update                          # update entire DB
update "Music/NewAlbum"         # update specific directory
```

**Response:**
```
updating_db: 1                  # job ID
OK
```

### `channels`
List all client message channels.

**Response:**
```
channel: notifications
channel: chat
OK
```

### `sendmessage CHANNEL TEXT`
Send message to `CHANNEL`. Other clients subscribed to channel receive it.

```
sendmessage notifications "New album added"
```

### `subscribe CHANNEL`
Subscribe to client message channel.

```
subscribe notifications
```

Use `idle message` to wait for messages.

### `unsubscribe CHANNEL`
Unsubscribe from channel.

### `readmessages`
Read messages from subscribed channels.

**Response:**
```
channel: notifications
message: New album added
OK
```

## Reflection Commands

### `commands`
List all available commands.

**Response:**
```
command: add
command: addid
command: clear
command: currentsong
...
OK
```

### `notcommands`
List unavailable commands (disabled or require permissions).

### `tagtypes`
List supported metadata tag types.

**Response:**
```
tagtype: Artist
tagtype: Album
tagtype: Title
tagtype: Track
tagtype: Genre
tagtype: Date
...
OK
```

### `urlhandlers`
List supported URL schemes.

**Response:**
```
handler: file
handler: http
handler: https
...
OK
```

### `decoders`
List audio decoders and supported MIME types.

**Response:**
```
plugin: mad
suffix: mp3
mime_type: audio/mpeg
plugin: flac
suffix: flac
mime_type: audio/flac
...
OK
```

## Protocol Features

### Quoting & Escaping

Arguments with spaces MUST be quoted:
```
add Music/Song.mp3              # OK (no spaces)
add "Music/My Song.mp3"         # OK (quoted)
add Music/My Song.mp3           # ERROR (unquoted space)
```

Escape sequences in quoted strings:
```
add "Music/Artist - \"Best Of\".mp3"     # escape quote
add "Music/Path\\To\\Song.mp3"           # escape backslash
```

### Authentication

Password authentication is plaintext:
```
password "my secret pass"
```

**Security recommendations:**
- Use Unix socket connections (no network exposure)
- Use SSH port forwarding: `ssh -L 6600:localhost:6600 user@server`
- Use TLS tunnel (stunnel, nginx reverse proxy)
- Set restrictive file permissions on `mpd.conf`

### Connection Timeout

Connections timeout after inactivity (default: 60 seconds). Send `ping` to keep alive:
```
ping
```

**Response:**
```
OK
```

### Protocol Version

The banner version indicates protocol compatibility:
```
OK MPD 0.23.0
```

Version is in `MAJOR.MINOR.PATCH` format. Protocol changes occur on MINOR version bumps. Implementations should verify minimum required version.

## Implementation Notes (Port of Call)

### Safety Restrictions

The Port of Call implementation restricts commands to read-only operations. Allowed commands:

**Query Commands:**
- `status`, `stats`, `currentsong`
- `outputs`, `commands`, `notcommands`, `tagtypes`, `urlhandlers`, `decoders`
- `listplaylists`, `listplaylist`, `listplaylistinfo`, `playlistinfo`
- `list`, `find`, `search`, `count`, `listall`, `listallinfo`, `lsinfo`
- `replay_gain_status`

**Excluded Commands:**
- Playback control: `play`, `pause`, `stop`, `next`, `previous`, `seek` (available via dedicated endpoints)
- Queue modification: `add`, `addid`, `delete`, `deleteid`, `clear`, `move`, `swap`
- Database changes: `update`, `rescan`
- Output control: `enableoutput`, `disableoutput`, `toggleoutput`
- Options: `setvol`, `repeat`, `random`, `single`, `consume`
- Playlists: `save`, `rm`, `rename`, `playlistclear`, `playlistmove`
- Stickers: `sticker`
- Blocking commands: `idle` (ties up connection until event)
- Deprecated commands: `config` (removed in MPD 0.18)

### Playback Control Endpoints

Port of Call provides separate REST endpoints for playback control:

**POST /api/mpd/play**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "password": "secret",
  "songpos": 0,
  "timeout": 10000
}
```

**POST /api/mpd/pause**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "password": "secret",
  "timeout": 10000
}
```

**POST /api/mpd/next**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "timeout": 10000
}
```

**POST /api/mpd/previous**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "timeout": 10000
}
```

**POST /api/mpd/add**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "uri": "Music/Artist/Album/Song.mp3",
  "timeout": 10000
}
```

**POST /api/mpd/seek**
```json
{
  "host": "mpd.example.com",
  "port": 6600,
  "songpos": 0,
  "time": 30.5,
  "timeout": 10000
}
```

All endpoints return:
```json
{
  "success": true,
  "server": "mpd.example.com:6600",
  "version": "0.23.0",
  "command": "play",
  "raw": "OK\n"
}
```

Or on error:
```json
{
  "success": false,
  "server": "mpd.example.com:6600",
  "version": "0.23.0",
  "command": "play",
  "error": "Player error: player",
  "raw": "ACK [50@0] {play} player\n"
}
```

### Validation & Security

**Input Validation:**
- Host format: `^[a-zA-Z0-9._:-]+$` (alphanumeric, dots, underscores, colons, hyphens)
- Port range: 1-65535
- Commands: newline validation (rejects `\r\n` to prevent command injection)
- URIs: newline validation
- Passwords: newline validation, automatic quoting if contains spaces

**Argument Escaping:**
- Passwords with spaces/quotes are automatically quoted and escaped
- URIs with spaces/quotes are automatically quoted and escaped
- Backslashes: `\` → `\\`
- Quotes: `"` → `\"`

**Timeout Handling:**
- Default: 10 seconds
- Configurable per request
- Applied to: connection, banner read, authentication, command execution

**Response Size Limit:**
- Maximum 100KB per response to prevent memory exhaustion
- Large responses (e.g., `listall` on huge libraries) may hit this limit

## Common Use Cases

### Music Server Discovery

Probe port 6600 to detect MPD servers:

**Request:**
```json
POST /api/mpd/status
{
  "host": "192.168.1.100",
  "timeout": 5000
}
```

**Success Response:**
```json
{
  "success": true,
  "server": "192.168.1.100:6600",
  "version": "0.23.0",
  "status": [
    {"key": "volume", "value": "80"},
    {"key": "repeat", "value": "0"},
    {"key": "state", "value": "play"}
  ],
  "stats": [
    {"key": "artists", "value": "150"},
    {"key": "albums", "value": "500"},
    {"key": "songs", "value": "5000"}
  ],
  "currentSong": [
    {"key": "file", "value": "Music/Song.mp3"},
    {"key": "Artist", "value": "Artist Name"},
    {"key": "Title", "value": "Song Title"}
  ]
}
```

### Health Monitoring

Check server responsiveness and playback state:

**Request:**
```json
POST /api/mpd/command
{
  "host": "mpd.home.local",
  "command": "status"
}
```

**Parse response:**
- `state: play` → actively playing
- `state: pause` → paused
- `state: stop` → stopped
- `volume: -1` → volume unavailable (common on ALSA direct output)

### Now Playing Display

Get current track info:

**Request:**
```json
POST /api/mpd/status
```

**Display fields:**
- `currentSong.Artist` - artist name
- `currentSong.Title` - song title
- `currentSong.Album` - album name
- `status.elapsed` - current position (seconds)
- `status.duration` - total length (seconds)
- `status.bitrate` - current bitrate (kbps)

### Library Statistics

Get database summary:

**Request:**
```json
POST /api/mpd/command
{
  "host": "mpd.home.local",
  "command": "stats"
}
```

**Fields:**
- `artists` - number of artists
- `albums` - number of albums
- `songs` - number of tracks
- `db_playtime` - total music duration (seconds)
- `uptime` - server uptime (seconds)

### Audio Output Configuration

List available outputs:

**Request:**
```json
POST /api/mpd/command
{
  "host": "mpd.home.local",
  "command": "outputs"
}
```

**Response:**
```json
{
  "response": [
    {"key": "outputid", "value": "0"},
    {"key": "outputname", "value": "ALSA Device"},
    {"key": "outputenabled", "value": "1"},
    {"key": "plugin", "value": "alsa"},
    {"key": "outputid", "value": "1"},
    {"key": "outputname", "value": "PulseAudio"},
    {"key": "outputenabled", "value": "0"},
    {"key": "plugin", "value": "pulse"}
  ]
}
```

Parse groups of 4 key-value pairs (one per output).

## Error Handling

### Common Errors

**Connection Refused:**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

Causes:
- MPD not running
- Wrong port
- Firewall blocking connection
- Host unreachable

**Authentication Failed:**
```json
{
  "success": false,
  "error": "Authentication failed: incorrect password"
}
```

Causes:
- Wrong password
- MPD configured without password but client sends one
- Permission denied (connection from unauthorized IP)

**Invalid Command:**
```json
{
  "success": false,
  "error": "Command \"invalid\" is not allowed. Only read-only commands are permitted."
}
```

Causes:
- Attempting state-changing command via `/api/mpd/command` endpoint
- Typo in command name

**Malformed Response:**
```json
{
  "success": false,
  "error": "Unexpected banner: random text"
}
```

Causes:
- Not an MPD server (e.g., HTTP server on port 6600)
- Protocol version mismatch
- Proxy/middleware mangling connection

### Debugging Tips

1. **Test with telnet:**
   ```bash
   telnet mpd.home.local 6600
   # Should see: OK MPD 0.23.0
   status
   # Should see key-value pairs ending with OK
   ```

2. **Check MPD logs:**
   ```bash
   journalctl -u mpd -f
   ```

3. **Verify MPD config:**
   ```bash
   cat /etc/mpd.conf | grep -E 'bind_to_address|port|password'
   ```

4. **Test authentication:**
   ```bash
   echo -e "password secret\nstatus\nclose" | nc mpd.home.local 6600
   ```

5. **Capture raw protocol:**
   ```bash
   tcpdump -i any -A port 6600
   ```

## References

- [Official MPD Protocol Documentation](https://mpd.readthedocs.io/en/latest/protocol.html)
- [MPD Homepage](https://www.musicpd.org/)
- [MPD GitHub Repository](https://github.com/MusicPlayerDaemon/MPD)
- [MPD Wiki](https://wiki.archlinux.org/title/Music_Player_Daemon)

## Changelog

### 2026-02-18 - Initial Documentation
- Created comprehensive protocol guide
- Documented Port of Call implementation specifics
- Added security notes and debugging tips

### Bugs Fixed (2026-02-18)
1. **ACK Error Pattern** - Fixed regex to anchor at line start for correct ACK parsing
2. **Password Injection** - Added newline validation and quote escaping for passwords
3. **Argument Quoting** - Added automatic quoting and escaping for URIs with spaces/quotes
4. **Input Validation** - Added numeric validation for `songpos` and `time` parameters
5. **Security** - Prevented command injection via newlines in passwords and URIs
