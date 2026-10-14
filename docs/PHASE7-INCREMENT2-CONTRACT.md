# Fase 7 — Incremento 2: persistência e API da central pessoal

Coordenação: Codex #2. Backend e conclusão dos testes: Antigravity. Data: 2026-10-13. Atribuição explícita após aceite TEST do Incremento 1. Em 13/10 à noite, ownership da suíte foi transferido do OpenCode ao Antigravity após indisponibilidade recorrente do provedor e ausência de progresso verificável. Arquivo salvo preservado, sem Vitest ativo observado; OpenCode recebeu instrução de liberar e restringir-se ao handoff/nota. Aplicar AGENTS.md e docs/AGENT-AUTONOMY.md. O contrato estável de PHASE7-NOTIFICATIONS-CONTRACT.md prevalece para tipos/respostas/interface.

## Resultado deste incremento

Gate final: ACEITO EM TEST por Codex #2 em 13/10, 25/25 reais. A coordenação assumiu as correções complexas da suíte/teardown após indisponibilidade do Antigravity, preservando o arquivo salvo e sem Vitest ativo. Evidências em PHASE7-INCREMENT2-TEST-RESULT.md e PHASE7-INCREMENT2-INDEPENDENT-REVIEW.md. Ownership da suíte/resultado está na coordenação até transferência posterior; os cabeçalhos de atribuição inicial abaixo são históricos.

Criar persistência real, GET /api/v1/notifications e POST /api/v1/notifications/:id/read. Não gerar avisos de eventos ou calendário ainda: destinatários administrativos aguardam decisão do responsável e a ligação aos produtores terá contrato próprio. Caixa vazia retorna a resposta real do banco, sem mocks/fallback em produto. Fixture via migrator em TEST serve apenas para comprovar persistência e autorização. Não declarar notificações operacionais entregues ou Fase7 concluída por este incremento isolado.

## Ownership

- Antigravity: novo apps/api/src/notifications.ts; alterações focais em apps/api/src/identity.ts, app.ts, schema.ts e migrate.ts; nova db/migrations/0005_notifications.sql e entrada correspondente em db/migrations/meta/_journal.json; relatório docs/PHASE7-INCREMENT2-RESULT.md; helpers exclusivos .local/phase7/increment2/backend/. Código demands.ts, contracts/web e testes são READONLY neste incremento.
- Antigravity assume também a conclusão do arquivo salvo tests/notifications.integration.test.ts, relatório docs/PHASE7-INCREMENT2-TEST-RESULT.md e helpers .local/phase7/increment2/tests/. OpenCode conserva QA-PLAN/interface em standby e não pode editar/executar a suíte transferida. Não reescrever o teste inteiro sem necessidade; corrigir os achados da revisão e verificar o contrato integral.
- Codex #2: este contrato, desenho, revisão, ROADMAP e checklist geral. Sem edição concorrente nos arquivos dos implementadores.

Cada agente registra início, evidências e conclusão exclusivamente na própria seção de oriumsystem-acompanhamento. Coordenar checkpoint backend pronto diretamente entre donos; preparar teste sem esperar backend inteiro, mas não executar suite contra código/schema em edição. Apenas um agente usa TEST para suites/grants/migration de cada vez. Não iniciar builds, serviços HTTP, browser, migration ou restart DEV. Fastify inject dispensa listener HTTP.

## Schema e privilégios

Tabela notification: id UUID PK; recipient_user_id text FK auth_user; demand_id UUID FK demand; task_id UUID nullable FK task; kind text CHECK com os 12 kinds públicos; source_event_id UUID nullable FK demand_event; source_delivery_date date nullable; created_at timestamptz NOT NULL; read_at timestamptz nullable. FKs de recursos e destinatário usam ON DELETE CASCADE para permitir remoção cirúrgica das fixtures. Sem títulos históricos, metadata, motivo, comentário, URL ou credenciais.

Exigir exatamente uma origem: source_event_id XOR source_delivery_date. Kinds de calendário (task_due_today/task_due_soon/task_overdue/demand_overdue) exigem source_delivery_date; os demais exigem source_event_id. Kinds task_* exigem task_id; demand_* exigem task_id NULL. Antes de qualquer uso futuro do aviso, validar coerência tarefa/demanda e origem/recurso; não confiar em um task_id cuja demanda seja outra.

Deduplicação com dois índices únicos parciais: (recipient_user_id, kind, source_event_id) para eventos; (recipient_user_id, kind, demand_id, task_id, source_delivery_date) para calendário. Garantir semântica de unicidade também quando task_id é NULL (índice específico de demanda ou recurso a NULLS NOT DISTINCT somente se versão PostgreSQL real suportar; não presumir). Criar índices recipient_user_id/created_at DESC/id DESC, parcial para read_at IS NULL e FKs não cobertas pelos anteriores. Espelhar schema Drizzle e journal existentes sem reescrever migrations anteriores.

migrate.ts concede apenas SELECT, INSERT e UPDATE(read_at) em notification ao papel app. Não incluir a tabela no GRANT amplo existente; negar DELETE/TRUNCATE/UPDATE das colunas imutáveis. Testar privilégios usando orium_app. Sem novos tipos/grants de RBAC e sem serviço/depêndencia nova.

## Sessão privada e ordem de locks

Adicionar helper interno em identity.ts que obtém pelo Better Auth a sessão autenticada e retorna a identidade pública junto do sessionId em tipo interno do backend. authenticate existente mantém assinatura/retorno e delega ao helper; contratos públicos não mudam. Nenhum cookie analisado manualmente, token logado ou sessionId aceito do cliente. Não trocar chamadas de autenticação de rotas antigas desnecessariamente.

Nas duas rotas novas: autenticação HTTP obrigatória; serviço usa o mesmo PoolClient para BEGIN READ COMMITTED → pg_advisory_xact_lock(IDENTITY_LOCK) → lock da linha auth_session pelo sessionId confiável, com FOR SHARE → revalidação de sessão/usuário ativo → papel/grants atuais → consulta/leitura → COMMIT. Bloquear a sessão permite serializar com DELETE do sign-out existente, mesmo sem advisory nesse endpoint. Nunca adquirir advisory depois de bloquear sessão/domínio/aviso. Não iniciar snapshot REPEATABLE READ antes da espera.

A validade deve ser verificada depois que os locks foram obtidos (clock_timestamp, não somente now da transação iniciada antes da espera): expires_at, created_at com limite absoluto de sete dias, last_seen_at com limite de doze horas e user_id igual ao contexto autenticado. Não verificar apenas em predicado que PostgreSQL possa avaliar antes da espera pelo lock; consultar a linha bloqueada e avaliar em comando subsequente. Não ressuscitar sessão ou prolongar validade absoluta. Sessão ausente/inválida ou usuário inativo → 401; usuário válido sem ambos demands.read/tasks.read → 403. Ler papel real/grants no mesmo client sob advisory.

## Consulta, projeção e leitura

Cada usuário lê apenas notification.recipient_user_id igual ao próprio id, incluindo administrador. Papel administrator permite recursos atuais do próprio aviso; colaborador exige atribuição atual da tarefa (t.assigned_to_user_id), ou EXISTS tarefa atribuída na demanda para aviso sem task_id. Verificar t.demand_id = n.demand_id. Usar a mesma expressão de visibilidade em itens, total, unreadCount e POST. Aviso inacessível/alheio/inexistente retorna 404 sem revelar existência. Não devolver campos de origem nem dados de sessão.

Títulos e deliveryDate são consultados dos recursos atuais. Ordenação created_at DESC,id DESC; total respeita unreadOnly; unreadCount inclui todos os visíveis não lidos, independente do filtro/página. Snapshot consistente sob advisory compartilhado com mutações de identidade/domínio; todas as queries no mesmo client. updatedAt representa o horário real da consulta, formatado datetime com offset. Preservar data calendário sem conversão de timezone que altere YYYY-MM-DD.

POST corpo obrigatório strict {} e id UUID validado; Origin/JSON e headers de segurança existentes continuam obrigatórios. Bloquear somente o aviso autorizado (FOR UPDATE OF n) depois da revalidação. UPDATE read_at = COALESCE(read_at, timestamp) mantém primeiro readAt; devolver objeto notificationResponseSchema. Nenhuma geração temporal, alteração de domínio ou marcação automática ao abrir.

Avisos de calendário não serão inseridos pelo produto neste incremento. O serviço não deve expor aviso temporal obsoleto: se a consulta já suportar esses kinds, aplicar predicado atual e source_delivery_date correspondente ao prazo atual conforme desenho/dashboard; alternativamente excluir esses quatro kinds explicitamente nesta fundação até o incremento de materialização. Registrar a opção escolhida no relatório; não atribuir esse filtro à falta de permissão nem inventar cron.

## Aceite real em TEST

Aplicar PORT_POLICY/Find-FreePort para banco necessário e comprovar propriedade/configuração de orium_test antes de migration/suites. Não imprimir URLs/segredos. Sem mocks ou skips. Testes HTTP inject e PostgreSQL:

- Schemas, vazio real, ordenação/títulos atuais/data, paginação/total/unreadCount, unreadOnly true/false e inputs strict (query/corpo/UUID).
- Caixa pessoal administrador/colaborador, demanda compartilhada com tarefa de terceiro, aviso alheio e tarefa/demanda incoerentes, 404 após reatribuição; nenhuma informação privada na projeção.
- 401 sem sessão, sessão revogada/expirada enquanto aguarda advisory, sign-out concorrente bloqueado pela linha da sessão; desativação e revogação de grants em voo. Barreiras pg_locks/current_database e PID específico; sem sleeps como prova. Use comandos controlados do migrator para expiração durante espera, sem esperar dias/horas.
- Leitura explícita/idempotente e concorrente preserva primeiro readAt; falha de autorização não altera aviso; Origin/JSON/header protections preservados.
- Constraint de kinds/origens, deduplicação evento/recipiente e demanda temporal com NULL task, FK/cleanup, privilégios app SELECT/INSERT/UPDATE(read_at) e negação de DELETE/UPDATE imutável.
- Regressão pertinente de autenticação/identidade e demandas após mudanças em identity.ts; máximo uma suite/build por dono/pacote. Executar somente após checkpoint estável do backend. Backend verifica lint focal/tipos API/raiz; testes verifica lint focal/tipos pertinentes e suites/cleanup.

Cleanup exclusivamente fixtures rastreadas, permissões realmente alteradas e eventos próprios; preservar baseline de grants e histórico de identity_event. Relatórios distinguem testes novos, regressão, limites e ausência de geração/homologação/ativação DEV. Codex revisa código e resultados antes de liberar próximo incremento.
