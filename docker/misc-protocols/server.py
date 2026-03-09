#!/usr/bin/env python3
"""
Multi-Protocol Server implementing miscellaneous TCP protocols:
- QOTD (RFC 865, Port 17): Returns a random quote of the day
- WHOIS (RFC 3912, Port 43): Returns domain/user information
- Gopher (RFC 1436, Port 70): Returns Gopher menu/documents
- Ident (RFC 1413, Port 113): Returns user identification
- DICT (RFC 2229, Port 2628): Dictionary lookup service
- NNTP (RFC 3977, Port 119): Network News Transfer Protocol (basic)

All protocols enforce a 15-minute (900 second) session timeout.
"""

import socket
import threading
import time
import logging
import random
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

SESSION_TIMEOUT = 900

QUOTES = [
    "The only way to do great work is to love what you do. - Steve Jobs",
    "Innovation distinguishes between a leader and a follower. - Steve Jobs",
    "Stay hungry, stay foolish. - Steve Jobs",
    "The best time to plant a tree was 20 years ago. The second best time is now. - Chinese Proverb",
    "It does not matter how slowly you go as long as you do not stop. - Confucius",
    "Life is what happens when you're busy making other plans. - John Lennon",
    "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
    "In the middle of difficulty lies opportunity. - Albert Einstein",
    "Talk is cheap. Show me the code. - Linus Torvalds",
    "Programs must be written for people to read. - Harold Abelson",
]

DICT_ENTRIES = {
    "protocol": "A set of rules governing the exchange of data between devices.",
    "network": "A group of interconnected computers and devices that can communicate with each other.",
    "server": "A computer program or device that provides functionality for other programs or devices.",
    "client": "A computer program or device that accesses a service made available by a server.",
    "port": "A logical construct that identifies a specific process or network service.",
    "socket": "An endpoint for sending or receiving data across a computer network.",
    "tcp": "Transmission Control Protocol - a connection-oriented protocol for reliable data delivery.",
    "udp": "User Datagram Protocol - a connectionless protocol for fast, unreliable data delivery.",
    "dns": "Domain Name System - translates domain names to IP addresses.",
    "http": "HyperText Transfer Protocol - the foundation of data communication for the World Wide Web.",
}


class ProtocolServer:
    def __init__(self, port, handler, name):
        self.port = port
        self.handler = handler
        self.name = name

    def start(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('0.0.0.0', self.port))
        sock.listen(5)
        logging.info(f"{self.name} server started on port {self.port}")

        while True:
            try:
                client, addr = sock.accept()
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


def qotd_handler(client, addr):
    """RFC 865 Quote of the Day Protocol - Port 17"""
    try:
        quote = random.choice(QUOTES)
        client.sendall((quote + '\r\n').encode('ascii'))
    except Exception as e:
        logging.error(f"QOTD: Error with {addr}: {e}")
    finally:
        client.close()


def whois_handler(client, addr):
    """RFC 3912 WHOIS Protocol - Port 43"""
    try:
        client.settimeout(30)
        query = client.recv(1024).decode('ascii', errors='ignore').strip()

        if not query:
            response = "Error: No query provided\r\n"
        elif '.' in query:
            # Domain query
            response = f"""% WHOIS Test Server
% This is test data for protocol testing.

Domain Name: {query.upper()}
Registry Domain ID: TEST-{hash(query) % 100000}
Registrar WHOIS Server: whois.test.local
Registrar URL: http://www.test.local
Updated Date: 2024-01-15T12:00:00Z
Creation Date: 2020-06-01T00:00:00Z
Registry Expiry Date: 2025-06-01T00:00:00Z
Registrar: Test Registrar Inc.
Registrar IANA ID: 99999
Domain Status: clientTransferProhibited
Name Server: NS1.TEST.LOCAL
Name Server: NS2.TEST.LOCAL
DNSSEC: unsigned

>>> Last update of WHOIS database: {datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ')} <<<
"""
        else:
            # Handle lookup
            response = f"""% WHOIS Test Server
% Query: {query}

person:     Test Person
address:    123 Test Street
address:    Test City, TC 12345
phone:      +1-555-0100
e-mail:     {query}@test.local
nic-hdl:    TP1-TEST
source:     TEST
"""

        client.sendall(response.encode('ascii'))

    except socket.timeout:
        logging.info(f"WHOIS: Timeout for {addr}")
    except Exception as e:
        logging.error(f"WHOIS: Error with {addr}: {e}")
    finally:
        client.close()


def gopher_handler(client, addr):
    """RFC 1436 Gopher Protocol - Port 70"""
    try:
        client.settimeout(30)
        selector = client.recv(1024).decode('ascii', errors='ignore').strip()

        if not selector or selector == '/':
            # Root menu
            response = (
                "iWelcome to the Port of Call Gopher Test Server\tfake\t(NULL)\t0\r\n"
                "i\tfake\t(NULL)\t0\r\n"
                "1About this server\t/about\tlocalhost\t70\r\n"
                "0Test document\t/test.txt\tlocalhost\t70\r\n"
                "1Protocol information\t/protocols\tlocalhost\t70\r\n"
                "iLast updated: " + datetime.now().strftime('%Y-%m-%d') + "\tfake\t(NULL)\t0\r\n"
                ".\r\n"
            )
        elif selector == '/about':
            response = (
                "iPort of Call - Gopher Test Server\tfake\t(NULL)\t0\r\n"
                "iThis is a test Gopher server for protocol testing.\tfake\t(NULL)\t0\r\n"
                "iIt serves static test content.\tfake\t(NULL)\t0\r\n"
                "1Back to main menu\t/\tlocalhost\t70\r\n"
                ".\r\n"
            )
        elif selector == '/test.txt':
            response = (
                "This is a test document served over the Gopher protocol.\r\n"
                "It demonstrates basic Gopher document retrieval.\r\n"
                "\r\n"
                "Port of Call Test Server\r\n"
                ".\r\n"
            )
        elif selector == '/protocols':
            response = (
                "iSupported Protocols\tfake\t(NULL)\t0\r\n"
                "i\tfake\t(NULL)\t0\r\n"
                "i  QOTD  - Quote of the Day (Port 17)\tfake\t(NULL)\t0\r\n"
                "i  WHOIS - Domain Lookup (Port 43)\tfake\t(NULL)\t0\r\n"
                "i  Gopher - This protocol (Port 70)\tfake\t(NULL)\t0\r\n"
                "i  Ident - User Identification (Port 113)\tfake\t(NULL)\t0\r\n"
                "i  DICT  - Dictionary Lookup (Port 2628)\tfake\t(NULL)\t0\r\n"
                "1Back to main menu\t/\tlocalhost\t70\r\n"
                ".\r\n"
            )
        else:
            response = f"3'{selector}' does not exist\tfake\t(NULL)\t0\r\n.\r\n"

        client.sendall(response.encode('ascii'))

    except socket.timeout:
        logging.info(f"Gopher: Timeout for {addr}")
    except Exception as e:
        logging.error(f"Gopher: Error with {addr}: {e}")
    finally:
        client.close()


def ident_handler(client, addr):
    """RFC 1413 Ident Protocol - Port 113"""
    try:
        client.settimeout(30)
        query = client.recv(1024).decode('ascii', errors='ignore').strip()

        if ',' in query:
            parts = query.split(',')
            server_port = parts[0].strip()
            client_port = parts[1].strip()
            response = f"{server_port}, {client_port} : USERID : UNIX : testuser\r\n"
        else:
            response = "0, 0 : ERROR : UNKNOWN-ERROR\r\n"

        client.sendall(response.encode('ascii'))

    except socket.timeout:
        logging.info(f"Ident: Timeout for {addr}")
    except Exception as e:
        logging.error(f"Ident: Error with {addr}: {e}")
    finally:
        client.close()


def dict_handler(client, addr):
    """RFC 2229 DICT Protocol - Port 2628"""
    try:
        client.settimeout(SESSION_TIMEOUT)

        # Send banner
        banner = "220 testserver.local dictd 1.0.0 <test@testserver.local>\r\n"
        client.sendall(banner.encode('ascii'))

        while True:
            data = client.recv(4096)
            if not data:
                break

            command = data.decode('ascii', errors='ignore').strip()
            cmd_upper = command.upper()

            if cmd_upper.startswith('DEFINE'):
                parts = command.split()
                if len(parts) >= 3:
                    word = parts[2].lower().strip('"')
                    if word in DICT_ENTRIES:
                        definition = DICT_ENTRIES[word]
                        response = (
                            f'150 1 definitions retrieved\r\n'
                            f'151 "{word}" testdict "Test Dictionary"\r\n'
                            f'{definition}\r\n'
                            f'.\r\n'
                            f'250 ok\r\n'
                        )
                    else:
                        response = f'552 no match for "{word}"\r\n'
                else:
                    response = '501 syntax error, illegal parameters\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper.startswith('MATCH'):
                parts = command.split()
                if len(parts) >= 4:
                    pattern = parts[3].lower().strip('"')
                    matches = [w for w in DICT_ENTRIES if pattern in w]
                    if matches:
                        response = f'152 {len(matches)} matches found\r\n'
                        for m in matches:
                            response += f'testdict "{m}"\r\n'
                        response += '.\r\n250 ok\r\n'
                    else:
                        response = '552 no match\r\n'
                else:
                    response = '501 syntax error, illegal parameters\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'SHOW DB':
                response = (
                    '110 1 databases present\r\n'
                    'testdict "Test Dictionary"\r\n'
                    '.\r\n'
                    '250 ok\r\n'
                )
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'SHOW STRAT':
                response = (
                    '111 2 strategies present\r\n'
                    'exact "Match exact word"\r\n'
                    'prefix "Match word prefix"\r\n'
                    '.\r\n'
                    '250 ok\r\n'
                )
                client.sendall(response.encode('ascii'))

            elif cmd_upper.startswith('CLIENT'):
                response = '250 ok\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'QUIT':
                response = '221 bye\r\n'
                client.sendall(response.encode('ascii'))
                break

            elif cmd_upper == 'STATUS':
                response = '210 status [testdict]\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'HELP':
                response = (
                    '113 help text follows\r\n'
                    'DEFINE database word    -- look up word\r\n'
                    'MATCH database strategy word -- search for word\r\n'
                    'SHOW DB                 -- list databases\r\n'
                    'SHOW STRAT              -- list strategies\r\n'
                    'CLIENT info             -- identify client\r\n'
                    'STATUS                  -- server status\r\n'
                    'HELP                    -- this help\r\n'
                    'QUIT                    -- disconnect\r\n'
                    '.\r\n'
                    '250 ok\r\n'
                )
                client.sendall(response.encode('ascii'))

            else:
                response = f'500 unknown command "{command}"\r\n'
                client.sendall(response.encode('ascii'))

    except socket.timeout:
        logging.info(f"DICT: Session timeout for {addr}")
    except Exception as e:
        logging.error(f"DICT: Error with {addr}: {e}")
    finally:
        client.close()


def nntp_handler(client, addr):
    """RFC 3977 NNTP Protocol (basic) - Port 119"""
    try:
        client.settimeout(SESSION_TIMEOUT)

        # Send banner
        banner = "200 testserver.local NNTP Service Ready - posting allowed\r\n"
        client.sendall(banner.encode('ascii'))

        groups = {
            'test.general': {'count': 42, 'low': 1, 'high': 42, 'posting': 'y'},
            'test.protocols': {'count': 15, 'low': 1, 'high': 15, 'posting': 'y'},
            'comp.protocols.tcp-ip': {'count': 100, 'low': 1, 'high': 100, 'posting': 'y'},
        }

        current_group = None

        while True:
            data = client.recv(4096)
            if not data:
                break

            command = data.decode('ascii', errors='ignore').strip()
            cmd_upper = command.upper()

            if cmd_upper == 'LIST':
                response = '215 list of newsgroups follows\r\n'
                for name, info in groups.items():
                    response += f"{name} {info['high']} {info['low']} {info['posting']}\r\n"
                response += '.\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper.startswith('GROUP'):
                parts = command.split()
                if len(parts) >= 2:
                    gname = parts[1]
                    if gname in groups:
                        current_group = gname
                        info = groups[gname]
                        response = f"211 {info['count']} {info['low']} {info['high']} {gname}\r\n"
                    else:
                        response = '411 no such newsgroup\r\n'
                else:
                    response = '501 syntax error\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'CAPABILITIES':
                response = (
                    '101 Capability list:\r\n'
                    'VERSION 2\r\n'
                    'READER\r\n'
                    'LIST ACTIVE NEWSGROUPS\r\n'
                    'POST\r\n'
                    '.\r\n'
                )
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'DATE':
                now = datetime.now().strftime('%Y%m%d%H%M%S')
                response = f'111 {now}\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'QUIT':
                response = '205 Connection closing\r\n'
                client.sendall(response.encode('ascii'))
                break

            elif cmd_upper == 'MODE READER':
                response = '200 Reader mode, posting allowed\r\n'
                client.sendall(response.encode('ascii'))

            elif cmd_upper == 'HELP':
                response = (
                    '100 Help text follows\r\n'
                    'LIST        - List newsgroups\r\n'
                    'GROUP name  - Select newsgroup\r\n'
                    'DATE        - Server date/time\r\n'
                    'CAPABILITIES - List capabilities\r\n'
                    'MODE READER - Switch to reader mode\r\n'
                    'QUIT        - Disconnect\r\n'
                    '.\r\n'
                )
                client.sendall(response.encode('ascii'))

            else:
                response = f'500 Unknown command\r\n'
                client.sendall(response.encode('ascii'))

    except socket.timeout:
        logging.info(f"NNTP: Session timeout for {addr}")
    except Exception as e:
        logging.error(f"NNTP: Error with {addr}: {e}")
    finally:
        client.close()


def main():
    servers = [
        ProtocolServer(17, qotd_handler, "QOTD"),
        ProtocolServer(43, whois_handler, "WHOIS"),
        ProtocolServer(70, gopher_handler, "Gopher"),
        ProtocolServer(113, ident_handler, "Ident"),
        ProtocolServer(119, nntp_handler, "NNTP"),
        ProtocolServer(2628, dict_handler, "DICT"),
    ]

    logging.info("Starting miscellaneous protocol servers...")
    logging.info(f"Session timeout: {SESSION_TIMEOUT} seconds (15 minutes)")

    for server in servers:
        thread = threading.Thread(target=server.start, daemon=True)
        thread.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logging.info("Shutting down all servers...")

if __name__ == '__main__':
    main()
