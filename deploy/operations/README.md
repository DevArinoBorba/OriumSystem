# deploy/operations — tooling de empacotamento/verificação de release (local, fail-closed)

Ownership: OpenCode (Fase 10). Sem rede/VPS/CI external/serviços. `deploy/production/**` é entrada (READONLY).

## Interface para QA/Futuros operadores

| Script | Função | Exit | Nota CLI |
|---|---|---|---|
| `ops-manifest.mjs` | gera `manifest.json` | 0 ok / 1 erro | `--out <file> [--env production] [--app-image <id>]` |
| `ops-preflight.mjs` | gates fail-closed | 0 ok / 1 fail | `--manifest <file> [--env] [--port N] [--blocked-ports a,b]` |
| `ops-release.mjs` | empacota bundle + tar.gz + índice | 0 ok / 1 fail | `[--env production] [--app-image <id>]` |
| `ops-rollback.mjs` | rollback aplicação (sem downgrade schema) | 0 ok / 1 fail | `[--to <releaseId>]` |
| `run-pipeline.mjs` | orquestra manifest→preflight→release | 0 allPass / 1 fail | `<env>` |
| `ops-config.mjs` | allowlist + denylist + padrões secrets (única fonte) | — | import |

Artefatos: `releases/<releaseId>/{bundle/,manifest.json,bundle.tar.gz}` + `releases/index.json` + `current.json` (rollback).

## Manifesto (alinhado a deploy/verification/manifest-validator.ts do QA)

`manifestVersion: "1.0"`, `releaseId`, `version`, `gitCommit` (null quando sem git — nunca inventar), `sourceTreeSHA256` (hex64, snapshot local), `createdAt` ISO, `targetEnvironment`, `appImage`, `targetSchemaVersion` (nome do migration .sql mais recente), `files[{path,sha256,sizeBytes}]`, `rollbackPolicy` (schemaDowngradeAllowed:false). Denylist: `.env*`, `*.pem/key/pkcs8/pfx/p12`, `*.dump/backup/bak`, tests/node_modules/.git/.local.

## Gates exercitados localmente (provas em .local/phase10/opencode/)

- MANIFEST_GENERATION, PREFLIGHT, RELEASE (pipeline PASS, 58 arquivos, bundle.tar.gz, 0 secrets) — exit 0.
- Negativos: `.env` → FORBIDDEN_FILE_DETECTED exit 1; hash adulterado → CHECKSUM_MISMATCH exit 1; rollback a release inexistente exit 1.
- Rollback positivo: current 24550 -> 24545, 58 arquivos verificados, sem downgrade de schema.

Reproduzir: `node deploy/operations/run-pipeline.mjs production`
