# ADR-0002 — Monorepo com pnpm workspaces

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase: 0.

## Contexto

Web e API precisam evoluir com contratos compatíveis e coordenação de agentes em uma equipe pequena.

## Decisão aprovada

Manter frontend e backend no mesmo repositório, usando pnpm workspaces. A independência da API é preservada; compartilhar repositório não exige deploy conjunto.

## Consequências

Mudanças de contratos podem ser revisadas junto com consumidores. Exige limites entre pacotes e coordenação de alterações. Repositórios separados foram descartados inicialmente pelo custo de sincronização.

## Limites

A árvore da proposta é ilustrativa. Não aprova criação imediata de aplicações, pacote mobile, ferramentas extras de build ou CI. Workspaces e dependências serão inicializados somente com autorização da fase correspondente.
