# ADR-0001 — Sistema próprio, monólito modular e API REST

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase: 0.

## Contexto

A agência precisa de um domínio específico de clientes, demandas, tarefas, dependências e prazos. A comparação de projetos existentes está em `../../ARCHITECTURE_PROPOSAL.md`, seção 3.

## Decisão aprovada

Desenvolver sistema próprio, sem Twenty ou Plane como base. Organizar o backend como monólito modular com API REST independente. Web, futuro mobile e futuros agentes consomem a mesma API e regras de negócio. Agentes nunca acessam diretamente PostgreSQL de produção.

## Consequências

Evita fork de produto amplo e duplicidade de fonte de verdade. A equipe assume manutenção do domínio. Módulos pertencem a um backend, sem tornar a interface web a única porta de acesso às regras. Mobile e agentes permanecem nas suas fases; não estão autorizados nesta decisão.

## Limites e alternativas

Twenty/Plane como base e microsserviços não foram escolhidos. Detalhes de versionamento HTTP, webhooks, adapters e autenticação de máquina permanecem propostas para suas fases. Este ADR não autoriza implementação nem início da Fase 1.
