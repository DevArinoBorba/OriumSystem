# Fase 7 — Incremento 1: segurança dos produtores de eventos

Coordenação: Codex #2. Implementação: Antigravity. Autorização vigente: início da Fase 7 pelo responsável em 13/10/2026.

## Problema e comportamento esperado

As 16 funções mutadoras de demands.ts gravam demand_event em transações, mas não serializam com as alterações de identidade. createTaskComment escolhe autorização a partir de identity.roles recebido antes da transação. Antes de conectar esses produtores à central de notificações, garantir que mudança de identidade precedendo a operação seja observada pelo produtor.

Cada mutação deve executar BEGIN, adquirir pg_advisory_xact_lock(IDENTITY_LOCK) e revalidar usuário ativo, papel real e permissão específica no mesmo PoolClient antes de locks de domínio e decisões 404/409. Depois, preservar a ordem de locks demand → task → requisitos/dependências existente. Não adquirir o advisory lock depois de bloquear uma linha. Transações curtas, sem chamadas externas.

createTaskComment deve determinar papel atual dentro da transação: administrador exige tasks.manage; colaborador exige tasks.execute e atribuição atual da tarefa. Não escolher permissão ou dispensar atribuição usando identity.roles obsoleto. Manter as operações administrativas exclusivas do papel administrator, inclusive quando grants forem alterados.

Isso é revalidação de identidade e autorização do serviço; não declarar validação transacional de sessão, pois SessionResponse não transporta identificador de sessão. Autenticação HTTP existente continua obrigatória. O futuro contrato da central definirá validação de sessão na consulta/leitura de notificações separadamente.

## Ownership exclusivo

Antigravity pode alterar apps/api/src/demands.ts, criar tests/demands-authorization.integration.test.ts e docs/PHASE7-INCREMENT1-RESULT.md; helpers sanitizados exclusivos em .local/phase7/increment1/. Demais arquivos READONLY. Sem migrations, novos grants, notificações, frontend, app.ts, identidade ou contratos neste incremento. Não modificar fixtures/testes de outro dono. Codex revisa entrega antes de ativação DEV.

## Verificação real

- Testes PostgreSQL reais de desativação e revogação de permissão que confirmam antes da mutação sair da espera no IDENTITY_LOCK, com barreira pg_locks filtrada pelo OID de current_database(), sem sleeps como prova de fila. Validar 401/403 e ausência de alteração de domínio/histórico.
- Teste de papel administrativo obsoleto em createTaskComment: após alteração para colaborador, grant administrativo não dispensa atribuição atual; comentário em tarefa alheia não é gravado. Testar também mudança de colaborador para administrador sem usar snapshot antigo para escolher a permissão.
- Concorrência com reassignTask e comentário: após reatribuição confirmada, antigo responsável não escreve; verificar snapshot e ausência de evento novo. Promessas iniciadas devem ser drenadas em finally após liberar o holder.
- Verificar representação de todas as 16 mutações no código, lint focal, typecheck API/raiz e regressão pertinente de demandas/tarefas. Reportar contagens reais e seleção de testes, sem apresentar skips focais como suite inteira aprovada.
- Cleanup apenas IDs criados e diferenças de grants efetivamente causadas pela suite, baseline antes/depois de grants e histórico de identity_event; nunca reset hardcoded, DELETE global ou remover dados reais.

Antes dos testes, ler PORT_POLICY e executar Find-FreePort.ps1; reutilizar orium_test somente após comprovar propriedade/configuração. Liberar apenas leases próprios. Não expor URLs de banco, senhas ou tokens. Não iniciar builds, migrar/reiniciar DEV ou serviços de outros projetos.

## Entrega

Aplicar AGENTS.md e docs/AGENT-AUTONOMY.md. Registrar início, evidências e conclusão exclusivamente em ## Antigravity na nota oficial. Enviar resumo sanitizado a Codex #2 com arquivos, comandos/exit codes, testes, baseline/cleanup e impedimentos, usando scripts/maestri-send.mjs e arquivo de mensagem; não esperar resposta para finalizar. Autonomia para corrigir problemas mecânicos dentro do ownership; não mudar assertions para mascarar falhas.
