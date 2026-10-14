# ADR-0007 — Identidade, sessões, RBAC inicial e ambiente local

Status: **Aceito pelo responsável**. Registro: 05/10/2026. Implementação: Fase 1, autorizada explicitamente.

## Decisões

Login por e-mail e senha. Sem cadastro público. Arino e Monique são administradores iniciais; demais usuários começam como Colaborador. Administradores podem criar/desativar contas, gerenciar papéis/permissões e iniciar procedimentos administrativos de recuperação de acesso.

Recuperação automática por SMTP e MFA serão implementadas posteriormente. Não criar reset provisório inseguro. Nesta fundação não haverá endpoint público de recuperação; procedimento seguro precisa de desenho específico antes de ser ativado.

Sessões persistidas, revogáveis, com validade absoluta de 7 dias e expiração por 12 horas de inatividade. Cookies HttpOnly, Secure com HTTPS, verificação de CSRF/Origin nas mutações, sem tokens em localStorage.

Papéis iniciais: Administrador e Colaborador. RBAC centralizado no backend, deny-by-default. Permissões mínimas da fundação representam acesso protegido e administração de identidades; não inventar regras dos módulos futuros.

Desenvolvimento: web local + API local + PostgreSQL isolado em Docker. Não configurar produção, VPS, Caddy ou staging. Zod faz parte da fundação aprovada.

## Consequências e limites

Arino/Monique devem ser provisionados com e-mails e senhas escolhidos pelo responsável, sem credenciais padrão ou segredos versionados. Bootstrap local é explícito, não cadastro público nem recuperação de senha. Fluxos administrativos precisam de autorização no backend.

A atividade recente é distinta da criação da sessão: atualizar inatividade não estende a validade absoluta. Desativação e logout devem revogar o acesso, inclusive com cookies antigos. MFA, SMTP, permissões de negócio e produção continuam pendentes em suas fases. A Fase 2 não foi autorizada.

## Complemento (05/10/2026) — Recuperação Administrativa Local Implementada

Status: **Implementado na Fase 1**.

### Decisões Adicionais

1. **Procedimento administrativo local de recuperação (`pnpm db:recover`)**:
   - Ativado exclusivamente via CLI local em terminal interativo (`process.stdin.isTTY`).
   - Sem endpoint HTTP público, sem tokens temporários expostos e sem dependência de serviço externo de e-mail (SMTP) ou MFA nesta fase.
   - Proibição absoluta de passagem de senhas ou e-mails por variáveis de ambiente ou argumentos de linha de comando.
2. **Reautenticação e autorização estrita**:
   - O administrador autorizador deve informar seu e-mail e sua senha atual com digitação oculta.
   - A operação exige revalidação transacional sob bloqueio (`FOR UPDATE`) confirmando usuário ativo (`active = true`), papel `administrator` e a concessão da permissão `roles.manage`.
   - A senha atual é validada criptograficamente via `verifyPassword` oficial do `better-auth/crypto`.
3. **Escopo estrito sobre a conta alvo**:
   - A conta alvo deve existir, estar ativa e possuir exatamente uma credencial local (`provider_id = 'credential'`). Qualquer ambiguidade é rejeitada.
   - O procedimento não reativa contas desativadas, não cria novos usuários e não altera papéis ou permissões.
   - A nova senha (1 a 128 caracteres) é solicitada com confirmação e criptografada via `hashPassword` oficial do `better-auth/crypto`.
4. **Serialização e atomicidade**:
   - Operação executada sob lock consultivo `IDENTITY_LOCK` (712041) e fila `serializeIdentity`, impedindo concorrência com logins em voo.
   - Todas as sessões ativas da conta alvo são revogadas atomicamente na mesma transação (`DELETE FROM auth_session WHERE user_id = $1`).
   - Emite recibo pós-commit em `stdout` com `action: 'password_recovery'`, sem armazenar ou exibir segredos.

### Consequências e limites

- A perda simultânea de credenciais de todos os administradores **NÃO É SUPORTADA** por este procedimento; o sistema não possui backdoors nem rotinas de bypass que violem a política de autenticação. A custódia de ao menos uma credencial ativa é requisito operacional fundamental.
- A autorização ampla de continuidade autônoma concedida pelo responsável em 05/10/2026 superou a proibição histórica de iniciar a Fase 2; contudo, por determinação do responsável, a prioridade absoluta imediata é o fechamento integral e seguro da Fase 1.

