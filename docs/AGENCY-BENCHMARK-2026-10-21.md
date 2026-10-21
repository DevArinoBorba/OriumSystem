# OriumSystem — comparação para gestão da agência

Data: 21/10/2026. Escopo: análise e recomendações; nenhuma implementação autorizada por este relatório.

## Recomendação principal

O maior ganho é tornar o trabalho cotidiano mais simples e a informação operacional mais confiável. Recomendo uma experiência centrada em **demandas**, com etapas opcionais, seguida de indicadores coerentes, revisão da geração de prazos por templates, capacidade semanal e controle do escopo contratado. Não recomendo substituir a base do Orium por outro produto nem remover agora a entidade de tarefas.

Productive e Scoro são boas referências para planejamento e economia de serviços; Operand, para a rotina de agência; Worklenz, para alocação e operação. Plane e Leantime ajudam a simplificar organização; OpenProject, a visualizar dependências; Twenty e Frappe CRM, a separar venda de entrega; ERPNext e Gauzy, a compreender apontamentos e custos. Isso não torna necessário incorporar todos esses módulos.

## Método e limites da evidência

- Leitura de AGENTS.md, PROJECT_CONTEXT.md, ROADMAP.md, docs/AGENT-AUTONOMY.md e ADRs 0001/0003; inspeção focal de backend, contratos, migrações e componentes web. Base local: commit `8817dfa`, incluindo o estado de trabalho encontrado em 21/10.
- Consulta a fontes oficiais públicas dos oito projetos e três serviços, com verificação de licenças e distinções comerciais. Inspeção adicional do código público de timesheets do ERPNext. Não foram instalados nem executados esses produtos; descrição oficial não equivale a homologação.
- Trail foi consultado antes do código e não encontrou nós. Não havia diretório `.trail/learnings` disponível. A investigação prosseguiu por símbolos e trechos. Não se atribui economia de tokens inexistente.
- `maestri list` não pôde executar: CLI ausente do PATH; `MAESTRI_CLI` também indisponível, impedindo inclusive `debug`. OpenCode/Antigravity não puderam ser confirmados nem acionados. A nota `oriumsystem-acompanhamento` não foi atualizada por essa limitação; nenhuma nota substituta foi criada.
- Havia alterações anteriores em DashboardView.tsx, styles.css e package.json, além de arquivos não rastreados. Foram preservadas. Somente este relatório foi criado. Nenhum serviço, teste, banco ou publicação foi iniciado.
- **Existe** significa implementação localizada; **parcial**, base implementada sem o fluxo completo proposto; **ausente**, não localizado no recorte de código/contratos/migrações inspecionado; **não verificado**, sem prova suficiente. Ausência não é uma auditoria exaustiva de toda integração externa.
- O roadmap declara fases 0–11 concluídas tecnicamente, mas preserva registros anteriores de pendências. Este trabalho não reconciliou todos os aceites nem verificou produção. Recursos locais e documentos não provam disponibilidade real em produção.

## Situação atual do Orium

| Área | Situação | Evidência local e consequência |
|---|---|---|
| Clientes e equipe | Existe | `apps/api/src/clients.ts`; contratos e cadastro web. Não propor novo cadastro básico. |
| Perfil ampliado, briefing, canais, onboarding e escopo contratado | Parcial | `packages/contracts/src/index.ts:114`, `apps/api/src/clients.ts:736`, migração `0007_phase2a_clients_scope_team.sql`. Há periodicidade, quantidade e SLA no backend; buscas por esses campos não localizaram consumo na web atual. Exposição integral na interface e produção não verificadas. |
| Demandas com tarefas, requisitos e dependências | Existe | `apps/api/src/schema.ts:98`, `demands.ts`; demanda é o agrupador e tarefa concentra responsável, marcos e revisão. |
| Prontidão, início explícito, pausa administrativa e revisão | Existe | `demands.ts:860`, `:955`, `:1138`, `:1199`. Preservar a distinção entre disponibilidade e execução. |
| Materiais e histórico | Existe | `materials.ts:129`, `:309`, `:1087`; não propor outra central genérica de links. |
| Carga atual da equipe | Existe | `dashboard.ts:296`: contagens por pessoa, visibilidade administrativa. Não equivale a capacidade em horas por semana. |
| Produtividade e gargalos | Existe, com divergências | `reports.ts:35`, `:173` e `ReportsView.tsx:277`. Já há espera, ciclo, atrasos e pausas; ver achados abaixo. |
| Templates com dependências e requisitos | Existe | `templates.ts`, migração 0006, UseTemplateModal. Reutilização já existe; geração de datas precisa revisão. |
| Revisões e retrabalho estruturado | Parcial | `demands.ts:984` grava pedido de ajustes e feedback; não localizado registro de rodadas vinculado à versão do entregável e causa padronizada. |
| Capacidade semanal, ausências e reservas de esforço | Ausente | Não localizados modelos/API de disponibilidade, reservas ou estimativa de esforço em horas. `estimatedDays` em template não é capacidade. |
| Consumo de pacote, saldo e geração recorrente | Parcial | Existe `client_scope_item`; não localizado vínculo de consumo por entrega/período ou gerador de demandas recorrentes. |
| Funil comercial e rentabilidade | Ausente | Não localizados modelos operacionais de oportunidade, receita/custo por projeto ou apontamento de trabalho. Não confundir duração entre marcos com horas trabalhadas. |
| Notificações, PWA e backups | Existe na fonte; operação não verificada | Arquivos próprios na API e web. Não são lacunas novas deste benchmark. |

### Quatro achados que precedem novas métricas

1. **Atraso tem definições diferentes.** `dashboard.ts:358` exige início e status operacional ativo; `reports.ts:209` conta toda tarefa não concluída com data vencida, incluindo bloqueadas. A regra de negócio exclui atraso operacional durante bloqueio legítimo. Separar risco da data prometida de atraso operacional, com nomes explícitos.
2. **Rótulos não correspondem aos intervalos calculados.** O ciclo em `reports.ts:96` é conclusão menos início; `ReportsView.tsx:278` diz prontidão até conclusão. “Produção média” é início até agora/conclusão (`reports.ts:211`), mas a interface diz início até revisão (`ReportsView.tsx:291`). Esse intervalo não representa esforço efetivo nem desconta automaticamente pausas.
3. **Estatísticas exigem semântica temporal estável.** Lead time e conclusão da demanda usam `updated_at` (`reports.ts:79–82`), marcador de alteração, não um marco exclusivo de conclusão. A média de espera dos gargalos filtra tarefas abertas e com início registrado (`reports.ts:210–215`): não descreve toda a fila atual ainda não iniciada. Sem amostra, taxa de pontualidade retorna 100%; convém apresentar “sem entregas no período”.
4. **Templates já calculam datas automaticamente.** `templates.ts:552` usa duração estimada quando falta data da demanda; `:589` deriva datas das tarefas por deslocamento e duração. `UseTemplateModal.tsx:125` também preenche uma data sugerida. Isso precisa ser reconciliado com a decisão de prazo informado pelo criador e sem duração automática por serviço. Não ampliar recorrência ou previsões sobre essa ambiguidade. Não é uma afirmação de defeito reproduzido em produção: é divergência identificada na leitura.

## Matriz das referências

As sugestões abaixo são inferências para o Orium. As fontes comprovam os recursos anunciados e as condições indicadas, não sua adequação automática à agência.

| Referência | O que aproveitar como ideia | Comparação com Orium | Licença, edição e limite comercial |
|---|---|---|---|
| **Worklenz/worklenz** | Planejamento de pessoas entre projetos, apontamentos e visualização de utilização. | Carga existe; capacidade semanal e esforço registrado ausentes. Boa referência operacional, sem necessidade de outra plataforma. | Repositório **AGPL-3.0**. Site separa Community self-hosted, Cloud e planos pagos; relatórios avançados/SSO aparecem no Business self-hosted. Não inferir que toda captura do README está na Community. [Código e recursos](https://github.com/Worklenz/worklenz), [edições](https://www.worklenz.com/pricing/). |
| **ever-co/ever-gauzy** | Separar trabalho registrado, alocação, despesas e resultado. | Relógio operacional existe; timesheet e custos ausentes. Monitoramento de atividade e folha excedem a necessidade atual. | Community **AGPLv3**, alternativas comerciais Small Business/Enterprise e condições por arquivo/subpasta. Página de preços não entregou tabela utilizável nesta consulta; paridade por edição não verificada. [Recursos](https://github.com/ever-co/ever-gauzy), [licenças](https://raw.githubusercontent.com/ever-co/ever-gauzy/develop/LICENSES.md), [oferta](https://gauzy.co/pricing/). |
| **Leantime/leantime** | Objetivo do trabalho, marcos e contexto próximos da execução; organização adequada a não especialistas. | Templates e dependências existem; objetivo/critério de aceite podem melhorar o briefing sem criar planejamento estratégico completo. | **AGPL-3.0**. README declara a tabela de recursos como OSS; página comercial distingue núcleo Community e recursos avançados por plugins. Conferir versão/plugin antes de prometer disponibilidade. [Recursos](https://github.com/Leantime/leantime), [edições](https://leantime.io/pricing/). |
| **makeplane/plane** | Vistas salvas e entrada organizada de solicitações; níveis de organização usados conforme necessidade. | Filtros existem; vistas pessoais persistidas e triagem dedicada não localizadas. Não impor ciclos/sprints à agência. | **AGPL-3.0** no repositório. Plano Free anunciado inclui vistas, entrada de trabalho e estimativas; propriedades/tipos adicionais aparecem no Pro. Cloud e self-hosted precisam ser distinguidos. [Código](https://github.com/makeplane/plane), [planos](https://plane.so/pricing). |
| **frappe/erpnext** | Relação entre projeto, atividade, horas e custo; integridade dos apontamentos. | Duração operacional existe, horas trabalhadas e resultado financeiro não. ERP completo seria ampliação desproporcional. | **GPL-3.0**; hospedagem/serviços pagos não tornam o núcleo proprietário. [Repositório](https://github.com/frappe/erpnext), [timesheets](https://docs.frappe.io/erpnext/timesheets). |
| **opf/openproject** | Dependências, marcos e visão conjunta de cronogramas; tornar consequências de bloqueios visíveis. | Dependências existem; análise visual entre demandas e planejamento de pessoas são parciais/ausentes. | **GPL-3.0**, Community e Enterprise. Team planner é apresentado como complemento Enterprise; não tratá-lo como recurso gratuito garantido. [Código](https://github.com/opf/openproject), [glossário oficial](https://www.openproject.org/docs/glossary/), [planner](https://www.openproject.org/docs/user-guide/team-planner/). |
| **twentyhq/twenty** | Vistas por contexto e histórico comercial; modelo de oportunidade separado da execução. | Clientes existem; funil de venda ausente. Mais pertinente como inspiração ou CRM externo futuro do que como base. | Predominantemente **AGPLv3**, arquivos `@license Enterprise` comerciais e determinados pacotes MIT, inclusive ferramentas/SDK/UI; há exceção expressa para aplicações via interfaces. Permissões por linha aparecem no plano Organization. [Licença completa](https://raw.githubusercontent.com/twentyhq/twenty/main/LICENSE), [planos](https://twenty.com/pricing), [produto/código](https://github.com/twentyhq/twenty). |
| **frappe/crm** | Oportunidade, próxima ação e histórico reunidos; passagem clara da venda à entrega. | Cadastro de clientes existe; negociação e follow-up comercial estruturados ausentes. | **AGPL-3.0**. Frappe Cloud cobra hospedagem; não presumir telefonia ou serviços externos gratuitos. [Código](https://github.com/frappe/crm), [oportunidade](https://docs.frappe.io/crm/deal), [hospedagem](https://frappe.io/crm/pricing). |
| **Operand** | Briefings de agência, pauta e identificação de retrabalho. | Briefing parcial; pauta e revisões existem; tipificação do retrabalho ausente. Forte afinidade com a rotina local. | Serviço comercial; não foi identificada licença aberta para copiar implementação. Planos pagos e teste de 7 dias; teste não é edição gratuita. [Agências](https://www.operand.com.br/agencias), [planos](https://www.operand.com.br/planos). |
| **Productive** | Capacidade, horas e orçamento conectados; comparação entre planejado e realizado. | Carga parcial; capacidade, timesheet e orçamento ausentes. Bom modelo conceitual para expansão administrativa opcional. | Serviço comercial. Essential lista planejamento de recursos e tempo; Professional adiciona orçamentos recorrentes; Ultimate lista previsão de receita. Não atribuir tudo ao plano de entrada. [Planos](https://productive.io/pricing/), [visão de orçamento](https://help.productive.io/en/articles/3167633-the-budget-overview-tab). |
| **Scoro** | Reservas de capacidade, disponibilidade e contratos recorrentes conectados à entrega. | Escopo periódico existe no backend; reservas e consumo não localizados. | Serviço comercial modular: oito apps e adicionais; Resource cobre capacidade e Deliver inclui gestão de contratos recorrentes. Trial não é plano gratuito permanente. [Planos atuais](https://www.scoro.com/pricing/), [reservas](https://support.scoro.com/hc/en-us/articles/25995337245197-Getting-started-with-resource-bookings). |

Chatwoot e Activepieces foram excluídos da comparação principal: atendimento/mensageria e automação genérica não respondem diretamente ao foco corrigido de gestão da agência. Hermes/WhatsApp também não é critério de diferenciação deste relatório.

### Inspiração, integração e reaproveitamento são decisões diferentes

**Inspiração funcional:** implementar originalmente um fluxo adequado ao Orium, preservando regras e identidade próprias. É o caminho recomendado aqui; nenhuma cópia de código, layout ou conteúdo foi feita.

**Integração:** manter um sistema especializado externo e trocar dados por API, com fonte de verdade, permissões, idempotência e reconciliação definidas. Só vale se houver uma necessidade concreta, como CRM comercial já adotado. Não há integração pronta comprovada entre Orium e estas referências.

**Reaproveitamento de código:** exige escolher versão/commit e arquivos, verificar a licença efetiva, dependências, avisos e condições comerciais. Semelhança de stack não basta. AGPL/GPL não são licenças permissivas; não se presume que permitam incorporar código em produto fechado sem outras obrigações. A licença do Twenty tem exceções específicas e não autoriza copiar arquivos Enterprise. Nenhum reaproveitamento é recomendado como automaticamente liberado neste relatório; uma decisão concreta exige avaliação das condições aplicáveis.

Inspeção pública focal: `validate_time_logs` e `validate_overlap_for` no [timesheet.py do ERPNext](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/projects/doctype/timesheet/timesheet.py) validam relações e sobreposição de registros, com opções de configuração. A lição para eventual apontamento próprio é exigir integridade dos intervalos e vínculo ao trabalho, não importar aquele código ou os efeitos que ele aplica ao status das tarefas.

## Demandas e tarefas: simplificar a experiência, preservar a capacidade

**Sim, a duplicação pode confundir quando um trabalho simples exige cadastrar uma demanda e depois repetir título, prazo e responsável numa tarefa.** Isso é uma hipótese de usabilidade consistente com a estrutura localizada, não uma pesquisa já realizada com a equipe. “Alterar telefone no rodapé do site” deveria parecer um único trabalho do início ao fim.

A proposta é apresentar **Demanda** como unidade principal. Na criação, informar cliente, entrega, responsável e prazo; o trabalho simples teria uma execução interna única, sem obrigar a pessoa a conhecer a segunda entidade. Quando necessário, “Adicionar etapas” revelaria responsáveis, prazos intermediários e dependências. “Identidade visual → landing page → revisão → publicação” continuaria possível.

Não basta renomear tarefas para etapas em todas as telas. Uma etapa pode conter trabalhos paralelos; inicialmente convém usar o termo que a equipe validar, sem adicionar uma terceira hierarquia. O designer veria a demanda no contexto da sua atribuição e apenas as etapas autorizadas. Ocultar etapas de terceiros na tela não substitui autorização na API.

| Alternativa | Esforço e impacto | Avaliação |
|---|---|---|
| Ajustar linguagem, navegação e agrupar informações | Pequeno a médio; preserva tabelas/API, mas exige consistência de rótulos e ações | Bom primeiro passo, sem resolver sozinho a criação duplicada. |
| Criar fluxo simples com uma execução interna e etapas opcionais | Médio; criação atômica, projeção do estado e política clara de edição de prazos | Recomendado. Na demanda simples, espelhar explicitamente os campos da execução única; ao expandir, distinguir prazo global dos prazos de etapas. Não criar dois donos divergentes do mesmo estado. |
| Remover entidade/tabela de tarefas e migrar tudo para demanda | Grande a muito grande; migração de atribuições, dependências, requisitos, comentários, materiais, eventos, templates, notificações e relatórios | Não recomendado agora. A complexidade reapareceria como subdemandas ou nova estrutura equivalente; risco alto ao histórico e às permissões. |

Aceite sugerido para um futuro protótipo: Monique cadastra o trabalho simples uma vez; colaborador aceita/inicia/revisa sem navegar entre registros duplicados; uma landing page com dois responsáveis mantém bloqueio e visibilidade corretos. **Pronta** não vira **Em produção** por criação ou desbloqueio. Pausa continua requerendo aprovação administrativa e nova data informada, sem prorrogação automática. A experiência proposta não foi implementada nem decidida pelo usuário.

## Doze melhorias concretas

Prioridade: P0 = coerência/confiança antes da expansão; P1 = maior benefício operacional provável; P2 = evolução posterior; P3 = mudança de escopo opcional. Esforço relativo: P = ajuste focal; M = fluxo com API/interface; G = novos modelos e várias áreas. Não são estimativas de prazo ou orçamento.

### 1. Demanda como unidade principal; etapas opcionais — P1 / M

**Problema e exemplo:** cadastro duplicado para uma troca de banner; abrir uma demanda com responsável, prazo e ação de iniciar, sem criar manualmente uma segunda ficha. **Atual:** parcial: hierarquia existe, experiência simplificada não. **Dependências:** definir projeção de status e criação atômica da execução única. **Risco:** expor etapas alheias ou sincronizar prazos de forma inesperada. **Aceite:** fluxo simples e multi-responsável preservam as mesmas regras e autorização. Inspiração na concentração de contexto do [Frappe CRM](https://github.com/frappe/crm) e organização flexível do [Leantime](https://github.com/Leantime/leantime); o desenho é específico do Orium.

### 2. Indicadores com definições consistentes — P0 / M

**Problema e exemplo:** Monique vê um total de atrasos no dashboard e outro no relatório; uma noite de espera parece tempo de produção. **Atual:** existe, mas requer ajuste, conforme os quatro achados. **Proposta:** separar prazo comprometido, atraso operacional, espera antes do início, duração entre marcos e esforço; estabilizar marco de conclusão, amostras e tratamento de pausas. **Dependências:** definição única, eventos confiáveis e fuso consistente. **Risco:** comparar séries históricas com semânticas diferentes; versionar a definição. **Aceite:** a mesma tarefa recebe a mesma classificação nas telas; sem amostra aparece como tal. Referências conceituais: [ERPNext timesheets](https://docs.frappe.io/erpnext/timesheets) e [orçamentos Productive](https://help.productive.io/en/articles/3167633-the-budget-overview-tab).

### 3. Templates com confirmação explícita de prazos — P0 / M

**Problema e exemplo:** um template de landing page pode materializar datas por duração, apesar da regra de prazo informado. **Atual:** templates existem; segurança da escolha de datas é parcial. **Proposta:** reutilizar estrutura, requisitos e dependências; exigir as datas deliberadas pelo criador antes da instanciação. Sugestões calculadas só se uma decisão posterior permitir, identificadas como sugestões. **Dependências:** resolver a divergência com PROJECT_CONTEXT e contrato/API. **Risco:** alterar templates usados; preservar demandas anteriores. **Aceite:** nenhuma demanda/tarefa recebe prazo apenas por duração padrão escondida. [Worklenz](https://github.com/Worklenz/worklenz) é referência de reutilização; a regra de datas vem do próprio Orium.

### 4. Capacidade semanal por pessoa — P1 / G

**Problema e exemplo:** cinco peças rápidas e cinco identidades visuais parecem a mesma carga. Monique precisa saber se o designer consegue absorver a próxima campanha. **Atual:** parcial, há contagens. **Proposta:** disponibilidade informada, ausências e reservas de esforço por semana; começar com alocação manual, sem otimização automática. **Dependências:** convenção de estimativa, calendário e responsável por manter disponibilidade. **Risco:** falsa precisão e leitura punitiva; capacidade não é ranking de produtividade. **Aceite:** mostrar reserva maior que disponibilidade e permitir redistribuição administrativa sem iniciar tarefas nem mover prazos. [Worklenz](https://www.worklenz.com/pricing/), [Scoro reservas](https://support.scoro.com/hc/en-us/articles/25995337245197-Getting-started-with-resource-bookings).

### 5. Risco de entrega com explicação — P2 / M, após 2 e 4

**Problema e exemplo:** a landing page vence sexta, mas identidade visual e revisão ainda não estão prontas. **Atual:** parcial, existem prazos e dependências; previsão consolidada ausente. **Proposta:** alerta explicável por dependências pendentes, fila e capacidade, sem prometer uma data exata. **Dependências:** métricas coerentes e estimativas minimamente mantidas. **Risco:** transformar previsão em compromisso ou marcar bloqueio legítimo como atraso operacional. **Aceite:** alerta mostra causas e dados faltantes; só administrador altera data conscientemente. [OpenProject planejamento](https://www.openproject.org/collaboration-software-features/project-planning-scheduling/) inspira a leitura das dependências, não uma regra automática de reagendamento.

### 6. Rodadas de revisão e motivos de retrabalho — P1 / M

**Problema e exemplo:** o criativo volta três vezes e ninguém distingue erro de execução, briefing incompleto ou mudança do pedido. **Atual:** parcial, feedback e eventos já existem. **Proposta:** número de rodada, versão/URL do entregável, origem interna/cliente e motivo padronizado com texto livre; retorno do cliente registrado internamente por Monique. **Dependências:** preservar eventos e estabelecer categorias simples. **Risco:** atribuição de culpa e perda do contexto; evitar ranking individual. **Aceite:** reconstruir o que foi revisado, por quem e por quê; medir aprovação na primeira rodada sem inventar dados anteriores. [Operand agências](https://www.operand.com.br/agencias).

### 7. Saldo do escopo contratado por período — P1 / G

**Problema e exemplo:** contrato inclui 12 posts mensais, já foram entregues 10 e chegam mais 5 pedidos. **Atual:** parcial, quantidades/cadência já existem no backend. **Proposta:** ligar entregáveis a itens de escopo e período, exibindo contratado, comprometido, entregue e excedente. **Dependências:** decidir unidade e momento do consumo, tratamento de cancelamento, revisão e eventual saldo transferido; não presumir rollover. **Risco:** contar demanda inteira como uma peça ou descontar revisões em duplicidade. **Aceite:** cada número abre seus registros; exceções são explícitas. Referência: gestão de contratos recorrentes no [Scoro](https://www.scoro.com/pricing/). Não criar um segundo cadastro de contratos desconectado do atual.

### 8. Preparação de demandas recorrentes — P2 / G

**Problema e exemplo:** recriar manualmente a pauta mensal dos mesmos clientes. **Atual:** parcial, templates e periodicidade existem; gerador ausente. **Proposta:** preparar rascunhos por competência para revisão administrativa, com prevenção de duplicidade. **Dependências:** item 3, calendário de competência, regras para clientes pausados e escolha explícita dos prazos. **Risco:** duplicar trabalhos, criar fila sem capacidade ou iniciar execução involuntariamente. **Aceite:** repetir a geração não duplica; aprovação confirma destinatários e datas; nenhuma tarefa inicia automaticamente. Inspiração em recorrência e pacotes do [Scoro](https://www.scoro.com/pricing/); é uma adaptação própria, não equivalência de comportamento.

### 9. Briefing orientado ao tipo de entrega — P1 / M

**Problema e exemplo:** designer inicia um anúncio sem público, formato ou texto aprovado. **Atual:** parcial, existem descrição, requisitos, materiais e briefing do cliente no backend. **Proposta:** completar os templates com objetivo, entregável, formato, insumos e critério de aceite, reaproveitando requisitos existentes e expondo contexto de cliente autorizado. **Dependências:** decidir o mínimo por serviço e validar uso dos campos já criados. **Risco:** formulário longo e requisitos novos bloqueando trabalhos anteriores; não aplicar retroativamente. **Aceite:** solicitar só o necessário ao trabalho; requisito faltante bloqueia prontidão, não altera prazo automaticamente. [Operand](https://www.operand.com.br/agencias) e [Leantime](https://github.com/Leantime/leantime).

### 10. Vistas pessoais salvas — P2 / P–M

**Problema e exemplo:** Monique recompõe diariamente os filtros “aguardando minha revisão” e “materiais pendentes”. **Atual:** filtros existem; persistência personalizada não localizada. **Proposta:** salvar filtros e ordenação sobre listas atuais, com atalhos úteis; evitar outra tela concorrente com Meu Dia. **Dependências:** contrato estável dos filtros e autorização na consulta. **Risco:** uma vista compartilhada vazar dados; salvar critérios não concede acesso. **Aceite:** reabrir mantém a seleção e revalida atribuições após mudanças de equipe. [Plane](https://github.com/makeplane/plane) e [Twenty](https://twenty.com/pricing).

### 11. Funil comercial mínimo e passagem para execução — P3 / G

**Problema e exemplo:** proposta de site em negociação desaparece até o cliente perguntar, ou entra na produção antes do fechamento. **Atual:** clientes existem; oportunidades não. **Proposta:** oportunidade, responsável comercial, próxima ação e resultado; ao ganhar, preparar demanda com escopo revisado. **Dependências:** confirmar se há dor comercial real e escolher sistema próprio ou integração com CRM especializado. **Risco:** dois cadastros conflitantes e trabalho iniciado por mudança comercial. **Aceite:** conversão idempotente, sem execução automática; dados comerciais restritos quando necessário. [Frappe CRM Deal](https://docs.frappe.io/crm/deal) e [Twenty](https://github.com/twentyhq/twenty). Não recomendado antes de melhorar entrega.

### 12. Esforço apontado e rentabilidade administrativa opcional — P3 / G

**Problema e exemplo:** uma mensalidade parece saudável, mas consome muito mais esforço que o planejado. **Atual:** duração entre marcos existe; esforço/custos não. **Proposta:** se aprovado, apontamentos simples de trabalho, orçamento e despesas da agência, com acesso financeiro administrativo separado. Comissões e acordos particulares continuam fora dos módulos comuns. **Dependências:** adesão a apontamentos, definição de custo, permissões próprias e dados confiáveis; começar pelo esforço antes de prometer margem. **Risco:** usar tempo decorrido como custo, expor valores privados ou apresentar margem incompleta como lucro contábil. **Aceite:** demonstrar cálculo e cobertura dos registros; validar sobreposições; nenhuma captura de tela/teclado necessária. [ERPNext código](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/projects/doctype/timesheet/timesheet.py), [Gauzy](https://github.com/ever-co/ever-gauzy), [Productive](https://productive.io/pricing/).

## Ordem recomendada e decisões que permanecem abertas

Cinco prioridades para uma próxima rodada de decisão:

1. **Simplificação centrada na demanda:** validar primeiro os casos simples e os de múltiplos responsáveis. Preservar tarefas internamente nesta etapa.
2. **Confiabilidade dos indicadores:** alinhar significados e fontes antes de usar números para decidir capacidade ou avaliar pessoas.
3. **Templates e datas explícitas:** resolver a divergência atual antes de adicionar recorrência.
4. **Capacidade semanal:** testar se disponibilidade e esforço estimado serão mantidos pela equipe; só depois criar previsão de entrega.
5. **Consumo de escopo contratado:** aproveitar o cadastro existente e decidir regras de contagem; tornar excesso visível antes de automatizar cobrança.

**Melhorias menores:** linguagem e navegação, rótulos de indicadores, tratamento de amostra vazia, filtros salvos e briefings enxutos sobre estruturas existentes. Nem toda correção de métrica é pequena: marcos históricos e reconstrução de intervalos exigem cuidado.

**Ampliações a decidir:** capacidade com calendário, consumo por competência, recorrência, CRM e finanças administrativas. Remover tabelas/entidades é uma mudança estrutural distinta e não recomendada nesta fase. Portal de cliente continua fora do MVP; registro interno de revisão atende a sugestão sem criar login externo.

As prioridades são recomendações fundamentadas, não decisões de negócio já aprovadas. A próxima implementação, caso solicitada, deve começar com um contrato pequeno e critérios verificáveis; este benchmark não altera roadmap, permissões, arquitetura ou produção.
