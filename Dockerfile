FROM golang:1.21.3-bullseye AS go-builder

RUN git clone https://github.com/eslym/captcha-cli.git \
    && cd captcha-cli \
    && go build -o /usr/local/bin/captcha

FROM oven/bun:1.0.7 AS bun-builder

ADD ./index.ts /home/bun/app/index.ts
ADD ./package.json /home/bun/app/package.json
ADD ./lib /home/bun/app/lib

RUN cd /home/bun/app \
    && bun install \
    && bun run build \
    && chmod +x /home/bun/app/dist/index.js

FROM oven/bun:1.0.7-slim

COPY --from=bun-builder /home/bun/app/dist/index.js /usr/local/bin/guardbot
COPY --from=go-builder /usr/local/bin/captcha /usr/local/bin/captcha

ENV NODE_ENV=production
ENV GUARDBOT_CAPTCHA_BIN=/usr/local/bin/captcha

CMD guardbot
