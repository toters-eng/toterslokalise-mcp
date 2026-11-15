# Lingo Rider MCP server

The official [Model Context Protocol](https://modelcontextprotocol.io) server
for Lingo Rider (technical name `toterslokalise`). It lets Cursor, Claude, and other MCP hosts discover projects,
download app-ready translation files, and run the same reviewed import workflow as the dashboard.
Every call uses one organization API credential and its explicit scopes — it
never bypasses Lingo Rider authorization.

## Quick start

1. In Lingo Rider, open **Workspace administration → API credentials** and create a
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

3. Ask your assistant to list your Lingo Rider projects.

`npx` installs the published `@totersapp/toterslokalise-mcp` package (Node.js 20.19+).

The server connects to the Lingo Rider API at
`https://arcade.stage.toters-api.com/toters-lokalise` by default. Set
`TOTERSLOKALISE_API_ORIGIN` to use another deployment, for example
`http://localhost:3000` when running the Lingo Rider backend locally.

## Credentials and scopes

| Scope               | Grants                                                |
| ------------------- | ----------------------------------------------------- |
| `projects:read`     | List projects in the credential organization.         |
| `translations:read` | Read translations and import sessions.                |
| `exports:read`      | Export app files: iOS, Android, PHP, JSON, xcstrings, CSV, Excel. |
| `imports:write`     | Analyze, approve, and cancel durable import sessions. |
| `source:write`      | Add or change source-language (English) text. Owners only. |

Use only `projects:read`, `translations:read`, and `exports:read` for read-only
agents. Add `imports:write` only when the agent must import translations.
Production imports remain disabled and must go through promotion. Never use a
dashboard session credential here, and never commit or share the secret.

## Tools

- `toterslokalise_list_projects` — discover projects (paged).
- `toterslokalise_export_files` — download app-ready files, the same as the
  Export screen: iOS `.strings`/`.stringsdict`, Android `strings.xml`, PHP, JSON,
  xcstrings, CSV or Excel, every language at once, with `{0}` placeholders
  converted (`%@` on iOS, `%s` on Android). Pass `outputDir` (relative to the
  current project, e.g. `ios/Resources`) to write the files, ZIPs unpacked;
  without it the text files are returned for review. Options match the export
  screen: `locales`, `namespaces`, `tags`, `fileName` pattern, `missing`,
  `keyCase`, `keyQuotes`, `statuses` (published by default). Needs `exports:read`.
- `toterslokalise_export_translations` — read filtered translations as JSON,
  `.strings` or XML (one language per call, placeholders as written).
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

### Figma → Lingo Rider

Connect both the Figma MCP server and this one in the same agent, then ask, for
example: "Read the Checkout frame in Figma, list each text layer with its key
name, and create those keys in Lingo Rider project `<id>` (namespace
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
workflow, and troubleshooting: the **API & MCP reference** in Lingo Rider
([Developer Hub → API reference](https://arcade.stage.toters-api.com/toters-lokalise/#/developers/api#mcp)).

## Releasing

```bash
npm version 0.3.1 --tag-version-prefix=""
git push origin main 0.3.1
```

The Release workflow tests the tag and publishes it to npmjs.com.
