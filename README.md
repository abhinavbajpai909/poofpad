# PoofPad

An end-to-end encrypted, real-time shared text pad. Anyone with the link can edit it live from a phone, tablet or
laptop, and the pad disappears at an expiry its creator chooses (10 minutes up to 24 hours). The encryption key lives
only in the link's `#fragment`, so the server stores ciphertext it cannot read.

> Work in progress. Full documentation arrives with the first release.

## Local development

Requires Node.js 22.12 or newer. Works the same on Windows (PowerShell), macOS and Linux.

```sh
npm install
cp .dev.vars.example .dev.vars   # PowerShell: Copy-Item .dev.vars.example .dev.vars
npm run dev
```

- App with hot reload: http://localhost:5173 (API and WebSocket calls are proxied to the Worker)
- Worker serving the built app: http://127.0.0.1:8787

`npm run check` runs type checking, linting and tests.

## License

MIT
