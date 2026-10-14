---
version: 1
slug: "apps-web-src-components-notificationsview-tsx"
primary_target: "apps/web/src/components/NotificationsView.tsx"
related_targets: []
---

## Direction contract — Notificações (central)

THESIS: a central de notificações torna visível o próximo passo pessoal da operação (tarefa atribuída, desbloqueio, comentário, revisão, prazos) sem remodelar o produto: reusa o vocabulário de listas seccionadas do Painel e a navegação profunda de Demandas/Materiais; recusa inventar identidade visual.

OWN-WORLD: mundo incumbente preservado — paleta `--color-*` e classes existentes (`view-panel`, `panel-header`, `dashboard-item*`, `empty-state`, `alert-banner`, `skeleton-*`, badges de status/prioridade, `primary-button`/`secondary-button`), uma família tipográfica, timezone América/Cuiaba nos timestamps, sem assets novos e sem redesenhos. A novidade é apenas a superfície de notificações.

STORY: o usuário entende o que exige atenção pessoal e o que é novo (contador de não lidos no cabeçalho), filtra Todos/Não lidos, marca leitura de forma explícita, abre o item com um clique e nunca ganha acesso a trabalho reatribuído (revalidação no backend no destino).

FIRST VIEWPORT: cabeçalho "Notificações" com filtro Todos/Não lidos e botão Atualizar; lista cronológica DESC com tipo (rótulo PT), título do chamado/tarefa, prazo quando houver e data/hora Cuiabá; por item, ação "Marcar como lida" (sem implicitude ao abrir) e "Abrir tarefa/chamado" via handleOpenItem; contador de não lidos acessível no cabeçalho com estado vazio e erro/retry próprios.

FORM: extensão do mundo incumbente (sem concept-seed; requisito preciso de contrato): composição herdada do Painel/Demands — lista vertical com estados carregando/vazio/nenhum não lido/erro-retry/atualizando/403/404, paginação, single-flight.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. Nesta rodada é uma extensão em mundo estabelecido (sem mudança de DESIGN.md, inexistente) sem runtime disponível (API do backend ainda não atribuída): a verificação de acabamento é typecheck/lint/build + detector mecânico, e a concordância visual final acontece no portal visível após API/gate (contrato Fase 7); nada aqui declara homologação browser concluída.
