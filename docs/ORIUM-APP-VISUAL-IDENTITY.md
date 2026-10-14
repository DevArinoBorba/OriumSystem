# Documentação de Identidade Visual — OriumSystem & OriumDigital

**Data:** 2026-10-14  
**Versão:** 1.0  
**Escopo:** Frente A (`design/orium-app/`)  
**Coordenação:** Antigravity #2 (Maestro)

---

## 1. Racional Criativo & Visão Geral

O **OriumSystem** é o sistema operacional interno da agência **OriumDigital**. A identidade visual do aplicativo foi concebida como uma extensão natural da marca institucional OriumDigital: profissional, sofisticada, altamente scanável e focada na eficiência operacional ("Operate").

O design system estabelece um mundo visual próprio ("Own-World") fundamentado em:
- **Tema Dark Premium** como padrão (`#08070c`), transmitindo imersão, modernidade e foco nos dados e entregas.
- **Tema Claro** (`#faf8fd`), totalmente integrado com suporte a contraste WCAG AA/AAA.
- **Tipografia refinada** combinando **Sora** (títulos com forte personalidade e impacto visual) e **Manrope** (corpo de texto limpo e legível), complementadas por **JetBrains Mono** para métricas tabulares e dados numéricos.
- **Acentos em Violeta, Fúcsia e Índigo**, evocando a identidade visual oficial da OriumDigital sem competir com a legibilidade dos status operacionais.

---

## 2. Sistema de Tokens (Design Tokens)

### 2.1 Cores (Dark & Light)
O sistema utiliza variáveis CSS puras localizadas em `design/orium-app/tokens/colors.css`.

| Token Semântico | Dark Mode (Default) | Light Mode (`[data-theme="light"]`) | Descrição |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#08070c` | `#faf8fd` | Fundo principal da aplicação |
| `--color-surface` | `#13121a` | `#ffffff` | Superfícies de cards, tabelas e modais |
| `--color-surface-elevated` | `#1a1824` | `#f3effa` | Elementos elevados, toolbars e filtros |
| `--color-text-main` | `#f5f3ff` | `#09080e` | Títulos e textos de alta ênfase |
| `--color-text-muted` | `#a59ec2` | `#585070` | Rótulos, descrições e metadados |
| `--color-primary` | `#8b5cf6` | `#6d28d9` | Cor principal da marca (Violeta Orium) |
| `--color-accent-fuchsia`| `#d946ef` | `#c026d3` | Destaques e gradientes secundários |
| `--color-accent-indigo` | `#6366f1` | `#4f46e5` | Elementos interativos e links |

### 2.2 Tipografia
Importada via Google Fonts em `design/orium-app/tokens/typography.css`:
- `--font-display`: `'Sora', sans-serif`
- `--font-sans`: `'Manrope', sans-serif`
- `--font-mono`: `'JetBrains Mono', monospace` (com `font-variant-numeric: tabular-nums` para alinhamento perfeito de KPIs e prazos).

### 2.3 Espaçamentos e Raio de Borda
Escala modular baseada em incrementos de 4px (`design/orium-app/tokens/spacing.css`):
- `--space-1` (4px) a `--space-16` (64px)
- `--radius-sm`: 6px | `--radius-md`: 10px | `--radius-lg`: 14px | `--radius-xl`: 20px

---

## 3. Anatomia de Componentes

Foram implementados 6 componentes CSS modulares em `design/orium-app/components/`:
1. **`button.css`**: Botões primários com gradiente de marca e glow sutil, secundários, ghost e danger em múltiplos tamanhos (`sm`, `md`, `lg`).
2. **`card.css`**: Cards de conteúdo com bordas translúcidas e KPI cards com suporte a tendências numéricas.
3. **`badge.css`**: Indicadores de status (`success`, `warning`, `danger`, `info`, `neutral`, `primary`).
4. **`input.css`**: Controles de formulário com estados de foco com anel violeta e chips de filtro interativos.
5. **`table.css`**: Tabelas densas com cabeçalhos destacados e hover de linha suave.
6. **`nav.css`**: Barra lateral de navegação com alternância de tema em tempo real (Dark/Light) e persistência em `localStorage`.

---

## 4. Protótipos Funcionais em `design/orium-app/pages/`

- **`index.html`**: Visão Geral da Operação com KPIs em destaque, alertas de gargalos operacionais e tabela de demandas recentes.
- **`minhas-tarefas.html`**: Gestão de tarefas por colaborador, divididas por prazos (Hoje, Esta Semana) com barras de progresso de checklist.
- **`materiais.html`**: Repositório central de arquivos e entregáveis de clientes com status de aprovação.
