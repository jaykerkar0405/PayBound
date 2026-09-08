# ==============================================================================
# PayBound Agent Sandbox — Container Runtime (Task 2.1)
# ==============================================================================
# Docker is the decided isolation mechanism for Phase 2 (see docs/TECH_STACK_ADR.md).
# This image provides the network-isolated baseline runtime for the adversarial domain.
#
# Default Network Posture:
# - Zero outbound network access by default.
# - The entrypoint script strips DNS resolution (/etc/resolv.conf) and applies
#   iptables OUTPUT DROP (with loopback accepted) when CAP_NET_ADMIN is granted.
# - Running with `--network none` provides full kernel-level namespace isolation.
# - Phase 2 Task 2.2 builds on this baseline by carving out selective exceptions
#   (allowing web access while blocking payment infrastructure).
# ==============================================================================

# Build stage: compile TypeScript application
FROM node:24-alpine AS builder

WORKDIR /build/apps/sandbox

# Provide fallback parent tsconfig.base.json so tsc can resolve the extended base
RUN mkdir -p /build && \
    echo '{"compilerOptions":{"target":"ES2023","module":"NodeNext","moduleResolution":"NodeNext","lib":["ES2023"],"strict":true,"skipLibCheck":true}}' > /build/tsconfig.base.json

COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src

# Build TypeScript to compiled JavaScript in dist/
RUN npm install --no-package-lock typescript@^6.0.3 @types/node@^26.4.1 && \
    ./node_modules/.bin/tsc -p tsconfig.build.json


# Runner stage: minimal production container
FROM node:24-alpine

# Install curl and iptables for network testing and egress policy scaffolding
RUN apk add --no-cache curl iptables

WORKDIR /app

# Copy built JavaScript and runtime assets
COPY --from=builder /build/apps/sandbox/dist ./dist
COPY package.json ./
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

# Run compiled JS by default via network-isolating entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
