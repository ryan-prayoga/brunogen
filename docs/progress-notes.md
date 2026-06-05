# Progress Notes

## 2026-03-25

Initial contract for `brunogen`:

- Config contract:
  - `version`: currently `1`
  - `framework`: `auto | laravel | gin | fiber | echo | express`
  - `inputRoot`: source project root, defaults to `.`
  - `output.openapiFile`: normalized OpenAPI output path
  - `output.brunoDir`: generated Bruno collection directory
  - `project.name`, `project.version`, `project.serverUrl`
  - `environments[]`: generated Bruno environments with variable maps
  - `watch.include[]`, `watch.exclude[]`: source globs watched by `brunogen watch` and default ignored generated/vendor directories
  - `auth`: baseline auth variable names, API key placement defaults, and bearer middleware hint patterns
- Normalized model contract:
  - Framework adapters emit a shared `NormalizedProject`
  - `NormalizedProject.endpoints[]` is the framework-agnostic route inventory
  - Endpoint request bodies and parameters use OpenAPI-compatible schema fragments
  - Endpoint responses may now include optional JSON content schema/example metadata
  - Warnings are accumulated per scan/generation step so partial output is preferred over hard failures

Any future change to either contract must update this file.
