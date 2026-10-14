# Fase 4 — contrato de implementação

Status: em implementação. Coordenação: Codex. Continuidade autorizada pelo responsável.

## Escopo e regras

Dashboard somente de leitura, reutilizando os estados e permissões da Fase 3. Administradores acompanham a operação; colaboradores veem exclusivamente tarefas atribuídas a si e identificação mínima do respectivo chamado/cliente. Nenhum total, título ou responsável de trabalho alheio pode vazar. Não acrescentar estados, migrações, integrações ou decisões de negócio.

Data de referência calculada no servidor em America/Cuiaba. O responsável confirmou próximas entregas nos próximos **3 dias**: amanhã até hoje+3, inclusive. Hoje é seção própria. Comparar datas de calendário, com testes de virada de mês/ano. Chamados concluídos e tarefas concluídas ficam fora das pendências.

Separar prazo vencido do chamado de atraso operacional da tarefa. Tarefa só fica operacionalmente atrasada com startedAt e estado in_production, in_review ou changes_requested e deliveryDate anterior a hoje. blocked, paused e tarefas nunca iniciadas não são atrasos operacionais. Não recalcular datas ou autorizar pausas automaticamente.

Quatro seções: Em produção; Dependendo de ação; Pendências (atrasadas operacionais, prazo do chamado vencido, hoje, próximas 3 dias, urgentes); Carga da equipe (administradores com users.read). Dependendo de ação inclui bloqueadas, prontas aguardando aceite/início, revisão, ajustes, pausadas e solicitações de pausa pendentes, com motivo explícito baseado no estado real. Uma tarefa pode aparecer em seções distintas, sem duplicação dentro da mesma seção.

## Contrato técnico

GET /api/v1/dashboard autenticado, exige demands.read e tasks.read, respeita as verificações de função/permissão existentes. Schemas Zod estritos compartilhados: dashboardQuerySchema e dashboardResponseSchema; tipos DashboardQuery e DashboardResponse. Query opcional limit, inteiro 1..50, padrão 20. Janela de 3 dias fixa nesta fase.

Resposta: generatedAt ISO; today YYYY-MM-DD; timeZone America/Cuiaba; upcomingDays 3; scope all|assigned; sections {production, awaitingAction, overdueTasks, overdueDemands, dueToday, upcoming, urgent}; cada seção {total, items}, total exato antes do limite. Items são projeções mínimas com kind task|demand, id, title, demandId, demandTitle, client {id,name}, status, priority, deliveryDate; itens task também taskId, startedAt nullable e reason texto em português quando pertinente. assignedTo {id,name}|null apenas para administrador. workload array de {userId,name,active,total,production,awaitingAction}, apenas com autorização users.read e função administrator; incluir usuários ativos sem carga e inativos com trabalho aberto. workloadAvailable boolean. Não incluir emails, credenciais, comentários nem dependências de terceiros.

Ordenação determinística: priority urgente antes das demais conforme enum atual; deliveryDate crescente; id desempata. Chamados overdueDemands: todos abertos no escopo com prazo anterior a hoje; colaborador só chamados com tarefa própria aberta. Demais seções de prazo/urgência são de tarefas abertas no escopo. production usa in_production. Contagens e listas devem corresponder ao mesmo snapshot consistente, sem N+1 e sem buscar tudo para somar no navegador.

## Interface

Aba inicial Painel para quem possui ambas as permissões. Manter demais abas e idioma/estilos existentes. Resumo, listas com total e indicação de limite, estados vazio/carregando/erro com tentativa novamente, atualizar manualmente e horário da atualização. Botões levam ao chamado/tarefa correspondente reutilizando DemandsView, sem burlar autorização. Carga da equipe não aparece para colaborador ou sem users.read. Preservar acessibilidade de teclado e layout 390x844 e 1280x800. Usar linguagem distinta para prazo do chamado vencido e atraso operacional.

Extensão do mundo visual existente, modo Operate, code-led: sem redesign de marca ou competição de conceitos. OpenCode deve aplicar craft-floor da skill Impeccable e documentar o breve contrato desta superfície fora dos artefatos entregues ao navegador; executar detector e revisar resultado após implementação.

## Ownership e verificação

- Antigravity: packages/contracts/src/index.ts (acréscimos), apps/api/src/dashboard.ts, apps/api/src/app.ts (registro), docs/PHASE4-BACKEND-RESULT.md. Sem frontend/testes de QA.
- OpenCode: apps/web/src/App.tsx, components/Header.tsx, components/DashboardView.tsx, components/DemandsView.tsx (navegação externa), apps/web/src/api.ts, styles e tipos necessários no web; docs/PHASE4-FRONTEND-RESULT.md e brief da superfície. Sem contratos/backend/runner.
- Antigravity QA: tests/dashboard.integration.test.ts, runner exclusivo Fase 4 e artefatos/relatório/plano Fase 4. Não alterar runner/evidências Fase 3. Inicialmente planejar, depois executar contra implementação real.
- Codex: contrato, revisão de arquitetura, ROADMAP, encerramento e coordenação.

Testes reais: autorização/isolamento dos contadores e projeções, classificação de todos os estados, pauseRequested, datas limite e fuso, ordenação/limite/contagem exata, carga da equipe, navegação real para detalhes, falha/retry, vazio, teclado, responsividade e console. Registrar limitações reais de captura visual. Não considerar sintaxe ou exit0 de portal evaluate suficiente: rejeitar Error textual, debug primeiro após erro Maestri e validar DOM/estado esperado.

Todos registram início, impedimentos, evidências e conclusão EXCLUSIVAMENTE em sua própria seção de oriumsystem-acompanhamento via note edit. Nunca note write ou nova nota. Antes de iniciar serviços/testes ler PORT_POLICY e executar Find-FreePort por porta. Preservar DEV 3002/5173 e bancos/contas reais; API antiga 3001 sem propriedade comprovada intocável. QA usa orium_test e limpeza apenas de suas fixtures; respeitar quota Better Auth. Entrega curta com arquivos, comandos/resultados reais e pendências; comunicar ao Codex pelo Maestri.
