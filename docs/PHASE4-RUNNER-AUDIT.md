# Fase 4 — Auditoria READONLY do runner QA e da suíte de integração

**Autor:** OpenCode (auditoria somente-leitura)
**Data:** 2026-10-06 → 2026-10-07
**Método:** revisão estática contra `docs/PHASE4-IMPLEMENTATION-CONTRACT.md` e o frontend real implementado (DashboardView/App/Header/DemandsView). Nenhum arquivo auditado foi editado; nenhuma suíte executada.

## Versões auditadas (hash/version/timestamp)

| Arquivo | SHA256 | Linhas | Timestamp (ini.) |
| --- | --- | --- | --- |
| `.local/phase4-qa-runner.mjs` | `FC5D52443E14C6E3CEC821CC175B9FF2674F9DC90526089EA300399EDDC13573` | 1024 | 2026-10-06 14:44:38 |
| `tests/dashboard.integration.test.ts` | `719B0C2A01A590467B4CDF25F8B03592FD3048819C11FB634B8FFE3211AE0270` | 822 | 2026-10-06 14:39:00 |

Versões finais (reverificação no fim desta rodada):

| Arquivo | SHA256 | Timestamp (fim) |
| --- | --- | --- |
| `.local/phase4-qa-runner.mjs` | `FC5D52443E14C6E3CEC821CC175B9FF2674F9DC90526089EA300399EDDC13573` | inalterado nesta auditoria |
| `tests/dashboard.integration.test.ts` | `719B0C2A01A590467B4CDF25F8B03592FD3048819C11FB634B8FFE3211AE0270` | inalterado nesta auditoria |

> Nota de versão: a nota restaurada documenta execução posterior com 9 PASS + 1 FAIL (P4-BR-KB) e reforços (destino exato tarefa/chamado, recusa de logs sem captura). Nesta auditoria foram lidos os arquivos com os hashes acima; um achado pode já estar corrigido em versão posterior — a coluna "versão" indica a que o achado se aplica.

## Achados (materiais, por arquivo)

### `.local/phase4-qa-runner.mjs` (versão FC5D52)

- **R1 — P4-BR-01 só valida presença de container, não conteúdo real (média).** O teste espera `.dashboard-section*` montado, mas não asserts corretamente 7 seções, nem títulos/carga/tabela das fixtures. Um painel renderizando vazio ou com erro silencioso passaria. *Versão FC5D52; nota posterior indica P4-BR-01 reforçado (métricas 7 seções + tabela de carga) — verificar versão atual.*
- **R2 — P4-BR-03 não distingue destino tarefa vs chamado (média).** O wait aguarda QUALQUER de `.demand-detail-view, .task-detail-view, #demand-detail-heading, .task-header, .task-detail-shell`. Abrir "Abrir tarefa" e cair no detalhe do chamado (ou vice-versa) passaria. *Versão FC5D52; nota posterior indica asserção estrita de destino (`.task-header h1` / `#demand-detail-heading`) — verificar versão atual.*
- **R3 — P4-BR-08 pode PASS com captura de console vazia (média).** `allCapturedLogs` vazio não casa o regex → PASS mesmo sem evidência de console coletada. Recomenda-se recusa explícita se nenhuma linha foi capturada (ou verificar existência de captura ativa antes de PASS). *Nota posterior indica recusa estrita implementada — provavelmente corrigido após FC5D52.*
- **R4 — seletor obsoleto `.task-detail-shell` no wait de P4-BR-03 (baixa, cosmético).** Não causa FAIL porque os fallbacks (`#demand-detail-heading`, `.task-header`) existem no frontend real; ruído de seletores.
- **Aspectos positivos verificados:** PORT_POLICY lida; leases Find-FreePort alocados/liberados; secret efêmero; readiness por `/health/ready`; guarda de quota de login (janela deslizante 65s) compartilhada entre API e portal; interceptor 500 restaurado antes do retry; teardown em `finally` com `taskkill /T`, liberação de leases e limpeza cirúrgica com contagem de órfãos exigindo 0; screenshots com registro honesto de timeout (não certifica UI por código).

### `tests/dashboard.integration.test.ts` (versão 719B0C)

- **R5 — `assignedTo).toBeNull()` em todo item de colaborador (baixa/média).** Linha 71 aplica `toBeNull()` também a itens `kind=demand`. Se o backend omitir `assignedTo` (undefined, permitido pelo schema `nullable().optional()`) em item de demanda, a asserção falha por falso negativo. Como o QA reportou 24/24 PASS, o backend envia `null` consistentemente; sugerir `== null` (aceitar null/undefined) para robustez em demanda, ou explicitar no contrato que itens de demanda também enviam `assignedTo: null`.
- **R6 — ordenação usa `throw new Error` em vez de `expect` (baixa, estilo).** Linha 786 lança throw em vez de `expect(...)` — válido (falha o teste), apenas estilo; não é PASS falso.
- **Aspectos positivos verificados:** schema oficial `dashboardResponseSchema`; anti-leak de chaves topo/seções/cliente/workload; janela de datas hoje/amanhã/+3 inclusivo/+4 exclusivo via `today` do servidor; demotion com invalidação de sessão; `remoteAddress` alternante cobre quota Better Auth por IP; limpeza em `afterAll` com `app.close()`/`pool.end()` em `finally`; senhas/secret randômicos (sem segredo fixo).

## Limitações honestas desta auditoria

- Revisão **estática**; não executou suites (proibido) e não certifica UI/E2E.
- Baseada nos hashes acima; versões posteriores podem já ter resolvido R1–R4/R5.
- Responsividade avaliada apenas pela lógica do runner (overflow scrollWidth/innersWidth em 390x844 e 1280x800); captura visual é evidência do QA, não desta auditoria.
