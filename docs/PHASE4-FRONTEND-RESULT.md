# Fase 4 — Resultado Frontend (Painel operacional)

**Dono:** OpenCode (frontend web)
**Data:** 2026-10-06
**Escopo:** `apps/web/src` (App/Header/DashboardView/DemandsView navegação externa, api, types, estilos) + este documento.
**Fontes de verdade:** `docs/PHASE4-IMPLEMENTATION-CONTRACT.md`, decisões registradas e `docs/PHASE4-COORDINATION-REVIEW.md`.

---

## Resumo

Implementado o Painel operacional (aba "Painel") no frontend web, consumindo
`GET /api/v1/dashboard` via `api.getDashboard` (schema compartilhado
`dashboardResponseSchema` de `@orium/contracts`, sem espelho local). A aba
"Painel" é a página inicial para usuários com `demands.read` **e** `tasks.read`;
as demais regras de aba (clients → demands → team) são preservadas.

A navegação de um item do Painel para o chamado/tarefa reutiliza o
`DemandsView` existente por props de alvo inicial — **sem** burlar a
autorização (o backend revalida permissões no `getDemand`), **sem** vazar
colaborador (nenhum total/título/responsável de trabalho alheio para não-admin;
`assignedTo` pode aparecer a administrador com `demands.read` + `tasks.read`
mesmo **sem** `users.read`; `users.read` é exigida **somente** para a carga da
equipe, conforme contrato/backend).

## Arquivos alterados (ownership)

- `apps/web/src/types.ts` — `ActiveTab` inclui `'dashboard'`; re-exporta tipos de dashboard de `@orium/contracts`; aliases `DashboardScope`/`DashboardSectionKey` derivados de `DashboardResponse` (sem exports inexistentes).
- `apps/web/src/api.ts` — novo `api.getDashboard({ limit }, signal, onUnauthorized)`: GET `/api/v1/dashboard?limit=…` com parse estrito `dashboardResponseSchema`.
- `apps/web/src/components/DashboardView.tsx` — **novo** componente do Painel.
- `apps/web/src/components/Header.tsx` — aba "Painel" (primeira) quando `demands.read && tasks.read`.
- `apps/web/src/App.tsx` — aba Painel + default por permissões; estado `demandNavTarget` (cleared em logout/unauthorized/novo login); render do `DashboardView` e props ao `DemandsView`.
- `apps/web/src/components/DemandsView.tsx` — props `initialDemandId`/`initialTaskId`/`onNavigationConsumed` com efeito com guarda de geração (continuação só do alvo atual).
- `apps/web/src/styles.css` — seção "FASE 4 — DASHBOARD OPERACIONAL (Painel)" (extensão do mundo incumbente, mesmos tokens e linguagem visual).

Não alterado: `TaskDetailView.tsx` (componente da Fase 3 — o QA da Fase 4 não
possui componente; não tocado), `.local/phase3-qa-runner.mjs`
(só-leitura), contratos (Atrigravity), backend.

## Verificações (evidências reais)

| Checagem | Comando | Resultado |
| --- | --- | --- |
| Typecheck | `npm run typecheck` (apps/web) | ✅ verde (tsc, 0 erros) |
| Lint | `npx eslint apps/web/src` | ✅ verde (0 problemas) |
| Build | `npm run build` (apps/web) | ✅ verde (vite: 120 módulos, dist gerado) |
| Detector Impeccable (DashboardView) | `impeccable.cmd detect --json apps/web/src/components/DashboardView.tsx` | ✅ `[]` (nenhum achado) |

Detector sobre `apps/web/src` inteiro: 2 warnings **pré-existentes** do mundo
incumbente (`.event-item` `border-left`, Fase 3; `font-family: Inter`, marca) —
registrados, não alterados (modo OWN-WORLD preserva a marca).

## Achados da coordenação aplicados (docs/PHASE4-COORDINATION-REVIEW.md)

1. **403** limpa `setData(null)` — sem reter totais/nomes após acesso revogado; 401 via `onUnauthorized`.
2. **Status** de demanda (`open`/`completed`) mapeado como "Aberto"/"Concluído" separado do enum de tarefa (sem inglês vazado).
3. **Prazo** em `dd/mm/yyyy` (sem `new Date(YYYY-MM-DD)`); descrição "De amanhã até os próximos três dias" (sem "hoje+3").
4. **Skeleton** com `role="status"` + texto acessível ("Carregando o Painel…").
5. **Atualização que falha mantendo dado antigo** mostra "Dados da última atualização: …" com data/hora e fuso de Cuiabá (`America/Cuiaba`).

Revisão React (Codex): efeito de navegação externa com **guarda de cancelamento/**
geração; continuação antiga não executa após await; cleanup não cancela request
legítimo de outra geração; `demandNavTarget` limpo em sign-out, unauthorized e
novo login.

## Limitações honestas

- **API DEV desligada hoje**: o consumo E2E real do endpoint será validado pelo
  QA na stack isolada (ativação após checks). Nenhuma afirmação de serviço vivo
  aqui.
- Backend do dashboard e schemas **em implementação** pelo Antigravity; o
  frontend já consome os schemas publicados (`@orium/contracts`).
- Navegação entre abas continua montando/desmontando as views (comportamento
  atual do app, não introduzido aqui); o alvo de navegação é preservado no App
  até o `DemandsView` consumi-lo.

---

# Brief da superfície — Painel (Fase 4)

> Brief desenhado fora dos artefatos entregues ao navegador (docs), código segue
> o mundo incumbente.

## Proposta

Painel operacional que responde "o que está em jogo agora" para a pessoa
conectada, por permissões. Primeira aba para quem vê demandas e tarefas;
colaborador vê apenas o próprio escopo (`scope: assigned`), sem qualquer dado
de terceiros.

## Hierarquia e conteúdo (4 blocos)

1. **Em produção** — tarefas com relógio operacional em andamento.
2. **Dependendo de ação** — revisão, aprovação, material, retorno, decisão (com `reason` contextual).
3. **Pendências** — subgrupos com linguagem que distingue natureza do atraso:
   - *Atrasadas na operação* (prazo operacional estourado: `startedAt` + status ativo + prazo anterior);
   - *Chamados com prazo vencido* (prazo do chamado vencido);
   - *Vencem hoje*;
   - *Próximos 3 dias* ("de amanhã até os próximos três dias");
   - *Urgentes*.
4. **Carga da equipe** — tabela de volume por pessoa, **somente** admin com `users.read` (`workloadAvailable`).

## Comportamentos essenciais

- Estados reais: carregando (skeleton acessível), erro com "Tentar novamente",
  vazio ("Nada por aqui no momento"), limite (totais exatos + nota "exibindo X de Y").
- Atualização manual + selo "Atualizado…" / "Dados da última atualização" com hora de Cuiabá.
- Item → botão "Abrir chamado"/"Abrir tarefa" → `DemandsView` reutilizado, sem duplicar navegação e sem burlar autorização.

## Tokens do mundo

Mundo incumbente preservado (mesmos tokens de cor/sombra, tipografia, badges de
status/prioridade; `nav-tab` reutilizado). Novas classes `dashboard-*`/
`workload-*` estendem o mesmo sistema; responsivo (390x844 e 1280x800) com
`@media 640px` para cards empilhados.

## Acessibilidade

`aria-labelledby` por seção, `role="status"` no skeleton, `aria-current` na
aba ativa, `<th scope="col">` em tabela, foco visível em cartões
(`:focus-within`), textos em português.
