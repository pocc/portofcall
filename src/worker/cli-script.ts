/* eslint-disable no-useless-escape */
/**
 * Serves the `poc` CLI bash script at GET /cli.
 * Zero-dependency bash script that wraps curl calls to portofcall.
 */

const CLI_SCRIPT = `#!/usr/bin/env bash
# poc — Port of Call CLI
# Install: curl -sL portofcall.ross.gg/cli > /usr/local/bin/poc && chmod +x $_
# Usage:  poc [options] [protocol] target [extra]

set -euo pipefail

BASE_URL="\${POC_URL:-https://portofcall.ross.gg}"
FORMAT="text"
TIMEOUT=""
PROTOCOL=""
TARGET=""
EXTRA=""

# Colors (respect NO_COLOR: https://no-color.org)
if [[ -t 1 ]] && [[ -z "\${NO_COLOR:-}" ]]; then
  BOLD="\\033[1m"
  DIM="\\033[2m"
  GREEN="\\033[32m"
  RED="\\033[31m"
  CYAN="\\033[36m"
  RESET="\\033[0m"
else
  BOLD="" DIM="" GREEN="" RED="" CYAN="" RESET=""
fi

usage() {
  cat <<'HELP'
Usage: poc [options] [protocol] target [extra]

Protocols:
  synping    TCP ping (port required)      poc synping host:port
  tcp        Raw TCP send/receive          poc tcp host:port
  http       HTTP request                  poc http host [path]
  https      HTTPS request                 poc https host [path]
  dns        DNS lookup                    poc dns domain [type]
  ssh        SSH key exchange              poc ssh host[:port]
  ftp        FTP connect                   poc ftp host[:port]
  redis      Redis connect                 poc redis host[:port]
  mysql      MySQL connect                 poc mysql host[:port]
  postgres   PostgreSQL connect            poc postgres host[:port]
  smtp       SMTP connect                  poc smtp host[:port]
  whois      WHOIS lookup                  poc whois domain
  ntp        NTP time query                poc ntp host[:port]
  tls        TLS certificate check         poc tls host[:port]
  ws         WebSocket probe               poc ws host[:port] [path]

Options:
  --json         Output raw JSON
  --timeout=N    Timeout in milliseconds
  --help, -h     Show this help

Auto-detection:
  poc example.com         → http (default when no port given)
  poc host:22    → ssh
  poc host:80    → http
  poc host:443   → https/tls
  poc host:3306  → mysql
  poc host:5432  → postgres
  poc host:6379  → redis
  poc host:25    → smtp
  poc host:21    → ftp
  poc host:53    → dns
  poc host:123   → ntp

Environment:
  POC_URL     Base URL (default: https://portofcall.ross.gg)
  NO_COLOR    Disable colors when set
HELP
  exit 0
}

# Auto-detect protocol from port
detect_protocol() {
  local port="\$1"
  case "\$port" in
    22)   echo "ssh" ;;
    80)   echo "http" ;;
    443)  echo "tls" ;;
    3306) echo "mysql" ;;
    5432) echo "postgres" ;;
    6379) echo "redis" ;;
    25)   echo "smtp" ;;
    21)   echo "ftp" ;;
    53)   echo "dns" ;;
    123)  echo "ntp" ;;
    *)    echo "synping" ;;
  esac
}

# Parse arguments
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    --json)
      FORMAT="json"; shift ;;
    --timeout=*)
      TIMEOUT="\${1#--timeout=}"; shift ;;
    --help|-h)
      usage ;;
    -*)
      echo "Unknown option: \$1" >&2; exit 1 ;;
    *)
      if [[ -z "\$PROTOCOL" ]]; then
        # Check if this is a known protocol name or a target
        case "\$1" in
          synping|tcp|http|https|dns|ssh|ftp|redis|mysql|postgres|smtp|whois|ntp|tls|ws)
            PROTOCOL="\$1" ;;
          *)
            # It's a target — auto-detect protocol from port
            TARGET="\$1"
            if [[ "\$TARGET" == *:* ]]; then
              PORT="\${TARGET##*:}"
              PROTOCOL=\$(detect_protocol "\$PORT")
            else
              # No port specified — default to http (port 80) not synping (which requires a port)
              PROTOCOL="http"
            fi
            ;;
        esac
      elif [[ -z "\$TARGET" ]]; then
        TARGET="\$1"
      elif [[ -z "\$EXTRA" ]]; then
        EXTRA="\$1"
      fi
      shift ;;
  esac
done

if [[ -z "\$TARGET" ]]; then
  usage
fi

# Build URL
URL="\${BASE_URL}/\${PROTOCOL}/\${TARGET}"
[[ -n "\$EXTRA" ]] && URL="\${URL}/\${EXTRA}"

# Query params
PARAMS=""
[[ -n "\$TIMEOUT" ]] && PARAMS="?timeout=\${TIMEOUT}"
[[ "\$FORMAT" == "json" ]] && {
  [[ -n "\$PARAMS" ]] && PARAMS="\${PARAMS}&format=json" || PARAMS="?format=json"
}
URL="\${URL}\${PARAMS}"

# Make request
if [[ "\$FORMAT" == "json" ]]; then
  curl -sS "\$URL"
else
  RESPONSE=\$(curl -sS "\$URL")
  # Add colors if terminal
  if [[ -t 1 ]] && [[ -z "\${NO_COLOR:-}" ]]; then
    echo "\$RESPONSE" | sed \\
      -e "s/^PORTOFCALL/\${BOLD}\${CYAN}PORTOFCALL\${RESET}/" \\
      -e "s/ERROR/\${RED}ERROR\${RESET}/g" \\
      -e "s/OPEN/\${GREEN}OPEN\${RESET}/g" \\
      -e "s/Connected/\${GREEN}Connected\${RESET}/g"
  else
    echo "\$RESPONSE"
  fi
fi
`;

export function serveCLIScript(): Response {
  return new Response(CLI_SCRIPT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="poc"',
    },
  });
}
