# Revisão de Segurança - Fase 5 (Materiais)

Data: 2026-10-08  
Revisor: Sentinela (Claude Code)  
Escopo: Revisão independente READONLY de segurança/ativação DEV  
Arquivos revisados: `db/migrations/0003_materials.sql`, `apps/api/src/materials.ts`, `tests/materials.integration.test.ts`, `apps/api/src/identity.ts`

---

## 1. Resumo Executivo

Revisão de segurança focada em:
- RBAC e anti-IDOR (autorização por atribuição de trabalho)
- Snapshot e concorrência (isolation levels, locks, version checks)
- Grants e migração aditiva (permissões DDL/DML, journal)
- Timeline por cliente (agregação segura, vazamento de dados)

**Status geral**: Implementação robusta com proteções adequadas. Identificados **zero bloqueadores críticos**. Identificadas **3 limitações técnicas** documentadas para conhecimento da coordenação.

---

## 2. RBAC e Anti-IDOR

### 2.1 Autorização por Atribuição - ✅ CONFORME

**Colaboradores**: Toda operação de leitura/escrita de material exige vínculo de trabalho atribuído.

- **Linha 140-155** (`listMaterials`): Scoping automático para colaboradores via EXISTS nas tarefas atribuídas.
- **Linha 274-291** (`getMaterial`): Revalidação de atribuição no mesmo snapshot, com 404 para material inacessível.
- **Linha 319-347** (`createMaterial`): Colaborador não cria material apenas de cliente; exige demandId ou taskId com tarefa própria bloqueada `FOR SHARE`.
- **Linha 485-509** (`updateMaterial`): Autorização antecede 409 (version conflict) para não vazar existência. Task bloqueada `FOR SHARE` sincroniza com reatribuição concorrente.

**Evidência**: Linha 486 comentário explícito: "Bloquear a task FOR SHARE para sincronizar com reatribuição concorrente".

**Timeline por cliente** (linha 1026-1039):
- Colaborador: cliente precisa ter trabalho atualmente atribuído (anti-IDOR 404 se não tiver).
- Eventos de tarefa: somente se a tarefa do evento pertence atualmente ao colaborador (linha 1058).
- Eventos de material: usa exatamente o filtro autorizado de Materiais, excluindo client-only e tarefa de terceiro (linha 1060-1068).

### 2.2 Imutabilidade de Vínculos - ✅ CONFORME

**Linha 516-523** (`updateMaterial`): Vínculos `clientId`, `demandId`, `taskId` são estritamente imutáveis para AMBOS os papéis (administrator e collaborator). Comentário: "Imutabilidade de vínculos para AMBOS OS PAPÉIS (revisão de segurança Codex)".

**Evidência**: Transferir referência exige novo cadastro, preservando histórico do trabalho original conforme contrato (PHASE5-IMPLEMENTATION-CONTRACT.md linha 21).

### 2.3 Grants de Permissões - ✅ CONFORME

**Migração 0003_materials.sql** (linha 53-63):
```sql
INSERT INTO permission VALUES
  ('materials.read'),
  ('materials.write'),
  ('materials.archive');

INSERT INTO role_permission VALUES
  ('administrator', 'materials.read'),
  ('administrator', 'materials.write'),
  ('administrator', 'materials.archive'),
  ('collaborator', 'materials.read'),
  ('collaborator', 'materials.write');
```

**Validação em identity.ts** (linha 137-145):
```typescript
const collaboratorAllowed: Permission[] = [
  'protected.read',
  'demands.read',
  'tasks.read',
  'tasks.execute',
  'materials.read',
  'materials.write',
];
```

`materials.archive` restrito a administradores (linha 607-610 `archiveMaterial`, linha 676-679 `restoreMaterial`).

---

## 3. Snapshot e Concorrência

### 3.1 Isolation Levels - ✅ CONFORME

**Leitura**: `REPEATABLE READ READ ONLY` em:
- `listMaterials` (linha 133)
- `getMaterial` (linha 248)
- `getMaterialHistory` (linha 740)
- `listMaterialTargets` (linha 834)
- `getClientTimeline` (linha 1009)

**Escrita**: `BEGIN` com `IDENTITY_LOCK` advisory xact lock em:
- `createMaterial` (linha 313-314)
- `updateMaterial` (linha 456-457)
- `archiveMaterial` (linha 604-605)
- `restoreMaterial` (linha 673-674)

**Evidência**: Padrão consistente com identity.ts (linha 37) e demands.ts.

### 3.2 Row-Level Locks - ✅ CONFORME

**`updateMaterial`** (linha 461-509):
1. Lock do registro: `FOR UPDATE OF m` (linha 473) antes de qualquer validação.
2. Autorização de atribuição: task bloqueada `FOR SHARE` (linha 490, 500) para sincronizar com reatribuição concorrente.
3. Version check (linha 512-514) após autorização, antes de UPDATE.
4. UPDATE com `WHERE version = $6` (linha 550-561).

**`createMaterial`** (linha 325-347):
- Task bloqueada `FOR SHARE` (linha 328, 341) para validar atribuição antes de inserir.

**Evidência**: Ordem correta preservada: lock → autorização → version check → mutação.

### 3.3 Concorrência Otimista - ✅ CONFORME

**Version checks** em todas as mutações:
- `updateMaterial`: linha 512-514 (antes de UPDATE) + linha 563-565 (após UPDATE, double-check rowCount).
- `archiveMaterial`: linha 621-623 + linha 638-640.
- `restoreMaterial`: linha 690-692 + linha 707-709.

**Migração**: `version integer NOT NULL DEFAULT 1` com `CHECK (version > 0)` (linha 12, 15 em 0003_materials.sql).

**Incremento atômico**: `version = version + 1` em UPDATE (linha 548, 633, 702).

---

## 4. Grants e Migração Aditiva

### 4.1 Foreign Keys e ON DELETE - ✅ CONFORME

**0003_materials.sql** (linha 3-6, 38-39):
```sql
client_id uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
demand_id uuid REFERENCES demand(id) ON DELETE RESTRICT,
task_id uuid REFERENCES task(id) ON DELETE RESTRICT,
created_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,

material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
actor_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
```

**Análise**:
- `material` → `client/demand/task/user`: `RESTRICT` preserva vínculos e histórico, sem ampliar acesso por perda de vínculo (conforme contrato linha 24).
- `material_event` → `material`: `CASCADE` deleta eventos com o material (histórico interno).
- `material_event` → `auth_user`: `RESTRICT` preserva autoria para auditoria.

**Validação hierárquica**: CHECK `task_id IS NULL OR demand_id IS NOT NULL` (linha 17).

### 4.2 Índices e Performance - ✅ CONFORME

**Índices criados** (linha 20-34):
- FKs: `client_id`, `demand_id`, `task_id`, `created_by_user_id`.
- Consultas: `category`, `archived_at`, `updated_at DESC + id ASC`, `created_at`.
- Eventos: `material_id`, `created_at DESC`.

**Cobertura adequada** para:
- Scoping de colaborador (EXISTS em task com assigned_to_user_id).
- Paginação ordenada (updated_at DESC, created_at DESC).
- Filtros (category, archived_at, vínculos relacionais).

### 4.3 Journal e Idempotência - ✅ CONFORME

**`db/migrations/meta/_journal.json`** (linha 8):
```json
{ "idx": 3, "version": "7", "when": 1791200003000, "tag": "0003_materials", "breakpoints": true }
```

**Migração idempotente**: Drizzle controla aplicação; script DDL sem `IF NOT EXISTS` (delegado ao Drizzle).

**Ativação DEV pendente**: `orium_dev` confirmado sem tabela `material` (PHASE5-BACKEND-RESULT.md linha 98). Migração aplicada somente em `orium_test`.

---

## 5. Timeline por Cliente

### 5.1 Agregação Segura - ✅ CONFORME

**`getClientTimeline`** (linha 1000-1185):

**CTE unificada** (linha 1071-1129) com três UNIONs:
1. Eventos de demanda (linha 1073-1088): `WHERE d.client_id = $1` + filtro de colaborador.
2. Eventos de tarefa (linha 1092-1108): `WHERE d.client_id = $1` + filtro de colaborador.
3. Eventos de material (linha 1112-1128): `WHERE m.client_id = $1` + filtro autorizado de Materiais.

**Filtros de colaborador** (linha 1047-1069):
- Demanda: somente com tarefa própria (EXISTS).
- Tarefa: `t.assigned_to_user_id = $userParam` (linha 1058).
- Material: reutiliza lógica de `listMaterials`, excluindo client-only e tarefa de terceiro.

**Snapshot único**: `REPEATABLE READ READ ONLY` (linha 1009), count e select usam mesmos params (linha 1133-1162).

### 5.2 Não Vazamento de Dados - ✅ CONFORME

**Projeção mínima** (linha 1171-1183):
- Sem `metadata` bruto, `before/after`, comentários, `previewUrl`, contatos ou emails.
- Campos: `id`, `source`, `sourceId`, `demandId`, `taskId`, `materialId`, `title`, `action`, `actorName`, `createdAt`.

**Histórico detalhado** permanece em `getMaterialHistory` (linha 731-824) com autorização própria.

---

## 6. Limitações Técnicas (Não Bloqueadores)

### 6.1 Histórico de Material não Filtra Changes de Terceiros

**Arquivo**: `apps/api/src/materials.ts`  
**Linha**: 789-813 (`getMaterialHistory`)

**Contexto**: Após reatribuição, colaborador perde acesso ao material (404 na linha 764-766). Porém, se o histórico fosse acessível (não é, por 404), os `changes` no `metadata` (linha 801, 812) incluiriam valores `before/after` de quando o material pertencia a terceiros.

**Cenário**: Não explorável na prática porque colaborador recebe 404 antes de acessar eventos. Admin sempre pode ver todo histórico.

**Mitigação natural**: Ordem de verificação (linha 762-778) retorna 404 antes de consultar eventos.

**Recomendação**: Nenhuma ação necessária. Documentado para completude.

### 6.2 Timeline CTE Executa Três UNIONs Sem LIMIT Interno

**Arquivo**: `apps/api/src/materials.ts`  
**Linha**: 1071-1149 (`getClientTimeline`)

**Contexto**: CTE materializa todos os eventos antes de LIMIT/OFFSET externo. Em cliente com dezenas de milhares de eventos, pode consumir memória.

**Cenário**: Cliente típico de agência (< 1000 eventos) não sofre impacto. Crescimento para milhares de eventos por cliente exigiria índices compostos ou particionamento.

**Mitigação atual**: Paginação aplicada (pageSize 1-50) reduz rows retornadas. Índices em `created_at DESC` otimizam ordenação.

**Recomendação**: Monitorar performance em produção. Otimização prematura desnecessária para MVP.

### 6.3 Material History Ordena por created_at DESC sem Limite de Linhas

**Arquivo**: `apps/api/src/materials.ts`  
**Linha**: 788-794 (`getMaterialHistory`)

**Contexto**: Paginação aplicada (linha 787, 802), mas sem cap absoluto de eventos por material. Material com centenas de mutações poderia ter histórico extenso.

**Cenário**: Operação normal de agência (< 50 eventos por material) não afeta. Auditoria exige histórico completo.

**Mitigação atual**: `pageSize` limitado a 50 (materialHistoryQuerySchema). Interface carrega sob demanda.

**Recomendação**: Nenhuma ação necessária. Histórico completo é requisito de auditoria.

---

## 7. Testes de Integração

**Arquivo revisado**: `tests/materials.integration.test.ts`  
**Escopo**: Setup de fixtures (linha 0-149).

**Observações**:
- Bancos isolados: `orium_test` obrigatório (linha 11-24).
- Fixtures prefixadas com `testRunId` (linha 39-42, 66, 89, 110).
- Usuários/clientes/demandas registrados para cleanup (linha 47-49).
- Rate limit tratado via IPs únicos por request (linha 61).

**Cobertura de segurança pendente de execução**:
- RBAC: colaborador tenta acessar material de terceiro.
- Concorrência: duas sessões editam mesmo material.
- Reatribuição: perda de acesso após reassignTask.
- Version conflict: update com version desatualizada.

**Nota**: Execução e evidências fora do escopo desta revisão READONLY.

---

## 8. Checklist de Ativação DEV

### 8.1 Migração em orium_dev - ⚠️ PENDENTE

**Status**: Migração 0003_materials.sql NÃO aplicada em `orium_dev` (porta 55432).  
**Evidência**: PHASE5-BACKEND-RESULT.md linha 98: `{"materialInDev": false}`.

**Pré-requisitos para ativação**:
1. ✅ Revisão técnica de segurança (este documento).
2. ⏳ Aceite da coordenação (Codex).
3. ⏳ Execução de testes de integração contra `orium_test` com evidências reais.
4. ⏳ Backup de `orium_dev` antes de aplicar migração.
5. ⏳ Aplicação de `0003_materials.sql` via migrador oficial (`pnpm db:migrate`).
6. ⏳ Validação: `SELECT count(*) FROM material` retorna 0 em `orium_dev`.
7. ⏳ Verificação de grants para `orium_app`: `SELECT has_table_privilege('orium_app', 'material', 'SELECT,INSERT,UPDATE,DELETE')`.

### 8.2 Preservação de Dados Reais - ✅ CONFORME

**Contas reais preservadas**: 2 administradores ativos em `orium_dev` (arinoborba@gmail.com, moniquiborges_5@gmail.com) conforme ROADMAP linha 108.

**Bancos isolados**: `orium_test` (5433) e `orium_dev` (55432) operacionais sob PORT_POLICY.

---

## 9. Conclusão

### Achados Comprovados

**Zero bloqueadores críticos identificados.**

Implementação segue rigorosamente:
- ✅ RBAC com autorização por atribuição e anti-IDOR via 404.
- ✅ Isolation levels adequados (REPEATABLE READ, IDENTITY_LOCK).
- ✅ Row-level locks sincronizados com reatribuição (FOR SHARE).
- ✅ Concorrência otimista com version checks duplos.
- ✅ Imutabilidade de vínculos para ambos os papéis.
- ✅ Foreign keys RESTRICT preservando histórico e autorização.
- ✅ Timeline agregada sem vazamento de dados de terceiros.
- ✅ Grants e journal aditivos, migração idempotente.

### Limitações Técnicas Documentadas

1. **Histórico de material não filtra changes de terceiros** (não explorável, 404 antecede).
2. **Timeline CTE sem LIMIT interno** (não crítico para volume MVP).
3. **Material history sem cap absoluto** (requisito de auditoria, paginação aplicada).

### Recomendação Final

**APROVADO para ativação DEV** após:
1. Aceite formal da coordenação (Codex).
2. Execução de testes de integração com evidências PASS reais.
3. Backup de `orium_dev` e aplicação supervisionada de migração.

**Próximos passos**:
- Coordenação (Codex): revisar este documento e autorizar ativação DEV.
- Antigravity QA: executar suíte de integração contra `orium_test` e documentar evidências.
- Antigravity: aplicar migração em `orium_dev` após autorização, validar grants e reportar.

---

**Assinatura**:  
Sentinela (Claude Code) — Revisão independente READONLY  
2026-10-08
