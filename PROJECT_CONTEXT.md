# PROJECT_CONTEXT — Sistema de Gestão da Agência

> Fonte de verdade sobre produto, regras de negócio e funcionamento da agência.
> Agentes de IA devem ler este arquivo antes de propor arquitetura ou alterar código.

## 1. Objetivo
Criar um sistema interno para centralizar a operação da agência e reduzir gradualmente a dependência do WhatsApp para organização.

O sistema deverá permitir:
- gerenciar clientes;
- gerenciar demandas e tarefas;
- distribuir trabalho entre membros da equipe;
- controlar prioridades, prazos e dependências;
- acompanhar produção, revisão, aprovação e publicação;
- centralizar links e materiais;
- manter histórico por cliente;
- controlar acessos e permissões;
- fornecer dashboard operacional;
- futuramente possuir aplicativo mobile;
- futuramente permitir operação por agentes de IA.

## 2. Usuários
Inicialmente o sistema será utilizado somente pela equipe interna.

### Monique
Responsável principalmente por relacionamento com clientes, criação e distribuição de demandas, prioridades, acompanhamento, revisão/aprovação e comunicação com clientes.

### Desenvolvedor
Responsável principalmente por landing pages, sites, sistemas, infraestrutura, publicação e manutenção técnica.

### Equipe e Designers (Decisão aprovada em 2026-10-05, ADR-0008)
- A equipe conta com dois colaboradores designers responsáveis pela identidade visual, criativos e materiais.
- Cada usuário possui login individual com papel inicial `Colaborador`.
- **Regra de Visibilidade e Acesso**: Os colaboradores designers visualizam **SOMENTE** os clientes e as demandas que forem explicitamente atribuídos a eles.
- **Fluxo Operacional dos Designers**: Recebem a demanda distribuída por Monique, aceitam/iniciam o trabalho, produzem a identidade visual e a enviam para revisão interna; Monique analisa, aprovando/concluindo ou solicitando ajustes.
- **Operações Administrativas**: Cadastro, edição, arquivamento de clientes e administração da equipe permanecem exclusivos de Arino e Monique (administradores).
- **Delimitação entre Fases**: Na Fase 2, como não existem ainda entidades de demanda ou relações de atribuição, os colaboradores não possuem as permissões globais `clients.read`, `clients.write` ou `clients.archive` (mantém-se negação por padrão). A visibilidade vinculada por atribuição e o fluxo de aceitação/início/revisão serão implementados na Fase 3; não devem ser implementados nem declarados como existentes na Fase 2.

### Fundação aprovada (Fase 1)

- Login por e-mail e senha, sem cadastro público.
- Arino e Monique são os administradores iniciais; demais usuários começam como Colaborador.
- Administradores podem criar/desativar usuários, gerenciar papéis/permissões e iniciar procedimentos administrativos de recuperação de acesso.
- RBAC próprio centralizado no backend, com negação por padrão. Permissões de clientes, distribuição, aprovação, materiais, credenciais e integrações serão definidas em suas fases.
- Recuperação automática por SMTP fica para depois; não criar recuperação provisória insegura. MFA fica para o endurecimento de segurança.
- Sessões persistidas e revogáveis: validade absoluta de 7 dias e expiração após 12 horas de inatividade. Cookies HttpOnly, Secure com HTTPS, proteção CSRF/Origin nas mutações; sem tokens de autenticação em localStorage.
- Desenvolvimento: web local, API local e PostgreSQL isolado em Docker. Produção, VPS, Caddy e staging ficam fora da Fase 1.

## 3. Cliente final
No MVP, clientes da agência não terão login no sistema.
No futuro poderão existir links públicos controlados para compartilhamento de informações específicas.

## 4. Fluxo principal de uma demanda
Exemplo real: criação de landing page.

1. Monique fecha o serviço com o cliente.
2. O cliente é cadastrado ou selecionado.
3. Uma demanda é criada.
4. São criadas as tarefas necessárias.
5. A identidade visual é produzida internamente.
6. A landing page fica bloqueada enquanto os materiais necessários não estiverem concluídos.
7. Quando os materiais estiverem disponíveis, o desenvolvimento é liberado.
8. Quando todos os requisitos obrigatórios estão atendidos, a tarefa fica PRONTA PARA INICIAR e registra ready_at. O prazo operacional ainda não começa.
   O usuário autorizado clica INICIAR TAREFA: registrar started_at, iniciar o relógio operacional e passar para EM PRODUÇÃO.
9. O desenvolvedor cria a landing page.
10. É criado um preview, normalmente na Vercel.
11. Monique revisa.
12. O cliente revisa.
13. Se necessário, são feitos ajustes.
14. Após aprovação, ocorre a publicação.
15. A demanda é concluída.

## 5. Estados iniciais sugeridos
- Nova
- Planejamento
- Aguardando tarefa dependente
- Aguardando material
- Pronta para iniciar
- Em produção
- Em revisão interna
- Em revisão com cliente
- Ajustes solicitados
- Aprovada
- Publicação
- Concluída
- Cancelada

Os estados poderão ser refinados durante a especificação.

## 6. Prazos
Toda demanda operacional deverá possuir prazo de entrega.

**Definição do prazo:**
- O prazo de entrega é informado diretamente por quem abre o chamado (criador da demanda).
- Não há cálculo ou duração automática vinculada ao tipo de serviço (não há duração pré-fixada pelo sistema).
- Não há exigência de escolha entre dias úteis ou dias corridos para computar a data: o criador define a data de entrega diretamente no registro do chamado.

**Relógio operacional e marcos de execução:**
- O relógio de execução operacional NÃO começa quando os materiais ou dependências ficam disponíveis, nem na mera criação da demanda.
- O relógio de execução começa exclusivamente quando um usuário autorizado clica em **INICIAR TAREFA**, com todos os requisitos obrigatórios previamente atendidos.
- **Fluxo de marcos:**
  1. Requisitos incompletos → **BLOQUEADA**;
  2. Requisitos obrigatórios atendidos → **PRONTA PARA INICIAR** e registro de `ready_at`;
  3. Início explícito autorizado → registro de `started_at`, início do relógio operacional e status **EM PRODUÇÃO**.
- O intervalo entre `ready_at` e `started_at` permanece mensurável para análise de fila, capacidade e tempo de espera, sem consumir o tempo de execução operacional. Prontidão não é início de execução.

**Bloqueios, pausas e data de entrega:**
- O sistema registrará o histórico e a duração em que uma tarefa permaneceu bloqueada ou pausada. Bloqueios exigem causa válida e registro histórico (não sendo permitido bloquear manualmente apenas para esconder atraso).
- **Regra de bloqueios/pausas e ajuste de prazos (Decisão do responsável — 2026-10-06):**
  - O responsável pela tarefa solicita o bloqueio ou pausa formalmente, informando obrigatoriamente o motivo.
  - A aprovação da pausa é formal e administrativa: Monique (com perfil `administrator`) avalia a solicitação, aprova a pausa e informa diretamente a **nova data de entrega**.
  - O histórico de auditoria registra na mesma transação: o autor da ação, o motivo declarado, a data de entrega anterior e a nova data de entrega aprovada.
  - **Sem prorrogação automática calculada:** não há cálculo nem extensão automática de prazo pelo sistema; toda alteração de data decorrente de pausa é informada pelo administrador no ato da aprovação.
  - **Capacidade administrativa:** a aprovação decorre do papel administrativo (`administrator`), sendo Monique quem executa esse fluxo operacionalmente na agência, sem hardcode de endereço de e-mail no sistema.

## 7. Dependências
Tarefas poderão depender de outras tarefas.

Exemplo:
Criar identidade visual -> Preparar materiais -> Criar landing page -> Revisão interna -> Revisão cliente -> Publicação

Uma tarefa dependente não deverá ser considerada atrasada enquanto estiver legitimamente bloqueada por outra tarefa.

## 8. Prioridades
- Baixa
- Normal
- Alta
- Urgente

## 9. Dashboard
A tela principal deverá priorizar:

### Em produção
Demanda, cliente, responsável, prioridade, prazo e status.

### Dependendo de ação
Itens aguardando revisão, aprovação, material, retorno ou decisão.

### Pendências
Atrasadas, vencendo hoje, próximas do prazo e urgentes.

Também poderá existir uma visão resumida da carga da equipe.

## 10. Clientes
Cada cliente deverá possuir uma área própria contendo, quando aplicável:
- dados básicos;
- contatos;
- identidade visual;
- demandas;
- histórico;
- links;
- materiais;
- sites;
- previews;
- observações;
- acessos protegidos.

## 11. Arquivos
Decisão do responsável na Fase 5: colaboradores podem cadastrar/editar materiais dos próprios trabalhos atribuídos. Autorização é revalidada no backend; autoria do material não concede acesso permanente após reatribuição. Materiais de tarefas de terceiros não são acessíveis por compartilhar o mesmo chamado. Referências apenas de cliente e arquivamento/restauração permanecem administrativos. Escopo técnico em `docs/PHASE5-IMPLEMENTATION-CONTRACT.md`.
O sistema não precisa inicialmente ser um servidor de arquivos.
Materiais poderão ficar em serviços externos, como Google Drive.
O sistema deverá centralizar links, referências, categorias, descrições e associações com clientes/demandas.

## 12. Histórico
Cada cliente deverá possuir uma linha do tempo das ações relevantes: criação de demanda, atribuições, conclusão de dependências, início de desenvolvimento, revisões e publicação.

## 13. Segurança e credenciais

Decisão do responsável em 08/10/2026: usar **Bitwarden oficial** como cofre externo; o OriumSystem guarda apenas referências, visíveis **somente a administradores**. Atribuição a cliente/tarefa não concede visibilidade ao colaborador. Acesso aos itens no Bitwarden continua sujeito às permissões próprias do cofre. Instância, formato da referência e acesso de teste ainda exigem verificação real; contrato em `docs/PHASE6-IMPLEMENTATION-CONTRACT.md`.
Nunca:
- salvar senhas em texto puro;
- exibir senhas em logs;
- incluir credenciais em prompts de IA;
- expor segredos no frontend;
- armazenar secrets no repositório.

A arquitetura deverá prever cofre/criptografia e controle de acesso apropriado.

## 14. Informação financeira privada
Comissões e acordos financeiros particulares entre membros da agência não fazem parte do escopo operacional e não devem aparecer nos módulos comuns.

## 15. Auditoria

Decisão do responsável em 08/10/2026 para auditoria de identidade: administradores podem consultar toda a trilha; cada usuário ativo pode consultar somente eventos que o afetam. Retenção de 12 meses. O incremento de ações administrativas foi implementado, aceito em TEST e ativado em DEV, com gravação transacional e sem senhas/tokens/corpos de login; contrato em `docs/PHASE6-IDENTITY-IMPLEMENTATION-CONTRACT.md` e evidências em `docs/PHASE6-DEV-ACTIVATION.md`. Em 13/10, a autorização transacional de create/update/archive/restore de clientes também foi aceita e ativada em DEV (`docs/PHASE6-INCREMENT3-INDEPENDENT-REVIEW.md` e `docs/PHASE6-INCREMENT3-DEV-ACTIVATION.md`). Não presumir auditoria de login, MFA ou integração Bitwarden; hospedagem e homologação externa do cofre permanecem posteriores.
Ações sensíveis deverão futuramente registrar usuário, ação, data/hora e objeto afetado.

## 16. Aplicativo mobile
O sistema deverá ser arquitetado para que um aplicativo mobile possa consumir o mesmo backend.

Futuramente deverá permitir:
- visualizar demandas;
- receber push;
- comentar;
- alterar status;
- iniciar tarefa;
- acompanhar prazos;
- executar ações rápidas por notificação.

Inicialmente poderá ser distribuído internamente, sem publicação obrigatória em lojas.

## 17. Agentes de IA
Integrações com agentes pertencem a uma fase posterior.

Exemplos:
- "O que está atrasado hoje?"
- "Quais demandas do Gordinho estão em produção?"
- "Crie uma demanda para alterar o banner do Gordinho com prioridade alta."

Agentes deverão usar APIs controladas e não acessar diretamente o banco de produção.

## 18. Hermes
Existe interesse futuro em integrar o Hermes já executado em VPS.
Isso será analisado após APIs e regras do sistema principal estarem estáveis.

## 19. Princípios técnicos
1. Simplicidade
2. Modularidade
3. Segurança
4. Manutenção fácil
5. Baixo custo operacional
6. API bem definida
7. Possibilidade de self-hosting
8. Independência entre frontend e backend
9. Facilidade para automações futuras
10. Facilidade de trabalho por agentes de IA

## 20. Regra para agentes de programação
Antes de modificar código:
1. Leia PROJECT_CONTEXT.md.
2. Leia ROADMAP.md.
3. Identifique a fase atual.
4. Não implemente fases futuras sem autorização.
5. Não altere decisões arquiteturais silenciosamente.
6. Não adicione dependências desnecessárias.
7. Não reescreva módulos funcionais sem justificativa.
8. Preserve compatibilidade com o que já estiver concluído.
9. Execute testes relevantes.
10. Documente decisões importantes.

Se existir dúvida de regra de negócio: não inventar. Registrar a dúvida e solicitar decisão.
