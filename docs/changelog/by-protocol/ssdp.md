# SSDP Review

**Protocol:** Simple Service Discovery Protocol (UPnP)
**File:** `src/worker/ssdp.ts`
**Reviewed:** 2026-02-19
**Specification:** UPnP Device Architecture 1.1
**Tests:** N/A

## Summary

SSDP implementation provides 5 endpoints (discover, fetch, subscribe, action, search) supporting UPnP device discovery via HTTP XML fetching and TCP M-SEARCH. Parses device/service descriptions, invokes SOAP actions, and establishes GENA event subscriptions. Critical fixes include XML CDATA handling, SOAP fault detection, and HTTP/1.1 multiline header parsing.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | High | **XML PARSING**: Added CDATA section stripping in `xmlValue()` (line 84) — prevents raw CDATA markers in extracted text |
| 2 | High | **SOAP FAULT DETECTION**: Enhanced `handleSSDPAction()` to parse `<faultcode>` and `<faultstring>` from SOAP error responses (line 555) |
| 3 | Medium | **REGEX GREEDY MATCH**: Changed XML tag extraction from greedy `.*` to non-greedy `.*?` (line 81, 91) to handle nested elements correctly |
| 4 | Medium | **HTTP HEADER PARSING**: Added proper colon-split parsing for HTTP headers in SUBSCRIBE/SEARCH responses (line 392, 669) |
| 5 | Low | **CLOUDFLARE BYPASS**: Consistent Cloudflare IP detection across all 5 endpoints to prevent false positives |
| 6 | Low | **TIMEOUT COORDINATION**: SEARCH endpoint uses `mx * 1000 + 2000` for read deadline (line 633) to account for MX delay window |

## Documentation Improvements

**Created:** Comprehensive UPnP/SSDP reference

The implementation includes detailed documentation:

1. **5 endpoints documented** — `/discover` (fetch XML from path), `/fetch` (try 10 common paths), `/subscribe` (GENA events), `/action` (SOAP control), `/search` (M-SEARCH over TCP)
2. **10 common XML paths** — `/rootDesc.xml`, `/description.xml`, `/upnp/IGD.xml`, `/gateway.xml`, etc.
3. **Device description fields** — deviceType, friendlyName, manufacturer, modelName, UDN, presentationURL
4. **Service list parsing** — serviceType, serviceId, controlURL, eventSubURL, SCPDURL extracted from `<serviceList>`
5. **SOAP action structure** — XML envelope with `xmlns:s`, `s:encodingStyle`, `u:ActionName` namespace binding
6. **GENA subscription** — SUBSCRIBE request with CALLBACK, NT (upnp:event), TIMEOUT headers; returns SID
7. **M-SEARCH format** — HTTP request with HOST=239.255.255.250:1900 (multicast), MAN="ssdp:discover", ST (search target), MX (delay)
8. **Known limitations**:
   - TCP M-SEARCH non-standard (UPnP uses UDP multicast)
   - HTTP description fetch only (no multicast NOTIFY advertisement parsing)
   - GENA callback URL not receivable (Workers can't listen for NOTIFY events)
   - No multicast socket support in Cloudflare Workers

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** UPnP Device Architecture 1.1, GENA (General Event Notification)

## Security Notes

1. **No Authentication**: UPnP has no built-in authentication — any client can invoke SOAP actions
2. **SOAP Injection**: User-provided `args` in `/action` endpoint concatenated into XML without escaping (line 473)
3. **SSRF Risk**: `presentationURL` and `controlURL` fields could point to internal IPs (SSRF vector if fetched)
4. **Device Fingerprinting**: `manufacturer`, `modelName`, `UDN` reveal device type and firmware version

## See Also

- [UPnP Device Architecture 1.1](https://openconnectivity.org/upnp-specs/UPnP-arch-DeviceArchitecture-v1.1.pdf)
- [GENA Specification](https://openconnectivity.org/upnp-specs/gena.html)
- [Common UPnP Actions (IGD)](https://openconnectivity.org/upnp-specs/UPnP-gw-InternetGatewayDevice-v2-Device.pdf)
