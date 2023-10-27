# This docker file is only used for development purposes.

FROM golang:1.21.3-bullseye AS go-builder

RUN git clone https://github.com/eslym/captcha-cli.git \
    && cd captcha-cli \
    && go build -o /usr/local/bin/captcha

FROM mcr.microsoft.com/devcontainers/javascript-node:20-bullseye

ARG BUN_INSTALL=/usr/local
ARG BUN_VERSION=bun-v1.0.7

RUN apt update && apt upgrade -y \
    && apt install -y lldb siege wrk \
    && apt clean \
    && curl -fsSL https://bun.sh/install > /usr/local/bin/install-bun \
    && chmod +x /usr/local/bin/install-bun \
    && /usr/local/bin/install-bun $BUN_VERSION debug-info \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && npm install -g npm@latest

COPY --from=go-builder /usr/local/bin/captcha /usr/local/bin/captcha

CMD echo container started && sleep infinity
