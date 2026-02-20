# PPTP (Point-to-Point Tunneling Protocol)

## Overview

**PPTP** is a legacy VPN protocol developed by Microsoft. While widely supported, it has known security vulnerabilities and is being replaced by modern alternatives like OpenVPN, WireGuard, and IKEv2.

**Port:** 1723 (TCP control), GRE protocol 47 (data)
**Transport:** TCP + GRE
**Status:** Deprecated (security concerns)

## Protocol Specification

PPTP uses two connections:
1. **Control Connection**: TCP port 1723
2. **Data Tunnel**: GRE (Generic Routing Encapsulation)

## Resources

- **RFC 2637**: Point-to-Point Tunneling Protocol (PPTP)

## Notes

- **Security Issues**: Vulnerable to attacks, weak encryption
- **Legacy**: Still supported for compatibility
- **Easy Setup**: Simple configuration
- **Fast**: Low overhead
- **Not Recommended**: Use OpenVPN, WireGuard, or IKEv2 instead
