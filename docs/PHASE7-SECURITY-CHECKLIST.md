# Checklist de Segurança e Riscos — Fase 7 (Notificações)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-13  
**Escopo:** Levantamento READONLY refinado de riscos, isolamento, reatribuição, revogação de identidade, payloads, deduplicação e critérios de testes para a Fase 7.

---

## 1. Autenticação, Sessão e Revalidação de Identidade
- **Distinção Crítica:** A autenticação de sessão válida (via `better-auth`) difere da revalidação de usuário ativo e permissões/roles (`auth_user.active = true` e checagem de papéis). O uso de `IDENTITY_LOCK` assegura serialização transacional, mas não substitui a revalidação estrita do usuário ativo e permissões no mesmo snapshot/conexão (`PoolClient`), inclusive cobrindo revogações ocorridas enquanto uma consulta aguarda o lock (padrão verificado em `materials.ts` e `demands.ts`).

## 2. Isolamento, Reatribuição e Respeito a Papéis
- **Visibilidade Omitida vs. Erro:** A listagem de notificações ou eventos deve omitir registros inacessíveis por falta de permissão ou reatribuição, enquanto detalhes individuais podem retornar `404` para não revelar a existência de recursos restritos (alinhado ao comportamento de `demands.ts` e `materials.ts`, evitando exigência de `403` universal desnecessária).
- **Antigos Responsáveis:** Antigos responsáveis perdem acesso imediato a títulos, payloads e contagens de notificações após reatribuição de tarefas ou alteração de escopo.

## 3. Deduplicação e Alertas Temporais Precisos
- **Chave de Deduplicação:** A deduplicação deve ser baseada na identidade estável do evento combinada com o destinatário, evitando colapsar comentários distintos ou salvamentos legítimos realizados num curto intervalo de tempo. Alertas temporais (ex: prazos próximos) exigem chave composta por objeto/tipo/data-alvo para distinguir mudanças reais de prazo.

## 4. Integridade Atômica, Rollback e Payloads Seguros
- **Transacionalidade:** Operações de geração de eventos e notificações devem ocorrer na mesma transação com garantia de rollback conjunto. Operações falhadas não devem gerar notificações de sucesso ou conclusão.
- **Payloads Seguros:** Proibição absoluta de incluir senhas, tokens ou referências do cofre (Bitwarden) em payloads de notificação.

## 5. Critérios de Testes de Segurança (Propostas)
- Testes contra `orium_test` (sem mocks/skips) cobrindo:
  1. Revogação de identidade ou desativação de usuário ocorrendo enquanto a transação de notificação aguarda o `IDENTITY_LOCK`.
  2. Isolamento de listagens e marcação de leitura (antigos responsáveis sem acesso a dados pós-reatribuição).
  3. Deduplicação com preservação de comentários distintos e salvamentos válidos.
  4. Garantia de rollback transacional completo em caso de falhas parciais.
