# DiskDrive Terabox Resolver

Cloudflare Worker that resolves Terabox share links for DiskDrive. **NDUS stays server-side only.**

## Setup

```bash
cd server/terabox-resolver
npm install
npx wrangler secret put TERABOX_NDUS
# optional but recommended:
npx wrangler secret put RESOLVER_SECRET
npx wrangler deploy
```

## API

`POST /resolve`

Headers:
- `Content-Type: application/json`
- `X-Resolver-Key: <RESOLVER_SECRET>` (if configured)

Body:
```json
{ "url": "https://terabox.com/s/..." }
```

Success:
```json
{ "ok": true, "provider":"terabox", "name":"...", "directUrl":"https://...", "streamUrl":"https://...", "sourceUrl":"...", "sizeHuman":"..." }
```

Do not put `TERABOX_NDUS` in the app, git repo, or client settings.
