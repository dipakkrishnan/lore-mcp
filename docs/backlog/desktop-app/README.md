# desktop-app

Prefix: `APP`

Covers: the minimal Electron owner app, its embedded Pi runtime, the native
onboarding experience, local job visibility, and the Lore/Store views.

The app is an owner console over Lore's existing CLI, skills, SQLite store, and
deployed node. Buyer-facing MCP behavior stays under `mcp-server/` and
`monetization/`; core memory and publication behavior stays in its existing
component.
