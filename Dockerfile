ARG BUN_VERSION=1.2.8

FROM golang:1.21.3-alpine AS go-builder

RUN apk add git \
    && git clone https://github.com/eslym/captcha-cli.git \
    && cd captcha-cli \
    && go build -o /usr/local/bin/captcha

FROM oven/bun:${BUN_VERSION}-alpine

COPY ./index.js /usr/local/bin/guardbot
COPY --from=go-builder /usr/local/bin/captcha /usr/local/bin/captcha

ENV NODE_ENV=production
ENV GUARDBOT_CAPTCHA_BIN=/usr/local/bin/captcha

CMD guardbot
