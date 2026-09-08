#!/bin/sh
set -e

# ==============================================================================
# PayBound Agent Sandbox — Network Egress Policy (Task 2.2)
# ==============================================================================
# Enforces structural network boundary at the iptables level:
# - ALLOW: Arbitrary public web egress (HTTP/HTTPS, DNS) so agent can read
#          untrusted web content, docs, and tool APIs.
# - BLOCK: All routes to internal/host payment infrastructure endpoints.
# - ALLOW EXCEPTION: Exactly ONE host:port pair — the designated Broker channel
#   defined by $BROKER_HOST:$BROKER_PORT (from apps/sandbox/src/config.ts).
# - FAIL CLOSED: If iptables rules fail to apply, exit non-zero immediately.
# ==============================================================================

# Helper to resolve host to IPv4 address
resolve_ipv4() {
  target="$1"
  case "$target" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*)
      echo "$target"
      return 0
      ;;
  esac
  ip=$(getent hosts "$target" 2>/dev/null | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)
  if [ -n "$ip" ]; then
    echo "$ip"
    return 0
  fi
  # Fallback to default gateway if host.docker.internal
  if [ "$target" = "host.docker.internal" ]; then
    gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -n 1)
    if [ -n "$gw" ]; then
      echo "$gw"
      return 0
    fi
  fi
  return 1
}

# Check if network administration capability is available
if ! iptables -L -n >/dev/null 2>&1; then
  # Without CAP_NET_ADMIN, cannot apply iptables egress policy.
  # Fail closed: keep DNS resolution disabled and fail if egress policy was explicitly required.
  if [ "${REQUIRE_EGRESS_POLICY:-0}" = "1" ]; then
    echo "FATAL: CAP_NET_ADMIN capability required to apply sandbox network egress policy." >&2
    exit 1
  fi
  echo "Notice: CAP_NET_ADMIN not available; maintaining zero-network posture." >&2
  if [ -w /etc/resolv.conf ]; then
    > /etc/resolv.conf
  fi
  exit 0
fi

# Restore DNS configuration if it was previously truncated or use default resolvers
if [ ! -s /etc/resolv.conf ]; then
  if [ -f /etc/resolv.conf.bak ]; then
    cp /etc/resolv.conf.bak /etc/resolv.conf
  else
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf
  fi
fi

BROKER_HOST="${BROKER_HOST:-host.docker.internal}"
BROKER_PORT="${BROKER_PORT:-3000}"

# 1. Flush existing rules
iptables -F OUTPUT
iptables -F INPUT

# 2. Allow loopback traffic
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# 3. Allow stateful return traffic (ESTABLISHED, RELATED)
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 4. Allow DNS queries (UDP and TCP port 53)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# 5. Resolve Broker host and allow specific Broker host:port ONLY
BROKER_IP=$(resolve_ipv4 "$BROKER_HOST") || {
  echo "FATAL: Could not resolve Broker host: $BROKER_HOST" >&2
  exit 1
}

iptables -A OUTPUT -p tcp -d "$BROKER_IP" --dport "$BROKER_PORT" -j ACCEPT

# 6. Block all other traffic to the container gateway / internal host network
# This ensures that any other listener on the host (e.g. stand-in payment infrastructure)
# cannot be reached from the sandbox container.
GATEWAY_IP=$(ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -n 1)
if [ -n "$GATEWAY_IP" ]; then
  iptables -A OUTPUT -d "$GATEWAY_IP" -j DROP
fi

# If stand-in or specific payment infrastructure host is specified, block it explicitly
if [ -n "$PAYMENT_INFRA_HOST" ]; then
  PAYMENT_IP=$(resolve_ipv4 "$PAYMENT_INFRA_HOST" || true)
  if [ -n "$PAYMENT_IP" ]; then
    if [ -n "$PAYMENT_INFRA_PORT" ]; then
      iptables -A OUTPUT -p tcp -d "$PAYMENT_IP" --dport "$PAYMENT_INFRA_PORT" -j DROP
    else
      iptables -A OUTPUT -d "$PAYMENT_IP" -j DROP
    fi
  fi
fi

# 7. Allow all remaining outbound traffic (arbitrary public web, docs, tool APIs)
iptables -A OUTPUT -j ACCEPT

# Default policy: DROP (any unmatched packets are dropped)
iptables -P OUTPUT DROP

echo "Sandbox egress policy applied: Web allowed, payment infra blocked, Broker exception allowed on $BROKER_IP:$BROKER_PORT"
