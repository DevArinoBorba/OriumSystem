# Proposta arquitetural — OriumSystem

Data: 05/10/2026. Status: **FASE 0 aprovada; políticas de fundação aprovadas; FASE 1 autorizada; fases posteriores não autorizadas**.

Fontes de verdade: `PROJECT_CONTEXT.md` e `ROADMAP.md`, lidos integralmente. Também foi lido `PROMPT_01_ORQUESTRADOR.md`. Em caso de conflito, prevalecem os dois primeiros documentos e as instruções explícitas do responsável.

**Fase 0 aprovada pelo responsável. Fase 1 autorizada: somente fundação local.** As fontes de verdade foram sincronizadas com a regra oficial: requisitos atendidos registram `ready_at`; somente INICIAR TAREFA por usuário autorizado registra `started_at` e inicia o relógio. Espera pronta não consome prazo. A documentação e ADRs foram revisados antes de encerrar a Fase 0; o andamento e evidências da Fase 1 são registrados no roadmap.

As decisões de contas, sessões, RBAC inicial e PostgreSQL local em Docker constam no [ADR-0007](docs/adr/0007-politicas-fundacao.md). Arino e Monique serão administradores; demais usuários Colaborador; sem cadastro público, SMTP de recuperação ou MFA nesta fundação. Não há autorização para módulos futuros ou infraestrutura de produção.
## 1. Resumo executivo

Está aprovado um sistema próprio de gestão operacional, implementado futuramente como **monólito modular com API REST independente**, PostgreSQL e frontend web separado no mesmo repositório. Reutilizar componentes técnicos; autenticação com Better Auth e autorização própria centralizada no backend. A direção preferencial aprovada para credenciais é cofre externo, com apenas referências na aplicação e Vaultwarden como candidato inicial, sem contratação ou implantação autorizada.

A razão principal é o domínio: cliente → demanda → tarefas → dependências e materiais obrigatórios. O relógio operacional só começa quando um usuário autorizado inicia efetivamente uma tarefa pronta. Disponibilidade de requisitos libera a tarefa, mas não inicia a contagem. Adaptar um CRM ou gestor de projetos completo para garantir essa regra pode custar mais que construir um núcleo pequeno e explícito.

Proposta de stack: React + Vite + TypeScript; Node.js LTS + Fastify; PostgreSQL; Drizzle + driver `pg`; Better Auth; Zod; testes com Vitest e Playwright; REST + OpenAPI; Docker Compose + Caddy em VPS. Sem Redis, Kubernetes, microserviços ou motor genérico de workflow inicialmente. Jobs duráveis entram apenas quando a fase e a necessidade justificarem.

Estão aprovados sistema próprio, monólito modular, API REST, monorepo pnpm, React/Vite/TypeScript, Node.js/Fastify/TypeScript, PostgreSQL, Drizzle, Better Auth e RBAC próprio centralizado; sem Redis, Kubernetes ou microserviços inicialmente. Web, mobile e agentes usarão a mesma API; agentes nunca acessarão diretamente o banco de produção. Calendário, reabertura, permissões de negócio e detalhes do cofre/recuperação futura seguem pendentes. Políticas iniciais de identidade, sessões e RBAC foram aprovadas no ADR-0007. Bibliotecas auxiliares e mecanismos de deploy descritos abaixo continuam recomendações, não aprovações implícitas.

## 2. Requisitos compreendidos

O produto atende inicialmente uma única agência e sua equipe interna, com contas individuais. Monique acompanha clientes, cria e distribui demandas, define prioridades e participa das revisões. Desenvolvedor e equipe executam trabalhos atribuídos. Esses nomes não devem virar permissões fixas no código.

O escopo compreende clientes, demandas com prazo, tarefas, responsáveis, prioridades baixa/normal/alta/urgente, dependências, requisitos de materiais, comentários e fluxo de produção até publicação. O dashboard deverá mostrar produção, ações pendentes, urgências e atrasos válidos. Há histórico por cliente, links de Drive, previews e sites publicados.

Clientes finais não terão login no MVP. Aprovação externa pode ser registrada pela equipe, com autor, data e evidência, sem inventar um portal de cliente. Links públicos controlados pertencem ao futuro. Arquivos continuam em serviços externos inicialmente. Comissões e acordos financeiros particulares ficam fora do domínio e dos módulos comuns.

Mobile, push, agentes e Hermes são extensões posteriores. Todos consomem a mesma API; nenhum agente recebe acesso direto ao PostgreSQL de produção.

### Compatibilidade com o roadmap

| Fase | Implicação arquitetural, sem implementação nesta entrega |
| --- | --- |
| 1 | Fundação, banco, autenticação, sessões, permissões e controles básicos de segurança |
| 2 | Clientes e equipe |
| 3 | Demandas, tarefas, dependências, bloqueios, relógio e histórico operacional |
| 4 | Dashboard baseado nas regras já consolidadas |
| 5 | Catálogo completo de materiais, links e linha do tempo |
| 6 | Cofre e revisão aprofundada de segurança/auditoria |
| 7 | Notificações e entregas assíncronas |
| 8–9 | Mobile e integração com agentes |
| 10 | Infraestrutura e operação de produção |

Há uma dependência a esclarecer: materiais obrigatórios precisam de uma representação mínima na Fase 3 para o bloqueio funcionar, mesmo que seu catálogo completo fique na Fase 5. Segurança básica nasce na Fase 1; a Fase 6 não autoriza armazenar credenciais antes de implementar sua proteção. Produção com dados reais exige backup e restauração verificados, mesmo se houver pedido futuro para antecipar a implantação em relação à Fase 10. Qualquer ajuste de sequência exige aprovação.

## 3. Open source analisado

Pesquisa em fontes oficiais realizada em 05/10/2026. A maturidade abaixo é avaliação qualitativa a partir de documentação, histórico de desenvolvimento, política de segurança e ecossistema; não é benchmark nem homologação. Os repositórios consultados mostram histórico e canais de manutenção, mas esta análise não certifica ausência de vulnerabilidades nem SLA. Antes de adotar, conferir versão estável, releases recentes, avisos de segurança e licença dos arquivos efetivamente usados. Não houve instalação ou prova de conceito.

### 3.1 CRM, projetos e tarefas

| Projeto | Licença e manutenção | Stack / self-host / complexidade | API, webhooks e customização | Adequação e excesso para nosso caso |
| --- | --- | --- | --- | --- |
| Twenty | Predominantemente AGPLv3, arquivos comerciais e alguns pacotes MIT; plataforma ativa e em evolução | TypeScript, React, NestJS, PostgreSQL, Redis e BullMQ; Docker Compose; complexidade média/alta | REST/GraphQL, webhooks, objetos e aplicações extensíveis; customização pela plataforma mais sustentável que fork | Forte em CRM. Metadados, ecossistema de apps e funções comerciais ampliam a manutenção. Não foi demonstrado que preserve nosso relógio e invariantes transacionais sem extensão |
| Plane Community | AGPLv3; projeto ativo com documentação de deployment e integração | React/TypeScript, backend Python/Django, PostgreSQL e serviços auxiliares; self-host; complexidade alta frente ao escopo | REST e webhooks documentados; customização possível, mas mudanças profundas aumentam divergência do upstream | Forte em tarefas e projetos. Ciclos, páginas, colaboração e múltiplos serviços são excedentes. Suporte exato na edição Community e na versão escolhida precisa ser confirmado |
| Frappe CRM | AGPLv3; ecossistema Frappe estabelecido, CRM com evolução própria | Python/Frappe e Vue; self-host por Bench/Docker; ecossistema operacional adicional | Framework oferece APIs e extensões; integração exige aprender DocTypes e validar webhooks/autorização na edição selecionada | Mais orientado a vendas; não comprova o fluxo operacional solicitado. Compatibilidade PostgreSQL de toda a combinação precisa de validação; não presumir suporte de ponta a ponta |

Fontes: [Twenty: repositório e stack](https://github.com/twentyhq/twenty), [licença e exceção para aplicações](https://github.com/twentyhq/twenty/blob/main/LICENSE), [Plane: repositório](https://github.com/makeplane/plane), [arquitetura self-host](https://developers.plane.so/self-hosting/plane-architecture), [API](https://developers.plane.so/), [webhooks](https://developers.plane.so/dev-tools/intro-webhooks), [Frappe CRM](https://github.com/frappe/crm).

Não se descartam esses produtos por serem grandes ou por usarem AGPL. A diferença é o custo de adaptação, atualização e operação diante de um domínio pequeno. A licença também exige revisão antes de copiar código ou manter modificações; uso de API e incorporação de código são situações distintas.

### 3.2 Componentes transversais

| Projeto | Licença / maturidade / stack | Integração, extensibilidade e self-host | Decisão proposta e excesso |
| --- | --- | --- | --- |
| Vaultwarden | AGPLv3; comunidade estabelecida; servidor Rust compatível com clientes Bitwarden | Self-host relativamente leve; organizações e coleções; API de clientes não equivale à API pública completa; webhooks não são premissa | Candidato a cofre externo usado diretamente por humanos. Guardar referências no OriumSystem; evitar fork e integração que exija desbloquear todo o cofre |
| Bitwarden oficial | Licenças variam por componente e funcionalidades; produto estabelecido | Self-host e APIs documentados, com funcionalidades sujeitas a assinatura; extensões e clientes próprios | Alternativa quando suporte oficial, API ou governança justificarem custo. Não presumir que todas as funções sejam gratuitas/open source |
| Keycloak | Apache-2.0; IAM estabelecido; Java | Self-host, OIDC/SAML, Admin REST API, eventos e provedores de extensão; webhooks normalmente precisam de extensão | Bom para SSO entre vários sistemas. Serviço e administração extras para poucas contas internas; adiar |
| Better Auth | MIT; biblioteca TypeScript ativa, mais recente que Keycloak | Executa dentro da API, integração Fastify e adapter Drizzle; plugins e hooks; não depende de serviço remoto | Reutilizar login e sessões. Desativar recursos desnecessários; manter autorização de negócio fora de plugins genéricos |
| Node-Casbin | Apache-2.0; biblioteca de autorização estabelecida | RBAC/ABAC, adapters e APIs de políticas; embutida, sem servidor ou webhook obrigatório | Reavaliar se políticas ficarem complexas. RBAC simples com escopo de recurso pode usar tabelas e verificação central explícita |
| Temporal | MIT no servidor; execução durável estabelecida; Go e SDKs | Self-host, workers e APIs; workflows em código, integrações via atividades | Excesso para dependências humanas locais. Modelar estados e transações; adotar apenas diante de processos distribuídos duráveis reais |
| Novu | Núcleo MIT e código enterprise comercial; plataforma ativa; TypeScript | APIs/SDKs, workflows e integrações de canais; self-host com serviços auxiliares como MongoDB/Redis | Útil para operação multicanal maior. Acrescenta outro banco e painel; adiar e verificar matriz de edição |
| ntfy | Servidor com opções Apache-2.0/GPLv2; Go, projeto mantido | Self-host, publicação HTTP e assinaturas; configuração de autenticação/ACL; customização limitada ao canal | Canal opcional futuro, não fonte de verdade. Push móvel tem particularidades de plataforma; tópico não deve ser usado como segredo |
| pg-boss | MIT; biblioteca Node.js mantida | Fila persistida no PostgreSQL, APIs de jobs, retries e agendamento; sem Redis; webhooks implementados pelo consumidor | Candidato na Fase 7. Isolar em schema próprio; handlers idempotentes, mesmo com garantias da fila |
| pgAudit | Licença PostgreSQL; extensão C mantida conforme versões do banco | Auditoria SQL em logs PostgreSQL; não oferece API de produto ou webhooks | Complemento futuro para atividade no banco. Não substitui auditoria de negócio e pode gerar volume/dados sensíveis |

Fontes: [Vaultwarden](https://github.com/dani-garcia/vaultwarden), [limitações da API pública](https://github.com/dani-garcia/vaultwarden/wiki), [APIs Bitwarden](https://bitwarden.com/en-gb/help/bitwarden-apis/), [licenciamento self-host Bitwarden](https://bitwarden.com/help/licensing-on-premise/), [Keycloak](https://github.com/keycloak/keycloak), [Better Auth](https://github.com/better-auth/better-auth), [integração Fastify](https://better-auth.com/docs/integrations/fastify), [Node-Casbin](https://github.com/apache/casbin-node-casbin), [Temporal](https://github.com/temporalio/temporal), [Novu](https://github.com/novuhq/novu), [deployment Novu](https://docs.novu.co/community/self-hosting-novu/deploy-with-docker), [ntfy](https://docs.ntfy.sh/), [configuração ntfy](https://docs.ntfy.sh/config/), [pg-boss](https://github.com/timgit/pg-boss), [pgAudit](https://github.com/pgaudit/pgaudit), [licença pgAudit](https://github.com/pgaudit/pgaudit/blob/main/LICENSE).

## 4. Recomendação: reutilizar vs desenvolver

**Decisão aprovada C, combinada com B:** desenvolver o núcleo operacional e reutilizar componentes consolidados. Não usar Twenty ou Plane como base. Não copiar seus módulos para reduzir trabalho sem avaliar acoplamento e licença.

Desenvolvimento próprio fica limitado a clientes, demandas, tarefas, requisitos, transições, cálculo operacional, permissões específicas e histórico. Bibliotecas assumem autenticação, validação, SQL tipado e infraestrutura técnica. Um cofre existente assume a proteção de credenciais humanas.

Essa escolha reduz serviços e evita dois sistemas concorrentes para clientes e tarefas. Traz responsabilidade de manter o domínio e testes, mas evita manter um fork amplo. A comparação permanece como justificativa histórica; não há prova de aderência com Twenty/Plane pendente para começar a fundação.

## 5. Stack recomendada

**Aprovado:** React/Vite/TypeScript, Node.js/Fastify/TypeScript, PostgreSQL, Drizzle, Better Auth e RBAC próprio. A tabela preserva justificativas e alternativas avaliadas; elas não autorizam trocar a stack. Zod e PostgreSQL local isolado em Docker também estão aprovados para a Fase 1. React Router, ferramentas auxiliares e infraestrutura de produção não são requisitos aprovados por extensão; versões/driver e ferramentas de verificação da fundação serão documentados na implementação. Sem Redis, Kubernetes ou microserviços inicialmente, conforme ADR-0003.

| Camada | Proposta | Motivo / alternativa |
| --- | --- | --- |
| Web | React + Vite + TypeScript; React Router; CSS simples e componentes acessíveis | Aplicação interna sem necessidade de SEO/SSR; build estático. Vue também é adequado se houver maior experiência da equipe |
| API | Node.js em versão LTS suportada + Fastify + TypeScript | Pouca infraestrutura, plugins e validação; API independente. NestJS se convenções maiores compensarem seu custo; Django/DRF se Python for preferência da equipe |
| Banco | PostgreSQL, major suportada e fixada após verificar compatibilidade | Relações, constraints e transações para regras críticas; mesmo motor local e produção |
| Query layer | Drizzle + `pg`; migrations SQL revisadas | SQL explícito e acesso a locks/CTEs. Prisma é alternativa se produtividade da equipe superar a necessidade de SQL direto |
| Autenticação | Better Auth com adapter Drizzle | Biblioteca embutida; login individual e sessões; validar combinações estáveis antes da Fase 1. Keycloak se SSO passar a ser requisito |
| Autorização | RBAC em tabelas + política central com escopo do recurso | Pequeno catálogo de ações, negação por padrão. Casbin se surgir complexidade demonstrável |
| Validação | Zod nos contratos; integração mantida com Fastify/OpenAPI | Validar entradas e saídas. Regras de negócio no serviço; constraints no banco. JSON Schema/Ajv é alternativa mais nativa ao Fastify |
| Jobs | Nenhuma fila na fundação; pg-boss quando entregas/retries forem necessários | PostgreSQL já existe; sem broker adicional. Não usar timers em memória como garantia durável |
| Notificações | Inbox no banco; polling inicial; adapter SMTP futuro; push na Fase 8 | Canais desacoplados do domínio; Novu se complexidade multicanal justificar |
| Testes | Vitest, testes de API com Fastify inject e PostgreSQL real de teste; Playwright para fluxos essenciais | Priorizar regras e autorização; banco simulado não prova concorrência |
| API docs | OpenAPI gerada dos contratos, UI Swagger protegida | Contrato para web/mobile/agentes; verificar compatibilidade real do conversor Zod |
| Logs | Pino estruturado, redaction e rotação | Integração com Fastify; sem plataforma de logs inicialmente |
| Containers | Docker Compose; imagens fixadas por versão/digest | Poucos serviços em uma VPS; alternativa local sem containers para processos web/API |
| Deploy | VPS Linux + Caddy + Compose + CI do provedor Git escolhido | HTTPS e rollback controlado; sem dependência de Vercel para o sistema |

Referências técnicas: [Fastify](https://fastify.dev/docs/latest/), [Drizzle](https://orm.drizzle.team/docs/overview), [Better Auth e adapter](https://better-auth.com/docs/installation), [política de suporte PostgreSQL](https://www.postgresql.org/support/versioning/). Versões e licenças da árvore de dependências serão registradas quando houver aprovação; esta proposta não fixa versões não homologadas.

## 6. Arquitetura

```text
Web React
    ↓ HTTPS /api/v1
API Fastify — identidade, autorização, validação, limites
    ↓
Casos de uso e regras de negócio por módulo
    ↓
Repositories / transações PostgreSQL
    ↓
PostgreSQL

Futuro:
Mobile ───────┐
Web ──────────┼── API ── casos de uso ── PostgreSQL
Agente IA ────┘
                    └── adapters: cofre, notificações, integrações
```

Um backend implantável, organizado por módulos: identidade, clientes, operação, referências, atividade, auditoria e, nas fases próprias, notificações e integrações. Controllers traduzem HTTP; casos de uso verificam regras; repositories executam SQL. Evitar um framework interno de abstrações e um repository genérico para todas as tabelas.

Web e API são independentes em código e contrato, embora possam usar o mesmo domínio na VPS: `/` entrega arquivos estáticos e `/api` encaminha para o backend. O frontend não contém regras definitivas de prazo/permissão nem credenciais de banco.

Uma transição crítica altera tarefa, intervalos operacionais, atividade e registro de auditoria necessário na mesma transação. Na fase de notificações, registrar evento em outbox na mesma transação e entregá-lo após commit. Falha de SMTP/push não desfaz conclusão de tarefa. Sem event sourcing, CQRS separado ou barramento distribuído.

## 7. Modelo conceitual do domínio

### Entidades e relações

| Entidade | Responsabilidade e relações conceituais |
| --- | --- |
| User | Conta interna, nome, identificador de login, estado ativo/desativado; múltiplos Role via UserRole |
| Role | Papel de trabalho; associa Permission via RolePermission |
| Permission | Ação estável, como `task.transition` ou `client.read`; escopo avaliado separadamente |
| Session | Sessão revogável de User, expiração e metadados mínimos; gerenciada pela biblioteca |
| Client | Cliente da agência, contatos, observações, arquivamento; possui Demand e referências |
| Demand | Trabalho contratado/solicitado, Client obrigatório, título, prioridade, responsável pela coordenação, prazo de entrega obrigatório e fase |
| Task | Unidade executável de Demand, responsável, prioridade, estado de produção, orçamento operacional, `ready_at`, `started_at`, versão para concorrência |
| TaskDependency | Aresta `prerequisite_task → dependent_task`; requisito de liberação explícito, sem duplicatas ou auto dependência |
| TaskMaterialRequirement | Material exigido pela Task, categoria/descrição, obrigatório ou opcional, condição de aceitação e responsável por validá-lo |
| Material | Referência de material do Client/Demand, versão, categoria, Link e estado de validação; pode satisfazer requisitos de tarefas |
| Link | URL externa, categoria, descrição e associações explícitas com Client/Demand/Task/Material; não armazena senha |
| Comment | Texto, autor, datas; ligado a Demand ou Task com constraint de alvo válido |
| TaskBlockInterval | Período bloqueado, abertura/fechamento e motivos associados; mede a união dos bloqueios |
| TaskOperationalInterval | Período em que o relógio operacional conta; preserva histórico em vez de sobrescrever início |
| TaskReadyInterval | Proposta de histórico dos períodos pronta e aguardando início; permite medir fila sem confundir com bloqueio ou produção; tratamento de novos ciclos depende da política de reabertura |
| Activity | Evento operacional legível na linha do tempo, ator humano/sistema e contexto do cliente/demanda/tarefa |
| Notification | Evento apresentado a um destinatário User, leitura e chave de deduplicação; Fase 7 |
| NotificationDelivery | Tentativa de entrega por canal, retry/erro sanitizado; Fase 7 |
| AuditLog | Evidência técnica de ação, ator, data, objeto, resultado, request ID e diferenças permitidas |
| CredentialReference | Client + referência opaca ao item/coleção do cofre, descrição e política; sem valor secreto |
| ServiceAccount / OutboxEvent | Identidade de integração e evento durável, apenas quando as fases futuras exigirem |

```text
Client 1 ── N Demand 1 ── N Task
                              │
                       N TaskDependency N
                              │
                       outras Task (DAG)
Task 1 ── N TaskMaterialRequirement ── Material ── Link
User N ── N Role N ── N Permission
Demand/Task ── Comment, Activity e AuditLog
```

Usar IDs não sequenciais expostos, timestamps UTC com timezone, chaves estrangeiras e unicidades. Horários são exibidos no fuso aprovado. Não usar JSON genérico para todas as entidades; reservar JSON para metadados limitados. Associações polimórficas precisam de integridade explícita. Arquivamento preserva histórico; remoção/anonymização depende da política de retenção.

### Bloqueio e relógio operacional

Separar três conceitos: **fase de produção**, **condição de liberação** e **tempo operacional consumido**. Uma tarefa pode estar em planejamento e ter requisitos pendentes; “bloqueada” é uma condição derivada dos requisitos, não um status que qualquer pessoa marca para eliminar atraso.

Proposta de liberação: todos os predecessores obrigatórios atingiram a condição aprovada e todos os materiais obrigatórios foram disponibilizados e validados. Link cadastrado não prova material utilizável. Requisitos opcionais não bloqueiam. Alterar requisito obrigatório exige permissão, justificativa e histórico.

**Regra aprovada:** antes da liberação, o relógio não foi iniciado. Ao atender todos os requisitos obrigatórios, registrar `ready_at`, fechar o intervalo de bloqueio válido e passar para **PRONTA PARA INICIAR**, sem abrir intervalo operacional. Somente quando usuário autorizado clicar **INICIAR TAREFA**, a API revalida os requisitos e a permissão, registra `started_at`, inicia o relógio e passa para **EM PRODUÇÃO**. A liberação pode ser automática; o início não.

```text
BLOQUEADA → requisitos obrigatórios atendidos → PRONTA PARA INICIAR
                                                 ready_at
                         → usuário autorizado inicia → EM PRODUÇÃO
                                                        started_at
```

O intervalo entre `ready_at` e `started_at` não consome prazo operacional e permanece mensurável para análise futura de fila/capacidade. No primeiro ciclo sem interrupção, espera em fila = `started_at − ready_at`; enquanto não iniciada, espera corrente = agora − `ready_at`. Essa espera não é bloqueio. Se requisitos forem invalidados antes do início, os períodos de prontidão/bloqueio devem permanecer distinguíveis no histórico; detalhes de novos ciclos/reabertura continuam pendentes para a Fase 3.

Proposta para bloqueio legítimo posterior: fechar intervalo ativo, abrir intervalo bloqueado e preservar tempo já consumido; desbloquear retoma o saldo, nunca devolve orçamento consumido. Essa política depende de aprovação porque o contexto não detalha reabertura/invalidação posterior. Revisão e retorno do cliente não pausam automaticamente o relógio sem regra aprovada.

```text
Tempo operacional consumido = soma dos intervalos ativos
Saldo = orçamento aprovado − tempo operacional consumido
Tempo bloqueado = duração da união dos intervalos bloqueados
Atraso operacional = tarefa iniciada, não terminal, sem bloqueio legítimo e consumo acima do orçamento
```

Múltiplos motivos simultâneos não multiplicam o tempo bloqueado. Bloqueio requer causa válida e histórico; não pode ser marcado manualmente apenas para esconder atraso. Antes de `started_at`, a espera pronta não constitui atraso operacional, embora possa afetar a entrega da demanda. Pausas e retomadas posteriores ainda são propostas: seu cálculo depende da política a aprovar na Fase 3. Não inventar dias úteis, jornada, feriados, arredondamento ou prazo padrão “3 dias”.

O prazo da Demand é uma referência de entrega distinta. Uma tarefa legitimamente bloqueada não está operacionalmente atrasada, mas a demanda pode ter entrega em risco ou prazo de entrega vencido. Mostrar esse impacto com motivo, sem alterar silenciosamente a promessa ao cliente. Prazo final da demanda não é automaticamente a soma dos prazos das tarefas.

### Integridade e concorrência

Dependências formam grafo acíclico. Rejeitar ciclos transitivos, auto dependência e arestas duplicadas. Proposta inicial: dependências somente na mesma Demand; permitir entre demandas exigiria aprovação e regras de escopo.

Concluir predecessora, validar material e liberar dependente deve ocorrer em transação com locks em ordem determinística e reavaliação de todos os requisitos. Serializar alterações do grafo por demanda, para que duas inserções concorrentes não criem ciclo apesar de verificações isoladas. Usar versão/ETag para edições concorrentes e chave idempotente para comandos repetidos. Constraints complementam a aplicação.

Predecessora cancelada não satisfaz automaticamente requisito. Reabrir predecessora, invalidar material ou adicionar requisito após início exige política explícita; não propagar bloqueios silenciosamente até definir impacto. Job de reconciliação pode corrigir projeções futuras, mas a integridade principal não depende de polling.

Critérios de aceite futuros: landing page bloqueada por identidade/textos/imagens; liberação apenas com todos os obrigatórios; `ready_at` sem contagem operacional; espera pronta mensurável e fora do prazo; início explícito autorizado registra `started_at` uma vez e abre um único intervalo; início rejeitado se os requisitos deixarem de estar atendidos; múltiplos bloqueios sem dupla contagem; reenvio ou dois inícios simultâneos não duplicam o relógio; desbloqueio jamais inicia produção; ciclo concorrente rejeitado; demanda em risco continua visível; reabertura conforme decisão futura.

## 8. Autenticação

Login aprovado por e-mail/senha, sem cadastro público. Administradores iniciais: Arino e Monique; demais usuários Colaborador. Criação/desativação e gestão de papéis por administradores. Convites não são necessários na fundação. Better Auth assume login, hashing, recuperação e ciclo de sessões. Seu padrão documentado é scrypt; não assumir Argon2 automaticamente. Proposta: manter scrypt com parâmetros adequados e custo medido na VPS, ou usar extensão oficial de hashing com Argon2id caso aprovada e testada. Nunca desenvolver algoritmo criptográfico. [Hashing Better Auth](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx), [orientação OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Senhas longas, limite máximo razoável sem truncamento silencioso, bloqueio de senhas comuns, mensagens sem enumerar contas e rate limit progressivo. Recuperação automática por SMTP fica para depois; não disponibilizar endpoint provisório de reset. Administradores podem iniciar procedimento administrativo, mas sua execução segura será desenhada antes de habilitar recuperação. Mudança de senha/desativação revoga sessões. Não exigir trocas periódicas arbitrárias.

Web: cookie opaco HttpOnly, Secure em HTTPS, SameSite apropriado; proteção CSRF e verificação de Origin nas mutações, lista de origens explícita. Sessão persistida no PostgreSQL, revogável; evitar token de autenticação em localStorage. Validar funcionamento real de revogação e eventual cache da biblioteca. Rotacionar sessão após autenticação/elevação quando suportado.

Política aprovada: validade absoluta de 7 dias, inatividade de 12 horas, persistência e revogação no banco, cookies HttpOnly e Secure com HTTPS, CSRF/Origin nas mutações e nenhum token em localStorage. MFA fica para endurecimento; SMTP de recuperação fica para depois. Atualizar atividade não prorroga validade absoluta.

## 9. Autorização/RBAC

Negar por padrão. Toda leitura, lista, alteração, exportação e comando deve verificar permissão e escopo no backend. UUID não é controle de acesso. Filtrar listas no SQL; impedir que comentários, histórico ou notificações revelem recursos inacessíveis.

| Papel proposto | Capacidades candidatas, sujeitas à matriz aprovada |
| --- | --- |
| Administrador (aprovado) | Criar/desativar usuários, gerenciar papéis/permissões e iniciar procedimentos administrativos de recuperação; sem privilégios de módulos futuros inventados |
| Coordenação | Clientes, criação/distribuição, prioridades, requisitos e revisões |
| Colaborador (aprovado) | Papel padrão dos demais usuários; acesso protegido da fundação. Ações de negócio serão definidas nas respectivas fases |
| Leitura | Consultar escopo permitido sem mutações |
| Integração | Ações e clientes permitidos por identidade de máquina; sem privilégios humanos herdados |

Somente Administrador e Colaborador são papéis iniciais; Coordenação, Leitura e Integração da tabela são candidatos futuros, não papéis a criar na Fase 1. Exemplos futuros de Permission: `client.read`, `client.write`, `demand.assign`, `task.transition`, `requirement.validate`, `credential.reference.read`, `audit.read`, `user.manage`. Aprovar se colaboradores veem toda a agência ou apenas clientes/tarefas atribuídos. Permissão de gerenciar papéis não deve permitir autoelevação sem controle. Mudanças de papel têm efeito imediato e são auditadas.

Não iniciar com multi-tenancy/SaaS. Se surgir múltipla agência, será uma revisão arquitetural de isolamento, não só adicionar uma coluna. RLS pode ser defesa adicional futura; não expor PostgreSQL ao frontend nem usá-la como substituto das regras da API.

## 10. Segurança e credenciais

### Comparação de armazenamento

| Critério | A — criptografadas no OriumSystem | B — cofre externo |
| --- | --- | --- |
| Experiência | Consulta integrada | Usuário abre cofre com identidade própria |
| Superfície de risco | API precisa conseguir descriptografar; comprometimento de app + chave expõe valores | App armazena referências; comprometimento da app isolada não entrega senhas |
| Criptografia | Projetar envelope, AEAD, rotação, recuperação e acesso de revelação | Reutiliza projeto especializado e clientes; manutenção e backups continuam necessários |
| Permissões/auditoria | Unificadas, mas com implementação sensível | Políticas do cofre separadas; auditar referência não prova quem revelou senha |
| Operação | Menos serviços, maior responsabilidade de segurança | Serviço adicional, atualizações e procedimento próprio de recuperação |
| Integração | API interna personalizada | Compatibilidade real e recursos/licenças devem ser validados |

Está aprovada a **direção preferencial B**: cofre externo e apenas referências no OriumSystem; Vaultwarden é o candidato inicial, não produto definitivamente homologado ou implantação autorizada. A proposta de integração é acesso humano ao cofre, sem chave mestra, senha do cofre ou sessão de desbloqueio geral na aplicação. Bitwarden oficial permanece alternativa a avaliar na Fase 6. Mudança para armazenamento de valores secretos exige nova aprovação.

Coleções por cliente/equipe, contas individuais, MFA, cadastro público desativado e administração restrita. Permissões no OriumSystem e no cofre devem ser revisadas conjuntamente: ocultar uma referência não revoga acesso já concedido no cofre. Validar recursos de eventos/auditoria do produto escolhido; não prometer auditoria granular de revelação se ele não a oferecer.

Se A for escolhida, só avançar após revisão específica: AES-256-GCM ou equivalente AEAD de biblioteca confiável, nonce único, dados associados ao cliente/item, chave de dados protegida por chave mestra fora do banco, versão de chave e rotação testada. Banco e backups nunca levam chave mestra junto. Chave perdida torna dados irrecuperáveis; chave exposta exige rotação e resposta a incidente. Revelação requer autorização específica, reautenticação, auditoria sem conteúdo e resposta sem cache. A criptografia em repouso não protege contra backend comprometido com acesso às chaves.

### Controles gerais

- Secrets locais em arquivos ignorados pelo Git; em produção arquivos com permissões restritas montados como secrets. Docker secrets em Compose não devem ser tratados como criptografia automática em repouso. Apenas placeholders no repositório.
- Banco sem porta pública, usuário da app sem superuser/DDL; migração com identidade separada; acesso administrativo restrito. TLS quando o banco estiver fora da rede local privada confiável.
- HTTPS, headers de segurança, CSP compatível, validação de tamanho, timeouts e tratamento uniforme de erros. Comentários em texto/Markdown limitado, sanitização de conteúdo e URLs; bloquear esquemas perigosos.
- Não buscar automaticamente URLs cadastradas. Futuras prévias/webhooks exigem defesa contra SSRF, redirects e acesso a redes internas.
- Logs não incluem senhas, cookies, tokens, chaves, corpos sensíveis ou URLs com credenciais; redaction por campo e testes de vazamento. Erros externos não revelam stack SQL.
- AuditLog registra quem/qual identidade, o que, quando, objeto, resultado e correlação. Mudanças críticas e leitura/revelação sensível entram no desenho; log de auditoria sem valores secretos.
- Auditoria de negócio é append-only para a identidade comum da app, com permissões SQL específicas. Administrador do banco ainda pode adulterar; cópia externa restrita aumenta resistência. Não alegar imutabilidade absoluta.
- Dados pessoais mínimos, acesso restrito e retenção definida pelo responsável; avaliação jurídica de obrigações de privacidade antes da produção.

## 11. Estratégia de API

REST JSON em `/api/v1`, contratos OpenAPI e respostas sanitizadas. Autenticação resolve identidade; autorização aplica política; casos de uso aplicam invariantes. Compartilhar DTOs e cliente tipado, nunca modelos internos de persistência com web/mobile.

Endpoints de recursos para operações simples; comandos explícitos para ações críticas, por exemplo `/tasks/{id}/start`, `/complete`, `/requirements/{id}/validate`. Um PATCH genérico de status não pode contornar verificações. Paginação e ordenação determinística, filtros permitidos, limites de página e payload; códigos HTTP coerentes e erro estruturado com código de negócio e request ID.

Datas ISO 8601, versão do recurso e conflito `409` em alteração incompatível. Escritas repetíveis por agentes/mobile usam chave de idempotência vinculada à identidade, operação e payload, com persistência e validade definidas. Não permitir atualização direta de tempo consumido pelo cliente.

Webhooks são futuros, assinados, com ID de evento, timeout, retry, deduplicação e proteção SSRF. Polling basta inicialmente; SSE só quando atualização frequente justificar. Compatibilidade documentada e mudanças destrutivas versionadas. `/health/live` e `/health/ready` sem divulgar configuração ou secrets.

## 12. Estrutura proposta do repositório

Está aprovado **monorepo com pnpm workspaces**. A recomendação é começar sem orquestrador de build adicional.

| Opção | Vantagem | Custo |
| --- | --- | --- |
| Monorepo | Contratos e mudanças web/API revisados juntos; agentes compartilham contexto; uma CI | Exige limites de dependências e coordenação de arquivos |
| Repositórios separados | Controle de acesso e releases independentes por equipe | Versionamento/publicação de contratos, duplicação de CI e sincronização de mudanças |

Com equipe pequena, o monorepo reduz coordenação sem obrigar deploy conjunto. Repositórios separados ganham valor se equipes e permissões divergirem.

**Árvore ilustrativa futura; apenas `docs/adr` foi criado para documentação nesta revisão:**

```text
OriumSystem/
├── PROJECT_CONTEXT.md
├── ROADMAP.md
├── PROMPT_01_ORQUESTRADOR.md
├── ARCHITECTURE_PROPOSAL.md
├── AGENTS.md
├── apps/
│   ├── web/src/                 # interface, sem import do backend
│   └── api/src/
│       ├── modules/             # identity, clients, operations...
│       │   └── operations/      # routes, services, repositories, tests
│       └── infrastructure/      # db, auth adapter, logging
├── packages/
│   └── contracts/               # DTOs e cliente público tipado
├── db/migrations/               # SQL revisado, criado na fase autorizada
├── tests/e2e/
├── docs/
│   ├── adr/
│   ├── api/
│   └── runbooks/
├── infra/                       # Dockerfiles, Compose e proxy na fase própria
└── .github/workflows/           # se GitHub for aprovado
```

Não criar app mobile, worker ou pacote de abstrações antes da necessidade. Foram registrados apenas ADRs aceitos para decisões explicitamente aprovadas: [0001 — sistema e API](docs/adr/0001-sistema-proprio-monolito-api.md), [0002 — monorepo](docs/adr/0002-monorepo-pnpm.md), [0003 — stack](docs/adr/0003-stack-e-simplicidade.md), [0004 — autenticação e autorização](docs/adr/0004-better-auth-rbac.md), [0005 — início operacional](docs/adr/0005-inicio-explicito-tarefa.md) e [0006 — direção do cofre](docs/adr/0006-cofre-externo-referencias.md). Recuperação, calendário, sessões e detalhes do cofre não receberam ADR de decisão aceita.

## 13. Infraestrutura

Desenvolvimento aprovado no computador local, com web/API locais e PostgreSQL isolado em Docker. Configuração local está autorizada na Fase 1; VPS, Caddy, staging e produção não estão. Fixtures fictícias; não copiar produção nem cofre para prompts/testes. No Windows, definir uso de Docker Desktop/WSL2 e considerar licenciamento aplicável à organização antes de instalar.

Staging é opcional: útil antes de mudanças sensíveis, com banco e secrets próprios e dados sintéticos. Se na mesma VPS, isolar redes, volumes, domínio e recursos; não tratar isso como redundância.

Produção futura: VPS Linux, Compose com Caddy, API e PostgreSQL; Caddy entrega build web e encaminha `/api`. Volumes persistentes, reinício controlado, processos sem root onde possível, limites de recursos, healthchecks e imagens fixadas. Dimensionamento só após medir carga; quantidade de usuários, orçamento e VPS disponível ainda não foram informados.

HTTPS por ACME com renovação monitorada; portas públicas mínimas, SSH com chaves e administração restrita. Banco/cofre administrativos sem exposição irrestrita. Cofre pode compartilhar host inicialmente por custo, mas essa opção mantém falha e comprometimento comuns; separá-lo quando criticidade/orçamento justificarem.

Logs estruturados em stdout com rotação e disco monitorado. Monitoramento inicial: disponibilidade externa, uso de disco/volume, memória, CPU, erros, certificado e idade do último backup. Alertas por canal aprovado. Não exigir stack Prometheus/Grafana/Loki completa para começar.

CI futura: lint, tipos, testes de domínio/segurança, integração com PostgreSQL, build e varredura de secrets/dependências. Gerar imagem identificada pelo commit; promoção para produção controlada. Credenciais de CI restritas e fora de logs. Deploy registra versão, executa migrations autorizadas uma vez, verifica readiness e fluxo básico.

Rollback: manter imagem anterior e configuração versionada; migrations compatíveis por expansão/contração. Reverter imagem não reverte schema. Mudança destrutiva requer janela, backup, ensaio e plano de recuperação; restaurar backup pode perder dados posteriores e precisa de decisão consciente. Reiniciar Compose pode causar breve indisponibilidade, aceitabilidade pendente.

## 14. Estratégia de backup

Proposta inicial sujeita à aprovação: dump PostgreSQL diário em formato custom, criptografado e copiado para destino fora da VPS; retenção de 7 diários, 4 semanais e 3 mensais. **RPO candidato: até 24 horas. RTO candidato: até 4 horas**, metas a medir em restauração; não garantias.

Backup inclui banco, configuração necessária, referência de versão e dados persistentes do cofre conforme seu procedimento oficial, inclusive anexos quando existentes. `pg_dump` não inclui automaticamente papéis/configurações do cluster; documentá-los de forma protegida. Cada banco tem dump consistente, mas bancos distintos não formam snapshot transacional conjunto. Configuração e chaves de recuperação têm custódia separada e acesso mínimo.

Google Drive e outros links não significam backup dos arquivos externos. Aprovar quem preserva e controla esses materiais. Snapshots da VPS e volume Docker isolado não substituem cópia externa restaurável.

Teste mensal em ambiente isolado: baixar backup, verificar integridade, restaurar banco, permissões e cofre, conferir contagens/relações e fluxo operacional com credenciais de teste, medir tempo e registrar evidência. Alertar por backup ausente, falha de envio, crescimento de armazenamento ou teste vencido. Guardar chave de descriptografia e acesso emergencial fora do servidor, com responsável definido.

Se perda de um dia for inaceitável, avaliar WAL/PITR e ferramenta como pgBackRest antes de produção. Mais frequência de dump pode ajudar, mas não oferece a mesma recuperação pontual. Definir exclusão ao fim da retenção e como tratar dados removidos que permanecem em backups.

## 15. Aplicativo mobile futuro

Começar com web responsiva; PWA pode servir para acesso interno, sem presumir equivalência a app/push nativo. Na Fase 8, avaliar React Native/Expo por compartilhamento de TypeScript/contratos, comparando Flutter se experiência da equipe favorecer. Não decidir distribuição sem saber Android/iOS e dispositivos disponíveis.

O app usa a mesma API e regras, com credenciais em armazenamento seguro do sistema operacional, sessões revogáveis e política própria de dispositivos. Se necessário, adotar OAuth/OIDC com Authorization Code + PKCE, sem inventar fluxo de tokens. Não embutir segredo de cliente em aplicativo distribuído.

Push depende das plataformas e serviços de entrega, inclusive APNs/FCM conforme solução escolhida; self-host do backend não elimina isso. Payload mínimo, sem credenciais/dados sensíveis na tela bloqueada. Ação rápida exige autenticação e revalidação na API, versão e idempotência. Offline fica fora do MVP; futura sincronização exige conflito explícito, não sobrescrita automática.

## 16. Integração futura com agentes/Hermes

Somente na Fase 9, após API e domínio estáveis. “Hermes” ainda não foi identificado por produto, versão, repositório ou modo de autenticação; não presumir SDK, MCP ou capacidade específica.

Criar identidade de máquina própria por integração, scopes e clientes permitidos, expiração/rotação, rate limits e revogação. Tokens simples, se aprovados, são aleatórios e armazenados por hash quando apenas verificados; OAuth de máquina pode ser avaliado conforme ecossistema. Nunca compartilhar conta administrativa humana.

Agente consulta ou comanda pela API; adapter de tools/MCP apenas traduz chamadas para casos de uso. Sem SQL, shell de produção ou conexão de banco. Começar com leitura, depois ações pequenas autorizadas. Ações críticas, como excluir dados, alterar permissões, cancelar demandas ou divulgar links, exigem confirmação humana vinculada ao comando exato, validade e estado atual.

Auditar identidade do agente, usuário representado quando houver, correlação e resultado. Conteúdo de comentários, links e materiais é entrada não confiável: instruções presentes ali não concedem privilégios. Secrets e credenciais de clientes nunca entram em prompts ou respostas de tools. Limitar campos e volume; definir retenção de prompts e política do fornecedor antes de enviar dados da agência.

## 17. Estratégia de orquestração dos agentes de programação

A divisão abaixo orienta a Fase 1 autorizada. A execução e delegações efetivas serão registradas em relatório próprio; não atribuir trabalho a agentes que não tenham recebido/executado a tarefa.

| Classe | Tarefas | Supervisão |
| --- | --- | --- |
| Baixo custo | Documentação, fixtures, CRUD já especificado, testes simples, alterações repetitivas | Contrato claro, diff pequeno e validação automática; CRUD com dados sensíveis sobe de classe |
| Médio | Componentes, endpoints, integração de módulos, regras moderadas | Agente com capacidade comprovada, testes de integração e revisão do orquestrador |
| Alto raciocínio | Arquitetura, auth, segurança, concorrência, prazos/bloqueios, migrations críticas, debugging complexo | Agente especializado e revisão independente, cenários adversariais e aprovação humana quando pertinente |

Escolher modelo por capacidade demonstrada, custo total com retrabalho, privacidade, ferramentas e latência, sem vincular a um fornecedor. Manter interfaces, decisões e testes no repositório para permitir troca de modelo.

Cada tarefa recebe fase autorizada, objetivo, arquivos permitidos, contratos, invariantes, critérios de aceite e comandos de verificação. Agentes leem fontes de verdade e ADRs; dúvidas de negócio voltam ao responsável. Orquestrador pode delegar módulos independentes em branches/worktrees separados, com um dono por arquivo ou fronteira; autenticação, schema e contratos têm coordenação central.

Executor entrega diff e evidências, incluindo limitações. Revisor independente verifica requisito, autorização, vazamento de dados e testes relevantes. Orquestrador integra e valida o fluxo completo antes de propor merge. Agente não aprova sua própria revisão sensível nem marca fase concluída sem evidência. Não entregar secrets ou dados reais aos agentes. Evitar múltiplos agentes editando migrations simultaneamente.

## 18. Riscos técnicos

| Risco | Tratamento proposto |
| --- | --- |
| Regra ambígua de calendário, revisão e reabertura | Aprovar exemplos concretos e ADR antes de implementar o relógio |
| Bloqueio usado para mascarar atraso | Motivos derivados, validação de requisitos, autorização e histórico |
| Ciclos/liberações concorrentes | Transações, serialização por demanda e testes concorrentes com banco real |
| Crescimento de papéis e acesso por recurso | Matriz explícita, negação por padrão e testes contra acesso horizontal |
| Dependência de biblioteca de auth relativamente recente | Versões fixas, acompanhamento de avisos, isolamento do adapter e revisão especializada |
| Cofre integrado de modo inseguro | Referências sem descriptografia pelo backend; validação de APIs e políticas |
| VPS única | Backup externo e recuperação ensaiada; aceitar indisponibilidade ou ampliar infraestrutura |
| Links externos inacessíveis ou removidos | Responsável e validação explícita; não confundir URL existente com requisito satisfeito |
| Licença/edição muda ou funcionalidade é comercial | Inventário de dependências e revisão da versão efetivamente adotada |
| Logs/auditoria vazam dados ou crescem sem limite | Redaction, retenção, quotas e alertas de disco |
| IA erra regra ou amplia escopo | Contratos pequenos, revisão e gates por fase; permissões de ferramenta limitadas |
| Notificação duplicada ou perdida | Outbox, idempotência e reprocessamento; domínio independe de entrega externa |

## 19. Alternativas descartadas e motivo

- **Fork amplo de Twenty/Plane:** maior acoplamento e custo de atualização; regras críticas ainda exigem homologação. Integração posterior continua possível.
- **Dois produtos completos sincronizados para CRM e tarefas:** duplica identidade, autorização e fonte de verdade; falhas de sincronização aumentam operação.
- **ERP completo:** finanças e outros módulos fora do escopo trazem código e configuração desnecessários.
- **Next.js full-stack como núcleo obrigatório:** aplicação interna não precisa de SSR/SEO; Fastify separado torna API e deploy mais explícitos. Next.js continua alternativa se requisito concreto justificar.
- **Microserviços, Kubernetes e broker na fundação:** não há escala ou equipes independentes que compensem operação distribuída.
- **Backend hospedado obrigatório / acesso direto do cliente ao banco:** conflita com independência/self-host e centralização das regras na API.
- **JWT duradouro como única sessão web:** revogação e mudança de permissões ficam mais difíceis; preferir sessão de servidor.
- **Motor genérico de workflow / designer visual inicial:** estados e DAG explícitos bastam; reconsiderar se processos configuráveis complexos surgirem.
- **Servidor próprio de arquivos inicial:** contexto autoriza referências externas; não introduzir storage de objetos sem necessidade.
- **Cofre próprio como padrão:** criptografia e recuperação ampliam responsabilidade; só considerar mediante escolha consciente e revisão.
- **Push/offline/mobile/agente antecipados:** fases posteriores; preparar contrato não significa implementar recurso.

## 20. Decisões que ainda precisam de aprovação humana

Fase 0 aprovada: direção técnica, contas, sessões, RBAC mínimo e ambiente local foram definidos. Não há decisão de negócio pendente que bloqueie tecnicamente a Fase 1. A Fase 1 está autorizada e deve ser verificada antes de ser marcada concluída. Questões de ferramentas/rede disponíveis são impedimentos de execução a relatar, não reabertura da arquitetura.

## DECISÕES PENDENTES DO RESPONSÁVEL

Rastreabilidade Q1–Q20 preservada; itens futuros continuam pendentes. Aprovação da Fase 1 não aprova produção ou módulos futuros.

### A) PRECISA SER DECIDIDO ANTES DA FASE 1

Nenhuma pendência arquitetural restante. Identidade, sessões, RBAC e ambiente local foram respondidos. E-mails e senhas reais dos administradores serão informados pelo responsável no provisionamento local; não inventar dados nem credenciais padrão. Isso não impede implementar/testar a fundação com identidades fictícias de teste.
### B) PODE SER DECIDIDO ANTES DA FASE CORRESPONDENTE

1. **Q3 — Dimensão e infraestrutura:** estimar equipe/carga antes da Fase 4; orçamento, VPS e tolerância à indisponibilidade antes da Fase 10. Não são bloqueios da fundação local de um sistema inicialmente pequeno.
2. **Q4/Q5 — Endurecimento de identidade:** MFA fica para a fase de endurecimento. Recuperação automática por SMTP será posterior, sem reset provisório inseguro; políticas sensíveis serão refinadas na Fase 6.
3. **Q6 — Matriz dos módulos:** visibilidade de clientes e equipe antes da Fase 2; atribuição, aprovação, alteração de prazo/requisitos e validação de materiais antes da Fase 3; credenciais antes da Fase 6.
4. **Q7 — Calendário:** dias corridos/úteis, jornada, fuso operacional, feriados e orçamento por tarefa antes da Fase 3. Nenhum desses detalhes altera o início explícito aprovado.
5. **Q8 — Planejamento residual:** a questão de início foi respondida. Se existir uma etapa de planejamento além dos requisitos obrigatórios, explicitar sua condição de prontidão antes da Fase 3; não usá-la para iniciar o relógio automaticamente.
6. **Q9 — Pausas posteriores:** definir quais causas legítimas pausam uma tarefa já iniciada, saldo, revisão interna/cliente e retomada antes da Fase 3. Nada disso foi aprovado implicitamente pela regra do primeiro início.
7. **Q10 — Dependências:** mesma demanda ou entre demandas, condição de conclusão/aprovação, cancelamento, reabertura e requisitos novos antes da Fase 3.
8. **Q11 — Materiais:** responsável pela validação e representação mínima na Fase 3; catálogo completo na Fase 5. Confirmar compatibilidade da sequência sem antecipar módulo completo.
9. **Q12 — Prazo da demanda:** compromisso com cliente, renegociação, aprovação externa e evidências antes da Fase 3.
10. **Q13 — Cofre, detalhes restantes:** existência de cofre, homologação do Vaultwarden, identidade/permissões e maneira de abrir referências antes da Fase 6 ou de registrar acessos reais. A direção externa com apenas referências já foi respondida; revelação de senha dentro da aplicação não faz parte da direção aprovada.
11. **Q14 — Retenção:** regras por categoria antes de persistir dados reais e, em particular, no desenho da auditoria da Fase 6. Fundação/testes usam dados fictícios; não inventar retenção definitiva.
12. **Q15 — Backup:** RPO/RTO, retenção, destino externo, custódia e restauração antes de produção/Fase 10.
13. **Q16 — Operação:** domínio, staging, CI/CD, alertas, deploy e isolamento do cofre antes da Fase 10. Provedor Git pode ser escolhido quando o fluxo de colaboração o exigir, sem decidir CI de produção agora.
14. **Q17 — Notificações:** canais, eventos, destinatários, horários e conteúdo permitido antes da Fase 7.
15. **Q18 — Mobile:** plataformas, distribuição, aparelhos e offline antes da Fase 8.
16. **Q19 — Hermes/IA:** produto/versão, permissões de máquina, confirmação humana e fornecedores autorizados antes da Fase 9. API única e proibição de acesso direto ao banco já estão aprovadas.
17. **Q20 — Orquestração e execução:** classes de custo/risco e revisão independente são propostas para confirmar antes de delegar implementação. Não bloqueiam a arquitetura. A autorização explícita para começar a Fase 1 já foi concedida, com tarefas pequenas e fronteiras exclusivas. Revisão adicional de segurança e integração é obrigatória; fases posteriores não foram autorizadas.

### C) JÁ FOI RESPONDIDO/APROVADO

1. **Q1/Q2:** sistema próprio, sem Twenty/Plane como base; monólito modular, API REST independente, monorepo pnpm; React/Vite/TypeScript, Node/Fastify/TypeScript, PostgreSQL, Drizzle, Better Auth, RBAC centralizado, Zod; sem Redis/Kubernetes/microserviços inicialmente.
2. **Q4:** e-mail/senha, sem cadastro público; Arino e Monique administradores; demais Colaborador. Administradores criam/desativam usuários, gerenciam papéis/permissões e iniciam procedimento administrativo de recuperação. SMTP automático é posterior; nenhuma recuperação provisória insegura. MFA é posterior.
3. **Q5:** sessões persistidas e revogáveis, 7 dias absolutos, 12 horas de inatividade; cookies HttpOnly, Secure em HTTPS, CSRF/Origin nas mutações e sem autenticação em localStorage.
4. **Q6, fundação:** Administrador e Colaborador, deny-by-default no backend. Detalhes de acesso aos módulos de negócio permanecem para suas fases.
5. **Ambiente local:** web/API locais e PostgreSQL isolado em Docker; sem produção/VPS/Caddy/staging nesta fase.
6. **Q8:** somente INICIAR TAREFA autorizado começa relógio e registra started_at; ready_at registra prontidão; espera não consome prazo; bloqueios com causa válida e histórico.
7. **Q13:** direção externa com apenas referências e Vaultwarden candidato, sem implantação nesta fase.
8. **Q19, fronteiras:** todos os consumidores usam a mesma API; agentes jamais acessam diretamente PostgreSQL de produção.
9. **Q20:** Fase 1 explicitamente autorizada; delegação com fronteiras exclusivas e revisão adicional de segurança; não avançar à Fase 2.

Q3/Q7/Q9–Q12/Q14–Q18 e detalhes futuros de Q4–Q6/Q8/Q13/Q19 continuam na categoria B. Os ADRs de fundação e início explícito registram as decisões aceitas, sem antecipar essas questões.