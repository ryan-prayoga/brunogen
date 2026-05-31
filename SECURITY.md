# Security Policy

## Supported Versions

Brunogen is currently pre-1.0. Security fixes are applied to the latest published version only.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately by opening a minimal advisory-style issue only if no sensitive details are included, or by contacting the maintainer directly through the GitHub profile listed on this repository.

Do not include secrets, private source code, production URLs, tokens, customer data, or exploit details in a public issue.

Useful report details:

- Brunogen version
- Node.js version
- Target framework: Laravel, Express.js, Go/Gin/Fiber/Echo, or other
- Minimal reproducible fixture
- Expected vs actual generated OpenAPI/Bruno output
- Whether the issue could hide, mislabel, or incorrectly generate a security-sensitive route

## Security Scope

In scope:

- Incorrect inference that hides protected or sensitive API routes
- Incorrect auth or middleware inference once implemented
- Generated Bruno collections that could encourage unsafe defaults
- Path traversal, unsafe file writes, or unexpected project-file access by the CLI
- Dependency vulnerabilities affecting CLI users

Out of scope:

- Vulnerabilities in analyzed third-party projects
- Issues requiring access to private code without a minimal reproducible fixture
- Social engineering, spam, or denial-of-service against project infrastructure

## Security Roadmap

Planned security-focused work:

- Infer auth and middleware coverage across Laravel, Express.js, and Go frameworks
- Flag undocumented or unauthenticated sensitive routes
- Detect common validation gaps from request/schema patterns
- Warn on suspicious config, secret, or environment references in API handlers
- Generate Bruno negative/security test collections
- Emit machine-readable findings for CI usage
