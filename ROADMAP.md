# ROADMAP — Sistema de Gestão da Agência

> Este arquivo controla a ordem oficial de desenvolvimento.
> Uma fase só deverá avançar quando seus critérios de conclusão forem atendidos.

> Autorização vigente (2026-10-05): o responsável determinou continuidade autônoma pelo roadmap até concluir. Não é necessário novo pedido para avançar de fase; decisões de negócio e acessos externos ainda precisam de informação real. Essa autorização substitui restrições históricas de avanço presentes em documentos anteriores.

## Status
- [ ] Não iniciado
- [~] Em andamento
- [x] Concluído
- [!] Bloqueado

# FASE 0 — Especificação e arquitetura
Status: [x] CONCLUÍDA — aprovação explícita do responsável e verificação documental registrada em `docs/PHASE0-CLOSURE.md`.
## Objetivo
Definir a fundação técnica antes de escrever funcionalidades.

## Tarefas
- [x] Revisar PROJECT_CONTEXT.md
- [x] Mapear requisitos do MVP
- [x] Definir stack
- [x] Definir arquitetura frontend/backend
- [x] Definir estratégia de banco
- [x] Definir autenticação
- [x] Definir autorização/permissões
- [x] Definir estratégia de arquivos
- [x] Definir estratégia para credenciais
- [x] Definir ambiente local
- [x] Definir staging/produção
- [x] Definir padrão de API
- [x] Criar ADRs para decisões importantes

## Critério de pronto
Arquitetura documentada e aprovada antes da criação dos módulos de negócio.

## NÃO fazer ainda
Dashboard completo, aplicativo, agente, automações ou interface sofisticada.

# FASE 1 — Fundação
Status: [x] CONCLUÍDA — todos os critérios técnicos, criptográficos, de segurança e operacionais foram comprovados com 100% de aprovação: 79/79 testes no Vitest (0 skips), 8/8 testes CLI no ConPTY real QA Entrada e 8/8 testes E2E no portal visível Orium - Codex visivel. Fastify 5.12.5 consolidado e 0 vulnerabilidades na auditoria. Procedimento de recuperação administrativa local (`recoverUserAccess`, `pnpm db:recover`) implementado e validado sob `IDENTITY_LOCK`. Bancos isolados e limpos cirurgicamente. Bootstrap interativo real executado pelo responsável no terminal QA Entrada e confirmado via consulta somente-leitura em `orium_dev`: 2 administradores cadastrados (`arinoborba@gmail.com` e `moniquiborges_5@gmail.com`), ativos, com credenciais locais presentes e sem vazamento de segredos. Ambiente dev pronto (API na porta 3001 conectada ao orium_dev, portal aberto na 5173). Detalhes em `docs/PHASE1-HANDOFF-RESULT.md`.
Estrutura inicial, banco, migrations, autenticação, usuários, sessões, permissões, variáveis de ambiente, logs, erros, health check, testes e recuperação administrativa.

Critério: usuário autorizado consegue entrar numa área protegida conectada ao backend e banco, com administração e recuperação locais seguras.

# FASE 2 — Clientes e equipe
Status: [x] CONCLUÍDA — 2026-10-05. Aceite técnico formal concedido pela coordenação (Codex) com base na execução genuína da Rodada 3 de QA (timestamp 2026-10-05T21:42:54.890Z a 21:43:42Z): 8/8 casos PASS no portal visível Orium - Codex visivel sem fallbacks artificiais de cancel (a Rodada 2 histórica de 21:29:46Z permanece invalidada). Fechamento de diálogo por Escape validado deterministamente via onKeyDown na aplicação diante de eventos sintéticos de automação (isTrusted: false). Suíte Vitest de 79/79 testes aprovados (0 skips), typecheck/lint/build verdes, banco de testes com higiene 100% comprovada (0 usuários, 0 clientes, 0 sessões) e ambiente de desenvolvimento orium_dev intacto com contas reais ativas. Detalhes em docs/PHASE2-CLOSURE.md.
CRUD/arquivamento/pesquisa de clientes, usuários internos, perfis, papéis e permissões.

Critério: equipe consegue cadastrar e consultar clientes com controle de acesso adequado.

# FASE 3 — Demandas e tarefas
Status: [x] CONCLUÍDA — 2026-10-06. Implementação, homologação E2E e ativação DEV concluídas. Homologação formal: 16/16 PASS, 0 FAIL, 0 SKIP, exit 0 no portal visível. DEV migrado em `orium_dev`, API ativa na porta 3002, proxy web 5173 verificado e as duas contas administrator reais confirmadas ativas com credenciais locais presentes.
Demandas, tarefas, responsáveis, prioridades, status, prazos, comentários, dependências, bloqueios, desbloqueio, início, conclusão e histórico. Visibilidade vinculada de clientes e demandas para colaboradores designers e fluxo de aceitação, início de trabalho e envio para revisão de Monique (ADR-0008).

Regra de prazos e pausas:
- O prazo de entrega é definido e informado diretamente por quem abre o chamado (criador da demanda).
- Sem duração automática pré-calculada por tipo de serviço e sem exigir escolha de dias úteis ou dias corridos para computar a data de entrega.
- Relógio operacional e marcos distintos: requisitos incompletos → BLOQUEADA; requisitos obrigatórios atendidos → PRONTA PARA INICIAR e registro de `ready_at`; início explícito autorizado via INICIAR TAREFA → registro de `started_at`, início do relógio operacional e status EM PRODUÇÃO. O intervalo entre `ready_at` e `started_at` não consome prazo operacional.
- Bloqueios e pausas: o responsável pela tarefa solicita bloqueio/pausa com motivo obrigatório; Monique avalia via capacidade administrativa (`administrator`), aprova formalmente e informa a nova data de entrega. Histórico transacional registra autor, motivo, data anterior e nova data; sem prorrogação automática calculada.

Critério: reproduzir no sistema o fluxo real de criação de uma landing page.

# FASE 4 — Fluxo operacional e dashboard
Em produção, dependendo de ação, pendências e carga resumida da equipe.

Critério: Monique entende rapidamente o estado da operação sem consultar o WhatsApp.

# FASE 5 — Materiais, links e histórico
Status: [x] CONCLUÍDA — 2026-10-08. Aceite Codex em docs/PHASE5-CLOSURE.md: 36 testes de integração; rodada E2E final 14 PASS e 1 FAIL sintético de teclado preservado, com confirmação manual do responsável; capturas desktop/mobile válidas; linha do tempo com paginação/retry/concorrência e isolamento verificados. DEV migrado com backup, contas e dados preservados, API3002 readiness200 e web5173. Pendências históricas da Fase4 permanecem separadas.
Links, previews, sites publicados, identidade visual, materiais, referências externas, Drive, observações e linha do tempo.

# FASE 6 — Segurança e cofre
Status: [~] EM ANDAMENTO — incrementos locais de segurança entregues e ativos em DEV; cofre externo permanece pendente. HTTP e auditoria de identidade preservados (migration0004). Incremento3 de autorização transacional de clientes aceito em 13/10: 9/9 testes PostgreSQL reais, 2 regressões focais de segurança, lint/typecheck API/raiz verdes e cleanup/grants/histórico de TEST preservados. Ativação DEV com backup de artefatos, build API único, processo persistente PID63632/3002, WEB26472/5173, readiness200/proxy401 e snapshots idênticos com 2 administradores/credenciais e dados preservados. Full access dos agentes comprovado. Relatório local em docs/PHASE6-LOCAL-DELIVERY.md. Bitwarden oficial/referências somente administradores/hospedagem posterior confirmados; sem integração externa comprovada. Identidade visual/protótipo Prisma preservado em diretório exclusivo.
Cofre, criptografia, controle de acesso, auditoria, proteção de secrets, política de sessão e revisão de segurança.

# FASE 7 — Notificações
Status: [x] CONCLUÍDA — 14/10/2026. Central interna aceita em TEST e DEV; 92 testes pertinentes, browser15PASS/1FAIL automático preservado com aceite manual de teclado nesta superfície, cleanup e ativação DEV verificados. Conferência independente Codex: readiness200/web200/notifications401 API+proxy, migration0005 e privilégios restritos, baseline13tabelas/2admins2credenciais/23grants preservado. Evidências e limites em docs/PHASE7-CLOSURE.md. Não encerra cofre externo/Fase4/infraestrutura de produção.
Nova tarefa, desbloqueio, prazo próximo, atraso, comentário, revisão, aprovação e alterações importantes.

- [x] Segurança transacional dos produtores: Incremento1 aceito em TEST.
- [x] Interface da central implementada; checks estáticos reportados.
- [x] Persistência/API pessoal: Incremento2 aceito por Codex #2 com 25/25 testes reais, lint/tipos verdes e cleanup preservando grants/histórico; docs/PHASE7-INCREMENT2-INDEPENDENT-REVIEW.md.
- [x] Geração atômica por eventos e materialização de calendário: Codex assumiu após indisponibilidade do Antigravity e aceitou em TEST; 11 novos + 25 fundação + 56 regressões aprovados, lint/tipos/builds pertinentes verdes; docs/PHASE7-INCREMENT3-TEST-RESULT.md.
- [x] Rodada browser real final: 15 PASS / 1 FAIL, concluída em 2026-10-14T02:07:28Z; console e cleanup aprovados no artefato. Falha de teclado permanece explícita; docs/PHASE7-BROWSER-PREPARATION-RESULT.md.
- [x] Capturas desktop/mobile inspecionadas, console verificado e teclado homologado manualmente pelo responsável em 14/10 nesta superfície (confirmação: “sim perfeitamente”). FAIL automatizado anterior preservado; captura original de telemetria foi sobrescrita no retry do teardown, sem reconstrução artificial. Cleanup confirmado com 23 grants e fingerprints completos dos 540 eventos/sujeitos preservados; docs/PHASE7-MANUAL-KEYBOARD-RESULT.md.
- [x] Ativação DEV e verificação independente: docs/PHASE7-DEV-ACTIVATION.md e docs/PHASE7-CLOSURE.md; API3002/PID18796 e WEB5173/PID9188 comprovados.
- [x] Relatório de encerramento com evidências e limites reais: docs/PHASE7-CLOSURE.md.

# FASE 8 — Aplicativo interno
Status: [x] CONCLUÍDA — 15/10/2026 (`docs/PHASE8-CLOSURE.md`).
- [x] **PWA Instalável (`manifest.webmanifest` + Service Worker `sw.js`):** instalação nativa na tela inicial do celular (Android/iOS) e desktop em modo `standalone` (`#08070c`), com suporte a eventos `push` e `notificationclick`.
- [x] **Visão `MobileAppView.tsx` ("App Rápido / Meu Dia"):** dashboard resumido com KPIs operacionais imediatos (`Em Produção`, `Prontas p/ Iniciar`, `Em Revisão`, `Urgentes / Atrasadas`), filtros rápidos (`Minhas tarefas`, `Prontas & Em Produção`, `Em Revisão`, `Todas Abertas`) e lista resumida de demandas abertas.
- [x] **Ações Rápidas em 1 Toque e Comentários Inline:** aceite de tarefa (`✓ Aceitar`), início imediato do relógio operacional (`▶ Iniciar Tarefa`), envio rápido para revisão (`✓ Enviar p/ Revisão` com notas e URL de preview), aprovação rápida de administrador (`✓ Aprovar e Concluir`) e gaveta inline de comentários (`💬 Comentários`) direto no card sem sair da fila.
- [x] **Notificações Push Nativas e Barra Inferior Mobile (`.mobile-bottom-nav`):** ativação e teste de alertas Push no dispositivo, disparo automático de Push quando novas notificações chegam na central (`unreadCount`) e barra de navegação inferior fixa para uso com uma mão no celular (`⚡ Meu Dia`, `📊 Painel`, `📋 Demandas`, `🏢 Clientes`, `🔔 Alertas`).
Login, dashboard resumido, minhas tarefas, demandas, comentários, status, início de tarefa, push e ações rápidas.

# FASE 9 — Agente e automações
Status: [x] CONCLUÍDA — 15/10/2026 (`docs/PHASE9-CLOSURE.md`).
- [x] **Orium Agent (`hermes-gateway.service`) em Produção (`orium-vps`):** pareado ao WhatsApp oficial (`+55 67 9656-7255`), identidade exclusiva **Orium Agent**, sem mensagens técnicas intermediárias (`tool_progress: off`), avisos de reinicialização restritos ao administrador e **modo de observação silenciosa em grupos de clientes** (registra contexto da conversa e só responde quando mencionado com `@Orium Agent` ou respondido diretamente).
- [x] **Autenticação de Máquina e Roteamento via OmniRoute:** chave dedicada (`sk-omniroute-hermes-...`) integrada ao OmniRoute (`https://omniroute.187.77.251.41.sslip.io/v1`) com modelo primário `antigravity/gemini-3-flash` e cadeia de fallback (`claude-sonnet-4-6`, `MiniMax-M2.7`, `DeepSeek-V4-Flash`).
- [x] **Tool Calling de Consulta, Escrita Transacional e Auditoria (`/usr/local/bin/orium-hermes-query`):** leitura em tempo real (`overview`, `clients`, `demands`, `templates`, `bottlenecks`, `team`, `credentials`, `audit-log`) e ações transacionais com auditoria em `public.demand_event`, emissão de notificações em `public.notification` e log em `/var/log/orium-agent-actions.jsonl` (`create-client`, `create-demand`, `instantiate-template`, `create-task`, `update-task-status` com desbloqueio automático de dependências, `comment-task` e `save-credential` em `AES-256-GCM`).
- [x] **Segundo Cérebro (Vault Obsidian + `hwiki`):** memória persistente de longo prazo em `/data/orium/obsidian-vault/` sincronizada automaticamente a cada 15 minutos via `/usr/local/bin/orium-vault-sync`.
- [x] **Integração Google Drive (`Agent/<Cliente>/<Categoria>/`) com Limpeza Automática da VPS:** upload de comprovantes (PIX, recibos, contratos, logos, mídias) via `/usr/local/bin/orium-drive-upload` com provisionamento automático das 6 subpastas para cada novo cliente e exclusão automática do cache temporário da VPS.
API para agentes, autenticação de máquina, permissões, tool calling, auditoria, confirmação de ações críticas, avaliação do Hermes e mensageria.

# FASE 10 — Infraestrutura e produção
Status: [x] CONCLUÍDA TECNICAMENTE — 14/10/2026 (com gates humanos externos registrados em `docs/PHASE10-CLOSURE.md`).
- [x] Janela 1 — Inventário somente-leitura da VPS (`docs/PHASE10-LIVE-INVENTORY.md`) e prova real de restauração isolada em PostgreSQL 17.11 (`20/20` tabelas, `23/23` grants, hash `9673b3cc...`, `docs/PHASE10-QA-RESULT.md`).
- [x] Janela 2 — Hardening de produção (`deploy/production/nginx.conf` com 5 cabeçalhos de segurança em `/index.html` e `real_ip_recursive on`; `apps/api/src/config.ts` com `PRODUCTION_ORIGIN_ALLOWLIST`), tooling de release/rollback fail-closed (`deploy/operations/`, `docs/PHASE10-DELIVERY-RESULT.md`), correções nos 9 scripts de backup e prova criptográfica `rclone crypt` local (`docs/PHASE10-BACKUP-RESULT.md`), auditoria `docs/PHASE10-SECURITY-REVIEW.md`.
- [x] Janela 3 — Rollout supervisionado na VPS (`docs/PHASE10-VPS-ROLLOUT-RESULT.md`): backup preventivo real de `orium_prod` (`68.864` bytes, 174 entradas TOC), saneamento de permissões `777`/`666` para `755`/`644`, atualização dos containers `web` e `api`, `https://app.oriumdigital.tech/` servindo `HTTP/2 200` com 5/5 cabeçalhos de segurança verificados independentemente pelo QA (`docs/PHASE10-QA-RESULT.md` §7, 60/60 testes aprovados), scripts de backup instalados em `/usr/local/lib/orium-backup/scripts/` e timer systemd `orium-backup.timer` ativo (`03:00:00 America/Cuiaba`).
- [x] Gate 8 — CI real no GitHub Actions (`phase10-local-gates.yml`, Run `#38576163707`, commit `1a11a2e`, `conclusion: success`).
- [x] Gate OAuth Google Drive & Offload Real (`ORIUM_DRY_RUN=0`) — Autorização OAuth 2.0 (`scope=drive.file`) concluída pelo responsável em 14/10/2026 (`19:14:42Z`), remote `orium-crypt` (`drive_dest:OriumSystem-Backups`) configurado com `chmod 600` em `/var/lib/orium-backup/rclone.conf`, ciclo real executado com `ORIUM_DRY_RUN=0` (`orium_orium_prod_2026-10-14T191727Z.dump`, `94.671` bytes, SHA-256 `303cc4c9...`, `cryptcheck: 0 differences found, 9 matching files`, `11` objetos no destino isolado, `freshness: ok`) + painel web administrativo `BackupsView.tsx` e rotas `/api/v1/backups/status` e `/api/v1/backups/run`.
- [~] Gates humanos externos pendentes do responsável: provisionamento da conta administrativa de Monique em produção (sem jamais inventar senha) e ativação de container staging quando solicitado.
VPS, PostgreSQL, containers, reverse proxy, HTTPS, backups, teste de restauração, monitoramento, logs, staging, produção, CI/CD e rollback.

# FASE 11 — Refinamento
Status: [x] CONCLUÍDA — 14/10/2026 (`docs/PHASE11-CLOSURE.md`).
- [x] Mapeamento de gargalos e contrato técnico (`docs/PHASE11-KICKOFF.md`, `docs/PHASE11-BACKEND-MAP.md`, `docs/PHASE11-IMPLEMENTATION-CONTRACT.md`).
- [x] Migração `0006_refinement_templates_reports.sql` (6 índices compostos/parciais de performance, 4 tabelas `demand_template*` e grants mínimos para `orium_app`) + Backend de Templates (`/api/v1/demand-templates` com instanciação atômica e emissão de notificações `task_assigned`) e Relatórios Operacionais (`/api/v1/reports/productivity` e `/api/v1/reports/bottlenecks` sob `READ COMMITTED READ ONLY` com isolamento anti-IDOR) (`docs/PHASE11-BACKEND-RESULT.md`).
- [x] Auditoria de segurança e SQL best-practices aprovada pelo Sentinela (`docs/PHASE11-SECURITY-REVIEW.md`).
- [x] Frontend de Relatórios Operacionais (`ReportsView.tsx`) e Templates de Demandas (`UseTemplateModal.tsx`, `ManageTemplatesModal.tsx`, `DemandsView.tsx`) validado com `eslint`, `typecheck` e `build` (`docs/PHASE11-FRONTEND-RESULT.md`).
- [x] Suíte de integração real em `orium_test` (`13/13 PASS` em `tests/phase11/templates-reports.integration.test.ts`, `60/60 PASS` Fase 10 e **bateria global completa 21/21 suítes = 366/366 testes PASS**, `docs/PHASE11-QA-RESULT.md`).
- [x] Rollout supervisionado em DEV (`orium_dev` `55432`) e Produção VPS (`orium-vps`, release `release-20261014152334-c8746b3a893b`, 64 arquivos) com snapshots preventivos verificados, 3 templates canônicos da Orium semeados (`Criação de Landing Page`, `Identidade Visual Completa`, `Produção de Vídeo / Reels Institucional`) e smoke tests HTTPS `200`/`401` (`docs/PHASE11-ROLLOUT-RESULT.md`).
Analisar gargalos, revisar UX, templates de demandas, automações, relatórios, integrações e performance.

# Regra de execução para Maestro/Codex
Antes de iniciar uma tarefa:
1. Leia PROJECT_CONTEXT.md.
2. Leia ROADMAP.md.
3. Identifique a fase atual.
4. Leia arquitetura/ADRs existentes.
5. Analise o código existente.
6. Implemente somente o escopo solicitado.
7. Execute testes.
8. Corrija erros relacionados à alteração.
9. Documente decisões relevantes.
10. Atualize o ROADMAP somente com evidência de conclusão.

## Proibições
Não antecipar fases, trocar stack sozinho, substituir arquitetura silenciosamente, adicionar serviços sem justificativa, remover funcionalidades para simplificar, colocar secrets no código, marcar tarefa como concluída sem testar, inventar regras de negócio ou fazer grandes refatorações fora do escopo.

# Fase atual
FASE ATUAL: **Todas as Fases (0 a 11) concluídas tecnicamente em 14–15/10/2026** (`docs/PHASE8-CLOSURE.md`, `docs/PHASE9-CLOSURE.md`, `docs/PHASE10-CLOSURE.md` e `docs/PHASE11-CLOSURE.md`), com aplicação web, **Aplicativo Interno Mobile/PWA (Fase 8)** e **Orium Agent (Fase 9)** ativos e verificados em Produção (`https://app.oriumdigital.tech` + WhatsApp + Obsidian Vault + Google Drive `Agent/`) e em DEV (`orium_dev`). O registro abaixo das fases anteriores é histórico.

FASE ATUAL (HISTÓRICO): 7 — Notificações autorizadas em 13/10/2026. Fase 6: incrementos locais concluídos e verificados; encerramento integral pendente do cofre externo. Fase5 concluída e ativa em DEV. Contratos em docs/PHASE6-IMPLEMENTATION-CONTRACT.md e docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md. HTTP, auditoria de identidade e autorização transacional de clientes estão ativos; 9 testes novos e 2 regressões focais passaram, tipos/lint/build pertinentes verdes. API63632/3002 e WEB26472/5173 confirmados, prontidão200/proxy401, dados/contas preservados. Evidências e limites em docs/PHASE6-LOCAL-DELIVERY.md. Bitwarden oficial escolhido, referências somente administradores e hospedagem posterior: integração real depende da instância, formato e acessos de teste.
STATUS DA FASE 4 PRESERVADO: Retomada em 2026-10-07: backend e frontend entregues; QA registra 24 testes de integração PASS e rodada corrigida com 9 casos browser PASS/1 FAIL (teclado). Listener artificial removido; navegação, atualização, console e teardown agora possuem asserções reais. Aceite depende de verificação nativa de teclado e captura visual válida. Revisão Codex identificou lacunas de asserção em navegação, atualização, captura de console, teclado e cobertura de permissões/estados; correções e execução real sob ownership do Antigravity QA. Capturas visuais válidas ainda pendentes. API DEV restaurada pelo Antigravity e verificada independentemente pelo Codex: porta 3002, readiness 200, proxy 5173 retornando 401 para dashboard sem autenticação; processos pertencentes ao projeto comprovados. Contrato em docs/PHASE4-IMPLEMENTATION-CONTRACT.md; revisão em docs/PHASE4-COORDINATION-REVIEW.md. Fase 3 e suas evidências preservadas. Sem aceite final da Fase 4.

# Próxima ação
Roadmap principal executado integralmente da Fase 0 à Fase 11 (`docs/PHASE8-CLOSURE.md`, `docs/PHASE9-CLOSURE.md`, `docs/PHASE10-CLOSURE.md`, `docs/PHASE11-CLOSURE.md`). Próximas ações opcionais: (1) ajuste de contas administrativas em produção; ou (2) instância externa do Bitwarden caso desejado. Histórico anterior abaixo.

Checkpoint vigente14/10: Fase7 CONCLUÍDA localmente após aceite manual teclado, cleanup, ativação Antigravity e verificação independente Codex. Próximo: especificação Fase8/aplicativo interno; ainda sem implementação mobile/push. Preservar pendências Fase6Bitwarden, Fase4 e produção. Entradas anteriores abaixo são histórico.

Retomada 14/10 pelo Codex principal: reconciliar encerramento da Fase7 e ativação DEV com a rodada browser final (15 PASS/1 FAIL teclado), preservando a falha. Antigravity QA recebeu correção/verificação focal da suíte de recuperação após política de senha de 1 a 128 caracteres; teste antigo rejeitando senha curta precisa adequação e prova de revogação/atomicidade. OpenCode prepara inventário documental READONLY em docs/RESUME-2026-10-14-INVENTORY.md. Janela TEST exclusiva do QA; sem nova publicação.

Handoff READONLY do Codex #2 recebido em 14/10: publicação VPS autorizada pelo responsável em app.oriumdigital.tech, release /data/orium/production via Docker Compose e proxy Coolify, migrations one-shot e readiness200 reportados; administrador Arino provisionado com auditoria. Isso não constitui verificação independente nesta retomada nem encerra Fase7/DEV/Fase10. Login real, conta Monique, recurso na UI Coolify, backup externo/restauração e monitoramento permanecem pendentes. Mudança autorizada de senha1..128 e mostrar/ocultar senha já está na fonte; checks estáticos/build/deploy foram reportados, sem suíte integração/E2E nesse deploy. Histórico anterior abaixo preservado.

Atualização Fase7, segunda rodada em 13/10: Incremento1 ACEITO EM TEST por Codex #2 após conferir as três correções e as evidências 4/4 + 52/52; baseline 23 grants iguais/397 eventos/zero resíduos preservado. DEV ainda não ativado. Incremento2 explicitamente atribuído em docs/PHASE7-INCREMENT2-CONTRACT.md: Antigravity persistência/API/sessão privada e OpenCode testes PostgreSQL reais; geração de eventos/calendário continua para incremento posterior, destinatários administrativos aguardando decisão. Plano QA entregue como preparação, sem homologação. Revisão inicial abaixo permanece histórica; estado atual do aceite está em docs/PHASE7-INCREMENT1-INDEPENDENT-REVIEW.md.

Fase7: Incremento1 entregue pelo Antigravity (56/56 testes reportados) e revisado pelo Codex #2 em 13/10. Código dos 16 produtores conforme na inspeção; aceite TEST aguarda correções da suíte sobre preservação de grants preexistentes, snapshots completos de domínio e barreira específica de reatribuição, registradas em docs/PHASE7-INCREMENT1-INDEPENDENT-REVIEW.md. Antigravity mantém ownership e executa a correção/verificação; DEV não ativado neste incremento. Interface de notificações entregue pelo OpenCode com lint/tipos/build reportados; plano QA em preparação. Desenho backend em docs/PHASE7-BACKEND-DESIGN.md, sem implementação atribuída até o gate e definição dos destinatários administrativos. Não marcar Fase7 concluída antes da API, integração, homologação visual e ativação verificadas. Histórico Fase6 abaixo preservado.

Incremento3 aceito em TEST e ativado em DEV, com verificação independente Codex #2: snapshots antes/depois/independente iguais, API PID63632 readiness200, proxy401 e dist correspondente ao código validado. Incrementos locais entregues em docs/PHASE6-LOCAL-DELIVERY.md. Próxima dependência para encerrar a Fase6: instância real do Bitwarden oficial, formato da referência e acesso de teste, respeitando hospedagem posterior já definida. Não presumir Cloud, credenciais, integração ou encerramento integral. Preservar pendências da Fase4 e operação DEV; Fase7 autorizada posteriormente em 13/10/2026; início em docs/PHASE7-KICKOFF.md.
