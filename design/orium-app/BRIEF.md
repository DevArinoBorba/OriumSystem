# BRIEF — Identidade Visual OriumSystem

## Fonte de verdade
`design/orium-app/BRIEF.md`

## 1. Decisão — o que é verdadeiro

- **Não há DESIGN.md existente** para o OriumSystem — a identidade visual é nova.
- O branding OriumDigital (violeta, Manrope, gradientes) é a referência institucional confirmada.
- O app existente (`apps/web`) tem componentes funcionais sem identidade unificada (tokens `--color-primary`, mas sem sistema de design).
- **Decisão:** criar mundo novo (brand OriumDigital) para o OriumSystem — não copiar aparência comercial indiscriminadamente.

## 2. O que vai mudar o trabalho

### Modo: Operate
- Visitante completa tarefa: scanability, consistência, expectativas nativas.
- Brand vive em detalhes precisos — não decoração.

### Brief do responsável (Codex)
- Identidade **OriumDigital**: violeta (OKLCH 62% .26 295), Manrope (texto), Sora/Syne (títulos), gradientes violet/fuchsia/indigo, cantos arredondados, brilho.
- Superfícies: Dashboard / Minhas tarefas / Materiais — desktop e mobile.
- Protótipo funcional navegável com dados fictícios.
- Tokens completos: cores, tipografia, espaçamento, componentes, estados, contraste.
- Proposta de implantação incremental.
- **Não inventar logo** — usar referência ao logo existente.
- Preservar produto/RBAC/fluxos existentes.

## 3. Invenção

### Superfícies
- Dashboard: Em produção / Dependendo de ação / Pendências / Carga da equipe
- Minhas tarefas: tarefas do usuário logado, status, prioridades, prazos
- Materiais: links, categorias, Drive, referências externas

### Paleta (base OriumDigital)
```
--color-bg-dark:        #08070c    /* fundo escuro */
--color-bg-light:       #faf8fd    /* fundo claro */
--color-surface-dark:   #13121a    /* card/panel escuro */
--color-surface-light:  #ffffff    /* card/panel claro */
--color-primary:        oklch(62% .26 295)  /* violeta escuro */
--color-primary-light:  oklch(58% .24 295)  /* violeta claro */
--color-accent-fuchsia: oklch(58% .20 330)  /* fúcsia */
--color-accent-indigo:  oklch(65% .22 260)  /* índigo */
--color-text-dark:      #ffffff    /* texto principal escuro */
--color-text-muted:     #a0a0b8    /* texto secundário */
--color-success:        oklch(65% .20 145)
--color-warning:        oklch(72% .18 85)
--color-error:          oklch(60% .22 25)
```

### Tipografia
- **Headings/Display:** Sora (Google Fonts)
- **UI/Body:** Manrope (Google Fonts)

### Tokens de espaçamento
- Base: 4px
- Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96

### Componentes
- Navbar: logo, user menu, navegação principal
- Cards: status badges, prioridade, prazo, responsável
- Botões: primary (violeta), secondary (outline), ghost
- Form controls: inputs, selects, toggles
- Estados: default, hover, focus, active, disabled, loading, error
- Tabelas: compactas com ações inline

### Estilo visual
- Cantos arredondados (8px botões, 12px cards, 16px modais)
- Sombras suaves com brilho violeta em elementos de destaque
- Gradientes subtis violet → fuchsia → indigo em CTAs e headers
- Glassmorphism sutil em overlays

## 4. Contrato de direção

### THESIS
O sistema operacional da agência com alma OriumDigital: violeta premium, limpo e funcional, onde o brand não compete com a operação — a reforça com consistência e confiança.

### OWN-WORLD
Paleta escura principal com violeta como cor de marca. Manrope para toda UI. Sora para títulos. Gradientes violet/fuchsia em elementos de destaque. Cards com fundo `#13121a`, bordas sutis violeta, sombras com brilho. Navegação lateral escura com ícones violeta no estado ativo.

### STORY
O usuário interno (Monique, Arino, equipe) acessa um app que parece profissional e premium — extensão natural da marca que eles representam. A interface é limpa, scanável, com hierarquia clara. Dados fictícios demonstram todas as funcionalidades.

### FIRST VIEWPORT
- Header com logo OriumSystem e user avatar
- Sidebar esquerda: Dashboard, Minhas tarefas, Materiais (e futuras: Clientes, Demandas)
- Área principal: welcome card com métricas resumidas, seguido de seções de conteúdo
- Footer mínimo

### FORM
Sistema de design atômico com tokens CSS customizados. Componentes reutilizáveis. HTML/CSS vanilla funcional em protótipo standalone. Mobile-first responsive.

### FINISH
Protótipo funcional navegável com dados fictícios. Desktop (1280px) e mobile (390px). Tokens documentados. Proposta de implantação incremental. Revisão Codex.

## 5. Arquivos de saída

```
design/
  orium-app/
    BRIEF.md                    ← este arquivo
    tokens/
      colors.css               ← variáveis CSS de cor
      typography.css           ← variáveis CSS de tipografia
      spacing.css              ← variáveis CSS de espaçamento
    components/
      button.css
      card.css
      badge.css
      input.css
      table.css
      nav.css
    pages/
      index.html               ← Dashboard (protótipo funcional)
      minhas-tarefas.html      ← Minhas tarefas
      materiais.html           ← Materiais
    assets/
      (referências a logos existentes)
docs/
  ORIUM-APP-VISUAL-IDENTITY.md ← Documentação completa
```

## 6. Restrições de escopo

- **NÃO editar:** `apps/web/`, backend, `PRODUCT.md`, `DESIGN.md` existentes, `ROADMAP.md`
- **NÃO iniciar:** mobile nativo, novo framework
- **NÃO inventar:** logo (usar referência)
- **NÃO incluir:** dados reais, segredos, credenciais