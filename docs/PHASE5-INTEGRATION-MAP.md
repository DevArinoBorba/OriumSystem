# Mapa de Integração Técnica — Fase 5: Materiais, Links e Histórico

**Documento:** `docs/PHASE5-INTEGRATION-MAP.md`  
**Data:** 07/10/2026  
**Autor:** Antigravity (Backend Developer)  
**Status:** Proposta técnica preparatória para revisão da coordenação (Codex). Nenhuma alteração aplicada ao banco, backend, schemas ou permissões nesta etapa.

---

## 1. Visão Geral e Princípios Arquiteturais

A Fase 5 centraliza referências externas (manuais de marca, identidade visual, links de Drive, protótipos/previews e sites publicados) vinculadas a clientes e, opcionalmente, a chamados e tarefas operacionais.

### Diretrizes Centrais
1. **Sem Upload ou Sincronização Externa:** O sistema armazena metadados e referências URL; não realiza upload de binários, web scraping, checagens automáticas de links ou integração direta com APIs de terceiros.
2. **Reutilização da Stack Consolidada:** Utiliza Fastify 5, Drizzle ORM, PostgreSQL 16, Zod em `@orium/contracts` e Better Auth, mantendo o padrão de transações transacionais, locks otimistas e serialização segura.
3. **Concorrência Otimista:** Cada mutação exige conferência do campo `version` sequencial, prevenindo sobrescritas acidentais (HTTP 409).
4. **Isolamento Estrito por Atribuição:** Colaboradores só visualizam materiais de trabalhos atribuídos a si. Referências globais de cliente permanecem restritas aos administradores nesta preparação.

---

## 2. Modelo de Dados Relacional Proposto (DDL Aditivo)

A modelagem segue a convenção de `client` e `demand`, introduzindo duas tabelas aditivas sem impacto nas tabelas existentes.

### 2.1 Tabela `material`

```sql
CREATE TABLE material (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES client(id),
  demand_id uuid REFERENCES demand(id) ON DELETE SET NULL,
  task_id uuid REFERENCES task(id) ON DELETE SET NULL,
  created_by_user_id text NOT NULL REFERENCES auth_user(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  url text NOT NULL,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_version_check CHECK (version > 0),
  CONSTRAINT material_category_check CHECK (category IN ('brand', 'preview', 'published', 'drive', 'asset', 'reference'))
);

-- Índices de Consulta e Isolamento
CREATE INDEX material_client_id_idx ON material(client_id);
CREATE INDEX material_demand_id_idx ON material(demand_id);
CREATE INDEX material_task_id_idx ON material(task_id);
CREATE INDEX material_category_idx ON material(category);
CREATE INDEX material_archived_at_idx ON material(archived_at);
CREATE INDEX material_created_at_idx ON material(created_at);
```

### 2.2 Tabela `material_event` (Histórico Transacional)

Reutiliza o padrão transacional de `demand_event`, garantindo auditoria e rastreabilidade:

```sql
CREATE TABLE material_event (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES auth_user(id),
  actor_name text NOT NULL,
  action text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX material_event_material_id_idx ON material_event(material_id);
CREATE INDEX material_event_actor_id_idx ON material_event(actor_id);
CREATE INDEX material_event_created_at_idx ON material_event(created_at);
```

---

## 3. Validação de Vínculos e Integridade Hierárquica

Os materiais podem ser vinculados a três níveis: Cliente, Chamado ou Tarefa. Para impedir inconsistências relacionais e vazamentos cruzados, o backend deve revalidar a cadeia de custódia dentro da transação:

1. **Apenas Cliente:** `client_id` preenchido, `demand_id = NULL` e `task_id = NULL`.
2. **Vinculado a Chamado:** `client_id` e `demand_id` informados. O backend valida:
   ```sql
   SELECT 1 FROM demand WHERE id = $demandId AND client_id = $clientId;
   ```
   Se não corresponder, rejeitar com erro `400 BAD_REQUEST (DEMAND_CLIENT_MISMATCH)`.
3. **Vinculado a Tarefa:** `client_id`, `demand_id` e `task_id` informados. O backend valida:
   ```sql
   SELECT 1 FROM task t
   JOIN demand d ON d.id = t.demand_id
   WHERE t.id = $taskId AND d.id = $demandId AND d.client_id = $clientId;
   ```
   Se a tarefa não pertencer à demanda ou cliente indicados, rejeitar com `400 BAD_REQUEST (TASK_DEMAND_MISMATCH)`.

---

## 4. Segurança de URLs e Sanitização

Em conformidade com as salvaguardas da Fase 5:
1. **Esquema Estrito:** Apenas `http:` e `https:`. Rejeição via Zod e parser Node `new URL()` de qualquer outro esquema (`javascript:`, `data:`, `file:`, `blob:`).
2. **Anti-Vazamento de Credenciais:** Rejeição estrita de URLs contendo credenciais de autenticação embutidas (`username` ou `password` não vazios):
   ```typescript
   export const materialUrlSchema = z.string().trim().url().max(2048).refine((val) => {
     try {
       const parsed = new URL(val);
       if (!['http:', 'https:'].includes(parsed.protocol)) return false;
       if (parsed.username || parsed.password) return false;
       return true;
     } catch {
       return false;
     }
   }, { message: 'URL deve utilizar protocolo HTTP/HTTPS e não conter credenciais embutidas' });
   ```
3. **Proteção contra SSRF:** O servidor em hipótese alguma realiza `fetch`, crawling ou resolução de DNS das URLs fornecidas.
4. **Proteção de Abertura:** Frontend obrigatório a renderizar links externos com `target="_blank"` e `rel="noopener noreferrer"`.

---

## 5. Autorização, RBAC e Isolamento por Atribuição

### 5.1 Permissões Propostas

| Permissão | Finalidade |
|---|---|
| `materials.read` | Visualizar lista, detalhes e histórico de materiais autorizados |
| `materials.write` | Cadastrar e editar materiais |
| `materials.archive` | Arquivar e desarquivar referências |

### 5.2 Regras de Escopo e Isolamento
- **Administrador (`role: 'administrator'`):**
  - Possui `materials.read`, `materials.write` e `materials.archive`.
  - Visualiza materiais de todos os clientes, chamados e tarefas.
  - Pode vincular referências em qualquer nível hierárquico.
- **Colaborador (`role: 'collaborator'`):**
  - Possui `materials.read`.
  - **Filtro Estrito por Atribuição:** O backend aplica cláusula `WHERE` que restringe o acesso estritamente a materiais vinculados a tarefas atribuídas a si (`task.assigned_to_user_id = identity.user.id`) ou a chamados abertos que contenham ao menos uma tarefa do próprio colaborador.
  - **Materiais Globais de Cliente:** Materiais com `demand_id IS NULL` e `task_id IS NULL` são restritos aos administradores.
  - **Anti-IDOR:** Tentativas de consultar materiais alheios por ID retornam `404 NOT_FOUND` (evitando confirmar a existência do recurso).
  - Contadores, filtros e paginações excluem dados inacessíveis da contagem `total`.

### 5.3 Decisão Pendente do Usuário
> [!IMPORTANT]
> **Definição de Negócio Pendente:** O responsável pelo projeto ainda não definiu se colaboradores terão permissão de escrita (`materials.write`) nos trabalhos atribuídos a si ou se a escrita permanecerá 100% restrita a administradores.
> **Salvaguarda Operacional:** Nesta proposta, nenhuma permissão de escrita é concedida a colaboradores. A implementação de rotas e botões de mutação para colaboradores aguarda essa definição explícita.

---

## 6. Contrato Mínimo de API Proposto

### 6.1 Rotas HTTP

```typescript
// Leitura
GET  /api/v1/materials             // Lista paginada com filtros
GET  /api/v1/materials/:id         // Detalhe do material + metadados de vínculo
GET  /api/v1/materials/:id/history // Histórico de eventos e alterações

// Mutações Administrativas (e colaboradores se autorizado)
POST /api/v1/materials             // Cadastro de novo material
PATCH /api/v1/materials/:id        // Edição com verificação de version
POST /api/v1/materials/:id/archive // Arquivamento lógico (version check)
POST /api/v1/materials/:id/restore // Desarquivamento lógico (version check)
```

### 6.2 Query de Listagem (`GET /api/v1/materials`)

```typescript
export const listMaterialsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: z.string().uuid().optional(),
  demandId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  category: z.enum(['brand', 'preview', 'published', 'drive', 'asset', 'reference']).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
```

### 6.3 Resposta Paginada Padronizada

```typescript
export interface MaterialListResponse {
  items: Material[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## 7. Compatibilidade e Migração Aditiva

1. **Arquivo de Migração:** `db/migrations/0003_materials.sql` adicionará as tabelas `material` e `material_event`, seus índices e as novas permissões (`materials.read`, `materials.write`, `materials.archive`).
2. **Atualização do `migrateDatabase` (`apps/api/src/migrate.ts`):** Inclusão de `material, material_event` nos comandos `GRANT` para a role `orium_app`.
3. **Não-Regressão:** A migração é estritamente aditiva, preservando integralmente os dados de clientes, demandas, tarefas e contas administrativas em `orium_dev`.
