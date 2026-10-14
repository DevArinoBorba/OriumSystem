# Relatório de Implementação & Rollout — Identidade Visual OriumDigital (`apps/web/`)

**Data:** 2026-10-14  
**Referências Visuais:**
- Site institucional ao vivo: `https://orium-phi.vercel.app/`
- Contrato: `docs/ORIUM-DESIGN-IMPLEMENTATION-CONTRACT.md`
- Especificação e Design System: `design/orium-app/BRIEF.md` & `docs/ORIUM-APP-VISUAL-IDENTITY.md`

---

## 1. Resumo Executivo

A identidade visual oficial da **Orium Digital** (extraída diretamente de `https://orium-phi.vercel.app/` e `company-reference-assets/`) foi aplicada integralmente ao frontend React do **OriumSystem** (`apps/web/`) e publicada tanto no ambiente **DEV (`http://127.0.0.1:5173`)** quanto na **VPS de Produção (`https://app.oriumdigital.tech`)**.

---

## 2. Entregas na Aplicação Web (`apps/web/`)

1. **Assets Oficiais da Marca (`apps/web/src/assets/`):**
   - `apps/web/src/assets/logo-horizontal.png` (67.85 KB — para superfícies escuras `#08070c` / `#100f16`)
   - `apps/web/src/assets/logo-horizontal-light-theme.png` (52.32 KB — para superfícies claras `#faf8fd` / `#ffffff`)
   - Tipagem declarada em `apps/web/src/vite-env.d.ts` (`*.png`).

2. **Sistema de Temas Dark (Default) & Light (`apps/web/src/theme.ts` + `apps/web/index.html`):**
   - Inicialização imediata no `<head>` de `apps/web/index.html` (`data-theme="dark"` por padrão, lendo `localStorage.getItem('orium-theme')` sem flash de tema incorreto).
   - Hook reativo `useTheme()` em `apps/web/src/theme.ts` sincronizado entre componentes via `CustomEvent('orium-theme-change')` e `storage`.
   - Botão de alternância Dark/Light (`Alternar para tema claro` / `Alternar para tema escuro`) com ícone Sol/Lua integrado em `Header.tsx` e `LoginView.tsx`, trocando automaticamente a logo horizontal oficial correspondente ao tema ativo.

3. **Tokens e Estética de `https://orium-phi.vercel.app/` (`apps/web/src/styles.css`):**
   - **Tema Dark (`.dark` / `[data-theme="dark"]` — padrão):**
     - `--color-bg: #08070c` com atmosfera radial violeta/fúcsia sutil
     - `--color-surface: #100f16` e `--color-surface-elevated: #161420`
     - `--color-primary: oklch(62% 0.26 295)` / `--color-primary-glow: oklch(74% 0.22 296)` / `--color-primary-deep: oklch(40% 0.24 290)`
     - `--gradient-brand: linear-gradient(135deg, #a855f7 0%, #7c3aed 55%, #581c87 100%)` com `--shadow-glow` nos botões primários e CTA de login
     - Glassmorphism (`backdrop-filter: blur(20px) saturate(160%)`) no cabeçalho `.app-header` e no card de login `.card`
     - Scrollbar customizada (`#a855f740` -> `#a855f780`) e `::selection` violeta
   - **Tema Light (`[data-theme="light"]`):**
     - `--color-bg: #faf8fd`, `--color-surface: #ffffff`, `--color-surface-elevated: #f4f0fa`, `--color-text-main: #09080e`, `--color-primary: oklch(58% 0.24 295)`
   - **Tipografia:**
     - Google Fonts `Sora` (títulos `h1`–`h4`, cabeçalhos e valores numéricos de KPI com `font-variant-numeric: tabular-nums`), `Manrope` (corpo, tabelas, formulários e navegação) e `JetBrains Mono`.
   - **Contraste WCAG AA/AAA:**
     - Todas as cores claras hardcoded das views (`DashboardView`, `DemandsView`, `ClientsView`, `MaterialsView`, `NotificationsView`, `ReportsView`, `TeamView`, `UseTemplateModal`, `ManageTemplatesModal`) foram convertidas para variáveis semânticas CSS.

---

## 3. Validação Técnica e Rollout em Produção (`orium-vps`)

- **Typecheck & Lint:** `pnpm run typecheck` e `pnpm exec eslint apps/web deploy/verification tests/phase10` -> **0 erros**.
- **Build & Release Pipeline:** `node deploy/operations/run-pipeline.mjs production` -> **PASS** (`release-20261014160623-c96df05c1ff7`, 67 arquivos canônicos verificados).
- **Deploy VPS (`orium-vps`):**
  - Sincronizados `apps/web/index.html`, `apps/web/src/theme.ts`, `apps/web/src/vite-env.d.ts`, `apps/web/src/styles.css`, `apps/web/src/components/Header.tsx`, `apps/web/src/components/LoginView.tsx` e `apps/web/src/assets/*.png` em `/data/orium/production/apps/web/`.
  - Container `orium-production-web-1` reconstruído e recriado com sucesso (`vite v8.3.2` gerando `logo-horizontal-C4tbYeGM.png`, `logo-horizontal-light-theme-E3wpBN-Q.png` e `index-BB8xhNMx.css`).
  - `https://app.oriumdigital.tech/` e `https://app.oriumdigital.tech/api/v1/ready` respondendo `200 OK`.
