FROM golang:1.21.3-bullseye AS go-builder

RUN git clone https://github.com/eslym/captcha-cli.git \
    && cd captcha-cli \
    && go build -o /usr/local/bin/captcha

FROM oven/bun:1.0.7-distroless AS bun-builder

ADD ./index.ts /home/bun/app/index.ts
ADD ./package.json /home/bun/app/package.json
ADD ./lib /home/bun/app/lib

RUN bun install --production \
    && bun run build

FROM oven/bun:1.0.7-distroless

COPY --from=bun-builder /home/bun/app/dist/index.js /home/bun/app/index.js
COPY --from=go-builder /usr/local/bin/captcha /usr/local/bin/captcha

CMD bun index.js
