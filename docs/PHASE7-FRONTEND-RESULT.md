# Phase 7 — Interface da central de notificações (Resultado)

Data: 2026-10-13 · Dono: OpenCode · Escopo: `docs/PHASE7-NOTIFICATIONS-CONTRACT.md`, seção "Interface e schemas compartilhados".

## Escopo

Implementação da interface da central de notificações e dos schemas compartilhados, conforme contrato estável definido pelo Codex #2. Nenhum mock/fallback em produto: a API foi definida em contrato, o frontend consome a rota real `GET /api/v1/notifications` e `POST /api/v1/notifications/:id/read`, e a homologação visual posterior à API fica para o portal visível.

## Arquivos alterados/criados (ownership em escopo)

- `packages/contracts/src/index.ts` — novo bloco "FASE 7: NOTIFICAÇÕES" no fim do arquivo (nada existente tocado):
  - `notificationKindSchema` (12 kinds) + `NotificationKind`.
  - `notificationSchema` (strict; `deliveryDate` reutiliza `calendarDateSchema.nullable()`) + `Notification`.
  - `listNotificationsQuerySchema` (strict; `unreadOnly` via `z.preprocess` aceita apenas strings `'true'/'false'` ou booleanos reais, sem coerção truthy/Boolan('false')) + `ListNotificationsQuery`.
  - `notificationListResponseSchema` (strict; `notifications`, `page`, `pageSize`, `total`, `unreadCount`, `updatedAt`) + `NotificationListResponse`.
  - `notificationResponseSchema` (strict; `{ notification }`) + `NotificationResponse`.
- `apps/web/src/api.ts` — importa os 2 schemas de valor + 3 tipos; novos métodos `listNotifications` (query page/pageSize/unreadOnly) e `markNotificationRead`.
- `apps/web/src/types.ts` — `ActiveTab` ganhou `'notifications'` e re-export dos 5 tipos (import + export type).
- `apps/web/src/App.tsx` — estado `unreadCount`, `refreshUnread` (single-flight com abort), polling 60s visível + foco (cleanup), reset em logout/principal, render `NotificationsView` sob `hasNotificationsRead` (= demands.read && tasks.read), `Header` recebe `unreadCount`.
- `apps/web/src/components/Header.tsx` — aba "Notificações" para quem tem ambos os grants, com contador acessível (`aria-label` com singular/plural, `99+`), nome "Notificações".
- `apps/web/src/components/NotificationsView.tsx` — **novo** componente da central (ver seções abaixo).
- `apps/web/src/styles.css` — somente estilos da nova superfície (bloco "FASE 7" no fim).
- `apps/web/.impeccable/surfaces/apps-web-src-components-notificationsview-tsx.md` — surface brief (artefato de skill, fora do produto).
- `.local/phase7/frontend/` — helpers/evidências exclusivos (surface brief body + este relatório não; ver nota).

## Decisões de produto/interface

- Gate da aba: reaproveita `demands.read` + `tasks.read` juntos (mesmo critério do Painel), sem nova permissão — alinhado ao contrato (nenhuma alteração dos 17 tipos/23 grants).
- Aba **não** é a inicial: `initialTabFor` inalterado (prioriza dashboard/clients/demands/materials/team como antes; notifications só por clique).
- Cada caixa é pessoal: o backend decide a visibilidade; a UI apenas renderiza o que a API devolve e não inventa acesso.
- Abrir não marca como lido implicitamente: `Abrir tarefa/chamado` chama `onOpenItem` (navegação profunda existente que revalida autorização no destino).
- `Marcar como lida` é ação explícita; botões por item impedem duplicação (`busyIds`).
- Datas/timestamps sempre em `America/Cuiaba`; `deliveryDate` exibido como `dd/mm/aaaa` (mesmo formatador do Painel).
- Rótulos PT-BR por `kind` (ex.: `task_assigned` → "Tarefa atribuída a você"), sem payload histórico livre.

## Estados implementados

- `carregando`: skeleton (`dashboard-skeleton` + `sr-only`).
- `lista vazia`: `empty-state` com título/detalhe dependendo do filtro (Todos vs Não lidos).
- `nenhum não lido`: mensagem específica no filtro Não lidos ("Você está em dia.").
- `erro com retry`: `alert-banner error` + "Tentar novamente"; mantém `updatedAt` anterior quando já há dados.
- `atualização em andamento`: botão "Atualizando…" desabilitado.
- `item que perdeu acesso (404)`: recarrega a página atual (e/ou remove na listagem seguinte).
- `permissão revogada (403)`: limpa dados/contador, exibe mensagem e invoca `refreshUnread`.
- `sessão encerrada (401)`: callback global `onUnauthorized` (App limpa contador → login).
- Requests cancelados no unmount/logout; guarda contra resposta antiga repovoando dados (`requestRef.current === controller`).

## Atualização/ciclo

- Ao entrar: `load()` no mount + `refreshUnread` no App.
- Botão "Atualizar" no painel.
- Silenciosa: 60s + retorno de foco, somente com `document.visibilityState === 'visible'`, sem anunciar toda a lista em `aria-live` a cada ciclo (nenhum `aria-live` na lista; apenas no skeleton/erro localizado), sem roubar foco nem alterar página/filtro.
- Nenhum som, toast em massa ou payload em `localStorage`.

## Verificações reais (exit codes)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 0 erros |
| `pnpm --filter @orium/contracts build` | exit 0 (tsc dist) |
| `pnpm --filter @orium/web typecheck` | 0 erros (tsc --noEmit) |
| `pnpm --filter @orium/web build` | exit 0 (tsc + vite, 122 módulos, dist gerado) |

`pnpm typecheck` do monorepo **não** executado: inclui rebuild de contracts+api que cruza o build do Antigravity (incremento 1), evitado conforme contrato; API não reconstruída, DEV não reiniciado, `Portas` não tocadas (nenhum serviço iniciado).

## Limitações reais

- API de notificações ainda não atribuída/implantada (contrato marca backend em revisão): a interface compila e consuma a rota, porém **não há teste de integração/browser** contra resposta real — nada de PASS de integração declarado.
- Homologação visual e E2E (desktop/mobile, teclado, aria-live) ficam para after-backend/gate + PORT_POLICY no portal visível, conforme contrato.
- Detector Impeccable em `apps/web/src/styles.css` apontou 2 achados **pré-existentes do mundo incumbente** (`side-tab` border-left e font Inter), não desta superfície e não alterados (sem redesign global permitido).

## Pendências

- `docs/PHASE7-NOTIFICATIONS-CONTRACT.md` aceite/revisão do Codex #2.
- Backend: atribuição explícita do Codex #2 (schema/migration/serviço/rotas) — fora do meu escopo.
- Homologação visual após API/gate.
