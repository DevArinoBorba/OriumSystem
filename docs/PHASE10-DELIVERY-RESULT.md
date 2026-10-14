# PHASE10-DELIVERY-RESULT.md — deploy/operations/ (OpenCode), Janela 2 corrigida

**Data:** 14/10/2026 · **Ator:** OpenCode · **Contrato:** docs/PHASE10-WINDOW2-CONTRACT.md §2.1
**Ordem de aplicação:** correções fraca→forte; nenhum serviço/rede/VPS/CI externo executado. `deploy/production/**` READONLY (entrada). Sem segredos no bundle nem neste relatório.

## Scripts entregues (deploy/operations/)

| Script | Função | Fail-closed |
|---|---|---|
| `ops-config.mjs` | allowlist + denylist + padrões de segredo (fonte única) | import |
| `ops-util.mjs` | walk/glob/sha256/sourceTreeSHA256 | — |
| `ops-manifest.mjs` | gera manifest (rollbackPolicy incluído) | exit≠0 em erro |
| `ops-preflight.mjs` | gates fail-closed (denylist, integridade, ambiente, porta) | exit 1 em qualquer gate |
| `ops-release.mjs` | empacota bundle + tar.gz + índice | tar falhou → exit 1 |
| `ops-rollback.mjs` | rollback aplicação (sem downgrade schema; sem candidato → exit 1) | exit 1 |
| `run-pipeline.mjs` | orquestra manifest → preflight → release | exit≠0 se qualquer gate falhar |
| `package.json` | declara @orium/operations (ESM, zero deps) | — |
| `README.md` | interface para QA/operadores + provas | — |

## Manifesto (schema compatível com deploy/verification/manifest-validator.ts + delta coordenado)

`manifestVersion:"1.0"`, `releaseId`, `version`, `gitCommit` (null quando sem git — nunca inventar), `sourceTreeSHA256` (hex64), `createdAt` ISO, `targetEnvironment`, `appImage`, `targetSchemaVersion` (= nome do migration .sql mais recente), **`rollbackPolicy:{ schemaDowngradeAllowed:false, keepBackups:true }`**, `files[{path,sha256,sizeBytes}]`. Denylist: `.env*`, `*.pem/key/pkcs8/pfx/p12`, `*.dump/backup/bak`, tests/node_modules/.git/.local.

## Resultados reais dos gates (Janela 2 regenerada)

- **Pipeline local PASS** (exit 0): MANIFEST_GENERATION → PREFLIGHT → RELEASE, **58 arquivos**, `bundle.tar.gz` (150.783 bytes), schema alvo `0005_notifications.sql`, `rollbackPolicy` persistido em `manifest.json`. Artefato `.local/phase10/opencode/pipeline-result.json`.
- **Rollback positivo** (exit 0): `release-20261014124550-e558ed3b122d -> release-20261014124545-e558ed3b122d`, 58 arquivos verificados, `current.json` atualizado, sem downgrade de schema.
- **Gates negativos (failure-exit provado, todos exit 1):**
  - `.env` no manifesto → `FORBIDDEN_FILE_DETECTED` (exit 1) — `.local/phase10/opencode/manifest-negative-forbidden.json`.
  - hash adulterado → `CHECKSUM_MISMATCH` (exit 1) — `.local/phase10/opencode/manifest-negative-checksum.json` (size real 1473, hash real divergente).
  - rollback a release inexistente → exit 1.
  - rollback sem candidato anterior → exit 1 (correção §2.1.3).
- **Secrets-excluded no bundle real:** 0 arquivos env-like, 0 hits de conteúdo secreto em 58 arquivos (varredura SHA-256).

## Limites reais (não declarados como concluídos)

- CI cloud e push dependem do repositório/provedor do responsável; YAML descritivo em `.github/workflows/phase10-local-gates.yml` não aprova CI.
- Rollback exercitado localmente (ponteiro `current.json`) — aplicação real na VPS depende de gate de usina e do fechamento conjunto; **nenhuma mutação VPS** nesta tarefa.
- `targetSchemaVersion` é `0005_notifications.sql` (migração mais nova presente); o deploy VPS real já a aplicou (inventário da Janela 1).
- Manifesto com `gitCommit: null` (workspace sem `.git`); `sourceTreeSHA256` é o snapshot local determinístico.

## Reproduzir

```
node deploy/operations/run-pipeline.mjs production
node -e "const i=require('./deploy/operations/releases/index.json');console.log(i.releases.at(-1))"
```
