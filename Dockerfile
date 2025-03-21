ARG BUN_VERSION=1.2.5

FROM golang:1.21.3-bullseye AS go-builder

RUN git clone https://github.com/eslym/captcha-cli.git \
    && cd captcha-cli \
    && go build -o /usr/local/bin/captcha

FROM oven/bun:${BUN_VERSION}-alpine AS bun-builder

ADD ./ /home/bun/app/

RUN cd /home/bun/app \
    && bun install \
    && bun run build \
    && chmod +x /home/bun/app/dist/index.js

FROM oven/bun:${BUN_VERSION}-alpine

COPY --from=bun-builder /home/bun/app/dist/index.js /usr/local/bin/guardbot
COPY --from=go-builder /usr/local/bin/captcha /usr/local/bin/captcha

ENV NODE_ENV=production
ENV GUARDBOT_CAPTCHA_BIN=/usr/local/bin/captcha

CMD guardbot
