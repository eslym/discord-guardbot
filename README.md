# discord-guardbot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Docker

```bash
docker run eslym/discord-guardbot
```

Or download the prebuilt executable from [releases](https://github.com/eslym/discord-guardbot/releases).

## Dependencies

1. [bun](https://github.com/oven-sh/bun)
2. [this simple captcha generator](https://github.com/eslym/captcha-cli)

All dependencies are included in dev container and docker image.

## Configuration

### Via config file

```yaml
# config.yml
discord:
    token: 'your token'
```

```bash
guardbot --config config.yml # or config.json
```

### Via environment variables

```bash
export GUARDBOT_DISCORD_TOKEN='your token'
guardbot
```

**Path Conversion:**

`GUARDBOT_` + `{path}` + `_` + `{subpath}`, ex:<br/>

-   `GUARDBOT_DISCORD_TOKEN` -> `discord.token`
-   `GUARDBOT_GUILD_{ID}_ROLE` -> `guild.{ID}.role`

### Via command line arguments

```bash
guardbot --config.discord.token 'your token'
guardbot --config.file config.yml --config.discord.token 'your token' # with config file
```

### Priority

Config file < Environment variables < Command line arguments
