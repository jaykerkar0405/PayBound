#!/bin/sh
set -e

# ==============================================================================
# PayBound Agent Sandbox — Network Egress Policy (Task 2.2)
# ==============================================================================
# Default-deny OUTPUT baseline, with explicit ACCEPT carve-outs:
# - loopback, established/related connections, DNS.
# - The designated Broker channel: $BROKER_HOST:$BROKER_PORT (from
#   apps/sandbox/src/config.ts) — the one authenticated payment channel.
# - Standard outbound web ports (80/443) to arbitrary hosts, so the agent can
#   read untrusted web content, docs, and tool APIs (see THREAT_MODEL.md's
#   network isolation scope section for why this is intentional, not a gap).
#
# On top of that baseline, this script explicitly DROPs:
# - The Docker host gateway (stand-in for host-side payment infrastructure).
# - Any named payment-infrastructure targets given via $PAYMENT_INFRA_HOSTS
#   (or the legacy singular $PAYMENT_INFRA_HOST/$PAYMENT_INFRA_PORT) — these
#   block rules are installed before the generic web-port ACCEPT rules, so
#   they take precedence even if a named target sits on port 80/443.
#
# This is NOT a claim that all payment infrastructure everywhere is blocked —
# arbitrary, previously-unknown payment endpoints on the open internet are
# out of scope for network-layer blocking (see THREAT_MODEL.md). The blocked
# set here is the gateway plus whatever targets are explicitly enumerated.
#
# FAIL CLOSED: the OUTPUT policy is set to DROP immediately after the chain
# is flushed, before any ACCEPT rule is added, so a mid-script failure (e.g.
# broker host resolution failing) leaves the sandbox with no route out
# instead of falling back to iptables' allow-all default policy.
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

# Blocks one "host[:port]" entry: DROPs the given port on that host, or every
# port on that host if no port is given. No-ops if the host doesn't resolve.
block_payment_target() {
  entry="$1"
  host="${entry%%:*}"
  case "$entry" in
    *:*) port="${entry#*:}" ;;
    *) port="" ;;
  esac
  [ -z "$host" ] && return 0
  ip=$(resolve_ipv4 "$host" 2>/dev/null) || return 0
  if [ -n "$port" ]; then
    iptables -A OUTPUT -p tcp -d "$ip" --dport "$port" -j DROP
  else
    iptables -A OUTPUT -d "$ip" -j DROP
  fi
}

BROKER_HOST="${BROKER_HOST:-host.docker.internal}"
BROKER_PORT="${BROKER_PORT:-3000}"

# 1. Flush existing rules
iptables -F OUTPUT
iptables -F INPUT

# 2. Fail-closed default: DROP as the OUTPUT policy immediately, before any
# ACCEPT rule exists, so a failure anywhere below leaves the sandbox closed.
iptables -P OUTPUT DROP

# 3. Allow loopback traffic
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# 4. Allow stateful return traffic (ESTABLISHED, RELATED)
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 5. Allow DNS queries (UDP and TCP port 53)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# 6. Resolve Broker host and allow specific Broker host:port ONLY
BROKER_IP=$(resolve_ipv4 "$BROKER_HOST") || {
  echo "FATAL: Could not resolve Broker host: $BROKER_HOST" >&2
  exit 1
}
iptables -A OUTPUT -p tcp -d "$BROKER_IP" --dport "$BROKER_PORT" -j ACCEPT

# 7. Block the container gateway (stand-in for host-side payment infrastructure).
# Installed before the web-port ACCEPT rules below, so it takes precedence.
GATEWAY_IP=$(ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -n 1)
if [ -n "$GATEWAY_IP" ]; then
  iptables -A OUTPUT -d "$GATEWAY_IP" -j DROP
fi

# 8. Block named payment-infrastructure targets. Supports a comma/space
# separated list via $PAYMENT_INFRA_HOSTS (each entry "host" or "host:port"),
# plus the legacy singular $PAYMENT_INFRA_HOST/$PAYMENT_INFRA_PORT pair.
# Installed before the web-port ACCEPT rules, so a named target on 80/443 is
# still blocked rather than falling through to the general web allowance.
if [ -n "$PAYMENT_INFRA_HOST" ]; then
  if [ -n "$PAYMENT_INFRA_PORT" ]; then
    block_payment_target "${PAYMENT_INFRA_HOST}:${PAYMENT_INFRA_PORT}"
  else
    block_payment_target "$PAYMENT_INFRA_HOST"
  fi
fi

if [ -n "$PAYMENT_INFRA_HOSTS" ]; then
  saved_ifs=$IFS
  IFS=', 	'
  for entry in $PAYMENT_INFRA_HOSTS; do
    [ -n "$entry" ] && block_payment_target "$entry"
  done
  IFS=$saved_ifs
fi

# 9. Allow standard outbound web ports to arbitrary remaining hosts, so the
# agent can read untrusted web content, docs, and tool APIs. Anything not
# matched by an ACCEPT rule above falls through to the OUTPUT policy (DROP,
# set in step 2) — this is a default-deny baseline with explicit carve-outs,
# not an allow-all-then-block-a-few-hosts policy.
iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

echo "Sandbox egress policy applied: Web allowed, payment infra blocked, Broker exception allowed on $BROKER_IP:$BROKER_PORT"
