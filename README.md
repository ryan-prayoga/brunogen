# brunogen

[![CI](https://github.com/ryan-prayoga/brunogen/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ryan-prayoga/brunogen/actions/workflows/ci.yml)

Brunogen scans a Laravel, Express.js, or Go API codebase, normalizes what it finds into OpenAPI, and emits a Bruno collection you can try immediately.

Early public alpha. Laravel is the primary happy path today. Express.js and Go support exist, but remain experimental and heuristic.

CI runs `npm run verify` on pushes to `main` and on pull requests. That includes the Laravel golden snapshot test for the checked-in demo path.

## Install

```bash
npm i -g brunogen
```

## How It Works

```text
source code
  -> framework adapter
  -> normalized endpoint model
  -> openapi.yaml
  -> Bruno collection
```

OpenAPI is the internal source of truth after scanning. Bruno is the output target.

## Works Today

- Global CLI with `init`, `generate`, `watch`, `validate`, and `doctor`
- Laravel route scanning from `routes/*.php`
- Laravel route groups, prefixes, middleware-based auth hints, and `apiResource` expansion
- Laravel request schema inference from FormRequest rules and simple inline validation
- Bruno collection generation with environment files and baseline bearer/basic/api-key auth support
- OpenAPI generation and validation before export
- Express.js scanning in experimental mode for `express()`/`Router()`, mounted routers, basic handler imports, and heuristic body/query/header/response inference
- Go Gin, Fiber, and Echo scanning in experimental mode

## Laravel-First Quickstart

The current canonical happy path is the minimal Laravel fixture in `tests/fixtures/laravel`.
Curated generated snapshots for that path live in [docs/demo/laravel-happy-path](docs/demo/laravel-happy-path/README.md).

```bash
npm install
npm run build

cd tests/fixtures/laravel
node ../../../dist/cli.js generate
```

To refresh the checked-in Laravel demo snapshots after an intentional output change:

```bash
npm run demo:laravel
```

Expected result:

```text
Generated 5 endpoints.
OpenAPI: .../tests/fixtures/laravel/.brunogen/openapi.yaml
Bruno: .../tests/fixtures/laravel/.brunogen/bruno
```

The normal installed flow is the same:

```bash
brunogen init
brunogen generate
```

Default output:

- `.brunogen/openapi.yaml`
- `.brunogen/bruno/`

## Express Quickstart

The Express fixture used by the test suite lives in `tests/fixtures/express`.
It covers mounted routers, route chains, middleware-based auth hints, and basic body/query/header/response inference.

```bash
npm install
npm run build

cd tests/fixtures/express
node ../../../dist/cli.js generate
```

Expected result:

```text
Generated 3 endpoints.
OpenAPI: .../tests/fixtures/express/.brunogen/openapi.yaml
Bruno: .../tests/fixtures/express/.brunogen/bruno
```

## Example Input Project Shape

This is the minimal Laravel shape Brunogen currently handles well:

```text
app/
  Http/
    Controllers/
      SessionController.php
      UserController.php
    Requests/
      StoreUserRequest.php
routes/
  api.php
artisan
composer.json
```

## Example Output Tree

Generated from the Laravel fixture:

```text
.brunogen/
  openapi.yaml
  bruno/
    bruno.json
    environments/
      local.bru
    session/
      sessioncontrollerstore.bru
    user/
      usercontrollerindex.bru
      usercontrollerindexgetapiprojects.bru
      usercontrollershow.bru
      usercontrollerstore.bru
```

The same snapshot is also checked into:

- [output-tree.txt](docs/demo/laravel-happy-path/output-tree.txt)
- [openapi-snippet.yaml](docs/demo/laravel-happy-path/openapi-snippet.yaml)
- [usercontrollerstore.bru](docs/demo/laravel-happy-path/bruno/user/usercontrollerstore.bru)

## Example Generated OpenAPI

Real snippet from the generated Laravel fixture output:

```yaml
openapi: 3.1.0
paths:
  /api/users:
    post:
      operationId: usercontrollerStore
      summary: UserController::store
      tags:
        - User
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  maxLength: 255
                  type: string
                email:
                  format: email
                  type: string
                age:
                  nullable: true
                  minimum: 18
                  type: integer
              required:
                - name
                - email
      responses:
        "201":
          description: Inferred JSON response
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
                  data:
                    type: object
                    properties:
                      id:
                        type: integer
                      name:
                        type: string
                      email:
                        type: string
              example:
                message: User created
                data:
                  id: 1
                  name: Jane Doe
                  email: jane@example.com
      security:
        - bearerAuth: []
```

## Example Generated Bruno Request

Real snippet from the generated Laravel fixture output:

```bru
meta {
  name: usercontrollerStore
  type: http
  seq: 3
  tags: [
    User
  ]
}

post {
  url: {{baseUrl}}/api/users
  body: json
  auth: bearer
}

headers {
  accept: application/json
  content-type: application/json
}

auth:bearer {
  token: {{authToken}}
}

body:json {
  {
    "name": "",
    "email": "user@example.com",
    "age": 1
  }
}
```

## Example Config

```json
{
  "version": 1,
  "framework": "auto",
  "inputRoot": ".",
  "output": {
    "openapiFile": ".brunogen/openapi.yaml",
    "brunoDir": ".brunogen/bruno"
  },
  "project": {
    "version": "1.0.0",
    "serverUrl": "{{baseUrl}}"
  },
  "environments": [
    {
      "name": "local",
      "variables": {
        "baseUrl": "http://localhost:3000",
        "authToken": ""
      }
    },
    {
      "name": "prod",
      "variables": {
        "baseUrl": "https://api.example.com",
        "authToken": ""
      }
    }
  ],
  "auth": {
    "default": "auto",
    "bearerTokenVar": "authToken",
    "basicUsernameVar": "username",
    "basicPasswordVar": "password",
    "apiKeyVar": "apiKey",
    "apiKeyName": "X-API-Key",
    "apiKeyLocation": "header"
  }
}
```

## Support Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Laravel route scanning | Supported | Reads `routes/*.php` declarations |
| Laravel route groups and prefixes | Supported | Handles common `prefix`, `middleware`, and grouped routes |
| Laravel `apiResource` expansion | Supported | Common REST actions are expanded |
| Laravel FormRequest inference | Partial | `rules()` arrays are supported; complex dynamic rules are not |
| Laravel inline validation inference | Partial | Simple `$request->validate()` and `Validator::make()` arrays |
| Auth inference | Partial | Middleware and OpenAPI security are inferred heuristically |
| OpenAPI generation | Supported | OpenAPI is the normalized intermediate output |
| Bruno export | Supported | Collection, requests, environments, and baseline auth blocks |
| Express route scanning | Experimental | Handles `express()` / `Router()`, `use()` mounts, and `route()` chains |
| Express handler inference | Experimental | Heuristic request and response inference from straightforward handlers |
| Go Fiber scanning | Experimental | Route and request inference are heuristic |
| Go Gin scanning | Experimental | Route and request inference are heuristic |
| Go Echo scanning | Experimental | Route and request inference are heuristic |
| Go request schema inference | Experimental | Works for straightforward bind/body-parser patterns |
| Laravel response inference | Partial | Straightforward `return [...]`, `response()->json([...], status)`, and `noContent()` patterns |
| Express response inference | Partial | Straightforward `res.json()`, `res.send()`, `res.status(...).json()`, and `sendStatus()` patterns |
| Go response inference | Limited | Response helper inference is still heuristic and often generic |
| Watch mode | Supported | Regenerates on `.php`, `.go`, `.js`, `.cjs`, `.mjs`, and `.ts` changes |

## Known Limitations

- This is not production-hardened. It is an early public alpha.
- Laravel parsing is regex-driven, not full AST analysis.
- Express parsing is also regex-driven, not full AST analysis.
- Complex dynamic route declarations may be skipped with warnings.
- Complex Express router factories, metaprogrammed middleware, and indirect exports may be skipped with warnings.
- Complex Laravel validation rules, custom rule objects, and conditional rules are not fully inferred.
- Laravel response inference currently targets straightforward array and `response()->json()` return paths.
- Express request and response inference currently targets straightforward `req.body` / `req.query` access and direct `res.*()` calls.
- Go support is intentionally labeled experimental.
- Go route parsing can miss unusual middleware signatures or custom router abstractions.
- Go response schemas are best-effort and often generic around nested `data` payloads.
- Generated Bruno auth is baseline setup, not a complete auth flow engine.

## Roadmap

- Stabilize the Laravel path as the default demoable experience
- Broaden and harden the Express adapter without losing the current lightweight scanner model
- Improve Laravel and Go response inference without breaking the current OpenAPI-first pipeline
- Reduce Go false positives and document supported code patterns more precisely
- Add more canonical fixtures before broadening framework claims

## Release Hygiene

Useful checks before tagging:

```bash
npm run verify
```

Related docs:

- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/release-checklist.md](docs/release-checklist.md)

## npm Publishing

This repository includes a dedicated npm publish workflow at `.github/workflows/publish-npm.yml`.
It is designed for npm Trusted Publisher with GitHub Actions OIDC, so it does not need an `NPM_TOKEN`.

Trusted Publisher form values for the current repository:

- Publisher: `GitHub Actions`
- Organization or user: `ryan-prayoga`
- Repository: `brunogen`
- Workflow filename: `publish-npm.yml`
- Environment name: `npm`

Recommended release flow:

1. Update `package.json` version and changelog.
2. Push the commit to `main`.
3. Create or publish a GitHub Release for the version tag.
4. The `Publish To npm` workflow will run and publish `brunogen` to npm.

Notes:

- The workflow uses the GitHub Actions environment `npm`. If you want approvals or branch restrictions, configure that environment in GitHub repository settings.
- Keep the Trusted Publisher fields aligned exactly with the repository owner, repository name, workflow filename, and environment name above.
- This package is public and unscoped, so the workflow publishes the existing `brunogen` package name from `package.json`.
- `.github/workflows/publish-github-packages.yml` remains the separate workflow for GitHub Packages.
