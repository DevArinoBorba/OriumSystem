# OriumSystem

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipe interna de uma agência. Monique organiza clientes e distribui demandas; Arino e demais colaboradores executam trabalhos. Arino e Monique são os administradores iniciais. Clientes finais não possuem login no MVP.

## Product Purpose

Centralizar clientes, demandas, tarefas, materiais e histórico para reduzir a dependência operacional do WhatsApp.

## Operating Context

Frontend React/Vite separado da API Fastify e banco PostgreSQL. Desenvolvimento local, com banco em Docker. Os arquivos e materiais permanecem em serviços externos, como Google Drive.

## Capabilities and Constraints

Login individual por e-mail e senha, sem cadastro público. Autorização no backend, com negação por padrão. Não armazenar tokens em localStorage ou exibir credenciais. O relógio de uma tarefa começa somente no início explícito por usuário autorizado; prontidão e espera na fila não contam como execução. Permissões de negócio e calendário ainda estão em definição; seguir decisões documentadas em PROJECT_CONTEXT.md e ROADMAP.md.

## Brand Commitments

Nome OriumSystem; interface e mensagens em português do Brasil. A implementação existente da tela de login é a referência visual a preservar nesta extensão.

## Evidence on Hand

PROJECT_CONTEXT.md, ROADMAP.md, ADRs e relatórios locais de testes. Dados de validação são fictícios; não inventar clientes, métricas ou resultados comerciais.

## Product Principles

- Tornar o próximo passo da operação claro.
- Preservar histórico e motivos das mudanças.
- Concentrar regras e permissões na API.
- Usar módulos simples e verificáveis.
