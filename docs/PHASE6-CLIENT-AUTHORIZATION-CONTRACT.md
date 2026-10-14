# Fase 6 — incremento 3: autorização transacional de clientes

Contrato Codex, 08/10/2026. Base: `docs/PHASE6-CLIENT-AUTHORIZATION-REVIEW.md`. Objetivo: alinhar create/update/archive/restore de clientes ao padrão já usado por Materiais e Demandas, revalidando o ator dentro da transação sob `IDENTITY_LOCK`.

## Ownership

OpenCode: `apps/api/src/clients.ts`, `apps/api/src/app.ts`, novo `tests/clients-authorization.integration.test.ts`, `docs/PHASE6-CLIENT-AUTHORIZATION-RESULT.md` e sua seção da nota. Não alterar migration/schema/contracts/frontend/DEV. Pode ajustar chamadas e tipos necessários nos arquivos próprios. Codex revisa. Sem agentes concorrentes nos mesmos arquivos.

### Transferência de ownership — 13/10/2026

Codex #2 assume a coordenação por autorização do responsável. Após timeouts/ECONNRESET e seis tentativas recusadas por capacidade do provedor do OpenCode, foram encerradas somente as tentativas de inferência sem ferramenta/suíte em execução; o TUI ficou ocioso, e os arquivos salvos foram preservados. **Antigravity passa a ser o único dono da implementação, correções e execução dos testes deste incremento**, nos mesmos quatro arquivos acima e na própria seção Antigravity da nota. OpenCode permanece em standby e não retomará edições/builds/testes sem nova transferência explícita. Não aplicar migration/schema/frontend/config/DEV neste contrato. Codex #2 revisa o resultado antes do gate; a revisão independente será feita pela coordenação/Sentinela, não pelo implementador. A atribuição original ao OpenCode permanece acima como histórico.

As permissões foram ampliadas por instrução do responsável em 13/10; provas em `PHASE6-AGENT-PERMISSIONS.md`. OpenCode foi colocado em `auto accept` na própria sessão, sem reinício; falha de capacidade do provedor é independente dessas permissões.

### Complemento de verificação de tipos — 13/10/2026

Após os 9 testes do incremento passarem, a coordenação confirmou sete erros de tipos anteriores no projeto raiz. Antigravity também recebe ownership exclusivo para correções mínimas em `tests/identity-audit.integration.test.ts` e `tests/materials.integration.test.ts`, e relatório `docs/PHASE6-TYPECHECK-REMEDIATION.md`. Corrigir somente import/inferência de tipos, narrowing da união de eventos, dados completos de fixtures e guardas de linhas existentes; preservar as expectativas de autorização/concorrência. Não alterar produção, dependências, configuração TypeScript, schema ou migrations para esconder erros. Exigir typecheck raiz e lint dos arquivos alterados, e verificações focais das asserções de segurança afetadas. Não repetir a suíte nova verde se ela permanecer inalterada.

Leia `PROJECT_CONTEXT.md`, `ROADMAP.md`, `docs/AGENT-AUTONOMY.md`, a auditoria de clientes e a skill `C:/Users/arino/.agents/skills/supabase-postgres-best-practices/SKILL.md`. Registrar início/evidências/conclusão somente na seção própria da nota `oriumsystem-acompanhamento` via `note edit`. Sem segredos.

## Implementação

As quatro mutações devem abrir transação curta, adquirir `pg_advisory_xact_lock(IDENTITY_LOCK)`, revalidar no mesmo `PoolClient` que o usuário está ativo e ainda possui a permissão exigida, executar a escrita e commitá-la. Falha de autorização ou escrita faz rollback. Leituras e a lógica otimista de `version` permanecem iguais. Não fazer chamadas externas dentro da transação.

As rotas devem passar o identificador do ator autenticado ao serviço; a autorização na rota continua como guarda inicial, mas não substitui a revalidação. Preserve códigos atuais (`CLIENT_NOT_FOUND`, `CLIENT_VERSION_CONFLICT`, erros de input) e respostas. Não registrar auditoria nova neste incremento: clientes não devem gerar `identity_event`.

## Testes reais PostgreSQL

Criar testes contra `orium_test`, sem mocks/skips, serialmente e com cleanup apenas das próprias fixtures. Cobrir:

1. Admin válido cria/edita/armazena/restaura.
2. Colaborador e admin sem a permissão específica recebem 403; sessão inativa/revogada recebe 401 antes da mutação.
3. Revalidação intra-transação: segurar `IDENTITY_LOCK` em conexão independente, iniciar mutação com snapshot administrativo, concluir revogação antes da escrita e provar 401/403, sem evento/alteração parcial.
4. Ordem inversa: escrita adquire lock e conclui antes da revogação; a escrita permanece legítima e a revogação posterior também conclui.
5. Version conflict continua 409 e não altera dados.

Use barreiras observando `pg_locks` filtrado pelo OID de `current_database()`; não use sleeps como prova nem exija erro universal para mutação commitada antes da revogação. Rode typecheck/lint focal e a nova suíte; não rode o pacote inteiro sem mudança ou falha que justifique. Não aplicar migration, rebuild ou restart DEV neste incremento.
