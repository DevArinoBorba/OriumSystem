# Decisões de Negócio da Fase 3 — Demandas e Tarefas

Documento de alinhamento para a especificação da Fase 3 (reprodução do fluxo de landing page).  
Data: 2026-10-06 (Atualizado com decisões do responsável de 05/10 e 06/10)  
Status: Regras centrais de negócio consolidadas; pendências remanescentes isoladas.

---

## 1. Regras de Negócio Já Confirmadas pelo Responsável

Fontes: `PROJECT_CONTEXT.md` (seções 4, 6 e 7), `ROADMAP.md`, `ADR-0005`, `ADR-0008` e decisões explícitas do responsável em 05/10/2026 e 06/10/2026.

1. **Estrutura Básica e Vinculação a Cliente Ativo:**
   - Toda demanda está obrigatoriamente associada a um cliente ativo (`client_id uuid REFERENCES client(id)` onde `client.archived_at IS NULL`). Não existem demandas órfãs.
   - Uma demanda é composta por tarefas operacionais atribuídas a usuários internos com conta ativa (`auth_user.active = true`).

2. **Definição de Prazo pelo Criador da Demanda (Decisão 05/10/2026):**
   - Quem abre o chamado (criador da demanda) define a data de entrega diretamente no momento do cadastro.
   - Não há cálculo ou duração automática vinculada ao tipo de serviço (sem prazos pré-fixados pelo sistema).
   - Não há exigência de escolha entre dias úteis ou dias corridos para computar a data de entrega.

3. **Ciclo de Prontidão e Início Explícito (`ADR-0005`):**
   - Tarefas com requisitos obrigatórios ou dependências incompletas permanecem no estado **BLOQUEADA**.
   - Quando todos os requisitos obrigatórios e dependências são atendidos, a tarefa passa para **PRONTA PARA INICIAR** e registra `ready_at`.
   - **O relógio operacional NÃO começa em `ready_at`.** O tempo na fila de prontidão não consome prazo operacional.
   - O relógio operacional só inicia quando o usuário acionar a ação **INICIAR TAREFA**, registrando `started_at` e transicionando para **EM PRODUÇÃO**.

4. **Distribuição, Aceite e Revisão (ADR-0008):**
   - Apenas administradores (Monique e Arino) criam demandas e atribuem ou redistribuem tarefas.
   - O colaborador responsável realiza o **aceite formal da atribuição** (`accepted_at`), confirmando a responsabilidade sem iniciar o relógio operacional. Reatribuições invalidam expressamente o aceite anterior (`accepted_at = NULL`).
   - A revisão interna é realizada por Monique (com perfil `administrator`), que avalia o trabalho e emite parecer (aprovação ou ajustes).

5. **Regra de Bloqueios, Pausas e Ajuste de Prazos (Decisão 06/10/2026):**
   - **Solicitação:** O responsável pela tarefa solicita bloqueio ou pausa formalmente, informando obrigatoriamente o motivo.
   - **Aprovação Formal e Ajuste de Data:** Monique avalia a solicitação através de sua capacidade administrativa (`administrator`), aprova a pausa formalmente e informa diretamente a **nova data de entrega**.
   - **Histórico Transacional Auditável:** O histórico da tarefa registra na mesma transação atômica o autor da ação, o motivo declarado, a data de entrega anterior e a nova data de entrega aprovada.
   - **Sem Prorrogação Automática:** O sistema não realiza cálculo automático de extensão de prazo por tempo de bloqueio/pausa; todo ajuste de data decorrente de pausa é informado manualmente na aprovação administrativa.
   - **Sem Hardcode de E-mail:** A capacidade decorre do papel `administrator`, sendo Monique o ator operacional responsável pela execução desse fluxo na agência.

6. **Visibilidade Contextual e Restrita (ADR-0008):**
   - Colaboradores visualizam exclusivamente os clientes e demandas que lhes foram formalmente atribuídos, recebendo projeção restrita do cliente (sem contatos globais, histórico alheio ou notas administrativas).

7. **Cliente Final sem Acesso:**
   - No MVP, clientes externos não possuem login no sistema; toda interação com o cliente é mediada pela equipe interna.

---

## 2. Decisões de Negócio Remanescentes (Aguardando Alinhamento)

Com a consolidação de prazos, pausas e aprovação, restam apenas os seguintes pontos de negócio acessórios:

### 2.1. Início de Tarefa por Administrador
- **Ponto em aberto:** Um administrador (Monique/Arino) pode clicar em "INICIAR TAREFA" no lugar do colaborador atribuído (ex.: início pré-combinado ou ausência temporária do designer), ou o acionamento de `/start` deve ser estritamente exclusivo do próprio colaborador responsável?
- **Impacto técnico:** Validação de autorização na rota `/api/v1/tasks/:id/start` (permitir papel `administrator` além de `session.user.id === task.assignedToUserId`).

### 2.2. Cancelamento em Cascata
- **Ponto em aberto:** Ao cancelar uma demanda principal, todas as tarefas vinculadas devem ser canceladas em cascata automaticamente, ou exige confirmação individual para tarefas já em produção?
- **Impacto técnico:** Regra de transação e salvaguardas em `DELETE/PATCH /api/v1/demands/:id/cancel`.

### 2.3. Ciclo de Retrabalho e Reabertura Pós-Conclusão
- **Ponto em aberto:** Quando o cliente solicita ajustes após a revisão interna, a tarefa atual retorna para "Em produção" com nova data ajustada por Monique, ou deve ser aberta uma nova tarefa de ajuste vinculada à demanda?
- **Impacto técnico:** Transição de estados da tarefa e eventual geração de subtarefa de ajuste.
