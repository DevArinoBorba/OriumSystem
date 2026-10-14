# Relatório de Verificação e Correção de Regressão de Autenticação / Recuperação

- **Data:** 2026-10-14
- **Responsável:** Antigravity QA
- **Arquivo Alvo:** [`tests/recovery.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/recovery.integration.test.ts)
- **Status:** **CONCLUÍDO COM SUCESSO (16/16 TESTES PASSANDO, EXIT CODE 0, 0 RESÍDUOS, BASELINE PRESERVADO)**

---

## 1. Contexto e Causa-Raiz da Regressão

Com a consolidação da política oficial de senhas sob o **ADR-0007**, os esquemas de validação de autenticação (`loginSchema`, `createUserSchema`) e de recuperação administrativa (`recoveryInputSchema`) passaram a adotar a regra unificada de comprimento de **1 a 128 caracteres** (`z.string().min(1).max(128)`).

A suíte de testes de integração [`tests/recovery.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/recovery.integration.test.ts) continha um caso histórico:
```typescript
it('rejects invalid new password without partial changes', async () => {
  ...
  await expect(recover({
    adminEmail: admin.email, adminPassword: oldPassword,
    targetEmail: target.email, newPassword: 'tiny',
  })).rejects.toThrow();
  ...
});
```
Sob a regra legada (que exigia comprimento mínimo de 12 caracteres), o valor `'tiny'` (4 caracteres) era rejeitado pelo validador. Com a política oficial de 1 a 128 caracteres, `'tiny'` passou a ser uma senha **válida**, fazendo com que o teste falhasse ao esperar uma rejeição inexistente.

---

## 2. Correções e Robustecimentos Implementados

Em estrito alinhamento ao escopo de ownership exclusivo de [`tests/recovery.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/recovery.integration.test.ts):

### 2.1 Correção dos Limites Reais de Senha
1. **Fronteiras Inválidas Reais:**
   - String vazia `''` (comprimento 0, violando `min(1)`).
   - String de 129 caracteres `'a'.repeat(129)` (violando `max(128)`).
2. **Preservação Estrita das Asserções de Atomicidade:**
   - Comparação exata de hash no PostgreSQL (`passwordHashOf`) antes e depois da recusa.
   - Comparação exata de contagem de sessões ativas (`targetSessionCount`).
   - Sessão pré-existente permanece funcional.
   - Tentativas de login pós-recusa continuam aceitando apenas a senha antiga e rejeitando as senhas inválidas (`statusCode: 400` ou `401`).
3. **Prova Real com Senha Curta Válida (`recovers access using a valid short password with session revocation and successful login`):**
   - Comprova que senhas curtas válidas (comprimento dentro de 1..128, como `'tiny'`) são aceitas pela recuperação administrativa.
   - Prova que todas as sessões anteriores do alvo são revogadas (`revokedCount >= 1`, sessão prévia retorna HTTP 401).
   - Prova que a nova senha curta autentica com sucesso gerando uma nova sessão válida no Better Auth (`/api/v1/auth/sign-in/email` retorna HTTP 200).
   - **Higiene e Proteção de Segredos:** Zero senhas ou credenciais expostas em mensagens ou logs.

### 2.2 Isolamento Concorrente e Restauração Segura de Grants (`roles.manage`)
- O teste `denies administrator lacking roles.manage grant without changing anything` agora executa sob `IDENTITY_LOCK (712041)`.
- Utiliza `DELETE ... RETURNING` para registrar se o grant pré-existia no banco.
- Restauração condicional em bloco `finally` estritamente sob lock, prevenindo concorrência e garantindo que o conjunto de 23 grants permaneça idêntico.

### 2.3 Higiene de Fixtures e Preservação Estrita de Auditoria
- **Rastreamento de Fixtures:** Cada usuário criado no teste é registrado em `trackedUserIds` (e prefixo único `recovery-${uuid}-`).
- **Limpeza Rastreável:** `cleanTrackedFixtures` remove exclusivamente os registros em `identity_event_subject` e `identity_event` associados aos IDs rastreados, seguidos de sessões, contas, permissões e usuários, tudo sob `IDENTITY_LOCK` via pool do migrator.
- **Commit Atômico:** `trackedUserIds.clear()` é executado estritamente após o `COMMIT` bem-sucedido.
- **Preservação de Histórico:** O histórico pré-existente de auditoria (540 eventos pós-migração) não é tocado e permanece 100% preservado.
- **Asserções em `afterAll`:** `afterAll` valida ativamente a igualdade de hash SHA-256 e contagens dos grants e da auditoria, sem engolir erros.

---

## 3. Conformidade com Diretrizes Operacionais e PORT_POLICY

- **Ownership Exclusivo:** Apenas [`tests/recovery.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/recovery.integration.test.ts) e este relatório foram alterados. Código de produto, migrações, contratos e outros testes permaneceram intocados (READONLY).
- **Ambiente de Teste Isolado:** Execução estritamente direcionada a `TEST_DATABASE_URL` (`orium_test` na porta 5433).
- **Propriedade Docker Comprovada:**
  - Container: `orium-local-postgres-test-1`
  - Labels: `com.docker.compose.project = 'orium-local'`, `service = 'postgres-test'`
- **Sem Exposição de Variáveis:** Execução com `node --env-file=.env` sem impressão de configurações ou senhas.

---

## 4. Evidências de Execução

### 4.1 Linters e Verificação Estática de Tipos

```powershell
# ESLint
pnpm exec eslint tests/recovery.integration.test.ts
# Resultado: Exit 0 (zero avisos ou erros)

# TypeScript Compiler
pnpm exec tsc -p tsconfig.json --noEmit
# Resultado: Exit 0 (zero erros de tipos no monorepo)
```

### 4.2 Execução da Suíte Focal Vitest

```powershell
node --env-file=.env node_modules/vitest/vitest.mjs run tests/recovery.integration.test.ts
```

**Saída Verificável:**
```text
 RUN  v5.0.3 C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem

 ✓ tests/recovery.integration.test.ts (16 tests) 49243ms
   ✓ recoverUserAccess against real PostgreSQL (16)
     ✓ valid active administrator resets the target password atomically 5980ms
     ✓ revokes all target sessions but preserves the other account session 6188ms
     ✓ denies collaborator actor without changing hash or sessions 5499ms
     ✓ denies wrong administrator password without changing hash or sessions 3830ms
     ✓ denies inactive administrator without changing hash or sessions 3861ms
     ✓ denies administrator lacking roles.manage grant without changing anything 4303ms
     ✓ denies inactive target without changing anything 3448ms
     ✓ denies unknown target email without changing anything 2973ms
     ✓ rolls back the written hash when the session deletion fails mid-transaction 849ms
     ✓ rejects invalid new password without partial changes 660ms
     ✓ recovers access using a valid short password with session revocation and successful login 1091ms
     ✓ rejects unknown input fields without any effect 598ms
     ✓ serializes a concurrent reset against an in-flight old-password login 903ms
     ✓ serializes concurrent mutual demotions to exactly one surviving administrator 494ms
     ✓ rejects self-demotion of the sole remaining administrator after deactivating the other 478ms
     ✓ keeps a queue above the pool size alive without deadlock, with explicit results 5713ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  07:35:07
   Duration  61.05s (tests 81%, import 15%, transform 4%)
```

### 4.3 Auditoria de Limpeza de Fixtures e Preservação de Baseline

Consulta pós-execução contra `TEST_MIGRATION_DATABASE_URL`:
```json
{
  "residualRecoveryUsers": 0,
  "totalEvents": 540,
  "totalSubjects": 540,
  "totalGrants": 23
}
```

Fingerprints SHA-256 pós-migração e pós-execução:
```json
{
  "eventsCount": 540,
  "eventsFingerprint": "7db771da9b768b8979654239438c3e1bfdad132c9fb541674ef583f20f63642e",
  "subjectsCount": 540,
  "subjectsFingerprint": "574abfee0a5d287f423643d5792c3f3ed1f71cd4760b3033290e0dced40fdb4f",
  "grantsCount": 23,
  "grantsFingerprint": "9673b3ccf9d31ad30177ad4ba3ed1a7bbb62ef1cd2385d9827d3599c3c96195a"
}
```

Comprovações:
1. `residualRecoveryUsers = 0`: todas as fixtures criadas pela suíte foram 100% expurgadas sob `IDENTITY_LOCK`.
2. `totalEvents = 540` e `totalSubjects = 540`: integridade absoluta do baseline histórico pós-migração preservada.
3. `totalGrants = 23`: nenhuma alteração em grants após teste de revogação/restauração sob lock.
