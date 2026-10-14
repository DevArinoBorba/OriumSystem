# PHASE11-KICKOFF.md — Fase 11 · Refinamento — Planejamento Inicial

**Data:** 14/10/2026
**Fonte:** `ROADMAP.md` — "FASE 11 — Refinamento: Analisar gargalos, revisar UX, templates de demandas, automações, relatórios, integrações e performance."
**Status:** Em planejamento. Nada implementado ainda. Escopo objetivo abaixo para deliberação e contratos por frente.

---

## 1. Objetivo da fase

Melhorar o sistema já em operação (Fases 1–7 ativas, produção na VPS saudável) sem abrir novas superfícies de risco: mapear gargalos operacionais reais, refinar UX com base no fluxo diário da agência, padronizar abertura de demandas via templates, automatizar tarefas internas repetitivas, melhorar relatórios de gestão, integrar serviços onde houver acesso real e endereçar performance observável.

## 2. Temas de escopo (do ROADMAP)

1. **Análise de gargalos** — onde o fluxo perde tempo: aprovação/block de tarefas, dependências, revisão de materiais, comunicação de prazos.
2. **Revisão de UX** — reduzir fricção nas telas core (demandas/tarefas, central de notificações, dashboard).
3. **Templates de demandas** — modelos reutilizáveis por tipo de serviço (landing page, posts, design, etc.) com requisitos pré-preenchidos.
4. **Automações internas** — reduzir trabalho manual repetitivo (ex.: lembretes, status derivados, notificações consolidadas).
5. **Relatórios** — visões de gestão (carga por responsável, prazo, atrasos, produtividade, recorrência de imagem).
6. **Integrações** — apenas com acesso/prova real (ex.: Google Drive após OAuth da Fase 10; sem integrações fictícias).
7. **Performance** — latências observáveis, queries lentas, tamanho de bundle/loading, caso aplicável após medição.

## 3. Divisão por frentes

| Frente | Agente | Escopo inicial proposto |
|---|---|---|
| Backend / performance / templates / relatórios | **Antigravity** | Análise de gargalos no backend (queries/IO/transacional); templates de demandas no schema/API (modelo `demand_template` + seeds); relatórios (novos endpoints agregados de carga, série temporal de prazos); medição de performance (slow queries, índices) |
| UX / frontend | **OpenCode** | Revisão de UX das telas core; redesenho de componentes de alta fricção; consumir templates e relatórios na UI; micro-otimizações de carregamento; alinhamento com design tokens já existentes |
| Testes E2E / integração | **Antigravity QA** | Suítes E2E por fluxo core depois das mudanças; cobertura dos novos endpoints (templates/relatórios/automações); regressão de 60/60 da Fase 10 preservada; provas em sandbox/portal |
| Auditoria | **Sentinela** | Revisões READONLY por contrato: segurança das novas rotas (RBAC/IDOR), automações que tocam dados sensíveis, integração Drive (OAuth/escopo), melhores práticas Postgres nas migrações |

## 4. Critérios de aceite por módulo (proposta inicial)

- **Templates:** criar demanda a partir de template; template por tipo de serviço; edição/ativação com auditoria; requisitos pré-preenchidos; sem quebra do fluxo atual de criação manual.
- **Relatórios:** endpoints agregados autenticados com RBAC (administrator); série temporal de prazos/carga; dados somente-leitura via queries indexadas; sem exposição de dados além do papel.
- **Automações:** comportamento derivado determinístico e auditável em `demand_event`; cobertura de testes; sem decisões de negócio inventadas (cada automação exige confirmação do responsável).
- **UX:** estado-alvo documentado por tela; contraste/teclado/navegação preservados (herança das Fases 3–7); sem regressão visual nos fluxos homologados.
- **Integrações:** somente com acesso real e prova; Drive usa OAuth da Fase 10 (`drive.file`), upload em pasta autorizada, sem secrets no repo.

## 5. Regras de execução herdadas (aplicáveis a toda a fase)

- Ler `PROJECT_CONTEXT.md`, `ROADMAP.md`, ADRs e contratos antes de alterar código. Respeitar ownership de arquivos e a regra da nota `oriumsystem-acompanhamento` (cada agente edita a própria seção via `note edit`).
- Nada de classe de negócio inventada: cada feature nova entra com definição explícita de regra + critérios verificáveis.
- Integrações/infra externas só são declaradas concluídas com prova real.
- Aplicar `PORT_POLICY`/`Find-FreePort.ps1` antes de subir qualquer serviço; testes de navegador em portal visível.
- Atualizar `ROADMAP.md` somente com evidência de conclusão.

## 6. Frentes sugeridas para a próxima etapa

1. **Gate 1:** definição de gargalos (baseline com dados reais de uso/UX) antes de escolher o que refinar — proponho leitura de evidências existentes (Fase 3–7) + confirmação com o responsável sobre prioridades.
2. **Gate 2:** contrato de escopo da Fase 11 (módulos, ordem de execução, donos por frente, critérios de pronto).
3. **Gate 3:** execução por frente com verificação independente (QA/Sentinela) e aceite da coordenação.

Nenhuma implementação foi iniciada nesta kickoff.
