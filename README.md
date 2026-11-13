# TotersLokalise MCP server

The official [Model Context Protocol](https://modelcontextprotocol.io) server
for TotersLokalise. It lets Cursor, Claude, and other MCP hosts discover projects,
export translations, and run the same reviewed import workflow as the dashboard.
Every call uses one organization API credential and its explicit scopes — it
never bypasses TotersLokalise authorization.

## Quick start

1. In TotersLokalise, open **Workspace administration → API credentials** and create a
   dedicated credential. Copy the access key and the one-time secret.
2. Add this to your MCP host configuration (Cursor, Claude Desktop, Claude Code,
   or any stdio MCP host):

```json
{
  "mcpServers": {
    "toterslokalise": {
      "command": "npx",
      "args": ["-y", "@totersapp/toterslokalise-mcp"],
      "env": {
        "TOTERSLOKALISE_ACCESS_KEY": "gl_live_…",
        "TOTERSLOKALISE_SECRET": "gl_secret_…"
      }
    }
  }
}
```

3. Ask your assistant to list TotersLokalise projects.

`npx` installs the published `@totersapp/toterslokalise-mcp` package (Node.js 20.19+).

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
| `source:write`      | Add or change source-language (English) text. Owners only. |

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
- `toterslokalise_create_keys` — create keys with their text in one call
  (write action), for example keys and strings read from a Figma design by the
  Figma MCP server. Values are per locale (`{ "en-US": "Pay now" }`); existing
  text is kept unless `existingValues: "overwrite"`; `dryRun: true` previews.
  Needs `imports:write`, plus `source:write` to write English.
  The result counts values (one key in one language): `new`, `updated`,
  `unchanged`, and `conflicts` (existing text that differs), with
  `existingText` saying whether that text was `kept` or `overwritten`.

### Figma → TotersLokalise

Connect both the Figma MCP server and this one in the same agent, then ask, for
example: "Read the Checkout frame in Figma, list each text layer with its key
name, and create those keys in TotersLokalise project `<id>` (namespace
`checkout`) with the English text. Do a dry run first."

### Single sign-on (Okta)

The MCP server calls `/api/v1/*` directly with the credential. If that path is
behind Okta, every call fails with "answered by a sign-in page": the platform
team must exempt `/toters-lokalise/api/v1/*` from Okta (the API checks the
credential itself).

Analysis never mutates translations. Approval requires the server-issued
`analysisHash` and `projectStateHash` plus a decision for every review-policy
conflict, so a stale or partial snapshot cannot be applied.

Full documentation, including Cursor and Claude setup, the analyze/approve/apply
workflow, and troubleshooting: the **API & MCP reference** in TotersLokalise
([Developer Hub → API reference](https://arcade.stage.toters-api.com/toters-lokalise/#/developers/api#mcp)).

## Releasing

```bash
npm version 0.2.2 --tag-version-prefix=""
git push origin main 0.2.2
```

The Release workflow tests the tag and publishes it to npmjs.com.
