# Fase 6 — Auditoria READONLY de identidade e revogação concorrente

**Autor:** OpenCode (auditoria somente-leitura)
**Data:** 2026-10-08 (revisão aplicada conforme feedback do Codex em 2026-10-08)
**Fontes:** `docs/PHASE6-IMPLEMENTATION-CONTRACT.md` (seções "Decisões confirmadas", "Incrementos seguintes", "Dependências externas e critérios de conclusão"), `apps/api/src/identity.ts`, `apps/api/src/auth.ts`, `apps/api/src/recovery.ts`, `apps/api/src/app.ts`, `apps/api/src/materials.ts`, `apps/api/src/demands.ts`.
**Método:** conferência de contrato × guardas atuais; **sem implementar, editar, testar ou executar serviços.** Classificação: **[FATO]** observado no código nesta rodada; **[HIPÓTESE]** não investigado (requer verificação antes de qualquer afirmação de vulnerabilidade); **[SUGESTÃO]** proposta para escopo próprio; **[DECISÃO]** pendente de definição.

> **Correção aplicada (feedback Codex):** a L2 original generalizava indevidamente que mutações de demandas/tarefas/materiais dependem só do snapshot inicial de `authenticate`. Verificado que as mutações revalidam o ator **dentro da transação** (ver §2/§3). Esta rodada delimita o risco por símbolo/lock concreto e marca como hipótese o que não foi investigado.

---

## 1. Escopo da conferência (contrato)

- Seção "Decisões confirmadas": Bitwarden oficial; **hospedagem posterior** por decisão do responsável (não provisionar nesta fase; homologação externa pendente da instância futura); referências somente admin; atribuição de tarefa não concede acesso; nenhum valor de segredo/token/chave/sessão do cofre no banco, API, logs ou frontend.
- Seção "Incrementos seguintes": auditoria de identidade, MFA e proteção de textos livres **precisam de escopo próprio antes de implementação**; proibido persistir segredo/senha/cookie/token/corpo de login/e-mail de tentativa inexistente/IP/user-agent por conveniência.
- Seção "Dependências externas e critérios de conclusão": conclusão exige *auditoria e revogação concorrente* com evidência real.

---

## 2. Guardas existentes verificadas nesta rodada

### Auth / identidade (fresco por requisição, sem cookie-cache)
- **[FATO]** `identity.ts` `IDENTITY_LOCK = 712041` (advisory `pg_advisory_xact_lock`) serializa mutações de identidade em transação; `serializeIdentity` (fila por pool) evita exaurir o pool durante sign-in.
- **[FATO]** `identity.ts` `authenticate`: única `UPDATE` condicional sobre `auth_session`/`auth_user` (`u.active=true`, `expires_at > now()`, `created_at > now() - 7 days`, `last_seen_at > now() - 12 hours`); sem linha → sessão apagada + 401. Identidade/roles/permissões são re-derivadas do banco a cada requisição (`publicIdentity` lê `auth_user`, `user_role`, `role_permission`).
- **[FATO]** `auth.ts`: sessão 7d absoluta, `disableSessionRefresh`, `cookieCache.enabled=false` (sem identidade em cookie), cookie `httpOnly`+`sameSite=lax`; rate-limit 30/60s global e 5/60s em sign-in; hook de criação de sessão bloqueia usuário inativo.
- **[FATO]** `identity.ts` `changeIdentity`: re-checa admin dentro do lock; guarda `LAST_ADMINISTRATOR` (409) ao desativar/demover o único admin ativo; `DELETE FROM auth_session WHERE user_id=$1` **apaga todas as sessões** do alvo atomicamente com a mudança.
- **[FATO]** `identity.ts` `changeRolePermissions`: guardas `ADMIN_PERMISSIONS_REQUIRED` (rolo admin nunca perde permissão de fundação → evita self-lockout) e `ADMIN_PERMISSIONS_ONLY` (collaborator limitado); **apaga sessões de todos os membros do papel** na mudança de política.
- **[FATO]** `recovery.ts` `recoverUserAccess` é **CLI-only** (importado em `cli.ts`, sem rota HTTP): exige admin ativo com `roles.manage`, reautentica por senha do admin (`verifyPassword`), trava alvo `FOR UPDATE`, recusa alvo inativo e credencial ambígua, atualiza hash e `DELETE FROM auth_session WHERE user_id=$1`, tudo sob o mesmo lock de identidade. Não persiste e-mail de tentativa nem corpo de login.
- **[FATO]** `app.ts` não monta router wildcard de auth; único ponto é `POST /api/v1/auth/sign-in/email` sob `serializeIdentity` + advisory lock.

### Revalidação do ator dentro da transação nas mutações de negócio
- **[FATO]** `materials.ts` `revalidateActor(client, userId, permission)` consulta `auth_user` (active) + `user_role` + `role_permission` no mesmo `client` da transação e lança 401/403 na hora. Mutações (`createMaterial`, `updateMaterial`, `archiveMaterial`, `restoreMaterial`) abrem `BEGIN` + `pg_advisory_xact_lock(IDENTITY_LOCK)` + `revalidateActor(...)` **dentro da transação** (linhas atuais: create ≈313-316, update ≈456-459, archive ≈604-607, restore ≈673-676).
- **[FATO]** `demands.ts` `revalidateActorInsideTransaction(client, actorId, permission)` revalida `auth_user.active` + `role_id` + `role_permission` dentro da transação e lança 401/403. Chamado em todas as mutações de demandas/tarefas (ex.: ≈395/472/542 `demands.write`, ≈631 `tasks.manage`, ≈780/832/892/1047 `tasks.execute`, ≈952 `tasks.review`, ≈1099+ `tasks.manage`; leituras também revalidam autor — ex. linha 1563 com `requiredPerm`).

**Avaliação:** revogação de sessão é atômica e acoplada a desativação/demissão/recuperação e a mudança de política por papel; identidade e permissões são revalidadas **por requisição e dentro da transação de mutação** (materiais sob advisory lock de identidade; demandas/tarefas revalidando o ator na transação). Adequado ao contrato até aqui; as lacunas abaixo são para os escopos próprios ainda não definidos.

---

## 3. Lacunas para auditoria de identidade

### L1 — Ausência de trilha de auditoria persistente (maior lacuna) **[FATO + SUGESTÃO]**
- **[FATO]** Nenhuma tabela registra eventos de identidade: `provisionUser`, `changeIdentity`, `changeRolePermissions` e `recoverUserAccess` mutam `auth_user`/`user_role`/`role_permission`/`auth_session` **sem nenhum INSERT de auditoria**. `RecoveryReceipt` é devolvido no processo e descartado — não persiste.
- **[SUGESTÃO]** Para "auditoria de identidade" (escopo próprio, contrato), implementar tabela transacional de eventos (actor, target, action, before/after, `at`) escrita dentro das mesmas transações sob `IDENTITY_LOCK`, com controle de leitura por permissão e política de retenção/sanitização alinhada à proibição de persistir PII/segredo.
- **[DECISÃO]** Categorias, retenção e quem pode ler ainda não definidas.

### L2 — Janela de revogação concorrente: delimitada por símbolo/lock, não generalizada
- **[FATO (limite conhecido)]** Quem **revalida competentemente dentro da transação** (materiais sob `IDENTITY_LOCK`; demandas/tarefas com `revalidateActorInsideTransaction`; identidade sob `IDENTITY_LOCK`) está fora desta janela para a permissão que revalidam na escrita.
- **[HIPÓTESE (não investigado nesta rodada)]** Somente endpoints que **autenticam mas não revalidam na transação de escrita** poderiam ter janela entre a validação inicial de `authenticate` e o `COMMIT`. Não foi feito um inventário exaustivo de rotas para identificar os que revalidam vs os que dependem só do snapshot — **sem essa sequência demonstrável, não se declara vulnerabilidade.** Registrar como item de verificação para a auditoria concorrente.
- **[SUGESTÃO]** Para "revogação concorrente" (critério de conclusão do contrato), auditoria por símbolo: por cada rota de mutação, confirmar se há revalidação do ator dentro da transação e sob qual lock/snapshot; decisão explícita sobre janela intra-requisição em rotas que só validam o snapshot inicial.
- **[DECISÃO]** Política para janela residual (aceitar documentada vs revalidar) ainda não definida.

### L3 — MFA e gestão de sessões ativas **[FATO + DECISÃO]**
- **[FATO]** Não há plugin 2FA/TOTP em `auth.ts`; não há rota de listagem/revogação de sessões ativas pelo usuário.
- **[DECISÃO]** MFA é escopo próprio (contrato) — pendente; gestão de sessões próprias não consta do contrato atual. Não implementar.

---

## 4. Proposta mínima de testes/riscos (sugestões para suíte futura, não implementadas)

- **T1 (auditoria):** alterar papel → desativar user → mudar `role_permission` → `recoverUserAccess`, e asserter que cada um gera evento persistido com actor/target/before/after; usuário não-admin não grava nem lê.
- **T2 (revogação concorrente):** testar por símbolo — para cada mutação, resolver se revalida na transação (materiais: `revalidateActor`; demandas/tarefas: `revalidateActorInsideTransaction`) e asserir que desativação/demissão concorrente acarreta 401/403 no commit real; rotas sem revalidação na transação ficam marcadas como hipótese a confirmar antes de qualquer afirmação.
- **T3 (revogação de sessão):** sessão existente do desativado/demovido → próxima requisição 401; mudança de `role_permission` invalida sessões de todos os membros (contagem de `auth_session`).
- **T4 (recovery hardness):** admin sem `roles.manage`, senha errada, alvo inativo, credencial ambígua → falha; sessões do alvo = 0 após recuperação; nenhum e-mail/corpo de login persistido.
- **Riscos:** trilha de auditoria sem transação → inconsistência; revalidação concorrente sem política → custo/perf ou permissão efêmera; persistência inadvertida de PII/segredo → viola obrigação do contrato.

---

## 5. Resumo

Guardas atuais cobrem revogação de sessão atômica, identidade fresca por requisição, revalidação de ator dentro da transação (materiais sob `IDENTITY_LOCK`; demandas/tarefas via `revalidateActorInsideTransaction`) e isolamento CLI do recovery. Lacunas para os escopos próprios do contrato: **L1** sem trilha persistente de eventos de identidade; **L2** ausência de inventário exaustivo rota-a-rota de revalidação na transação (tratado como hipótese; sem vulnerabilidade declarada); **L3** MFA/sessões ativas pendentes de decisão. Nenhuma implementação/edição foi feita (read-only).
