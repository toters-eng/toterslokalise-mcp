# TotersLokalise MCP server

The official [Model Context Protocol](https://modelcontextprotocol.io) server
for TotersLokalise. It lets Cursor, Claude, and other MCP hosts discover projects,
export translations, and run the same reviewed import workflow as the dashboard.
Every call uses one organization API credential and its explicit scopes — it
never bypasses TotersLokalise authorization.

## Quick start

1. In TotersLokalise, open **Settings → Developer → API credentials** and create a
   dedicated credential. Copy the access key and the one-time secret.
2. Add this to your MCP host configuration (Cursor, Claude Desktop, Claude Code,
   or any stdio MCP host):

```json
{
  "mcpServers": {
    "toterslokalise": {
      "command": "npx",
      "args": ["-y", "@toters/toterslokalise-mcp"],
      "env": {
        "TOTERSLOKALISE_ACCESS_KEY": "gl_live_…",
        "TOTERSLOKALISE_SECRET": "gl_secret_…"
      }
    }
  }
}
```

3. Ask your assistant to list TotersLokalise projects.

`npx` installs the published `@toters/toterslokalise-mcp` package (Node.js 20.19+).

The server connects to the TotersLokalise API at
`https://arcade.stage.toters-api.com/toters-lokalise` by default. Set
`TOTERSLOKALISE_API_ORIGIN` to use another deployment, for example
`http://localhost:3000` when running the TotersLokalise backend locally.

## Credentials and scopes

| Scope               | Grants                                                |
| ------------------- | ----------------------------------------------------- |
| `projects:read`     | List projects in the credential organization.         |
| `translations:read` | Read translations and import sessions.                |
| `exports:read`      | Export JSON, Apple `.strings`, and Android XML.       |
| `imports:write`     | Analyze, approve, and cancel durable import sessions. |

Use only `projects:read`, `translations:read`, and `exports:read` for read-only
agents. Add `imports:write` only when the agent must import translations.
Production imports remain disabled and must go through promotion. Never use a
dashboard session credential here, and never commit or share the secret.

## Tools

- `toterslokalise_list_projects` — discover projects (paged).
- `toterslokalise_export_translations` — export filtered translations.
- `toterslokalise_analyze_import` — analyze up to 20 files without changing data.
- `toterslokalise_get_import_session` — poll a durable import session.
- `toterslokalise_list_import_items` — page through analyzed items.
- `toterslokalise_proceed_import` — apply an approved analysis (write action).
- `toterslokalise_cancel_import` — cancel a session before approval.

Analysis never mutates translations. Approval requires the server-issued
`analysisHash` and `projectStateHash` plus a decision for every review-policy
conflict, so a stale or partial snapshot cannot be applied.

Full documentation, including Cursor and Claude setup, the analyze/approve/apply
workflow, and troubleshooting: [`docs/MCP.md`](../../docs/MCP.md).

## Releasing

```bash
npm version 0.1.1 --tag-version-prefix=""
git push origin main 0.1.1
```

The Release workflow tests the tag and publishes it to npmjs.com.
