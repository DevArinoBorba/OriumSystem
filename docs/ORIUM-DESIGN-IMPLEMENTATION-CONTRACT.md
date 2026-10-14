# Contrato de Implementação — Identidade Visual OriumDigital & Design System

**Data:** 2026-10-14  
**Coordenação:** `Antigravity #2` (Maestro)  
**Referências Obrigatórias:**
- `design/orium-app/BRIEF.md`
- `COMPANY_REFERENCE.md`
- `company-reference-assets/INDEX.md` (`logo-horizontal.png` e `logo-horizontal-light-theme.png`)

---

## 1. Diretrizes Aprovadas pelo Usuário

1. **Execução em 2 Frentes Paralelas (Sem Conflito de Arquivos):**
   - **Frente A (`Prisma` / `OpenCode` — Pacote Design System & Protótipo Standalone):**
     - Escopo exclusivo: `design/orium-app/**` e `docs/ORIUM-APP-VISUAL-IDENTITY.md`.
   - **Frente B (`Antigravity` — Aplicação Real `apps/web/` + Rollout DEV/VPS):**
     - Escopo exclusivo: `apps/web/**`, `deploy/operations/ops-config.mjs` (se necessário para assets `.png`), `docs/ORIUM-WEB-DESIGN-RESULT.md`.
2. **Preferência de Tema:**
   - **Tema Dark Premium OriumDigital (`#08070c` background / `#13121a` surface / `#1a1824` surface-elevated)** como **padrão (`default`)**, com acentos violeta (`oklch(62% 0.26 295)` / `#8b5cf6`), fúcsia (`oklch(58% 0.20 330)` / `#d946ef`) e índigo (`oklch(65% 0.22 260)` / `#6366f1`), e glow sutil.
   - **Botão de alternância Dark / Light (`data-theme="dark"` / `data-theme="light"`)** persistido em `localStorage` (`orium-theme`), permitindo alternar para o **Tema Claro (`#faf8fd` background / `#ffffff` surface / `#09080e` ink)** com contraste WCAG AA/AAA em ambos os modos.

---

## 2. Sistema de Tokens OriumDigital (Compartilhado entre Frentes A e B)

### 2.1 Paleta Dark Mode (Default — `:root, [data-theme="dark"]`)
- `--color-bg`: `#08070c`
- `--color-surface`: `#13121a`
- `--color-surface-elevated`: `#1a1824`
- `--color-surface-hover`: `#211e2e`
- `--color-surface-subtle`: `#161420`
- `--color-text-main`: `#f5f3ff`
- `--color-text-muted`: `#a59ec2` (cinza matizado com violeta — contraste ≥ 7:1 sobre `#08070c` e ≥ 5.5:1 sobre `#13121a`)
- `--color-text-light`: `#7e779c`
- `--color-primary`: `#8b5cf6` (`oklch(62% 0.26 295)`)
- `--color-primary-hover`: `#9d6eff` (`oklch(67% 0.26 295)`)
- `--color-primary-light`: `rgba(139, 92, 246, 0.16)`
- `--color-primary-border`: `rgba(168, 85, 247, 0.35)`
- `--color-accent-fuchsia`: `#d946ef` (`oklch(58% 0.20 330)`)
- `--color-accent-indigo`: `#6366f1` (`oklch(65% 0.22 260)`)
- `--color-border`: `rgba(168, 85, 247, 0.16)`
- `--color-border-input`: `#322d46`
- `--color-success`: `#10b981` / `--color-success-bg`: `rgba(16, 185, 129, 0.15)` / `--color-success-text`: `#6ee7b7`
- `--color-warning`: `#f59e0b` / `--color-warning-bg`: `rgba(245, 158, 11, 0.16)` / `--color-warning-text`: `#fcd34d`
- `--color-danger`: `#ef4444` / `--color-danger-bg`: `rgba(239, 68, 68, 0.16)` / `--color-danger-text`: `#fca5a5`
- `--color-info`: `#38bdf8` / `--color-info-bg`: `rgba(56, 189, 248, 0.15)` / `--color-info-text`: `#7dd3fc`
- `--gradient-brand`: `linear-gradient(135deg, #8b5cf6 0%, #d946ef 50%, #6366f1 100%)`
- `--gradient-surface`: `linear-gradient(180deg, rgba(139, 92, 246, 0.08) 0%, rgba(19, 18, 26, 0) 100%)`
- `--shadow-glow`: `0 0 28px -6px rgba(139, 92, 246, 0.35)`

### 2.2 Paleta Light Mode (`[data-theme="light"]`)
- `--color-bg`: `#faf8fd`
- `--color-surface`: `#ffffff`
- `--color-surface-elevated`: `#f3effa`
- `--color-surface-hover`: `#ede6fa`
- `--color-surface-subtle`: `#f6f3fc`
- `--color-text-main`: `#09080e`
- `--color-text-muted`: `#585070` (contraste ≥ 6.5:1 sobre `#ffffff`)
- `--color-text-light`: `#786f94`
- `--color-primary`: `#6d28d9` (`oklch(55% 0.25 295)`)
- `--color-primary-hover`: `#5b21b6` (`oklch(49% 0.25 295)`)
- `--color-primary-light`: `#f2ebff`
- `--color-primary-border`: `#d8b4fe`
- `--color-border`: `#e4ddf2`
- `--color-border-input`: `#cfc5e6`
- `--color-success`: `#059669` / `--color-success-bg`: `#d1fae5` / `--color-success-text`: `#065f46`
- `--color-warning`: `#d97706` / `--color-warning-bg`: `#fef3c7` / `--color-warning-text`: `#92400e`
- `--color-danger`: `#dc2626` / `--color-danger-bg`: `#fee2e2` / `--color-danger-text`: `#991b1b`
- `--color-info`: `#0284c7` / `--color-info-bg`: `#e0f2fe` / `--color-info-text`: `#075985`

### 2.3 Tipografia
- `--font-display`: `'Sora', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif` (títulos `h1`–`h4`, valores de KPI, cabeçalhos de páginas e modais, wordmark)
- `--font-sans`: `'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif` (corpo, tabelas, inputs, labels, botões)
- `--font-mono`: `'JetBrains Mono', 'Fira Code', monospace` (IDs, durações, códigos, métricas tabulares com `font-variant-numeric: tabular-nums`)

---

## 3. Escopo Frente A (`design/orium-app/` + `docs/ORIUM-APP-VISUAL-IDENTITY.md`)

1. `design/orium-app/tokens/colors.css`: tokens completos Dark (default) e Light (`[data-theme="light"]`), gradientes, sombras e tokens semânticos de status e prioridade.
2. `design/orium-app/tokens/typography.css`: imports Google Fonts (`Sora` + `Manrope` + `JetBrains Mono`), escala modular fluida (`clamp()`), pesos, `line-height`, `letter-spacing`, `tabular-nums`.
3. `design/orium-app/tokens/spacing.css`: escala base `4px`/`8px`, raios (`--radius-sm` a `--radius-xl`), containers, grids e transições.
4. `design/orium-app/components/`:
   - `button.css` (`primary` com gradiente/glow sutil, `secondary`, `ghost`, `danger`, tamanhos `sm`/`md`/`lg`, estados hover/focus-visible/disabled)
   - `card.css` (KPI cards com borda translúcida violeta, cards de demanda/tarefa, estados de atraso/bloqueio)
   - `badge.css` (badges de status de demanda/tarefa, prioridade `low`/`medium`/`high`/`urgent`, áreas da agência `design`/`web`/`video`/`social`/`trafego`/`copy`)
   - `input.css` (inputs, selects, textareas, search bar, chips de filtro)
   - `table.css` (tabelas densas de operação com hover sutil, cabeçalhos fixos, alinhamento tabular)
   - `nav.css` (header/sidebar OriumDigital com logo oficial, itens ativos com indicador luminoso violeta, toggle de tema Dark/Light)
5. `design/orium-app/pages/`:
   - `index.html`: **Visão Geral da Operação** (KPIs em destaque, demandas por status, alertas de gargalo/atraso, aprovações de clientes pendentes, entregas da semana, seletor funcional de tema Dark/Light).
   - `minhas-tarefas.html`: **Minhas Tarefas por Colaborador** (filtros por prioridade/status/prazo, agrupamento Hoje / Esta Semana / Atrasadas / Em Revisão, progresso de checklist).
   - `materiais.html`: **Materiais de Clientes e Entregas** (galeria/tabela de materiais recebidos e entregáveis finais, status de aprovação do cliente, histórico de revisões).
6. `docs/ORIUM-APP-VISUAL-IDENTITY.md`:
   - Documento executivo e técnico da Identidade Visual do OriumSystem (racional criativo da conexão institucional OriumDigital -> produto interno de operação, tabela de tokens Dark/Light, tipografia, anatomia dos componentes e guia de uso).

---

## 4. Escopo Frente B (`apps/web/` + Rollout DEV/VPS)

1. **Assets Oficiais OriumDigital:**
   - Copiar `company-reference-assets/logo-horizontal.png` e `company-reference-assets/logo-horizontal-light-theme.png` para `apps/web/src/assets/logo-horizontal.png` e `apps/web/src/assets/logo-horizontal-light-theme.png`.
   - Adicionar `apps/web/src/vite-env.d.ts` (`/// <reference types="vite/client" />`) ou declaração de módulo `*.png` compatível com `tsc -p tsconfig.json --noEmit`.
   - Verificar `deploy/operations/ops-config.mjs`: garantir que `apps/web/src/assets/` e `.png` sejam permitidos nas regras do release manifest (`ALLOW` já inclui `apps/web/src/`, verificar se há filtro de extensão ou se todos os arquivos em `apps/web/src/` entram no manifesto).
2. **`apps/web/index.html`:**
   - Carregar Google Fonts `Sora:wght@600;700` e `Manrope:wght@400;500;600;700` e `JetBrains+Mono:wght@400;500`.
   - Configurar `<meta name="theme-color" content="#08070c" />` e título `OriumSystem — Orium Digital`.
   - Inicializar `document.documentElement.dataset.theme` como `'dark'` por padrão (ou lendo `localStorage.getItem('orium-theme')`).
3. **Tema Dark/Light + Logos Oficiais em `Header.tsx` e `LoginView.tsx`:**
   - Criar helper/hook de tema (ex: `apps/web/src/theme.ts` ou dentro de `App.tsx`/`Header.tsx`/`LoginView.tsx`) que lê/persiste `localStorage.getItem('orium-theme')` (`'dark'` default | `'light'`) e sincroniza `document.documentElement.dataset.theme`.
   - Exibir a logo oficial da Orium Digital (`logo-horizontal.png` quando `theme === 'dark'`, `logo-horizontal-light-theme.png` quando `theme === 'light'`) no `Header.tsx` e no `LoginView.tsx`, mantendo o texto acessível/semântico para leitores de tela e testes automatizados.
   - Adicionar botão de alternância de tema (`aria-label="Alternar tema"` / título claro) no `Header.tsx` e no `LoginView.tsx`.
4. **Refatoração Completa de `apps/web/src/styles.css`:**
   - Substituir toda a paleta genérica azul/slate por tokens OriumDigital Dark (default) e Light (`[data-theme="light"]`).
   - Eliminar todas as cores hardcoded (`#ffffff`, `#f8fafc`, `#f1f5f9`, `#1e293b`, `#475569`, `#64748b`, `#e2e8f0`, `#334155`, etc.) em modais, cards, tabelas, drawers, checklists, comentários, templates, relatórios, filtros e formulários, substituindo por variáveis CSS semânticas (`var(--color-surface)`, `var(--color-surface-elevated)`, `var(--color-surface-subtle)`, `var(--color-text-main)`, `var(--color-text-muted)`, `var(--color-border)`, etc.).
   - Aplicar `font-family: var(--font-display)` em títulos, cabeçalhos e números de KPI (`tabular-nums`), e `var(--font-sans)` na interface.
   - Estilizar `LoginView` com estética OriumDigital (background `#08070c` com radial glow violeta/fúcsia sutil, card elevado `#13121a` com borda translúcida violeta, botão primário com gradiente/glow Orium).
   - Preservar **100% dos seletores, classes, IDs, `aria-label` e estrutura funcional** das views (`DashboardView`, `DemandsView`, `ClientsView`, `MaterialsView`, `NotificationsView`, `ReportsView`, `TeamView`, `UseTemplateModal`, `ManageTemplatesModal`).
5. **Validação e Rollout:**
   - `pnpm run typecheck` (0 erros)
   - `pnpm exec eslint apps/web deploy/verification tests/phase10` (0 erros)
   - `pnpm --filter @orium/web build` (build limpo)
   - `node deploy/operations/run-pipeline.mjs production` (PASS)
   - Atualizar DEV (`http://127.0.0.1:5173`) e VPS de produção (`orium-vps` -> `https://app.oriumdigital.tech`).
   - Documentar resultado em `docs/ORIUM-WEB-DESIGN-RESULT.md`.
