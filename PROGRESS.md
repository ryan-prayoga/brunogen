# Brunogen AST Migration Progress

## Current State

Express AST scanning is available as an experimental path behind
`BRUNOGEN_EXPERIMENTAL_EXPRESS_AST=1`.

The default Express scanner remains the mature regex-based adapter. When the
experimental AST scanner is enabled through the pipeline and fails, Brunogen
falls back to the default regex scanner.

## Completed

- [x] Added dependencies: `@typescript-eslint/parser` and `eslint`
- [x] Created `src/core/ast-types.ts` for shared AST parsing types
- [x] Created `src/adapters/express-ast.ts` as the experimental Express AST scanner
- [x] Reused the default Express handler inference path from the AST route scanner
- [x] Wired `src/core/pipeline.ts` to enable the AST scanner via `BRUNOGEN_EXPERIMENTAL_EXPRESS_AST=1`
- [x] Added fallback from AST scanning to the default regex scanner
- [x] Added Express AST regression and demo snapshot coverage
- [x] Added route-chain parity coverage for same-line `router.route(...).get(...)` declarations
- [x] Added aliased router export coverage for namespace imports
- [x] Added default export and CommonJS object export router mount coverage

## Next Steps

- [ ] Keep the regex-based Express scanner as default until AST output parity is broad enough for real projects
- [ ] Expand Express AST fixtures around more dynamic import/export edge cases before making it the default path
- [ ] Consider Laravel AST only after the current Laravel output contract is protected by enough fixtures
- [ ] Consider Go AST only after deciding whether the added parser/runtime weight is worth it for the npm package
- [ ] Remove old regex adapters only if AST coverage is demonstrably stronger and package size stays within the guardrail

## Notes

- `npm run verify` is the canonical local and CI verification command.
- The npm package size guard currently expects the unpacked package to stay under 1 MB.
