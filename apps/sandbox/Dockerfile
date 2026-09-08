# ==============================================================================
# PayBound Agent Sandbox — Container Runtime (Task 2.1 / 2.2)
# ==============================================================================
# Docker is the decided isolation mechanism for Phase 2 (see docs/TECH_STACK_ADR.md).
# This image provides the network-isolated runtime for the adversarial domain.
#
# Egress Policy Posture (Task 2.2):
# - Outbound public web (HTTP/HTTPS, DNS) is allowed so agent can read untrusted content.
# - Host gateway and internal payment infrastructure routes are blocked.
# - The designated Broker channel ($BROKER_HOST:$BROKER_PORT) is explicitly allowed.
# - Egress policy is applied automatically at container startup via network/egress-policy.sh.
# ==============================================================================

# Build stage: compile TypeScript application
FROM node:24-alpine AS builder

WORKDIR /build/apps/sandbox

# Provide fallback parent tsconfig.base.json so tsc can resolve the extended base
RUN mkdir -p /build && \
    echo '{"compilerOptions":{"target":"ES2023","module":"NodeNext","moduleResolution":"NodeNext","lib":["ES2023"],"strict":true,"skipLibCheck":true}}' > /build/tsconfig.base.json

COPY . ./

# Build TypeScript to compiled JavaScript in dist/ if not already pre-built
RUN if [ ! -f "dist/index.js" ]; then \
      sed -i '/"workspace:/d' package.json && \
      npm install --no-package-lock typescript@^6.0.3 @types/node@^26.4.1 && \
      echo '{"extends":"/build/tsconfig.base.json","compilerOptions":{"outDir":"dist","rootDir":"src","types":["node"]},"include":["src/index.ts","src/config.ts","src/attestation.ts"]}' > tsconfig.entrypoint.json && \
      ./node_modules/.bin/tsc -p tsconfig.entrypoint.json; \
    fi

# Runner stage: minimal production container
FROM node:24-alpine

# Install curl and iptables for network testing and egress policy enforcement
RUN apk add --no-cache curl iptables

WORKDIR /app

# Copy built JavaScript and runtime assets
COPY --from=builder /build/apps/sandbox/dist ./dist
COPY package.json ./
COPY entrypoint.sh ./entrypoint.sh
COPY network ./network

RUN chmod +x ./entrypoint.sh ./network/egress-policy.sh

# Run compiled JS by default via network-isolating entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
