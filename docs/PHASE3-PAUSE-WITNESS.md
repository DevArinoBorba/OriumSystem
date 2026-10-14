# Relatório de Witness da Decisão de Negócio — Fase 3: Pausa Autorizada por Monique com Ajuste de Data

> **Nota de Escopo**: Este relatório documenta **exclusivamente** a comprovação funcional isolada da regra de negócio *"Monique autoriza a pausa e ajusta a data"* solicitada pelo responsável. **Não declara a Fase 3 concluída**, uma vez que a homologação visual e2e do navegador segue a cargo do QA no portal principal (`Orium - Codex visivel`).

---

## 1. Contexto e Isolamento Operacional

A validação foi conduzida em ambiente estritamente isolado de desenvolvimento:
- **Banco de Dados**: Exclusivamente `127.0.0.1:5433/orium_test` sob role `orium_app`. O banco `orium_dev` (porta 55432) e o processo da API DEV (PID 27784 / porta 3001) permaneceram 100% intactos e sem qualquer migração aplicada.
- **Portas Dinâmicas**: Política `PORT_POLICY.md` aplicada com reservas via `Find-FreePort.ps1`:
  - API Witness: Porta `3003` (PID `49660`, liberada pós-teste)
  - Web Witness (Vite): Porta `5175` (PID `42824`, liberada pós-teste)
- **Portal Dedicado**: Executado no portal visível independente `Orium - Fase3 pausa visivel` no canvas Maestri, sem interferência no portal de QA (`Orium - Codex visivel`).
- **Higiene e Cleanup**: Deleção em cascata de demandas, clientes e credenciais de teste, com asserção explícita de zero registros órfãos nas tabelas do banco de teste.

---

## 2. Casos de Teste Executados

Arquivo do runner: `.local/phase3-pause-witness.mjs`  
Evidência JSON: `.local/phase3-pause-witness-results.json`  
Resultado: **3/3 casos aprovados (PASS)**, exit code `0`.

### W-P3-PAUSE-01: Colaborador solicita pausa via UI com motivo
- **Atores**: Colaborador (`qa-witness-collab-a09f16b7@fixture.test`).
- **Ação na UI**: Login do colaborador no portal -> navegação até *"Minhas demandas"* -> abertura do chamado e da tarefa em produção -> clique em *"Solicitar Pausa"* -> preenchimento do motivo (`"Aguardando envio de assets e especificações técnicas pelo cliente"`) -> envio da solicitação.
- **Asserções Factualmente Aprovadas**:
  - `status`: **Permaneceu estritamente `in_production`** (não altera para `paused` no pedido do colaborador).
  - `deliveryDate`: **Preservou a data original** (`2026-11-15`).
  - `pauseRequestedAt`: Registrado (`2026-10-06T14:39:07.926Z`).
  - `pauseReason`: Registrado com a justificativa informada.
  - Evento no banco (`demand_event`): Registrado `task_pause_requested` com `actor_id` do colaborador e `metadata: {}`.

### W-P3-PAUSE-02: Monique aprova pausa via UI com nova data explícita e histórico
- **Atores**: Administradora Monique (`qa-witness-admin-a09f16b7@fixture.test`).
- **Ação na UI**: Logout do colaborador -> Login administrativo de Monique -> navegação em *"Demandas"* -> abertura dos detalhes da tarefa -> clique em *"Autorizar Pausa (Monique)"* -> preenchimento da justificativa (`"Pausa concedida por Monique com prorrogação formal acordada com cliente"`) e da nova data explícita (`2026-11-25`) -> submissão via *"Aprovar Pausa e Prorrogar Prazo"*.
- **Asserções Factualmente Aprovadas**:
  - `status`: Transicionado para **`paused`**.
  - `deliveryDate`: Atualizada para a **nova data explícita** (`2026-11-25`).
  - `paused_at`: Registrado na tabela `task` (`2026-10-06T14:39:22.232Z`).
  - Evento no banco (`demand_event`): Registrado `task_pause_approved`:
    - `actor_name`: `"Monique Borges Admin a09f16b7"`
    - `reason`: `"Pausa concedida por Monique com prorrogação formal acordada com cliente"`
    - `metadata.oldDeliveryDate`: `"2026-11-15"`
    - `metadata.newDeliveryDate`: `"2026-11-25"`
    - `metadata.originalPauseReason`: `"Aguardando envio de assets e especificações técnicas pelo cliente"`

### W-P3-PAUSE-03: Monique retoma tarefa via UI com preservação de startedAt e histórico de intervalo
- **Atores**: Administradora Monique (`qa-witness-admin-a09f16b7@fixture.test`).
- **Ação na UI**: Com a tarefa aberta em status *"Pausada"*, clique no botão *"Retomar Tarefa"*.
- **Asserções Factualmente Aprovadas**:
  - `status`: Transicionado de volta para **`in_production`**.
  - `startedAt`: **Estritamente preservado** (`2026-10-06T14:39:00.475Z`), idêntico ao timestamp inicial da primeira entrada em produção.
  - `deliveryDate`: **Mantida a nova data aprovada** (`2026-11-25`).
  - `pauseRequestedAt` e `pauseReason`: Limpos (`null`).
  - Evento no banco (`demand_event`): Registrado `task_resumed`:
    - `actor_name`: `"Monique Borges Admin a09f16b7"`
    - `metadata.pausedAt`: `"2026-10-06T14:39:22.232Z"`
    - `metadata.resumedAt`: `"2026-10-06T14:39:32.411Z"`
    - `metadata.pausedDurationSeconds`: `10` segundos contabilizados.

---

## 3. Limitações Técnicas e Evidências Estruturais

- **Limitação de Screenshot do Renderer**:
  O comando `maestri portal screenshot` registrou timeout de renderização (`renderer timeout — the page is not rendering (its window may be minimized)`), motivado pelo ambiente do canvas estar minimizado ou em segundo plano (`rootsky.list_apps native pipe unavailable`).
  Em conformidade com a determinação da coordenação, **não é alegada homologação visual pura por screenshot**.
- **Comprovação Estrutural**:
  A execução da interface web real foi atestada por:
  1. Ações diretas no DOM do portal com despacho de eventos nativos do React 19.
  2. Captura da árvore de acessibilidade (`maestri portal snapshot`) no portal `Orium - Fase3 pausa visivel`, comprovando a renderização dos componentes (`DemandsView` e `TaskDetailView`), notices de confirmação (`"Solicitação de pausa enviada para análise de Monique!"`, `"Pausa autorizada e nova data de entrega confirmada!"`, `"Tarefa retomada para produção!"`) e botões correspondentes.
  3. Respostas HTTP e persistência relacional no PostgreSQL `orium_test`.

---

## 4. Limpeza Pós-Execução e Higiene de Dados

Ao término do runner, o bloco `finally` executou com sucesso:
1. Limpeza no banco: `0` demandas, `0` clientes e `0` usuários órfãos confirmados por contagem pós-delete.
2. Processos filhos: PID da API (`49660`) e PID do Vite (`42824`) confirmados encerrados (`ESRCH`).
3. Leases de porta: Leases `3003` e `5175` liberados via `Find-FreePort.ps1`.
4. Portal: `Orium - Fase3 pausa visivel` redirecionado de volta para `http://127.0.0.1:5173` (mantido aberto).
5. Configuração temporária do Vite: `apps/web/vite.phase3-pause-witness.config.mjs` removida.
