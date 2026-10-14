# Fase 7 — Contrato da central de notificações

Coordenação: Codex #2. Preparação revisada: mapas READONLY Antigravity/OpenCode e checklist Sentinela. Canal inicial: central dentro do sistema; não configurar SMTP, WhatsApp, push ou serviços externos nesta entrega. Bitwarden e pendências históricas da Fase 4 permanecem separados. Não marcar a fase concluída sem testes reais, homologação visual e ativação verificada.

## Escopo funcional e autorização

Avisos de atribuição de tarefa, desbloqueio, comentário, envio para revisão, ajustes solicitados, aprovação, mudanças operacionais e prazos. Reutilizar demands.read e tasks.read juntos, sem nova permissão nem alteração dos 17 tipos/23 grants existentes. Cada caixa é pessoal: administrador também só lê avisos destinados ao seu próprio usuário. Toda listagem, contagem e marcação de leitura exige identidade ativa, sessão válida, grants atuais e visibilidade atual do recurso. Colaborador só vê aviso de tarefa atualmente atribuída a ele; avisos de demanda só quando possui tarefa vinculada, conforme escopo de demandas existente. IDs conhecidos não dispensam autorização; item inacessível retorna 404.

## API e schemas compartilhados — contrato estável para o frontend

- notificationKindSchema: enum task_assigned, task_unblocked, task_comment, task_review_submitted, task_changes_requested, task_approved, task_important_change, demand_important_change, task_due_today, task_due_soon, task_overdue, demand_overdue.
- notificationSchema (objeto strict): id UUID; kind enum acima; demandId UUID; taskId UUID nullable; demandTitle string; taskTitle string nullable; createdAt datetime com offset; readAt datetime com offset nullable; deliveryDate YYYY-MM-DD nullable. Títulos vindos de recursos atuais autorizados, não payload histórico livre. Não devolver comentário, motivo, previewUrl, metadata, e-mail ou credenciais.
- listNotificationsQuerySchema: page inteiro >=1 default 1; pageSize inteiro 1..50 default 20; unreadOnly boolean default false (query aceita apenas strings true/false ou boolean reais, sem Boolean('false')). Rejeitar chaves desconhecidas.
- notificationListResponseSchema: objeto strict { notifications: notificationSchema[], page: inteiro >=1, pageSize: inteiro 1..50, total: inteiro >=0, unreadCount: inteiro >=0, updatedAt: datetime com offset }. total corresponde ao filtro; unreadCount corresponde a todos os avisos atualmente visíveis e não lidos, independente de página/filtro.
- notificationResponseSchema: objeto strict { notification: notificationSchema }.
- GET /api/v1/notifications recebe a query acima e devolve notificationListResponseSchema. Ordenação createdAt DESC, id DESC. POST /api/v1/notifications/:id/read recebe corpo strict {} e devolve notificationResponseSchema; operação idempotente mantém o primeiro readAt. Autenticação e proteção Origin existentes continuam obrigatórias.

Exportar os tipos NotificationKind, Notification, ListNotificationsQuery, NotificationListResponse e NotificationResponse inferidos dos schemas. Nenhum campo privado de sessão entra nos contratos públicos.

## Interface — ownership OpenCode

Arquivos permitidos: packages/contracts/src/index.ts (apenas novo bloco de schemas/tipos descrito acima), apps/web/src/api.ts, types.ts, App.tsx, components/Header.tsx, novo components/NotificationsView.tsx e styles.css (apenas estilos da nova superfície). Relatório docs/PHASE7-FRONTEND-RESULT.md; helpers/evidências exclusivos .local/phase7/frontend/. Não editar demands.ts, app.ts API, schema, migrations, outros componentes ou documentos de outro dono.

Adicionar acesso Notificações no cabeçalho para usuários com ambos os grants, com contador pessoal acessível; não tornar a nova aba a inicial. Central em português com Todos/Não lidos, lista cronológica, data em America/Cuiaba, paginação, ação explícita Marcar como lida e Abrir tarefa/demanda usando handleOpenItem existente. Abrir não marca como lido implicitamente. Escapar conteúdo como texto React, sem HTML arbitrário.

Estados: carregando, lista vazia, nenhum não lido, erro com retry, atualização em andamento, item que perdeu acesso (404 remove/recarrega), permissão revogada (403 limpa dados/contador e exibe mensagem), sessão encerrada (401 callback global). Botões por item impedem duplicação enquanto gravam. Atualizar lista/contador depois do sucesso real do POST; não diminuir contador em falha. Cancelar requests no unmount/logout, impedir resposta antiga de usuário/página anterior de repovoar dados.

Atualização ao entrar e botão Atualizar; contador/lista podem atualizar a cada 60s somente com documento visível, além de retorno ao foco. Single-flight, abort e cleanup de timer/listener obrigatórios; nenhuma mensagem sonora, toast em massa ou armazenamento de payload em localStorage. Atualização silenciosa não rouba foco, não altera página/filtro e não anuncia toda a lista em aria-live a cada ciclo.

Preservar identidade visual existente e navegação. Operação acessível por teclado nativo; contador possui nome acessível; foco e contraste visíveis; desktop/mobile sem overflow. Aplicar skill Impeccable com referência incumbent e leitura craft-floor antes de editar UI; nenhum redesign global ou assets gerados. Nova superfície e documentação de design, se a skill exigir, devem ficar restritas ao escopo de notificações.

## Backend — fundação atribuída; geração de avisos em preparação

Incremento1 aceito em TEST pelo Codex #2 em 13/10 após revisão das correções e evidências. Schema/migration/serviço/rotas da fundação foram atribuídos ao Antigravity e testes ao OpenCode em docs/PHASE7-INCREMENT2-CONTRACT.md. O incremento2 implementa persistência e consulta/leitura pessoal com sessão privada revalidada na transação; não liga produtores nem materializa calendário ainda. Matriz de destinatários administrativos aguarda decisão do responsável. A geração de avisos receberá contrato próprio após esse gate/decisão. Não simular PASS de integração nem usar fixtures/mock como fallback em produto; caixa vazia real não equivale a notificações operacionais entregues.

## Verificações e entrega da interface

Lint focal, typecheck contracts/web e build do web pertinentes à alteração; máximo um build por pacote simultâneo. Não reconstruir API ou reiniciar DEV. Se contracts precisar de build, coordenar checkpoint com Antigravity antes, por depender dele para verificar incremento 1. Não rodar testes contra API inexistente e não declarar homologação browser concluída por build.

Registrar início/evidências/conclusão exclusivamente na seção OpenCode da nota oficial. Relatar comandos/exit codes, arquivos e limitações reais ao Codex #2 via helper, sem esperar reply. Validação visual final será coordenada após API/gate e política de portas, no portal visível; preservar dados reais e limites de passes da skill.
