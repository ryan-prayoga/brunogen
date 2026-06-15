# brunogen

[![npm version](https://img.shields.io/npm/v/brunogen)](https://www.npmjs.com/package/brunogen)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-2f855a)](https://nodejs.org/)
[![CI](https://github.com/ryan-prayoga/brunogen/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ryan-prayoga/brunogen/actions/workflows/ci.yml)

Brunogen scans a Laravel, Express.js, or Go API codebase, normalizes what it finds into OpenAPI, and emits a Bruno collection you can try immediately.

Laravel is the strongest path today, with materially richer request and response inference. Express.js and Go support are already usable for conventional codebases, but they remain more heuristic.

<table>
  <tr>
    <td align="center" valign="top">
      <strong>Laravel</strong><br />
      <a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/assets/preview-laravel.png">
        <img src="https://raw.githubusercontent.com/ryan-prayoga/brunogen/main/docs/assets/preview-laravel.png" alt="Laravel output preview" width="240" />
      </a><br />
      <sub>FormRequest + Resource response</sub><br />
      <sub><a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/laravel-happy-path/README.md">Open Laravel demo</a></sub>
    </td>
    <td align="center" valign="top">
      <strong>Express</strong><br />
      <a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/assets/preview-express.png">
        <img src="https://raw.githubusercontent.com/ryan-prayoga/brunogen/main/docs/assets/preview-express.png" alt="Express output preview" width="240" />
      </a><br />
      <sub>Mounted router + local response helper</sub><br />
      <sub><a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/express-happy-path/README.md">Open Express demo</a></sub>
    </td>
    <td align="center" valign="top">
      <strong>Go</strong><br />
      <a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/assets/preview-go.png">
        <img src="https://raw.githubusercontent.com/ryan-prayoga/brunogen/main/docs/assets/preview-go.png" alt="Go output preview" width="240" />
      </a><br />
      <sub>Gin bind + direct JSON response</sub><br />
      <sub><a href="https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/go-happy-path/README.md">Open Go demo</a></sub>
    </td>
  </tr>
</table>

## Quick Start

Best first run: start with Laravel if you want the most complete inference path in under a minute.

```bash
npm i -g brunogen
brunogen init
brunogen generate
```

Default output:

- `.brunogen/openapi.yaml`
- `.brunogen/bruno/`
- `.brunogen/ai/`
- `.brunogen/mcp/`

If you are testing from this repository checkout instead of an installed package, run `npm install`, `npm run build`, and `npm link` once from the repository root first.

## What You Get

- `openapi.yaml` generated directly from routes, handlers, controllers, and request/response patterns
- A ready-to-open Bruno collection under `.brunogen/bruno/`
- AI-ready context under `.brunogen/ai/` (`api-context.md`, `tools.json`, `findings.json`)
- A generated MCP server under `.brunogen/mcp/`
- Warnings for patterns Brunogen could not infer confidently

## Framework Paths

| Framework | Current fit | First place to try | Demo |
| --- | --- | --- | --- |
| Laravel | Strongest path today | `cd tests/fixtures/laravel && brunogen init && brunogen generate` | [Laravel demo](https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/laravel-happy-path/README.md) |
| Express | Useful, still heuristic | `cd tests/fixtures/express && brunogen init && brunogen generate` | [Express demo](https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/express-happy-path/README.md) |
| Go | Experimental | `cd tests/fixtures/gin && brunogen init && brunogen generate` | [Go demo](https://github.com/ryan-prayoga/brunogen/blob/main/docs/demo/go-happy-path/README.md) |

To refresh the checked-in demo snapshots after an intentional output change:

```bash
npm run demo:laravel
npm run demo:express
npm run demo:go
```

## Commands

- `init` creates a starter config in the current directory
- `generate` scans the current project and writes OpenAPI plus selected output formats
- `generate --format all` writes Bruno, AI context, and MCP output
- `watch` regenerates when supported source files change
- `validate` checks generated OpenAPI output
- `doctor` shows environment and framework detection details
- `skill install` installs the bundled `brunogen-api` Grok skill

## Works Best Today

- Laravel route scanning from `routes/*.php`, including groups, prefixes, middleware hints, and `apiResource`
- Laravel request inference from FormRequest rules, inline validation, and common manual accessors such as `query`, `header`, typed accessors, `has`, `filled`, `safe()->only(...)`, and `enum(...)`
- Laravel response inference for direct arrays, `response()->json(...)`, `noContent()`, same-controller helpers, `JsonResource`, `->additional(...)`, and common abort/error/not-found paths
- Express scanning for mounted routers, straightforward request access patterns, and local response helpers
- Go Gin, Fiber, and Echo scanning for conventional route registration and direct JSON responses
- Bruno export with environments, baseline auth support, and native response `example {}` blocks

## How It Works

```text
source code
  -> framework adapter
  -> normalized endpoint model
  -> openapi.yaml
  -> Bruno collection
  -> AI context
  -> MCP server
```

OpenAPI becomes the internal source of truth after scanning. Bruno, AI context, and MCP are output targets.

## Use With AI Agents

After `brunogen generate`, use these files as the API source of truth:

- `.brunogen/ai/api-context.md` for LLM-readable endpoint summaries
- `.brunogen/ai/tools.json` for function/tool calling shapes
- `.brunogen/ai/findings.json` for auth and validation findings
- `.brunogen/mcp/` for Cursor or Claude Desktop MCP integration

Install the bundled Grok skill globally:

```bash
brunogen skill install
```

For one API repository only:

```bash
brunogen skill install --target grok-project
```

Canonical skill source lives in `skills/brunogen-api/` inside this repository and npm package.

## Security Roadmap

Brunogen already maps API surfaces from source code. The next security-focused direction is to turn that inferred API surface into useful review and regression-test signals:

- detect undocumented or unexpectedly public routes
- infer auth and middleware coverage across Laravel, Express.js, and Go frameworks
- flag suspicious validation gaps around request bodies, query params, headers, and path params
- warn on sensitive config, secret, or environment references in API handlers
- generate Bruno negative/security test collections for common failure paths
- emit machine-readable findings that can be consumed in CI

See [SECURITY.md](https://github.com/ryan-prayoga/brunogen/blob/main/SECURITY.md) for reporting guidance and security scope.

## Read More

- [Detailed reference, examples, config, and support matrix](https://github.com/ryan-prayoga/brunogen/blob/main/docs/reference.md)
- [CHANGELOG.md](https://github.com/ryan-prayoga/brunogen/blob/main/CHANGELOG.md)
- [CONTRIBUTING.md](https://github.com/ryan-prayoga/brunogen/blob/main/CONTRIBUTING.md)
- [SECURITY.md](https://github.com/ryan-prayoga/brunogen/blob/main/SECURITY.md)
- [docs/release-checklist.md](https://github.com/ryan-prayoga/brunogen/blob/main/docs/release-checklist.md)
