# Handoff: publish server.json 2.0.2 to the MCP Registry

**Status (2026-10-27): done.** Published after the owner's employer approved the outside-activity disclosure. The registry lists 2.0.2 as latest and active, with `websiteUrl` https://getcloseknit.com and the icon. 2.0.0 and 2.0.1 stay active. Keep the steps for the next version.

## Where things stand
- Registry (registry.modelcontextprotocol.io) lists `com.getcloseknit/close-knit` 2.0.0 and 2.0.1, both active. 2.0.1 points `websiteUrl` and `repository` at the private repo `github.com/bmsdave/close-knit-mcp`, so crawlers get a 404 there.
- `server.json` at the repo root is **2.0.2** (PR #381): `websiteUrl` https://getcloseknit.com, icon https://getcloseknit.com/icon.svg, no `repository`. It matches what production already serves: `serverInfo` in `initialize`, `/.well-known/mcp/server.json` and `/.well-known/mcp/server-card.json` (prod f0c0753d). A test keeps `server.json` equal to `api/area_api/mcp_server.py` (`SERVER_VERSION` and the related fields).
- MCP data is closed: `CLOSE_KNIT_MCP_DATA` is off, so every data tool answers `coming-soon` (FLAGS.md). Publishing doesn't change that. Opening the data is a separate owner decision.

## Steps
1. Check: `curl -s https://getcloseknit.com/.well-known/mcp-registry-auth` returns `v=MCPv1; k=ed25519; p=AxbV…` (the public key; `api/area_api/discovery.py`). Also check `jq .version server.json` on origin/main. If metadata changed since 2.0.2, bump the patch version in **both** `server.json` and `SERVER_VERSION`, ship, then publish.
2. Log in with the domain key. The key lives outside the repo at `~/.config/close-knit/mcp-registry-key.pem`. Never print it, never commit it, never paste it into chat:
   ```bash
   mcp-publisher login http --domain getcloseknit.com --private-key "$(openssl pkey -in ~/.config/close-knit/mcp-registry-key.pem -noout -text | awk '/priv:/{f=1;next} /pub:/{f=0} f' | tr -d ' :\n')"
   The hex must be 64 characters (`grep -A3` picks up `pub` here; checked 2026-10-26).
3. From the repo root on origin/main, run `mcp-publisher publish` (it reads `./server.json`).
4. Verify: `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=closeknit"` lists 2.0.2 as active with the new `websiteUrl` and icon.

## Do not
- Make `bmsdave/close-knit-mcp` public, claim or submit listings (Glama, Smithery, mcprush, mcp.so, PulseMCP) or turn on `CLOSE_KNIT_MCP_DATA`. Each needs its own owner decision.
- Delete or deprecate 2.0.0/2.0.1. The registry serves the latest version.

## Deferred levers (for later, each needs the owner)
A public GitHub repo (Glama licence and maintenance grades, mcp.so, the `repository` field), a public landing page for `websiteUrl`, claiming Glama (`/.well-known/glama.json`) and Smithery, and a 48×48 PNG icon (design board first).
