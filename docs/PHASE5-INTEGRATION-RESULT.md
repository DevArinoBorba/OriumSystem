# Relatório de Testes de Integração e Correções do Backend — Fase 5: Materiais

**Documento:** `docs/PHASE5-INTEGRATION-RESULT.md`  
**Data:** 07/10/2026  
**Autor:** Antigravity (Backend Developer)  
**Status:** VALIDADO E APROVADO NO GATE DE INTEGRAÇÃO (`orium_test`)  

---

## 1. Escopo e Objetivos da Entrega

Atendimento integral aos apontamentos da revisão técnica do Codex descritos em `docs/PHASE5-COORDINATION-REVIEW.md` e aos complementos de validação rigorosa solicitados:
1. Revalidação estrita de identidade/papéis/permissões no banco sob transação/snapshot (`revalidateActor`).
2. Rejeição de privilégios forjados em sessão em memória para usuário colaborador real via serviço (403 `FORBIDDEN`).
3. Paginação real de targets com >= 51 registros autorizados cobrindo página 1 (50 itens), página 2 (restante), total exato e exclusão comprovada de tarefas de terceiros.
4. Sincronização determinística via lock `FOR SHARE` em task contra corridas com reatribuição (`FOR UPDATE`), comprovada via `pg_locks` (`NOT granted`), rejeição 404 pós-commit, preservação de versão e integridade de auditoria.
5. Salvaguarda e restauração garantida de `role_permission` em bloco `try/finally` e `afterAll` para isolamento total contra suítes paralelas.

### Arquivos com Ownership da Entrega:
- `apps/api/src/materials.ts` (correções de autenticação, RBAC no banco, locks e consistência de snapshot)
- `tests/materials.integration.test.ts` (suíte completa com 29 testes de integração contra PostgreSQL real `orium_test`)
- `docs/PHASE5-INTEGRATION-RESULT.md` (este relatório com as evidências do gate)

Nenhum arquivo de interface (`apps/web/*`), rotinas da Fase 4 ou banco `orium_dev` foi alterado.

---

## 2. Correções Realizadas no Backend (`apps/api/src/materials.ts`)

1. **Revalidação de Identidade e RBAC no Banco (`revalidateActor`)**:
   - `isAdmin` não é mais inferido cegamente do array em memória `identity.roles`.
   - Implementada a função `revalidateActor(client, userId, requiredPermission)` executada no PostgreSQL dentro da conexão transacional/snapshot.
   - Revalida se o usuário existe e está ativo em `auth_user` (rejeita com `401 AUTH_USER_INACTIVE` se desativado).
   - Revalida permissões ativas em `role_permission` associadas aos papéis do usuário (rejeita com `403 FORBIDDEN` se a permissão foi revogada).
   - Define o status de administrador a partir da presença real do papel `administrator` nas tabelas de papéis.

2. **Lock de Identidade Administrativa em Mutações**:
   - Mutações (`createMaterial`, `updateMaterial`, `archiveMaterial`, `restoreMaterial`) adquirem lock consultivo de transação `pg_advisory_xact_lock(712041)` (`IDENTITY_LOCK`), serializando alterações concorrentes de papéis ou permissões.

3. **Lock de Tarefa e Sincronização com Reatribuição (`FOR SHARE`)**:
   - Em `updateMaterial` (e validação de criação), a tarefa vinculada é consultada com `FOR SHARE`.
   - Bloqueia tentativas de edição de material enquanto uma transação concorrente de reatribuição de tarefa (`reassignTask`) estiver em andamento com `FOR UPDATE`.

4. **Snapshot Único e Consistente no Histórico (`getMaterialHistory`)**:
   - Histórico de auditoria, contagem total de eventos e verificação de autorização unificados em uma única conexão transacional com nível de isolamento `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.

5. **Imutabilidade Estrita de Vínculos**:
   - Os vínculos `clientId`, `demandId` e `taskId` são estritamente imutáveis para ambos os perfis (administrador e colaborador) após a criação.
   - Qualquer tentativa de enviar novos valores para esses campos em `updateMaterial` é rejeitada com status `400` e código de erro `MATERIAL_LINKS_IMMUTABLE`.

---

## 3. Cobertura do Gate de Integração (`tests/materials.integration.test.ts`)

A suíte foi executada contra o banco real de testes `orium_test` (porta 5433), sem mocks, cobrindo todos os cenários exigidos:

| Item do Gate | Cenário Verificado | Status |
| :--- | :--- | :--- |
| **1.1** | Rejeição `401` para requisições não autenticadas em todas as 8 rotas | **PASS** |
| **1.2** | Rejeição `401` para usuário desativado no banco mesmo com cookie de sessão válido | **PASS** |
| **1.3** | Rejeição `403` quando permissão (`materials.read`) é revogada no banco (com restauração garantida em `try/finally`) | **PASS** |
| **1.4** | Rejeição `401` para token de sessão inválido ou inexistente | **PASS** |
| **1.5** | Sessão forjada como admin para colaborador real via serviço é rejeitada pela revalidação do banco com `403 FORBIDDEN` (bloqueio de criação/arquivamento e escopo de targets) | **PASS** |
| **4.1** | Ciclo completo de CRUD por administrador (criar, listar, obter, editar, arquivar, restaurar) | **PASS** |
| **4.2** | Listagem administrativa com filtros por `category`, `clientId`, `demandId` e busca textual | **PASS** |
| **4.3** | Obtenção de detalhes de material por administrador | **PASS** |
| **4.4** | Atualização de título, descrição, categoria, URL e incremento correto de versão | **PASS** |
| **4.5** | Arquivamento de material por administrador (`status = archived`) com evento no histórico | **PASS** |
| **4.6** | Restauração de material arquivado por administrador (`status = active`) | **PASS** |
| **4.7** | Histórico de auditoria com eventos `created`, `updated`, `archived`, `restored` | **PASS** |
| **5.1** | Colaborador cria e edita material vinculado à sua tarefa atribuída | **PASS** |
| **5.2** | Anti-IDOR: colaborador recebe `404` ao tentar ler material de Colaborador A no mesmo chamado | **PASS** |
| **5.3** | Anti-IDOR: colaborador recebe `404` ao tentar atualizar material de Colaborador A no mesmo chamado | **PASS** |
| **5.4** | Anti-IDOR: colaborador recebe `404` ao tentar ver histórico de material de Colaborador A | **PASS** |
| **5.5** | Colaborador recebe `404` ao tentar criar material vinculando tarefa de terceiro | **PASS** |
| **6.1** | Bloqueio `403` para colaborador tentando criar material vinculado apenas ao cliente | **PASS** |
| **6.2** | Bloqueio `403` para colaborador tentando arquivar ou restaurar material | **PASS** |
| **7.1** | Listagem de alvos (`/targets`) escopada por tipo sem vazar tarefas de terceiros | **PASS** |
| **7.2** | Paginação > 50 é rejeitada estritamente com status `400` | **PASS** |
| **7.3** | Paginação real de targets com >= 51 registros autorizados valida page 1 (50 itens), page 2 (restante), total exato (52) e exclusão total de terceiros | **PASS** |
| **8.1** | Vínculos imutáveis: alteração de `clientId`, `demandId` ou `taskId` rejeitada com `400 MATERIAL_LINKS_IMMUTABLE` | **PASS** |
| **8.2** | Validação de consistência: rejeição `400` para divergência entre cliente e chamado | **PASS** |
| **9.1** | Rejeição `400` de esquemas perigosos (`javascript:`, `file:`, `data:`) sem efetuar fetch de rede | **PASS** |
| **9.2** | Rejeição `400` de URLs com credenciais embutidas (`user:pass@`) | **PASS** |
| **10.1**| Concorrência otimista: versão desatualizada rejeitada com `409 VERSION_CONFLICT` sem corromper estado ou histórico | **PASS** |
| **12.1**| Reatribuição de tarefa revoga imediatamente o acesso do colaborador anterior (`404`) | **PASS** |
| **12.2**| Corrida determinística: atualização de material por Colab A bloqueia sob lock `FOR SHARE` comprovado via `pg_locks` (`NOT granted`), é rejeitada com `404` após commit, preserva versão/eventos e permite atualização pelo novo responsável | **PASS** |

---

## 4. Resultado da Execução dos Testes

- **Comando executado:** `node --env-file=.env node_modules/vitest/vitest.mjs run tests/materials.integration.test.ts`
- **Ambiente:** Node.js v22.14.0, PostgreSQL 16 (`orium_test` na porta 5433)
- **Resultado:**
  - Test Files: **1 passed** (`tests/materials.integration.test.ts`)
  - Tests: **29 passed** (0 failed, 29 total)
  - Tempo de execução: ~9.7 segundos
  - Limpeza: Fixtures de teste identificadas por prefixo único foram devidamente removidas no teardown (`afterAll`), e as permissões padrão em `role_permission` foram restauradas garantindo isolamento total para suítes concorrentes.

---

## 5. Salvaguardas e Próximos Passos

1. **Preservação de Ambientes:**
   - O banco de desenvolvimento `orium_dev` (porta 55432) permaneceu intacto. A migration `0003_materials.sql` **NÃO** foi executada em DEV, aguardando aprovação final do Codex.
   - As credenciais e variáveis de ambiente foram estritamente preservadas.
2. **Próximo Passo:**
   - Conclusão da homologação pelo frontend / QA nos runners designados.
   - Ativação formal da migration em DEV sob supervisão do Codex.
