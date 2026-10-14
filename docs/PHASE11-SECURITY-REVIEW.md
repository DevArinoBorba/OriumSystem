# Relatório de Revisão de Segurança — Fase 11 (Refinamento: Templates e Relatórios)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-14  
**Escopo:** Auditoria de segurança e práticas SQL (READONLY) dos artefatos da Fase 11 (`db/migrations/0006_refinement_templates_reports.sql`, `apps/api/src/templates.ts`, `apps/api/src/reports.ts` e rotas em `apps/api/src/app.ts`).

---

## 1. Auditoria da Migração SQL (`0006_refinement_templates_reports.sql`)
- **Status:** **APROVADO / SEGURO**
- **Verificações:**
  - *Índices:* Utiliza `CREATE INDEX IF NOT EXISTS` em todas as definições de índice, evitando falhas de concorrência e re-execução.
  - *Privilégios (Grants Mínimos):* O bloco `DO $$` confere explicitamente apenas `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ... TO orium_app` condicionado à existência do papel `orium_app`. Não concede privilégios perigosos como `TRUNCATE`, `SUPERUSER`, `CREATE` ou permissões em massa.

## 2. Controle de Acesso e RBAC em Templates (`/api/v1/demand-templates`)
- **Status:** **APROVADO / SEGURO** (`apps/api/src/templates.ts` e `apps/api/src/app.ts`).
- **Verificações:**
  - *Leitura (`GET /api/v1/demand-templates` e `/:id`):* Requer autenticação e a permissão `demands.read`. Administradores visualizam todos os templates (ativos e inativos); colaboradores visualizam estritamente templates ativos (`active = true`), prevenindo vazamento de rascunhos ou templates desativados.
  - *Escrita de Templates (`POST` / `PATCH`):* Requer autenticação, permissão `demands.write` **e** o papel obrigatório `administrator` (`if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN')`).
  - *Instanciação (`POST /api/v1/demand-templates/:id/instantiate`):* Exige `demands.write`, valida a existência e atividade do cliente sob lock transacional (`FOR SHARE`), valida o template ativo, impede instanciar templates vazios e gerencia transações atômicas com `pg_advisory_xact_lock(IDENTITY_LOCK)`.

## 3. Isolamento de Dados e RBAC em Relatórios (`/api/v1/reports/*`)
- **Status:** **APROVADO / SEGURO** (`apps/api/src/reports.ts` e `apps/api/src/app.ts`).
- **Verificações:**
  - *Autenticação e Permissão:* As rotas `GET /api/v1/reports/productivity` e `GET /api/v1/reports/bottlenecks` exigem `demands.read`.
  - *Transacionalidade:* Ambas abrem transações isoladas em modo estrito `BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY`, prevenindo qualquer escrita acidental ou leitura suja.
  - *Isolamento por Papel (Anti-IDOR):* A função `revalidateActor` valida o usuário e seu papel no banco. Se o ator for administrador (`isAdmin = true`), pode opcionalmente filtrar por usuário ou cliente; se o ator for colaborador (`isAdmin = false`), os filtros de escopo (`demandScopeFilter` e `taskScopeFilter`) são injetados obrigatoriamente forçando `assigned_to_user_id = actor.id`, impedindo que um colaborador comum consulte dados de produtividade ou gargalos de outros membros da equipe.
