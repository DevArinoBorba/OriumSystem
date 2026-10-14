# Fase 6 — incremento 2: QA de identidade (RESULTADO QA)

Contrato: `docs/PHASE6-IDENTITY-IMPLEMENTATION-CONTRACT.md` (08/10/2026).
Autor do teste: Antigravity QA (herdado, transferido ao OpenCode p/ execução/ajuste); relatório consolidado por OpenCode. Sem dois builds/duas suítes concorrentes; executei serial.

## Suite
`tests/identity-audit.integration.test.ts` — 18 testes contra PostgreSQL real `orium_test` (5433).

## Resultado (rodada final após correções)
**18/18 PASS**, exit 0, 0 FAIL, 0 SKIP. Cobertura real por critério:

- **C1 (migração/schema/grants):** migração aditiva repetida preserva contas e eventos; colunas mínimas exatas; FKs limitadas a `subject→event (cascade)` (sem FK a `role`/`auth_user`); índices `(created_at DESC, id DESC)` e `(user_id, event_id)`; papel app `{SELECT,INSERT}` e `UPDATE/DELETE/TRUNCATE` negados em ambas tabelas; `prune_identity_events()` SECURITY DEFINER, search_path, `12 months`, `REVOKE EXECUTE FROM PUBLIC` + grant app; app incapaz de atualizar data/forçar exclusão recente. Ajuste mecânico: INSERT inválido com `id` (testava constraint de ação). **PASS.**
- **C2 (gravação transacional):** provisioning (actor NULL p/ bootstrap, admin em rota HTTP); role change + deactivation com before/after e contagem real de sessões revogadas; mudança semanticamente idêntica ainda é um evento com contagem real; negações não registram sucesso; `role_permissions_changed` com listas ordenadas/únicas, todos os membros como subjects e contagem real; recovery com reautenticação real, sem material de senha no evento/API. **PASS.**
- **C3 (rollback por falha de audit):** REVOKE INSERT temporário → `changeIdentity`, `changeRolePermissions`, `recoverUserAccess`, `provisionUser` rejeitados; rollback integral de role/sessoes/credencial; sem eventos de sucesso; sem mocks. **PASS.**
- **C4 (autorização/projeção):** admin vê tudo; colaborador só subjects próprios; filtro alheio 403; anônimo/inativo 401; sujeito histórico de policy não concedido a membro novo; promoção concede e demissão revoga; sem divulgação de outros sujeitos; sem email/name/subject/senha no corpo. **PASS.**
- **C5 (paginação):** keyset estável com empates reais (8 eventos compartilhando timestamp) e sem duplicações/omissões; filtros combinados; cursor inválido → 400 (agora inclui datas impossíveis de calendário — correção aplicada); cursor alargado de admin para colaborador não amplia escopo. **PASS.**
- **C6 (retenção):** boundary de calendário (±1 min de 12 meses) — só saem os expirados; cascade remove subjects; recentes intactos mesmo após prune; visibilidade independente da limpeza física; app incapaz de back-date/forçar exclusão. **PASS.**
- **C7 (concorrência real sob lock):** desativação serializada antes de write pendente o impede (403) e não registra evento; write serializado antes de revogação legitima-se e mantém evento; leitura revalida sob `IDENTITY_LOCK` (revogação primeiro → 401/403; leitura primeiro → preservada); demotion antes da revalidação reduz a escopo próprio. Sem sleeps como prova. **PASS.**

## Verificações de higiene
- `.local/phase6-identity-qa-cleanup.json`: 61 eventos removidos, 33 usuários removidos, 0 eventos/usuários órfãos, subjects órfãos = 0, permissões collaborator restauradas.
- Somente fixtures/events da própria execução ("identity-audit-…"); sem limpeza global; DEV intocado.
- Segredos não impressos (senha/hash/cookies nunca nos corpos de saída).

## Limites
- Sem capture visual/browser (incremento sem UI); sem E2E navegador declarado.
- Retenção física oportunista (sem agendamento contínuo — Fase10).

## Pendências p/ aceite Codex
- Revisão final do teste/código pelo Codex.
- DEV apenas em gate posterior, com backup e PORT_POLICY.
