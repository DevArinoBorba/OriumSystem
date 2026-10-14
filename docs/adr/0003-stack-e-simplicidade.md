# ADR-0003 — Stack principal e simplicidade inicial

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase: 0.

## Contexto

O sistema é inicialmente pequeno, com prioridade para baixo custo, manutenção e futura VPS com PostgreSQL.

## Decisão aprovada

- Frontend: React + Vite + TypeScript.
- Backend: Node.js + Fastify + TypeScript.
- Banco: PostgreSQL.
- Query layer: Drizzle.
- Sem Redis, Kubernetes ou microserviços inicialmente.

## Consequências

API e web usam TypeScript, mas domínio e persistência continuam responsabilidade do backend. PostgreSQL centraliza persistência relacional. Adicionar serviço distribuído exige justificativa e aprovação, não escolha silenciosa do executor.

## Limites e alternativas

Vue, Next.js full-stack, NestJS, Django e Prisma foram alternativas avaliadas, sem seleção. Na autorização posterior da Fase 1, Zod e PostgreSQL local isolado em Docker também foram aprovados. A Fase 1 pode implementar somente a fundação; jobs, deploy, infraestrutura de produção e módulos futuros continuam fora do escopo. Versões estáveis e compatíveis precisam ser verificadas antes de fixação.
