# Brunogen AST Migration Progress

## Current State: Phase 1 + 2 (Express AST) — IN PROGRESS

## Completed
- [x] Added dependencies: @typescript-eslint/parser, eslint
- [x] Created `src/core/ast-types.ts` — shared AST type definitions
- [x] Created `src/adapters/express-ast.ts` — AST-based Express scanner (~950 lines)

## Next Steps
- [ ] Patch `src/core/pipeline.ts` to use `scanExpressProjectAst` instead of `scanExpressProject`
- [ ] Run tests against Express fixtures to verify identical output
- [x] Add fallback mechanism: if AST fails, try legacy regex parser
- [ ] Switch over to AST as default, keep regex as fallback
- [ ] Phase 3: Laravel AST (use `php-parser` package)
- [ ] Phase 4: Go AST (use `tree-sitter-go` via WASM)
- [ ] Phase 5: Remove old regex adapters, cleanup

## Notes
- Cron progress: every 15m reports via Telegram
- Direct commit to main (no PRs)
- TypeScript already compiling clean
