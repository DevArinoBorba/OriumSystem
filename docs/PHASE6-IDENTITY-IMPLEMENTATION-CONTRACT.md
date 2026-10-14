# Fase 6 — incremento 2: auditoria de identidade

Contrato Codex, 08/10/2026. Autorização de continuidade vigente. Decisões do responsável: administradores consultam toda a trilha; usuário ativo consulta apenas seus próprios eventos; retenção **12 meses**. Não implementar MFA, cofre, frontend ou auditoria de login neste incremento.

## Ownership e execução

### Transferência por indisponibilidade — 08/10/2026

Antigravity e Antigravity QA atingiram quota do provedor durante a tarefa e pararam sem checkpoint final; nenhum aceite ou migration DEV concedido. Codex verificou ambos ociosos com mensagem de quota. **OpenCode assume exclusivamente os arquivos de implementação e QA abaixo até nova transferência explícita**, preservando os parciais. Antigravity continua apenas dono do processo API DEV já homologado, sem novas edições/builds enquanto houver esse ownership. Relatórios mantêm os autores e distinguem trabalho herdado de verificações efetivamente executadas. A revisão final continua com Codex.

- Antigravity: `apps/api/src/{identity.ts,recovery.ts,schema.ts,migrate.ts,app.ts}`, novo `apps/api/src/identity-audit.ts`, `packages/contracts/src/index.ts`, `db/migrations/0004_identity_audit.sql`, `db/migrations/meta/_journal.json`, `docs/PHASE6-IDENTITY-RESULT.md`. Helpers novos `.local/phase6-identity-*` permitidos; não alterar arquivos de QA. É dono único do build contracts/API. Sem migration DEV ou restart DEV antes de gate Codex.
- Antigravity QA: novo `tests/identity-audit.integration.test.ts`, ajustes **somente de cleanup de fixtures** nos testes de integração existentes, `docs/PHASE6-IDENTITY-QA-RESULT.md`. Sem código/backend/frontend/migration. Preparar testes; executar contra `orium_test` real somente após checkpoint estável do implementador. Coordenação direta para incompatibilidades. Sem duas suítes/builds concorrentes.
- Codex: revisão de arquitetura, segurança, contratos/roadmap e aceite final.

Aplicar `docs/AGENT-AUTONOMY.md`. Cada dono registra início/evidências/conclusão SOMENTE na própria seção da nota `oriumsystem-acompanhamento`, via note edit delimitado pelo próximo heading. Comunicação em background com helper, confirmar recibo no checkpoint; resumo até dez linhas. Ler skill Postgres antes de SQL/schema/testes de banco. PORT_POLICY/Find-FreePort para cada serviço local; reutilizar só serviço comprovadamente do projeto. Preservar segredos/config/dados; sem imprimir .env, URLs de banco, hashes ou sessões. Corrigir problemas mecânicos autonomamente.

## Modelo mínimo e privacidade

Tabela `identity_event`: UUID id; `created_at timestamptz DEFAULT now()`; `actor_id text NULL` (NULL significa provisioning técnico/bootstrap já autorizado, nunca ator arbitrário vindo de request); `action text` restrita a `user_created|user_role_changed|user_deactivated|role_permissions_changed|password_recovered`; `target_user_id text NULL`; `target_role_id text NULL` restrito aos papéis existentes; `previous_role text NULL`; `new_role text NULL`; `previous_active boolean NULL`; `new_active boolean NULL`; `previous_permissions text[] NULL`; `new_permissions text[] NULL`; `revoked_count integer NOT NULL DEFAULT 0 CHECK >=0`.

Sem nome/e-mail, senha/hash, cookie/token, IP/user-agent, texto livre, motivo, metadata JSONB ou corpo de request. Payloads de evento derivados exclusivamente dos dados confiáveis da transação. Constraints para ações/combinações de alvo coerentes; schemas Zod discriminados/estritos para projeção pública e entrada de query. Listas de permissões restritas ao permissionSchema atual, ordenadas e sem duplicatas. Sem campos de credenciais no schema de evento.

Tabela `identity_event_subject`: `(event_id uuid REFERENCES identity_event ON DELETE CASCADE, user_id text)` PK composta. Registra usuários **afetados na transação**: alvo nas ações individuais; todos os membros do papel capturados dentro de `IDENTITY_LOCK` na mudança de permissões. Sem FK a auth_user nos IDs históricos: remoção de uma conta não apaga evidência nem bloqueia cleanup, e registros históricos expiram pela retenção. Não vincular leitura a membros atuais: promoção/reatribuição posterior não concede histórico anterior de outras pessoas. Índices para `(created_at DESC,id DESC)` e subjects `(user_id,event_id)`.

## Gravação transacional

Instrumentar `provisionUser`, `changeIdentity`, `changeRolePermissions`, `recoverUserAccess` dentro das transações existentes sob IDENTITY_LOCK, antes do commit. Preservar assinatura, retorno, TTY/CLI recovery e todas as guardas. Falha em persistir evento ou subjects aborta a ação inteira (incluindo credencial/sessões/papel). Ações negadas não geram evento de sucesso. `password_recovered` só registra ator/alvo e contagem revogada; nenhum dado de senha. Não converter login ou recibo stdout em prova de auditoria. Não alterar auth.ts/sign-in para auditá-los neste incremento.

Provisioning sem actorId já é primitiva confiável de bootstrap/teste, não endpoint público: registrar ator NULL. Bootstrap histórico já realizado não recebe eventos retroativos; CLI bootstrap direto fica fora deste incremento, documentar limite. Mudança de papel/permissão semanticamente idêntica, quando a operação atual revoga sessões, continua sendo uma ação e deve registrar estado anterior/novo e contagem real.

Sem novo audit.write para o cliente; não criar endpoint de gravação/edição/exclusão. DB app recebe somente SELECT/INSERT nas duas tabelas e execução da rotina de retenção; sem UPDATE/DELETE/TRUNCATE. Migrador mantém privilégios de manutenção. Não adicionar tabelas à concessão CRUD genérica existente.

## Leitura e autorização

Novo GET `/api/v1/identity-events`. Query estrita: `limit` default20 max100; `cursor` opcional codificado/validado contendo `(createdAt,id)`; `action` opcional enum; `targetUserId` opcional UUID. Resposta `{events,nextCursor}` com schemas exportados `identityEventSchema`, `identityEventsQuerySchema`, `identityEventsResponseSchema` e tipos inferidos. Exportar serviço `listIdentityEvents(database, identity, query)`.

Semântica técnica do filtro: `targetUserId` filtra o alvo individual (`identity_event.target_user_id`). Eventos de política de papel têm alvo de papel e ficam fora desse filtro; a consulta própria sem filtro continua incluindo esses eventos via subjects históricos. Documentar/testar essa distinção. Cursor deve rejeitar datas de calendário impossíveis antes de qualquer cast PostgreSQL, sem normalização silenciosa de Date.parse.

Exigir `protected.read`, usuário ativo e revalidação **dentro de uma transação sob IDENTITY_LOCK** da identidade/papel/permissão atual. Administrador ativo vê todos os eventos não expirados. Colaborador vê apenas eventos cujo subject inclui seu próprio userId; targetUserId alheio →403, sem revelar existência. Sem subjects/IDs de outros afetados na projeção pública. Sem joins que exibam nomes/e-mails de colegas. Um administrador demovido em concorrência com a leitura deve seguir a ordem serial efetiva do lock; não exigir erro em leitura legitimamente anterior à revogação.

Paginação keyset `(created_at,id)` DESC com `limit+1`; cursor não amplia escopo. Empate de timestamps estável; filtros aplicados junto com autorização na consulta SQL. Cursor inválido →400 sanitizado; query desconhecida →400. Não adicionar permissão global de leitura de outros usuários a colaboradores nem mudar concessões atuais.

## Retenção 12 meses

Visibilidade: filtrar sempre `created_at >= statement_timestamp() - interval '12 months'` (meses de calendário, sem transformar em 365 dias). Limpeza física: função SQL sem argumentos `public.prune_identity_events()` SECURITY DEFINER com search_path restrito, referências totalmente qualificadas e DELETE **somente** `created_at < statement_timestamp() - interval '12 months'`; subjects removidos por cascade. REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE ao papel de aplicação explicitamente. Retornar apenas contagem. Nenhuma entrada do usuário, SECURITY DEFINER genérica ou bypass parametrizável.

Chamar a rotina na gravação de evento e antes da leitura autorizada; permissões da função não permitem à aplicação apagar evento recente. Aplicação continua sem UPDATE/DELETE nas tabelas. Limpeza é oportunista: sem atividade, registros expirados podem permanecer fisicamente até o próximo acesso; ficam invisíveis após corte. Agendamento contínuo e expiração de backups pertencem à Fase10, limite registrado honestamente. Nenhuma remoção de dados fora dessas tabelas. Testes de retenção podem usar migrador apenas no banco TEST para criar timestamps antigos e limpar fixtures.

## Critérios de aceite / QA real

1. Migração aditiva repetida sem perder contas/dados; grants reais app SELECT/INSERT e função, UPDATE/DELETE/TRUNCATE negados; função não exclui eventos recentes.
2. Cada ação aprovada produz exatamente evento + subjects corretos, antes/depois e contagem real; negação não registra sucesso. Recuperação usa reautenticação real e nenhuma senha/hash no evento/API.
3. Induzir falha de INSERT audit dentro transação (privilégio temporariamente revogado e restaurado no finally TEST, ou estratégia equivalente) prova rollback integral de mutação/roles/sessões/credencial; não usar mocks nem hooks de produção.
4. Admin vê todos; colaborador só próprios; filtro alheio403; anônimo401/inativo401; sujeito histórico de policy não aparece para membro novo; nenhuma divulgação de outros sujeitos na resposta.
5. Paginação estável, filtros e cursor inválido; empate timestamps; sem duplicação e sem ampliação de escopo.
6. Retenção: boundary de calendário, exclusão somente expirados e cascade, registros recentes intactos e permissão app incapaz de atualizar data/forçar exclusão recente.
7. Concorrência PostgreSQL controlada por locks/barreiras: revogação que conclui antes da revalidação impede acesso/gravação; caso inverso legitimamente concluído preserva evento. Sem sleeps como prova e sem asserção de erro universal no commit.
8. Cleanup só fixtures da própria execução, incluindo eventos/subjects via migrador e IDs registrados; nenhuma limpeza global, DEV intocado. Relatar contagens concretas e sem skips.

Verificações: QA suíte nova + regressões auth/recovery/rbac após checkpoint, serialmente. Implementador typecheck contracts/API, lint focal e build único. Falhas de regressão por novos eventos requerem cleanup específico das fixtures, nunca relaxar assertions. Sem frontend/E2E browser pois este incremento não contém UI; não alegar UI homologada. Aceite Codex após revisão do diff/código/evidência; DEV só em gate posterior com backup e PORT_POLICY.
