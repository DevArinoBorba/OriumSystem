# Revisão Independente de Segurança — Fase 1 (Fundação)

- **Data da análise:** 2026-10-05 12:30:00 -04:00
- **Responsável pela revisão:** Antigravity (leitura e análise independente)
- **Escopo analisado:** `apps/api/src/` (`auth.ts`, `identity.ts`, `cli.ts`, `app.ts`, `db.ts`, `migrate.ts`, `schema.ts`, `config.ts`, `errors.ts`, `server.ts`), contratos (`packages/contracts/src/index.ts`), migrations (`db/migrations/0000_foundation.sql`), suíte de testes (`tests/`) e relatórios de infraestrutura/navegador (`docs/LOCAL-INFRA-STATUS.md`, `docs/PHASE1-BROWSER-REPORT.md`, `docs/PHASE1-REPORT.md`).
- **Aviso:** Este documento apresenta uma análise técnica pontual e independente da base de código da Fase 1. Não constitui auditoria formal de conformidade nem declara ausência absoluta de vulnerabilidades.

---

## 1. Resumo Executivo

A implementação da Fase 1 demonstra alto rigor técnico, alinhamento com os ADRs aprovados (0001 a 0007) e aplicação consistente do princípio de menor privilégio. Não foram identificadas vulnerabilidades críticas ou exploráveis na camada de fundação. Os mecanismos de concorrência, revogação de sessão e negação por padrão atendem plenamente às especificações exigidas.

---

## 2. Análise Detalhada por Dimensão de Segurança

### 2.1 Permissões e Controle de Acesso (RBAC)
- **Princípio Deny-by-Default:** Implementado em `requirePermission()` (`identity.ts`, L48-50). O acesso exige que a permissão solicitada esteja explicitamente presente nas permissões computadas do usuário e restringe qualquer operação administrativa ao papel de `administrator`.
- **Prevenção de escalonamento de privilégios:** Em `changeRolePermissions()` (`identity.ts`, L102-118), o papel `collaborator` é proibido de receber permissões administrativas (`ADMIN_PERMISSIONS_ONLY`). Paralelamente, o papel `administrator` não pode ter suas permissões essenciais removidas (`ADMIN_PERMISSIONS_REQUIRED`).
- **Superfície exposta de rotas:** Não há montagem de roteador curinga (*wildcard*) do Better Auth. Apenas os endpoints estritamente necessários (`/api/v1/auth/sign-in/email` e `/api/v1/auth/sign-out`) estão mapeados no Fastify. O cadastro público (`sign-up`) foi completamente desabilitado e retorna 404.

### 2.2 Gerenciamento de Sessão e Revogação
- **Cookies Seguros e HttpOnly:** Cookies de sessão são configurados com `httpOnly: true`, `sameSite: 'lax'` e `path: '/'`. O acesso via JavaScript (`document.cookie`) é bloqueado, mitigando riscos de XSS. Em desenvolvimento local, `useSecureCookies` segue HTTP loopback; em produção com HTTPS, o flag `Secure` é automaticamente ativado.
- **Validade Absoluta vs. Inatividade:** A validação em `authenticate()` (`identity.ts`, L56-68) é atômica:
  - Validade absoluta de 7 dias (`s.created_at > now() - interval '7 days'`);
  - Janela deslizante de inatividade de 12 horas (`s.last_seen_at > now() - interval '12 hours'`);
  - Condição de usuário ativo (`u.active = true`).
  - O `last_seen_at` é atualizado sem prolongar a expiração absoluta (`expires_at`), e sessões inativas ou expiradas são imediatamente expurgadas do banco.
- **Revogação Imediata:** 
  - Ao efetuar logout (`/api/v1/auth/sign-out`);
  - Ao desativar um usuário (`PATCH /api/v1/users/:id`), todas as suas sessões ativas são deletadas de `auth_session`;
  - Ao alterar o papel de um usuário (`PUT /api/v1/users/:id/role`), as sessões anteriores são destruídas;
  - Ao alterar permissões de um papel (`PUT /api/v1/roles/:role/permissions`), todas as sessões dos membros afetados são revogadas.

### 2.3 Concorrência e Race Conditions
- **Lock Transacional Dedicado (`IDENTITY_LOCK = 712041`):** Todas as mutações que afetam identidade, papéis, permissões ou bootstrap utilizam `SELECT pg_advisory_xact_lock(712041)` dentro de transações seriais.
- **Revalidação do Ator sob Lock:** Nas funções `provisionUser()`, `changeIdentity()` e `changeRolePermissions()`, o status de atividade e o papel de administrador do ator solicitante são rechecados no banco *após* a aquisição do lock consultivo. Isso elimina a janela de corrida onde um administrador desativado poderia concluir mutações concorrentes.
- **Proteção do Último Administrador:** Em `changeIdentity()` (`identity.ts`, L79-86), a alteração seleciona o alvo com `FOR UPDATE` e contabiliza administradores ativos sob lock consultivo. Caso a contagem seja `<= 1`, a desativação ou rebaixamento é rejeitada com `409 LAST_ADMINISTRATOR`, impedindo que o sistema fique sem administração ativa por solicitações simultâneas.

### 2.4 Exposição de Segredos e Proteção de Dados
- **Sanitização de Logs:** O Fastify Logger está configurado com redaction explícito (`req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`, `password`, `token`, `secret`, `DATABASE_URL`). Serializadores omitem parâmetros de consulta (`query params`) e corpos de requisição.
- **Tratamento de Erros:** O manipulador global (`app.setErrorHandler`) mascara mensagens de erro internas e exceções de banco com `{ error: { code: 'INTERNAL_ERROR', requestId } }`, prevenindo vazamento de strings de conexão, credenciais ou schemas em falhas de execução.
- **Menor Privilégio no Banco (`assertApplicationDatabase`):** Executado na inicialização da API e no health check ready (`/health/ready`). Impede a execução da aplicação caso o usuário do banco possua permissões excessivas (`rolsuper`, `rolbypassrls`, `rolcreatedb`, `rolcreaterole`, `CREATE` na base ou schema, ou propriedade de tabelas/schemas).

### 2.5 Migrações e Integridade do Schema
- **Lock de Migração (`pg_advisory_lock(712040)`):** Garante execução única de migrações no banco, evitando execuções concorrentes.
- **Isolamento de Papéis:** As migrações são executadas exclusivamente pela role `orium_migrator`. A role da aplicação (`orium_app`) recebe apenas concessões mínimas de DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) em tabelas necessárias, sem permissões de DDL.
- **Validação de Entrada no CLI:** Validação rigorosa do protocolo e hostname loopback para strings de conexão e regex restritivo para o nome do papel da aplicação (`/^[a-z][a-z0-9_]{0,62}$/`).

---

## 3. Diferenciação Operacional: Bootstrap Inicial vs. Recuperação Futura

| Característica | Bootstrap Inicial (`pnpm db:bootstrap`) | Procedimento de Recuperação Futura |
|---|---|---|
| **Condição de Execução** | Banco de dados **completamente vazio** (`auth_user` com 0 registros). | Banco populado com perda de acesso dos administradores. |
| **Comportamento em banco com dados** | **Aborta com erro** (`Bootstrap somente em banco sem usuários; não é recuperação.`). | Não implementado na Fase 1; requer especificação formal futura. |
| **Entrada de Credenciais** | Terminal interativo (TTY) com entrada oculta de senhas, sem expor valores. | A definir (processo administrativo auditável, sem backdoors). |
| **Garantia de Segurança** | Impede que o comando seja usado como vetor de reset ou criação de contas em banco operacional. | Evita a introdução de endpoints provisórios inseguros de reset. |

---

## 4. Matriz de Achados e Observações Técnicas

| ID | Descrição | Gravidade | Reprodutibilidade | Contexto e Recomendação |
|---|---|---|---|---|
| **OBS-01** | `request.ip` em ambiente com Proxy Reverso | Baixa / Informativa | Determinística com proxy | Em desenvolvimento local Fastify lê IP do socket loopback. Na Fase 10 (produção/Caddy), será necessário ativar `trustProxy: true` no Fastify para que o rate limiter do Better Auth utilize o IP real do cliente. |
| **OBS-02** | Flag `Secure` desativado em ambiente HTTP | Baixa / Informativa | Determinística em HTTP | `useSecureCookies` avalia `config.API_ORIGIN.startsWith('https:')`. Correto para testes locais em HTTP loopback; será ativo por design quando HTTPS for configurado em produção. |
| **OBS-03** | Recuperação Administrativa pendente | Informativa | Por design de projeto | Conforme ADR 0007, a ausência de mecanismo de recuperação não é um defeito de código, mas uma decisão de não criar soluções provisórias inseguras. Procedimento seguro deve ser desenhado para fases posteriores. |

---

## 5. Critérios Técnicos Demonstrados (Evidências Dinâmicas)

A robustez da fundação foi comprovada pelas suítes automatizadas e verificações já executadas no repositório:

1. **Testes Unitários:** 28/28 aprovados (`tests/config.test.ts` e `tests/rbac.test.ts`), validando sanitização de configurações e regras de autorização RBAC.
2. **Testes de Integração com PostgreSQL Real:** 17/17 aprovados (`tests/auth.integration.test.ts` em `orium_test`), validando idempotência de migrations, papéis SQL, login/logout, expiração absoluta (7d) e inatividade (12h), desativação e demotion com revogação imediata.
3. **Validação no Navegador:** 6/6 cenários aprovados em Chromium headless (`docs/PHASE1-BROWSER-REPORT.md`), confirmando persistência de sessão, isolamento de cookie `HttpOnly` no DOM (`document.cookie` inacessível) e logout efetivo ponta a ponta.
4. **Qualidade de Código e Build:** `typecheck`, `lint` e `build` verdes em todo o workspace monorepo.

---

## 6. Conclusão

A fundação atual da Fase 1 atende com excelência a todos os critérios de arquitetura, segurança e isolamento estabelecidos na Fase 0 e nos ADRs 0001 a 0007. Nenhum problema crítico de segurança foi encontrado.
