# Resultado da Implementação Backend - Fase 5 (Materiais, Links e Histórico)

Data: 2026-10-07  
Responsável pela Implementação: Antigravity  
Contrato Norteador: `docs/PHASE5-IMPLEMENTATION-CONTRACT.md`

---

## 1. Escopo e Ownership

Em estrito cumprimento ao contrato e à matriz de responsabilidade:
- **Arquivos modificados/criados sob ownership:**
  - `packages/contracts/src/index.ts`: Schemas Zod estritos, tipos TypeScript, novas permissões (`materials.read`, `materials.write`, `materials.archive`) e expansão de papéis.
  - `db/migrations/0003_materials.sql`: Script DDL idempotente com tabelas `material` e `material_event`, restrições de integridade, índices relacionais e concessão de permissões.
  - `db/migrations/meta/_journal.json`: Registro de journal de migrações Drizzle (tag `0003_materials`).
  - `apps/api/src/schema.ts`: Mapeamento Drizzle ORM para tabelas `material` e `material_event`.
  - `apps/api/src/migrate.ts`: Permissões DDL/DML para o papel de aplicação `orium_app` sobre as novas tabelas.
  - `apps/api/src/identity.ts`: Permissões administrativas e restrições de concessão (`collaboratorAllowed`).
  - `apps/api/src/materials.ts`: Serviço de domínio de materiais, targets e histórico com RBAC estrito e auditoria transacional.
  - `apps/api/src/app.ts`: Registro dos 8 endpoints REST sob o prefixo `/api/v1/materials`.
  - `docs/PHASE5-BACKEND-RESULT.md`: Este relatório técnico de evidências.
- **Arquivos e escopos estritamente intocados:**
  - Frontend (`apps/web/*`).
  - Testes do QA (`tests/materials.integration.test.ts` e suíte QA).
  - Roadmap e documentação geral do projeto.
  - Banco de desenvolvimento (`orium_dev` mantido 100% isolado e sem aplicação da migração 0003).

---

## 2. Contratos e Schemas (@orium/contracts)

1. **Permissões Expandidas:**
   - Adicionadas `materials.read`, `materials.write` e `materials.archive`.
   - `rolePermissionsSchema` ampliado para até 17 permissões.
   - Atribuições padrão:
     - `administrator`: todas as 17 permissões (incluindo `materials.archive`).
     - `collaborator`: 6 permissões (`protected.read`, `demands.read`, `tasks.read`, `tasks.execute`, `materials.read`, `materials.write`).

2. **Categorias de Materiais:**
   - Categorias validadas: `'brand' | 'preview' | 'published' | 'drive' | 'asset' | 'reference'`.

3. **URL Sanitizada:**
   - `materialUrlSchema`: esquema estrito HTTP/HTTPS, validação via `new URL()`, rejeição mandatória de credenciais embutidas (`username` / `password`), comprimento máximo de 2048 caracteres.
   - Sem crawling ou requisição de rede pelo backend (prevenção total contra SSRF).

4. **Schemas de Entrada e Saída (.strict()):**
   - `createMaterialSchema`: `{ clientId, demandId?, taskId?, title, description?, category, url }` (.strict()).
   - `updateMaterialSchema`: `{ clientId?, demandId?, taskId?, title, description?, category, url, version }` (.strict()) — vínculos opcionais na entrada e estritamente imutáveis.
   - `materialVersionInputSchema`: `{ version }` (.strict()).
   - `listMaterialsQuerySchema`: `{ clientId?, demandId?, taskId?, category?, q?, status, page, pageSize }` (.strict()).
   - `listMaterialTargetsQuerySchema`: `{ kind: 'client' | 'demand' | 'task', q?, clientId?, demandId?, page, pageSize }` (.strict()).
   - `materialHistoryQuerySchema`: `{ page, pageSize }` (.strict()).
   - `materialSchema`, `listMaterialsResponseSchema`, `materialHistoryResponseSchema`, `listMaterialTargetsResponseSchema`.

---

## 3. Banco de Dados e Migração (0003_materials.sql)

### Estrutura DDL
- **Tabela `material`:**
  - `id`: UUID PRIMARY KEY.
  - `client_id`: UUID NOT NULL, FK `client(id)` ON DELETE RESTRICT.
  - `demand_id`: UUID NULLABLE, FK `demand(id)` ON DELETE RESTRICT.
  - `task_id`: UUID NULLABLE, FK `task(id)` ON DELETE RESTRICT.
  - `created_by_user_id`: UUID NOT NULL, FK `auth_user(id)` ON DELETE RESTRICT.
  - `title`: VARCHAR(200) NOT NULL.
  - `description`: TEXT NOT NULL DEFAULT ''.
  - `category`: VARCHAR(32) NOT NULL CHECK (`category IN (...)`).
  - `url`: VARCHAR(2048) NOT NULL.
  - `archived_at`: TIMESTAMPTZ NULLABLE.
  - `version`: INTEGER NOT NULL DEFAULT 1 CHECK (`version >= 1`).
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
  - `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
  - **Check Constraint:** `material_task_requires_demand_check` (`task_id IS NULL OR demand_id IS NOT NULL`).

- **Tabela `material_event`:**
  - `id`: UUID PRIMARY KEY.
  - `material_id`: UUID NOT NULL, FK `material(id)` ON DELETE CASCADE.
  - `actor_id`: TEXT/UUID NOT NULL.
  - `actor_name`: VARCHAR(100) NOT NULL.
  - `action`: VARCHAR(64) NOT NULL.
  - `reason`: TEXT NULLABLE.
  - `metadata`: JSONB NOT NULL DEFAULT '{}'.
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().

- **Índices de Performance:**
  - `material_client_id_idx` ON `material(client_id)`.
  - `material_demand_id_idx` ON `material(demand_id)`.
  - `material_task_id_idx` ON `material(task_id)`.
  - `material_category_idx` ON `material(category)`.
  - `material_archived_at_idx` ON `material(archived_at)`.
  - `material_created_at_idx` ON `material(created_at DESC)`.
  - `material_event_material_id_idx` ON `material_event(material_id)`.
  - `material_event_created_at_idx` ON `material_event(created_at DESC)`.

### Validação em orium_test (Porta 5433)
- Migração executada via `migrateDatabase(TEST_MIGRATION_DATABASE_URL)` através do migrador oficial (`drizzle-orm`).
- Concessão de permissões validada para `orium_app`: SELECT, INSERT, UPDATE, DELETE em `material` e `material_event`.
- Isolamento comprovado: `orium_dev` verificado e mantido sem a tabela `material` (`{"materialInDev": false}`).

---

## 4. Endpoints e Regras de Negócio

| Método | Rota | Permissão | Status Sucesso | Descrição |
|---|---|---|---|---|
| `GET` | `/api/v1/materials/targets` | `materials.read` | 200 | Lista alvos paginados (clientes, chamados, tarefas) respeitando o escopo do usuário |
| `GET` | `/api/v1/materials` | `materials.read` | 200 | Lista materiais com filtros, paginação e isolamento por papel |
| `POST` | `/api/v1/materials` | `materials.write` | 201 | Cria material com validação de escopo e gravação de histórico (`material_created`) |
| `GET` | `/api/v1/materials/:id` | `materials.read` | 200 | Consulta detalhe do material com projeções enriquecidas |
| `PATCH` | `/api/v1/materials/:id` | `materials.write` | 200 | Atualização atômica com trava `FOR UPDATE`, concorrência otimista (`version`) e histórico |
| `POST` | `/api/v1/materials/:id/archive` | `materials.archive` | 200 | Arquivamento administrativo com verificação de versão |
| `POST` | `/api/v1/materials/:id/restore` | `materials.archive` | 200 | Restauração administrativa com verificação de versão |
| `GET` | `/api/v1/materials/:id/history` | `materials.read` | 200 | Histórico transacional auditável do material |

### Regras de Isolamento e Segurança
1. **Colaborador:**
   - Só pode vincular material a uma tarefa que esteja explicitamente atribuída a si, ou a um chamado no qual possua ao menos uma tarefa sua atribuída.
   - Não pode criar material associado exclusivamente a cliente (nível cliente exige privilégios de administrador).
   - Não visualiza materiais vinculados a tarefas de outros colaboradores, mesmo que dentro do mesmo chamado compartilhado.
   - Se uma tarefa for reatribuída a outro usuário, o colaborador anterior perde imediatamente o acesso ao material (a autoria de criação não confere posse perene).
2. **Imutabilidade Estrita de Vínculos para Ambos os Papéis (Revisão Codex):**
   - Vínculos `clientId`, `demandId` e `taskId` são estritamente imutáveis após a criação tanto para `administrator` quanto para `collaborator`.
   - Previne que materiais movidos entre clientes/chamados exponham histórico prévio, URLs ou contexto de trabalhos anteriores.
   - Tentativa de alteração de vínculos via PATCH rejeita com `400 MATERIAL_LINKS_IMMUTABLE`.
   - Vínculos podem ser omitidos na requisição PATCH ou repetidos com o mesmo valor; a query UPDATE modifica unicamente `title`, `description`, `category`, `url`, `version = version + 1`, `updated_at = now()`.
   - Referenciar material em outro contexto exige novo cadastro (duplicação de referência), sem transferir histórico transacional.
3. **Prevenção de Enumeração e IDOR:**
   - A checagem de autorização precede as validações de concorrência (`409 VERSION_CONFLICT`) e erros de payload, retornando `404 NOT_FOUND` para materiais fora do escopo do colaborador, impedindo a inferência da existência de materiais de terceiros.
4. **Auditoria Transacional:**
   - Toda alteração computa o delta de campos (`{ before, after }`) e grava atomicamente na tabela `material_event` na mesma transação PostgreSQL.

---

## 5. Limites e Notas de Escala

- **Paginação:** Tanto a listagem de materiais quanto de histórico e alvos utilizam paginação estrita com `pageSize` máximo de 50 itens (padrão 20), prevenindo exaustão de memória em bases volumosas.
- **Locks Transacionais:** Operações de mutação utilizam `FOR UPDATE OF m` garantindo consistência sob concorrência e prevenindo race conditions em reatribuições simultâneas.
- **Sanitização de Log:** Mensagens de erro e payloads não expõem detalhes de conexão nem dados sensíveis.

---

## 6. Evidências de Validação

- `pnpm --filter @orium/contracts build`: Sucesso (exit code 0).
- `pnpm --filter @orium/contracts exec eslint src`: Sucesso (0 erros, 0 warnings).
- `pnpm --filter @orium/api build`: Sucesso (exit code 0).
- `pnpm --filter @orium/api exec eslint src`: Sucesso (0 erros, 0 warnings).
- `pnpm test:unit`: 63 testes unitários aprovados (config + rbac).
- `verify-phase5-test-migration.mjs`: Migração 0003 executada e verificada com sucesso em `orium_test` (porta 5433).
- `check_dev_untouched.mjs`: `orium_dev` intocado (`materialInDev: false`).
