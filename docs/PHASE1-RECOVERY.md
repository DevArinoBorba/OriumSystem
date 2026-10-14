# Fase 1 — Procedimento Administrativo de Recuperação de Acesso

Status: **Implementado e Homologado na Fundação (Fase 1)**.  
Conformidade: [ADR-0007](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0007-politicas-fundacao.md).  
Arquivo do módulo: [`apps/api/src/recovery.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/recovery.ts).  
Interface de linha de comando: [`apps/api/src/cli.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/cli.ts) (`pnpm db:recover`).  

---

## 1. Visão Geral e Princípios de Arquitetura

O procedimento de recuperação de acesso fecha a fundação de segurança da Fase 1, atendendo integralmente ao deliberado no [ADR-0007](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0007-politicas-fundacao.md):
- **Sem endpoints públicos**: Não existe rota HTTP de "esqueci minha senha" ou solicitação desatendida via API.
- **Sem SMTP provisório nem bypass inseguro**: O envio automático por e-mail e MFA continuam fora do escopo da fundação, evitando a criação de links transitórios ou tokens sem proteção contra enumeração e exfiltração.
- **Execução estritamente local e interativa**: O procedimento opera unicamente via CLI local (`pnpm db:recover`) em terminal interativo com TTY (`process.stdin.isTTY`), impedindo automações cegas ou execuções via pipelines sem operador presente.
- **Proteção contra vazamento de credenciais**: E-mails e senhas **nunca** são aceitos por argumentos de linha de comando (`process.argv`) ou variáveis de ambiente (`process.env`). Todas as entradas são coletadas de forma interativa e com máscara/ocultação de senha.

---

## 2. Requisitos de Ambiente e Banco de Dados

Antes de iniciar qualquer interação com o operador, o comando `pnpm db:recover` executa verificações de integridade:
1. **Terminal TTY interativo**: Garante que o processo possui entrada de teclado direta (`process.stdin.isTTY = true`).
2. **Validação da URL de conexão**: Exige protocolo PostgreSQL (`postgresql:` ou `postgres:`) e hostname estritamente restrito a loopback local (`127.0.0.1`, `localhost` ou `[::1]`).
3. **Privilégio mínimo via `assertApplicationDatabase`**: Executado **antes de qualquer prompt interativo**. O comando confirma que o usuário conectado é `orium_app`, rejeitando terminantemente credenciais com privilégios de superusuário, bypass de RLS, criação de bancos/tabelas ou papéis administrativos de banco de dados.
4. **Sem novas permissões ou migrações**: O fluxo utiliza estritamente o esquema existente (`auth_user`, `auth_account`, `auth_session`, `user_role`, `role_permission`), sem necessidade de novas tabelas ou migrações SQL.

---

## 3. Autorização e Reautenticação do Administrador

Para recuperar a credencial de qualquer conta (inclusive a própria), a operação deve ser autorizada por um administrador ativo:
1. **Identificação do Ator**: Solicita o e-mail do administrador autorizador.
2. **Reautenticação obrigatória (Reauth)**: Solicita a senha atual do administrador com digitação oculta.
3. **Validação sob Lock Transacional**:
   - Confirmação de que o administrador existe e está ativo (`auth_user.active = true`).
   - Confirmação de que possui o papel `administrator` associado em `user_role`.
   - Confirmação de concessão da permissão `roles.manage` em `role_permission`.
   - Verificação criptográfica da senha atual contra o hash armazenado na tabela `auth_account` utilizando `verifyPassword({ hash, password })` da biblioteca oficial `better-auth/crypto`.
   - Se a reautenticação falhar ou o usuário não possuir os privilégios exigidos, a operação aborta imediatamente sem alterar nenhum dado.

---

## 4. Validação da Conta Alvo e Atualização de Credencial

1. **Conta Alvo**:
   - Informada via e-mail interativo.
   - Deve existir e estar ativa (`auth_user.active = true`).
   - **Proibições estritas de escopo**:
     - Não reativa contas desativadas (`active = false`).
     - Não cria novos usuários (usuários novos devem ser criados via rota administrativa autenticada ou bootstrap).
     - Não altera papéis (`user_role`) ou permissões.
2. **Validação da Credencial**:
   - A conta deve possuir exatamente uma credencial local associada (`provider_id = 'credential'`).
   - Qualquer ambiguidade (zero credenciais locais ou múltiplas credenciais) causa erro imediato e rejeição.
3. **Nova Senha**:
   - Comprimento validado estritamente entre 1 e 128 caracteres.
   - Solicitada em dobro (com confirmação) em modo oculto no terminal.
   - Tratamento de sequências ANSI no helper `hiddenPassword` para evitar que teclas de navegação (setas, Home, End) injetem caracteres na senha digitada.
   - Criptografada utilizando `hashPassword(password)` oficial da `better-auth/crypto`.

---

## 5. Concorrência, Atomicidade e Revogação de Sessões

1. **Serialização Global de Identidade**:
   - A operação adquire o lock consultivo transacional `pg_advisory_xact_lock(712041)` (`IDENTITY_LOCK`), serializando-se com provisionamentos, alterações de papel e desativações de conta.
   - Fila em memória `serializeIdentity` para prevenir esgotamento do pool de conexões.
2. **Row Locking (`FOR UPDATE`)**:
   - As linhas do administrador e da conta alvo são bloqueadas com `FOR UPDATE` para garantir consistência de leitura e escrita.
3. **Revogação Atômica de Sessões**:
   - Todas as linhas ativas da conta alvo em `auth_session` são excluídas na mesma transação (`DELETE FROM auth_session WHERE user_id = $1`).
   - Caso o administrador esteja recuperando a própria senha, suas sessões atuais são igualmente revogadas, exigindo novo login imediato com a nova credencial.
4. **Rollback em Caso de Falha**:
   - Qualquer erro na validação, senha divergente, credencial ausente ou falha de banco aciona `ROLLBACK` completo da transação.

---

## 6. Recibo Pós-Commit e Segurança de Logs

Após o `COMMIT` bem-sucedido, o CLI emite um recibo JSON estruturado em `stdout` contendo exclusivamente metadados operacionais:
```json
{
  "action": "password_recovery",
  "actorId": "c983d3b7-7bb6-46c0-a7d1-...",
  "targetId": "f128e461-12c8-47a2-92ba-...",
  "at": "2026-10-05T17:30:00.000Z",
  "revokedCount": 2
}
```
- **Campos do recibo**:
  - `action`: `'password_recovery'`
  - `actorId`: ID do administrador autorizador.
  - `targetId`: ID da conta cuja senha foi atualizada.
  - `at`: Timestamp ISO 8601 da conclusão.
  - `revokedCount`: Quantidade de sessões ativas da conta alvo revogadas atomicamente.
- **Tratamento de Segredos**:
  - Nenhuma senha (nem do autorizador, nem a nova senha), hash ou token é impresso no terminal, armazenado em variáveis de log ou persistido em disco.
  - O recibo em stdout não alega auditoria persistente institucional (o registro institucional em banco de auditoria pertence às fases corporativas futuras).

---

## 7. Instruções Operacionais e Contas Reais

As contas reais designadas para administração da fundação são:
- `arinoborba@gmail.com`
- `moniquiborges_5@gmail.com`

> [!IMPORTANT]
> Nenhuma conta real é criada com senhas pré-definidas em código ou repositório. O responsável pelo sistema deve provisioná-las via `pnpm db:bootstrap` (em banco limpo) ou recuperar o acesso conforme este procedimento.

### Execução do Procedimento de Recuperação

No terminal com o banco de dados em execução (`pnpm db:up`):
```bash
pnpm db:recover
```

O CLI solicitará:
1. `E-mail do administrador autorizador:`
2. `Senha atual do administrador autorizador (entrada oculta):`
3. `E-mail da conta a ser recuperada:`
4. `Nova senha da conta (entrada oculta):`
5. `Confirme a nova senha (entrada oculta):`

---

## 8. Limites do Sistema

1. **Perda total de credenciais de todos os administradores**:
   - A recuperação em caso de perda de credenciais de todos os administradores **NÃO É SUPORTADA** por este procedimento.
   - O procedimento exige estritamente a reautenticação em tempo real de um administrador ativo portador do papel `administrator` e da permissão `roles.manage`.
   - O sistema não possui backdoors, rotinas assistidas ou atalhos de bypass que violem a política de autenticação e RBAC da fundação.
   - A preservação e guarda segura de ao menos uma credencial administrativa ativa é premissa operacional mandante.
2. **Escopo de Fase 1**:
   - Não implementa envio de links de redefinição por e-mail (SMTP).
   - Não implementa autenticação multifator (MFA).
   - Não altera status de ativação ou permissões do usuário recuperado.
