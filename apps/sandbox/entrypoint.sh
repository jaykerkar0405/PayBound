#!/bin/sh
set -e

# ==============================================================================
# PayBound Agent Sandbox — Container Entrypoint (Task 2.1 / 2.2)
# ==============================================================================
# In Task 2.2, apps/sandbox/network/egress-policy.sh is wired to run automatically
# at container startup before application code runs.
# It enforces a default-deny OUTPUT policy with explicit carve-outs:
# 1. Outbound public web access on ports 80/443 (HTTP/HTTPS, DNS).
# 2. Broker channel ($BROKER_HOST:$BROKER_PORT).
# It then blocks the Docker host/gateway network and any named
# payment-infrastructure targets ($PAYMENT_INFRA_HOST(S)) on top of that
# baseline. See apps/sandbox/network/egress-policy.sh for the full policy
# and docs/THREAT_MODEL.md for what this policy does and does not cover.
# If CAP_NET_ADMIN is absent, maintains zero-network baseline (fails closed).
# ==============================================================================

# Apply egress policy automatically at startup if present
if [ -f /app/network/egress-policy.sh ]; then
  /app/network/egress-policy.sh
elif [ -f ./network/egress-policy.sh ]; then
  ./network/egress-policy.sh
else
  # Fallback to Task 2.1 default posture: strip DNS resolution
  if [ -w /etc/resolv.conf ]; then
    > /etc/resolv.conf
  fi
  if command -v iptables >/dev/null 2>&1; then
    iptables -P OUTPUT DROP 2>/dev/null || true
    iptables -P FORWARD DROP 2>/dev/null || true
    iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
  fi
fi

# If a command was supplied (e.g. via `docker run ... <cmd>`), execute it.
# Otherwise, execute the compiled sandbox application entrypoint.
if [ $# -gt 0 ]; then
  exec "$@"
else
  exec node dist/index.js
fi
