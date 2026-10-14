# Relatório de Revisão de Segurança — Fase 2A (Clientes: Escopo e Equipe)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-14  
**Escopo:** Auditoria READONLY de `db/migrations/0007_phase2a_clients_scope_team.sql`, `apps/api/src/migrate.ts`, `apps/api/src/clients.ts`, `apps/api/src/app.ts` e `tests/phase2a-clients-scope-team.integration.test.ts`.

---

## 1. Migração SQL: `0007_phase2a_clients_scope_team.sql`

**Status:** APROVADO / SEGURO

- **Grants Mínimos:** O bloco `DO $$` concede apenas `SELECT, INSERT, UPDATE, DELETE` nas novas tabelas (`client_team_member`, `client_scope_item`) condicionado à existência de `orium_app`. Sem `TRUNCATE`, `SUPERUSER` ou concessões em massa. ✓
- **Índices:** Todos com `CREATE INDEX IF NOT EXISTS`. ✓
- **Tabelas com Constraints SQL:** `client_team_member` usa `PRIMARY KEY (client_id, user_id, functional_role)` com `ON DELETE CASCADE` e `RESTRICT` por coluna; `client_scope_item` inclui checks positivos em `contracted_quantity`, `sla_business_days` e `sla_hours`. ✓
- **Permissões RBAC inseridas:** `clients.read.assigned` criada para colaborador e administrador; `clients.manage` e `clients.team.manage` exclusivamente para administrador. `ON CONFLICT DO NOTHING` preserva idempotência. ✓

## 2. Migração em `migrate.ts`

**Status:** APROVADO

- Validação do hostname e credenciais (`orium_migrator`) antes de aplicar migração.
- Grants pós-migração cobrem as novas tabelas (`client_team_member`, `client_scope_item`) no `GRANT` geral, e as tabelas de identidade/notificação mantêm políticas restritivas preexistentes (append-only para `identity_event`; `UPDATE(read_at)` apenas para `notification`). ✓

## 3. Controle de Acesso Row-Level RBAC em `clients.ts`

**Status:** APROVADO / SEGURO

- **`resolveClientReadScope`:** Diferencia explicitamente entre permissão `clients.read` (acesso global) e `clients.read.assigned` (acesso restrito). Se nenhuma presente: `AppError 403`. ✓
- **`assertUserAllocatedToClient`:** Verifica vinculação do usuário ao cliente via três caminhos seguros: `account_manager_user_id`, `client_team_member` e `task.assigned_to_user_id`. Qualquer falso retorna `AppError 403`. ✓
- **`listClients`:** Quando escopo `assigned`, injeta condição SQL parametrizada via `$N` — sem concatenação direta de input não higienizado. Pesquisa por texto usa `ESCAPE '\\'` contra injeção. ✓
- **`getClientById`:** Quando escopo `assigned`, chama `assertUserAllocatedToClient` antes de buscar dados. Resultado 404 para clientes genuinamente inexistentes, 403 para acesso negado — sem vazar existência do registro restrito. ✓
- **Mutações de Clientes (`createClient`, `updateClient`, `archiveClient`, `restoreClient`):** Todas abrem `BEGIN` + `pg_advisory_xact_lock(IDENTITY_LOCK)` + `revalidateActor` com as permissões exigidas (`clients.write + clients.manage` para criar/atualizar, `clients.archive` para arquivar/restaurar). ✓
- **`revalidateActor` (local em `clients.ts`):** Agrega roles e permissions do usuário via query no mesmo `PoolClient` dentro da transação. Verifica ativo, permissão requerida e, para permissões admin-only, papel `administrator`. ✓
- **Gestão de equipe (`upsertClientTeamMember`, `removeClientTeamMember`):** Exigem `clients.team.manage` com lock transacional. Validam existência do cliente e do usuário alvo antes de operar. ✓
- **Gestão de scope (`createClientScopeItem`, `updateClientScopeItem`, `deleteClientScopeItem`):** Exigem `clients.manage`. Verificam `client_id` antes de escrever. `updateClientScopeItem` usa controle de versão otimista com resposta `409` para conflito. ✓

## 4. Testes de Integração: `phase2a-clients-scope-team.integration.test.ts`

**Status:** APROVADO

- Teste 3 cobre o isolamento Row-Level RBAC com quatro cenários: colaborador vê apenas cliente alocado, recebe 403 em cliente não alocado (sem vazar `briefingSummary` restrito), colaborador sem alocação recebe 403, e revogação imediata de visibilidade ao remover membro da equipe. ✓
- Cleanup cirúrgico usando prefixo único (`p2a-`) e transação com `IDENTITY_LOCK`, sem afetar dados de outros testes. ✓
