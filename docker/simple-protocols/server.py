#!/usr/bin/env python3
"""
Multi-Protocol Server implementing RFC-defined simple TCP protocols:
- Echo (RFC 862, Port 7): Echoes back received data
- Discard (RFC 863, Port 9): Discards all received data
- Daytime (RFC 867, Port 13): Returns current date/time as ASCII
- Chargen (RFC 864, Port 19): Generates continuous character stream
- Time (RFC 868, Port 37): Returns time as 32-bit binary number
- Finger (RFC 1288, Port 79): Returns user information

All protocols enforce a 15-minute (900 second) session timeout.
"""

import socket
import threading
import time
import struct
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

# Session timeout: 15 minutes
SESSION_TIMEOUT = 900

class ProtocolServer:
    def __init__(self, port, handler, name):
        self.port = port
        self.handler = handler
        self.name = name
        self.sock = None

    def start(self):
        """Start the protocol server"""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(('0.0.0.0', self.port))
        self.sock.listen(5)
        logging.info(f"{self.name} server started on port {self.port}")

        while True:
            try:
                client, addr = self.sock.accept()
                client.settimeout(SESSION_TIMEOUT)
                logging.info(f"{self.name}: Connection from {addr}")
                thread = threading.Thread(
                    target=self.handler,
                    args=(client, addr),
                    daemon=True
                )
                thread.start()
            except Exception as e:
                logging.error(f"{self.name}: Error accepting connection: {e}")

def echo_handler(client, addr):
    """RFC 862 Echo Protocol - Port 7"""
    try:
        while True:
            data = client.recv(4096)
            if not data:
                break
            client.sendall(data)
    except socket.timeout:
        logging.info(f"Echo: Session timeout for {addr}")
    except Exception as e:
        logging.error(f"Echo: Error with {addr}: {e}")
    finally:
        client.close()

def discard_handler(client, addr):
    """RFC 863 Discard Protocol - Port 9"""
    try:
        while True:
            data = client.recv(4096)
            if not data:
                break
            # Just discard the data, don't send anything back
    except socket.timeout:
        logging.info(f"Discard: Session timeout for {addr}")
    except Exception as e:
        logging.error(f"Discard: Error with {addr}: {e}")
    finally:
        client.close()

def daytime_handler(client, addr):
    """RFC 867 Daytime Protocol - Port 13"""
    try:
        # Send current date/time in human-readable format
        current_time = datetime.now().strftime('%A, %B %d, %Y %H:%M:%S %Z\r\n')
        client.sendall(current_time.encode('ascii'))
    except Exception as e:
        logging.error(f"Daytime: Error with {addr}: {e}")
    finally:
        client.close()

def chargen_handler(client, addr):
    """RFC 864 Character Generator Protocol - Port 19"""
    try:
        # Generate rotating pattern of ASCII printable characters (33-126)
        line_length = 72
        start_char = 33

        offset = 0
        while True:
            line = ''
            for i in range(line_length):
                char_code = ((i + offset) % 94) + 33
                line += chr(char_code)
            line += '\r\n'

            client.sendall(line.encode('ascii'))
            offset = (offset + 1) % 94
            time.sleep(0.1)  # Throttle output slightly

    except socket.timeout:
        logging.info(f"Chargen: Session timeout for {addr}")
    except Exception as e:
        logging.error(f"Chargen: Error with {addr}: {e}")
    finally:
        client.close()

def time_handler(client, addr):
    """RFC 868 Time Protocol - Port 37"""
    try:
        # Time since Jan 1, 1900 00:00:00 GMT
        # Unix epoch is Jan 1, 1970, so add 70 years worth of seconds
        EPOCH_OFFSET = 2208988800  # seconds from 1900 to 1970

        current_time = int(time.time()) + EPOCH_OFFSET
        # Send as 32-bit big-endian unsigned integer
        time_bytes = struct.pack('!I', current_time)
        client.sendall(time_bytes)
    except Exception as e:
        logging.error(f"Time: Error with {addr}: {e}")
    finally:
        client.close()

def finger_handler(client, addr):
    """RFC 1288 Finger Protocol - Port 79"""
    try:
        # Read the query (should end with \r\n)
        client.settimeout(30)  # Short timeout for query
        query = client.recv(1024).decode('ascii', errors='ignore').strip()

        # Generate response based on query
        if not query or query == '':
            # List all users
            response = """
Login     Name                  TTY      Idle  When
testuser  Test User             pts/0      -   Feb 16 12:00
alice     Alice Johnson         pts/1      1h  Feb 16 10:30
bob       Bob Smith             pts/2      -   Feb 16 11:45

Total users: 3
""".strip()
        else:
            # Query specific user
            username = query.lstrip('/')
            if username == 'testuser':
                response = """
Login: testuser                         Name: Test User
Directory: /home/testuser              Shell: /bin/bash
Last login: Fri Feb 16 12:00:00 2024 from 127.0.0.1
No mail.
No Plan.
""".strip()
            elif username == 'alice':
                response = """
Login: alice                            Name: Alice Johnson
Directory: /home/alice                 Shell: /bin/bash
Last login: Fri Feb 16 10:30:00 2024 from 10.0.0.100
Mail forwarded to alice@example.com
Plan:
Working on network protocols project.
Available for collaboration!
""".strip()
            else:
                response = f"finger: {username}: no such user"

        client.sendall((response + '\r\n').encode('ascii'))

    except socket.timeout:
        logging.info(f"Finger: Query timeout for {addr}")
    except Exception as e:
        logging.error(f"Finger: Error with {addr}: {e}")
    finally:
        client.close()

def main():
    """Start all protocol servers"""
    servers = [
        ProtocolServer(7, echo_handler, "Echo"),
        ProtocolServer(9, discard_handler, "Discard"),
        ProtocolServer(13, daytime_handler, "Daytime"),
        ProtocolServer(19, chargen_handler, "Chargen"),
        ProtocolServer(37, time_handler, "Time"),
        ProtocolServer(79, finger_handler, "Finger"),
    ]

    logging.info("Starting all protocol servers...")
    logging.info(f"Session timeout: {SESSION_TIMEOUT} seconds (15 minutes)")

    # Start each server in its own thread
    for server in servers:
        thread = threading.Thread(target=server.start, daemon=True)
        thread.start()

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logging.info("Shutting down all servers...")

if __name__ == '__main__':
    main()
