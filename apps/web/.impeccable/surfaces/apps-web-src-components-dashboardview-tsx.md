---
version: 1
slug: "apps-web-src-components-dashboardview-tsx"
primary_target: "apps/web/src/components/DashboardView.tsx"
related_targets: []
---

# Painel (Fase 4) — surface brief

## Direction contract

THESIS: O Painel responde "o que está em jogo agora" distinguindo atraso operacional de prazo do chamado vencido e mostrando totais exatos antes do limite; recusa o painel decorativo sem ação.

OWN-WORLD: Extensão do mundo incumbente do OriumSystem (mundo Operate code-led, sem novo design system): mesmos tokens (--color-primary/border/surface, sombras suaves), tipografia, nav-tab e badges de status/prioridade existentes; novas classes dashboard-*/workload-* na mesma linguagem visual.

STORY: Quem acessa (admin, ou colaborador apenas no próprio escopo) entende o que está em produção, o que depende de ação e o que vence, e abre o chamado/tarefa na mesma navegação, sem duplicar; colaborador nunca vê trabalho alheio.

FIRST VIEWPORT: Título "Painel" com toolbar Atualizar e selo de atualização; na sequência Em produção, Dependendo de ação, Pendências com subgrupos e Carga da equipe (admin + users.read). Ação primária por item: "Abrir chamado"/"Abrir tarefa".

FORM: Extensão da superfície operacional existente (modo Operate, code-led); nenhum mundo novo semeado — mantém a hierarquia e os estados da lista existente.

FINISH: Revisão final independente pendente (QA no portal visível: E2E real de /dashboard e validação 390x844/1280x800); sem declarar ship até aceite e evidências duráveis.
