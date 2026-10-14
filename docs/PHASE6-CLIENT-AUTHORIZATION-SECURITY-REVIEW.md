# Relatório de Revisão de Segurança: Contrato e Código de Clientes (Incremento 3)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-13  
**Escopo:** Revisão READONLY do contrato `docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md` e do código atual (`clients.ts`, `app.ts`, `identity.ts`).

---

## 1. Sumário Executivo
Esta revisão examinou a assimetria estática e comportamental de autorização nas mutações de clientes (`createClient`, `updateClient`, `archiveClient`, `restoreClient`) em comparação aos módulos maduros (`materials.ts` e `demands.ts`). O objetivo foi identificar lacunas concretas de segurança e critérios de aceite para o Incremento 3, sem declarar hipóteses concorrentes como vulnerabilidades comprovadas.

## 2. Achados e Análise Comparativa
1. **Assimetria Estática Existente:**
   - As mutações de clientes executam sobre `database.pool` sem abrir transações explícitas (`BEGIN`), sem adquirir o advisory lock transacional compartilhado (`IDENTITY_LOCK = 712041`) e sem revalidar o ator/permissão no banco durante a mutação.
   - Dependem estritamente da guarda inicial na rota (`requirePermission` e `authenticate` via snapshot da sessão), enquanto `materials.ts` e `demands.ts` adotam transações serializadas com `pg_advisory_xact_lock` e revalidação intra-transação (`revalidateActor` / `revalidateActorInsideTransaction`).

2. **Mitigação de Revogação Pré-Requisição:**
   - O fluxo existente com `authenticate` garante que requisições iniciadas **após** a revogação ou desativação falham imediatamente com `401` ou `403`.

3. **Janela Intra-Requisição (Hipótese vs. Fato):**
   - A ausência de revalidação intra-transação nas rotas de clientes cria uma janela teórica caso um administrador revogue permissões/sessão exatamente entre o término de `authenticate` e a execução do comando no banco. Esta sequência permanece como **hipótese** enquanto não instrumentada por testes determinísticos com barreiras de concorrência (`pg_locks`).

## 3. Critérios de Aceite para o Incremento 3
- Alinhar as quatro mutações de clientes (`create`, `update`, `archive`, `restore`) ao padrão transacional de `materials.ts` e `demands.ts`:
  1. Abrir transação (`BEGIN`).
  2. Adquirir `pg_advisory_xact_lock(IDENTITY_LOCK)`.
  3. Revalidar o ator e suas permissões ativas no mesmo cliente PostgreSQL.
  4. Executar a mutação e confirmar (`COMMIT`) ou reverter (`ROLLBACK`) em caso de falha.
- Preservar os códigos de erro atuais (`CLIENT_NOT_FOUND`, `CLIENT_VERSION_CONFLICT`, 401, 403).
- Respeitar a ressalva de coordenação: mutações concluídas antes de uma revogação em paralelo são legítimas (sem exigência de erro universal).

## 4. Limitações e Restrições
- Executado em modo estritamente READONLY, sem edições de código, sem execuções de testes ou comandos na aplicação, preservando totalmente o ambiente de desenvolvimento e os dados existentes.
