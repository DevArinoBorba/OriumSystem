# Fase 6 — Auditoria READONLY: autorização/revogação das mutações de clientes

**Autor:** OpenCode (auditoria somente-leitura)
**Data:** 2026-10-08
**Fontes:** `apps/api/src/clients.ts` (lido integralmente), rotas de clientes em `apps/api/src/app.ts`, `apps/api/src/identity.ts` (`changeIdentity`, `IDENTITY_LOCK`, `authenticate`, `requirePermission`), trechos necessários de `materials.ts` (`revalidateActor`) e `demands.ts` (`revalidateActorInsideTransaction`) para comparação pontual.
**Método:** inventário READONLY; **nenhum** código/contrato/config/teste editado; **nenhum** build/suite/serviço executado. Classificação: **[FATO]** observado no código nesta rodada; **[HIPÓTESE]** sequência concorrente não provada (requer demonstração antes de virar achado de segurança); **[SUGESTÃO]** proposta; **[DECISÃO]** pendente.

> Escopo estrito: apenas autorização/revogação das mutações de clientes (`create/update/archive/restore`) e suas rotas. Leituras (`listClients`, `getClientById`) citadas só para completude da rota; não extrapoladas.

---

## 1. Inventário rotas × mutações (app.ts, símbolos atuais)

| Rota | Função | Perfil exigido (rota) | Revalidação na transação de escrita | Lock | Transação explícita |
| --- | --- | --- | --- | --- | --- |
| `POST /api/v1/clients` | `createClient` | `clients.write` | **ausente** | **ausente** | **nenhuma** (auto-commit) |
| `PATCH /api/v1/clients/:id` | `updateClient` | `clients.write` | **ausente** | **ausente** | **nenhuma** (auto-commit) |
| `POST /api/v1/clients/:id/archive` | `archiveClient` | `clients.archive` | **ausente** | **ausente** | **nenhuma** (auto-commit) |
| `POST /api/v1/clients/:id/restore` | `restoreClient` | `clients.archive` | **ausente** | **ausente** | **nenhuma** (auto-commit) |

- **[FATO]** Todas as rotas de mutação usam `requirePermission(identity, 'clients.write'|'clients.archive')` sobre a identidade **snapshot** retornada por `authenticate` no início da requisição (`app.ts` ≈ 230/237/245/253). `clients.write` e `clients.archive` estão em `adminPermissions` (`identity.ts`), portanto exigem também papel `administrator` via `requirePermission`.
- **[FATO]** `clients.ts` mutações: `createClient` (≈97–114, `INSERT … version=1`), `updateClient` (≈116–164, `UPDATE … WHERE id=$1 AND version=$2` com `version = version+1`), `archiveClient` (≈166–186, `SET archived_at=now(), version+1`), `restoreClient` (≈188–208, `SET archived_at=NULL, version+1`). **Nenhuma** abre `BEGIN`, **nenhuma** executa `pg_advisory_xact_lock` e **nenhuma** revalida o ator no banco — dependem exclusivamente do snapshot da rota.
- **[FATO]** Conflito de versão otimista existe (404/409 `CLIENT_VERSION_CONFLICT`), mas é controle de concorrência de **dado**, não de **autorização**.

---

## 2. Comparação pontual (apenas o necessário, sem extrapolar)

- **[FATO]** `materials.ts` mutações (`createMaterial`/`updateMaterial`/`archiveMaterial`/`restoreMaterial`) abrem `BEGIN` + `pg_advisory_xact_lock(IDENTITY_LOCK)` + `revalidateActor(client,userId,permission)` **dentro da transação** (≈313–316/456–459/604–607/673–676). **Clientes não fazem o equivalente.**
- **[FATO]** `demands.ts` mutações revalidam com `revalidateActorInsideTransaction(client,actorId,permission)` dentro da transação (ex. ≈395/472/542 `demands.write`, ≈631 `tasks.manage`, ≈780/832/892/1047 `tasks.execute`, ≈952 `tasks.review`). **Clientes não fazem o equivalente.**
- **Não extrapolado:** não afirmo aqui sobre rotas/abrange fora de clientes; esta comparação serve só para dimensionar a assimetria existente em relação aos outros módulos de escrita.

---

## 3. Sequência concorrente possível (HIPÓTESE, sem sequência demonstrável → não declarada como vulnerabilidade)

- **[HIPÓTESE]** `PATCH /api/v1/clients/:id` autenticado (T0) → desativação/demissão concorrente do autor via `changeIdentity` (T1) → `UPDATE client … version+1` auto-commit (T2). Como a mutação de cliente **não** usa `IDENTITY_LOCK` nem revalida o ator, não há serialização com a revogação: se T1 confirmar antes de T2, a escrita ainda persiste com autor já revogado. **Não testado/provado nesta rodada; exige sequência determinística para ser afirmado como achado.**
- O que **está** garantido: requisições iniciadas **após** a revogação falham em `authenticate` (sessão apagada / `u.active=false` → 401) ou em `requirePermission` (403) — revogação por requisição coberta (mesma mecânica já registrada na revisão de identidade).

---

## 4. Plano de teste com barreiras reais (sugestões; ordem de commits sem erro universal)

Princípio: mutação **já commitada antes da revogação é legítima**; mutação ainda não commitada quando a revogação confirma tem política a decidir. **Não** exigir erro universal para qualquer mutação anterior à revogação.

- **T-C1 (barreira pré-requisição — testável já, sem mudança em código):** criar sesão de admin A; `changeIdentity` desativa A (e apaga sessões); nova mutação de cliente via rota com sessão antiga → **401** (sessão não ressurge) e nova login de A → 403 (inativo). Confirma revogação pré-requisição.
- **T-C2 (barreira de permissão principal):** admin com `clients.write` mas **sem** `clients.archive` → `archive`/`restore` → 403; colaborador → 403 para todas as mutações; último admin ativo → 409 `LAST_ADMINISTRATOR` (herdado de `changeIdentity`, registrar como cobertura cruzada).
- **T-C3 (barreira intra-requisição — HIPÓTESE a demonstrar):** só com instrumentação determinística (ex.: segurar execução entre `requirePermission` e `updateClient`, ou driver concorrente com barreira explícita). Enquanto não provado, registrar como hipótese, **não** como falha. Se for adotado o padrão de materiais/demands (revalidação do ator na transação ou `IDENTITY_LOCK`), a expectativa deste teste passa a ser rejeição (401/403) no commit.
- **T-C4 (ordem de commits):** mutação de cliente commitada; somente depois revogação; asserir que a escrita persiste e **nenhum erro esperado a posteriori** (sem erro universal). Caso contrário, sem a ordem, resultado é indeterminístico — documentado como tal.
- **Riscos:** sem lock/transação, teste intra-requisição é flaky; forçar rejeição universal criaria exigência indevida (viola a diretriz "sem erro universal para mutação anterior revogação"). Decisão pendente: adotar revalidação intra-mutação (padrão de materiais/demands) ou aceitar janela documentada.

---

## 5. Resumo

Mutações de clientes autorizam **somente** no snapshot de `authenticate` via `requirePermission`, sem `BEGIN`, sem `IDENTITY_LOCK` e sem revalidação de ator na transação (assimetria frente a materiais e demandas). Revogação **pré-requisição** está coberta (401/403). Janela **intra-requisição** (revogação entre a autorização e o commit) é **hipótese não provada**, sem reivindicação de vulnerabilidade. Plano de teste T-C1/T-C2/C-C4 com barreiras reais e ordem de commits; T-C3 depende de instrumentação e decisão de política. **Nenhuma implementação/edição/execução foi feita (read-only).**
