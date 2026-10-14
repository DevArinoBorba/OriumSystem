# Fase 6 — revisão independente do incremento 3

Codex #2, 13/10/2026. Revisão da coordenação, independente do implementador Antigravity. Não equivale ao encerramento da Fase 6 ou à homologação do Bitwarden.

## Código e comportamento

Examinados `clients.ts`, as quatro rotas em `app.ts`, a suíte final e seu relatório. Cada mutação abre transação, adquire `IDENTITY_LOCK`, consulta usuário ativo/papéis/permissões no mesmo `PoolClient` e exige administrador com `clients.write` ou `clients.archive`. As rotas passam a identidade obtida da autenticação; o serviço utiliza seu identificador e reconsulta a autorização, sem confiar nos papéis do snapshot. A revalidação precede a escrita e os erros de existência/versão. Commit, rollback e liberação da conexão estão previstos; leituras e respostas públicas permanecem compatíveis. Não foi introduzida emissão de `identity_event` para clientes.

## Provas de TEST

O relatório `PHASE6-CLIENT-AUTHORIZATION-RESULT.md` registra execução real de 9/9 testes em `orium_test`, lint focal e typecheck API com exit 0. O código dos testes foi revisado para confirmar o significado dessas provas:

- CRUD administrativo com versões 1 a 4; anônimo 401, colaborador 403 e permissões específicas efetivamente removidas/reconcedidas pelo `role_id` correto.
- Barreiras em conexões independentes observam `pg_locks` no OID do banco atual antes de liberar o holder. Revogação ordenada antes das quatro escritas impede a mutação. Archive e restore têm barreiras próprias; restore usa cliente previamente arquivado.
- Na ordem inversa, uma escrita legitimamente concluída antes da revogação permanece válida. Não foi imposta rejeição universal para toda concorrência.
- Snapshots e versão preservados nas negativas; 409/404/400 continuam verificáveis. Promises iniciadas são drenadas após liberar o holder em `finally`.
- Clientes criados, inclusive em respostas inesperadas, são rastreados centralmente e também por prefixo exclusivo. A limpeza altera somente fixtures e diffs de grants desta suíte; não redefine permissões por defaults.

Examinado `.local/phase6-client-authorization-cleanup.json`: 10 clientes, 18 eventos e 12 usuários removidos; resíduos por IDs/prefixo iguais a zero; `rolesBefore=rolesAfter`; total de auditoria antes/depois preservado em 394. Esses números abrangem as fixtures deste incremento, não todo o histórico de testes do projeto.

## Verificação ainda pendente antes do gate geral

A coordenação executou `pnpm exec tsc -p tsconfig.json --noEmit` e confirmou sete erros em testes anteriores: import/tipo de conexão e união discriminada em `identity-audit.integration.test.ts`; dados de fixture e acesso a linhas em `materials.integration.test.ts`. Nenhum erro foi emitido para os arquivos do incremento 3. Antigravity recebeu escopo complementar mínimo de correção no contrato. A checagem da raiz não foi descrita como verde, nem seu erro ignorado para fechar a fase.

**Estado do checkpoint anterior:** provas focais do incremento examinadas e correções de segurança da suíte aceitas; o gate ainda aguardava a correção de tipos e as verificações complementares. Esse registro preserva a falha anterior sem descrevê-la retroativamente como verde.

## Gate TEST aceito após remediação

Examinados `PHASE6-TYPECHECK-REMEDIATION.md`, as alterações mínimas nos dois testes anteriores e a evidência posterior de cleanup. Import de conexão corrigido por inferência da chamada real, narrowing da união de eventos, fixture com nome/descrição corretos e guardas de existência de linhas preservam as negativas e as expectativas anteriores. A limpeza de auditoria no teste de materiais usa exclusivamente os IDs dos usuários da própria execução e conexão de migrador antes da exclusão dessas fixtures.

ESLint dos dois arquivos e typecheck do escopo configurado pelo `tsconfig.json` da raiz terminaram com exit 0. Não se trata de uma nova compilação do frontend. As seleções focais C7 de identidade e 1.5 de materiais passaram, uma por arquivo; 17 e 35 casos ficaram intencionalmente fora desses filtros. A suíte nova de clientes continua com 9/9 PASS e não foi repetida após alterações exclusivamente nos outros testes.

Baseline posterior: `auth_user=0`, `client=0`, `identity_event=394`; permissões de clientes preservadas. A chamada inicial incorreta ao verificador de portas foi registrada como falha e corrigida com `-Preferred`/`-ReleaseLeaseId`; nenhuma verificação retroativa fictícia foi aceita. O banco existente pertence ao projeto e as reservas não usadas foram liberadas.

**Gate TEST aceito por Codex #2 em 13/10.** Antigravity está autorizado a executar a ativação DEV segundo `PHASE6-INCREMENT3-DEV-PLAN.md`, sem migration, fixtures DEV, mudanças de schema/dependências ou frontend. O executor precisa preservar artefatos e dados, comprovar processo/portas/readiness/proxy e fornecer snapshot antes/depois; o aceite DEV ainda não foi emitido.

## Gate DEV aceito após verificação independente

Examinados `PHASE6-INCREMENT3-DEV-ACTIVATION.md`, o startup desacoplado via WMI/CIM com janela oculta e os helpers de verificação/snapshot. A falha inicial de persistência foi registrada: o primeiro processo não sobreviveu ao Job Object do runner; o novo processo foi iniciado em contexto persistente. Não foi encoberta com uma verificação dentro do mesmo step.

Em invocação independente da coordenação, às 20:06 UTC, API PID63632 permaneceu em `127.0.0.1:3002` com caminho absoluto deste projeto, e WEB PID26472 em 5173. Readiness/liveness 200; cabeçalhos exatos; clientes/auditoria anônimos 401 diretamente e pelo proxy. Os hashes de `dist/clients.js`, `dist/app.js` e `dist/server.js` coincidiram com os artefatos reconstruídos reportados pelo executor.

A coordenação também executou novo snapshot READ ONLY de `orium_dev`. Snapshot anterior, posterior do executor e independente têm SHA-256 idêntico (`755C38D88F20FB5FA7979F73CB282ED4613D7D6A6FE5EFD1085E7126D66E628F`): cinco migrations, dois administradores ativos com credenciais presentes, 23 grants e contagens de dados de negócio preservados. Todas as reservas criadas na verificação independente foram liberadas pelo próprio `leaseId`.

Evidências privadas: `.local/phase6/root-http-verification.json`, `.local/phase6/root-dev-snapshot.json` e os snapshots/backup em `.local/phase6/increment3-dev/`. **Ativação DEV aceita por Codex #2.** Os incrementos locais estão entregues; a Fase 6 integral permanece dependente do Bitwarden real conforme a hospedagem posterior definida pelo responsável.
