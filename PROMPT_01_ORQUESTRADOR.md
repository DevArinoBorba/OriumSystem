# PROMPT 01 — ORQUESTRADOR / FASE 0

Você é o orquestrador técnico deste projeto.

Antes de qualquer ação:
1. Leia integralmente `PROJECT_CONTEXT.md`.
2. Leia integralmente `ROADMAP.md`.
3. Considere esses documentos como fonte de verdade para regras de negócio e ordem de desenvolvimento.
4. Confirme que a fase atual é a FASE 0 — ESPECIFICAÇÃO E ARQUITETURA.

## Sua missão nesta execução
Realizar SOMENTE a análise arquitetural da Fase 0.

NÃO escreva código de produção.
NÃO inicialize frameworks.
NÃO crie migrations.
NÃO implemente telas.
NÃO antecipe funcionalidades de fases futuras.
NÃO altere os requisitos silenciosamente.

## Entregue uma proposta técnica contendo

### 1. Arquitetura
Proponha uma arquitetura simples, modular, segura e adequada para uma pequena agência, sem complexidade desnecessária.

### 2. Stack
Proponha tecnologias para:
- frontend;
- backend;
- banco PostgreSQL;
- autenticação;
- autorização;
- validação;
- testes;
- documentação de API;
- containers;
- deploy.

Para cada escolha, explique brevemente o motivo e cite uma alternativa quando houver decisão relevante.

### 3. Estrutura do repositório
Compare de forma objetiva monorepo versus repositórios separados e recomende uma estrutura para este projeto.

### 4. Modelo de domínio inicial
Liste as entidades e relacionamentos que provavelmente serão necessários, SEM criar migrations ainda.

Considere no mínimo:
- usuários;
- clientes;
- demandas;
- tarefas;
- dependências;
- comentários;
- materiais/links;
- histórico;
- notificações;
- auditoria.

### 5. Autenticação e autorização
Proponha uma estratégia adequada para logins individuais e permissões internas.

### 6. Segurança
Explique como tratar:
- senhas dos usuários;
- credenciais de clientes;
- secrets;
- logs;
- auditoria;
- acesso por agentes de IA no futuro.

### 7. Infraestrutura
Considere desenvolvimento local e futura implantação em VPS própria com PostgreSQL.

Proponha:
- containers;
- ambientes;
- backup;
- restauração;
- HTTPS;
- proxy;
- monitoramento básico;
- CI/CD.

### 8. API e aplicativo futuro
A arquitetura precisa permitir que web, aplicativo mobile e futuros agentes utilizem o mesmo núcleo de negócio/API.

### 9. Riscos
Liste riscos técnicos e decisões que precisam ser tomadas antes da Fase 1.

### 10. Perguntas
Se houver informação indispensável faltando, faça perguntas no final.
Não invente regras de negócio.

## Resultado esperado
Produza um documento de proposta arquitetural para revisão humana.

Ao terminar, PARE.

Não implemente a proposta.
Não avance para a Fase 1.
Aguardaremos aprovação explícita antes de qualquer código.
