---
name: brunogen-api
description: >
  Use when working with Laravel, Express.js, or Go API projects and the user asks
  about endpoints, OpenAPI, Bruno collections, MCP servers, API testing, auth
  coverage, or validation gaps. Triggers: brunogen, test API, cek endpoint,
  openapi dari codebase, endpoint mana yang public, api-context, findings.json.
  Always refresh brunogen output before answering API questions.
---

# Brunogen API Skill

Treat brunogen output as the source of truth for API-related work in this repository.

## Before answering API questions

1. Run `brunogen doctor` to confirm framework detection.
2. Run `brunogen generate --format all` to refresh artifacts.
3. Read these files in order:
   - `.brunogen/ai/api-context.md`
   - `.brunogen/openapi.yaml`
   - `.brunogen/ai/findings.json`
4. Do not guess routes, request bodies, or auth rules from memory.

## When the user wants to test endpoints

- Prefer the Bruno collection in `.brunogen/bruno/`.
- Use environment variables from `brunogen.config.json` environments.
- Mention warnings from `findings.json` when a test may be misleading.

## When the user wants AI or MCP integration

- Use `.brunogen/ai/tools.json` for function/tool calling shapes.
- Use `.brunogen/mcp/` for Cursor or Claude Desktop MCP setup.
- Remind the user to run `npm install` inside `.brunogen/mcp` before starting the MCP server.

## When the user asks security or coverage questions

- Start from `.brunogen/ai/findings.json`.
- Highlight `UNAUTHENTICATED_ENDPOINT`, validation warnings, and OpenAPI consistency warnings.
- Point to the source file listed in each finding when available.

## Response rules

- Cite endpoint names with `METHOD /path` and `operationId`.
- If brunogen emitted a warning for an endpoint, say so explicitly.
- If generation failed or the framework is unsupported, say that before improvising.