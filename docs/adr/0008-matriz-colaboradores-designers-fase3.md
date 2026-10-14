# ADR-0008 — Matriz de Acesso de Colaboradores Designers e Delimitação das Fases 2 e 3

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase de definição: 2. Implementação do fluxo: Fase 3.

## Contexto

Na Fase 2 (Clientes e Equipe), foram implementadas as permissões globais `clients.read`, `clients.write` e `clients.archive`, além da gestão de usuários e permissões de equipe (`users.read`, `users.create`, `users.deactivate`, `roles.manage`).
Fazia-se necessária uma definição de negócio sobre o escopo de acesso dos membros da equipe com papel `collaborator`, especificamente os dois colaboradores designers da agência.

Na Fase 2, ainda não existem entidades de demanda, tarefas ou mecanismos de vinculação/atribuição individual entre colaboradores e clientes.

## Decisão Aprovada pelo Responsável

1. **Escopo dos Colaboradores Designers**:
   - Os dois colaboradores designers visualizam **SOMENTE** os clientes e as demandas que forem explicitamente atribuídos a eles.
   - Fluxo de trabalho dos designers:
     1. Recebem a demanda atribuída por Monique.
     2. Aceitam e iniciam o trabalho na demanda (em conformidade com o ADR-0005, início explícito após requisitos disponíveis).
     3. Produzem e enviam a identidade visual para revisão interna.
     4. Monique analisa a entrega: aprova/conclui ou solicita ajustes.

2. **Operações Administrativas Exclusivas (Arino e Monique)**:
   - Cadastro, edição, arquivamento e restauração de clientes (`clients.write`, `clients.archive`) permanecem exclusivos de Arino e Monique.
   - Gestão de equipe, criação de usuários, desativação e troca de papéis permanecem exclusivos de Arino e Monique.
   - Atribuição de demandas e clientes aos colaboradores é de responsabilidade de Monique/Arino.

3. **Delimitação Estrita na Fase 2 (Clientes e Equipe)**:
   - Como a Fase 2 não possui entidades de demanda nem tabelas de atribuição, os colaboradores permanecem **SEM** as permissões globais `clients.read`, `clients.write` e `clients.archive`.
   - O papel `collaborator` é mantido estritamente em **negação por padrão** (*deny-by-default*, HTTP 403) para todos os endpoints de clientes e de equipe.
   - A concessão prematura de `clients.read` global aos colaboradores na Fase 2 é proibida, pois violaria a regra de negócio que restringe a visibilidade apenas aos clientes atribuídos.

4. **Implementação da Visibilidade Vinculada na Fase 3 (Demandas e Tarefas)**:
   - A modelagem das tabelas de demanda, tarefa e atribuição de colaboradores a clientes/demandas será concebida e implementada na Fase 3.
   - As regras de autorização baseadas em atribuição (visibilidade restrita do cliente associado à demanda) e o fluxo operacional de aceitação, início de tarefa, envio de identidade para revisão e aprovação/ajustes por Monique serão desenvolvidos na Fase 3.

## Consequências e Limites

- **Não implementar na Fase 2**: Não criar tabelas, migrations, colunas ou mocks de demandas e atribuições nesta fase.
- **Não declarar existência prematura**: A documentação e os agentes não devem declarar que demandas ou vínculos de clientes existem até sua efetiva implementação na Fase 3.
- **Aceite da Fase 2**: A Fase 2 mantém o critério de que o colaborador não acessa a gestão de equipe nem clientes globais (bloqueio 403 e abas ocultas na interface). A conclusão da Fase 2 depende exclusivamente das validações reais de QA (sessão de colaborador no portal visível, colisão de versão 409 e acessibilidade de diálogos nativos).
