#!/bin/sh
set -e

# ==============================================================================
# PayBound Agent Sandbox — Default Network Isolation Entrypoint (Task 2.1)
# ==============================================================================
# In Task 2.1, the sandbox container enforces a zero-network-access baseline:
# 1. DNS resolution is disabled by truncating /etc/resolv.conf so outbound lookups fail.
# 2. If CAP_NET_ADMIN is available, iptables OUTPUT policy is set to DROP (loopback allowed).
# 3. Running with `--network none` provides airtight kernel-level network namespace isolation.
# In Task 2.2, apps/sandbox/network/egress-policy.sh will carve out specific exceptions
# (allowing public web access while blocking payment infrastructure except the Broker channel).
# ==============================================================================

# Disable DNS resolution inside container
if [ -w /etc/resolv.conf ]; then
  > /etc/resolv.conf
fi

# Apply iptables outbound drop if network admin capability is granted
if command -v iptables >/dev/null 2>&1; then
  iptables -P OUTPUT DROP 2>/dev/null || true
  iptables -P FORWARD DROP 2>/dev/null || true
  iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
fi

# If a command was supplied (e.g. via `docker run ... <cmd>`), execute it.
# Otherwise, execute the compiled sandbox application entrypoint.
if [ $# -gt 0 ]; then
  exec "$@"
else
  exec node dist/index.js
fi

