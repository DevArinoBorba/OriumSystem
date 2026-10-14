# Fase 7 — Resultado da Preparação do Runner Browser de Notificações

- Data: 2026-10-13 (revisado com rastreamento cirúrgico de grants sob IDENTITY_LOCK, baseline criptográfica de auditoria de identidade, asserções reais de teclado e console independente)
- Dono: Antigravity QA
- Contrato de referência: `docs/PHASE7-BROWSER-PREPARATION-CONTRACT.md`
- Status: **PREPARAÇÃO CONCLUÍDA E REVISADA — PRONTO PARA EXECUÇÃO FUTURA** (aguarda gate TEST e exclusividade)

---

## 1. Escopo e Ownership

- **Ownership exclusivo respeitado:**
  - `.local/phase7/browser/`:
    - `phase7-browser-runner.mjs`: orquestrador executável com asserções reais da superfície no DOM, API e PostgreSQL, sem falsos positivos, sem eventos artificiais, sem URLs/segredos hardcoded, com autochecks estáticos, verificação independente de console e teardown incondicional.
    - `portal-helpers.mjs`: wrappers de automação do portal Maestri com rejeição estrita de saídas `Error:`/`error:` no evaluate, diagnóstico preliminar com `maestri debug`, captura com hash SHA-256 e detecção de overflow.
    - `fixtures.mjs`: gestão e isolamento cirúrgico de fixtures para `orium_test` usando os esquemas reais de `demand_event`, `identity_event`, `identity_event_subject` e `notification`, com rastreamento cirúrgico de grants sob `IDENTITY_LOCK 712041`, baseline criptográfica (SHA-256) de auditoria de identidade e comprovação auditável de 0 resíduos.
    - `port-policy.mjs`: integração com `C:/Users/arino/.maestri/Find-FreePort.ps1` conforme a política global `PORT_POLICY.md` e verificação obrigatória de propriedade do container Docker de teste (`postgres-test`).
    - `artifacts/`: diretório local reservado para persistência durável de evidências visuais, capturas de tela e artefato de auditoria de resíduos (`phase7-browser-residuals.json`).
  - `docs/PHASE7-BROWSER-PREPARATION-RESULT.md`: relatório oficial de entrega da preparação.
- **Arquivos mantidos rigorosamente READONLY:**
  - Código de produto: `apps/web/` e `apps/api/` inalterados.
  - Banco e migrações: `db/` e esquemas inalterados.
  - Contratos públicos: `packages/contracts/` inalterado.
  - Suítes e planos de colegas: `tests/` e planos do OpenCode/Codex inalterados.
  - **Nenhum serviço foi iniciado, nenhum banco de dados foi acessado e o portal não foi navegado durante esta fase de preparação.**

---

## 2. Resolução de Bloqueadores de Runtime Identificados na Inspeção

| Bloqueador Apontado | Causa-Raiz Técnica | Correção Aplicada no Runner |
| :--- | :--- | :--- |
| **Rastreamento cirúrgico de grants sob `IDENTITY_LOCK`** | `restoreRolePermissionsBaseline` anterior deletava qualquer grant ausente no snapshot e reinseria qualquer faltante, violando o princípio de isolamento cirúrgico e podendo afetar grants de terceiros. | O runner agora rastreia **exclusivamente** os grants revogados por ele próprio via `DELETE RETURNING` sob `IDENTITY_LOCK 712041`. A função `restoreOwnPermissions` reinsere unicamente essas permissões próprias com `ON CONFLICT DO NOTHING`. A baseline global é estritamente não-destrutiva: compara a igualdade do snapshot e reporta erro caso haja alterações externas, sem apagar grants alheios. |
| **Preservação de histórico não-rastreado de identidade** | Risco de deleção de eventos de auditoria anteriores ou ausência de prova de integridade do histórico pré-existente. | Implementados `snapshotIdentityAuditBaseline` e `verifyIdentityAuditBaseline`: antes do provisionamento, é calculada a contagem e um fingerprint SHA-256 de todas as linhas de `identity_event` e `identity_event_subject`. O cleanup deleta unicamente registros atrelados a `registry.userIds`. O teardown valida que as contagens e hashes das linhas pré-existentes permaneceram 100% inalteradas. |
| **Asserções de teclado e ativação em P7-BR-11** | Teste anterior marcava PASS apenas pelo retorno de `sendPortalKey('Tab')`, sem comprovar foco ou efeito. | P7-BR-11 agora valida obrigatoriamente: (1) foco inicial em "Todos"; (2) envio de `Tab` nativo; (3) assert de que `activeElement` mudou para "Não lidos"; (4) envio de `Enter`/`Space` nativo; (5) assert de que o botão focado recebeu classe `.active`; (6) assert de que a lista DOM atualizou exibindo as 15 notificações não lidas. Envio sem efeito resulta em FAIL. Sem pontes sintéticas. |
| **Independência da verificação de console** | Logs de console eram validados dentro do mesmo fluxo do teclado, podendo mascarar erros de runtime caso o teclado falhasse. | A verificação de console foi movida para o bloco `finally`, sendo executada incondicionalmente e gerando o caso independente `P7-BR-CONSOLE`, garantindo que 0 exceções não tratadas sejam atestadas mesmo sob qualquer falha de interação. |
| **Campos inexistentes em `identity_event`** | Fixtures usavam `actor_user_id` e `subject_user_id` (inexistentes). | Alinhado rigorosamente a `0004_identity_audit.sql`: colunas reais `actor_id`, `target_user_id` e junção com `identity_event_subject(event_id, user_id)`. Cleanup e verificação atuam cirurgicamente apenas sobre os IDs rastreados em `registry.userIds`. |
| **Nome e validação de `TEST_MIGRATION_DATABASE_URL`** | Runner usava `TEST_MIGRATOR_URL` com fallback para DEV; nome real configurado no projeto é `TEST_MIGRATION_DATABASE_URL`. | Runner lê especificamente `TEST_DATABASE_URL` (para `orium_app`) e `TEST_MIGRATION_DATABASE_URL` (para `orium_migrator`). Valida protocolo, host (`127.0.0.1`), porta (`5433`), banco (`orium_test`), consistência entre ambas e ausência de fallbacks para DEV. |
| **Verificação de propriedade Docker na porta 5433 (PORT_POLICY.md)** | `isPortListening(5433)` sozinho não comprovava propriedade do container nem conformidade com a regra 7 da PORT_POLICY. | Implementado `verifyDatabasePortAndOwnership` em `port-policy.mjs`: além de verificar porta ativa, inspeciona o container Docker via `docker ps --filter publish=5433` e `docker inspect`, comprovando `com.docker.compose.project == 'orium-local'`, `service == 'postgres-test'` e `working_dir` coincidente com o workspace atual. |
| **Assinatura de `provisionUser`** | `createUserSchema` exige `{ name, email, password, role }` (não array `roles`); chamada anterior omitia senha e passava formato inválido. | Geradas senhas randômicas seguras mantidas estritamente em memória (`adminPassword`, `colabPassword`). Chamada alinhada a `{ name, email, password, role: 'administrator'/'collaborator' }`, retornando `{ id }` e guardando credenciais apenas em memória para login no portal. |
| **Colunas inexistentes em `demand_event`** | Fixtures usavam colunas antigas (`event_type`, `payload`, `actor_user_id`). | Alinhado rigorosamente ao esquema real da migração `0002_demands_tasks.sql`: `(id, demand_id, task_id, actor_id, actor_name, action, reason, metadata, created_at)`. |
| **Grants de `orium_app` vs Migrator** | `orium_app` possui apenas `SELECT`, `INSERT` e `UPDATE(read_at)` em `notification`, e não possui `DELETE`. Tentativa de cleanup pelo usuário da app falharia no PostgreSQL. | Separado o acesso: `appDatabase` (`orium_app`) para `provisionUser` e servidor API; `migratorClient` (`orium_migrator`) para inserção de fixtures, admin mutations (404, 403, 401) e cleanup cirúrgico em teardown. |
| **Inversão de `API_ORIGIN` e `WEB_ORIGIN`** | Runner configurava `API_ORIGIN: testWebUrl` sem definir `WEB_ORIGIN`, violando CORS e Better Auth. | Corrigido para `API_ORIGIN: testApiUrl` e `WEB_ORIGIN: testWebUrl`, em total conformidade com `config.ts` e `auth.ts`. |
| **Captura Inicial do Portal** | Captura do estado do portal tratada apenas como aviso em caso de falha. | Tornada mandatória: se `getPortalInfo` falhar ou retornar URL inválida, a execução é abortada imediatamente para evitar que o portal visível seja corrompido sem garantia de restauração. |
| **Autochecks de esquema estático** | Risco de regressão silenciosa em nomes de colunas ou parâmetros em futuras edições. | Adicionados autochecks na rotina `--check`: validação estática de que `fixtures.mjs` não contém termos inválidos, checagem da constante `IDENTITY_LOCK` (712041), integridade das migrações e do `compose.yaml`. |
| **Artefato durável de resíduos** | Falta de registro auditável pós-teardown sobre ausência de resíduos no banco. | O teardown agora persiste o artefato `.local/phase7/browser/artifacts/phase7-browser-residuals.json` contendo a contagem de resíduos por tabela, validação da baseline de permissões, baseline e fingerprint de auditoria de identidade e timestamp. |

---

## 3. Matriz Completa de Casos de Teste Preparados

1. **`P7-BR-01` — Login, aba não-inicial e caixa pessoal:**
   - Autentica Colaborador, confere aba inicial (demands/dashboard), navega para Notificações e valida subtítulo "de trabalho".
   - Autentica Administrador, valida subtítulo "administrativos" e comprova isolamento visual entre caixas pessoais.
2. **`P7-BR-02` — Contador acessível no Header (singular, plural e 99+):**
   - Plural: 15 não lidas -> texto `"15"`, `aria-label="15 notificações não lidas"`.
   - Cap 99+: 105 não lidas -> texto `"99+"`, `aria-label="105 notificações não lidas"`.
   - Singular: 1 não lida -> texto `"1"`, `aria-label="1 notificação não lida"`.
3. **`P7-BR-03` — Filtros Todos/Não lidos e paginação com totais exatos:**
   - 25 notificações no total (`PAGE_SIZE = 20`): Página 1 ("Página 1 de 2 (25 notificações)", 20 itens), Página 2 ("Página 2 de 2 (25 notificações)", 5 itens).
   - Filtro Não Lidos ("Página 1 de 1 (15 notificações)", 15 itens com ponto e classe unread).
4. **`P7-BR-04` — Ordem decrescente e fuso Cuiabá:**
   - Ordenação `createdAt DESC` e formatação textual terminando obrigatoriamente com `(horário de Cuiabá)`.
5. **`P7-BR-05` — Abrir tarefa E chamado sem POST read e destino DOM real:**
   - 5A: Clique em "Abrir tarefa" navega para demandas, renderiza detalhes da tarefa, retorno para notificações comprova que item continua unread e 0 chamadas `/read`.
   - 5B: Clique em "Abrir chamado" navega para demandas, renderiza demanda, retorno comprova item unread e 0 chamadas `/read`.
6. **`P7-BR-06` — Marcar lida explícito, single-flight e idempotência real no PostgreSQL:**
   - Duplo clique consecutivo enquanto pendente gera exatamente 1 requisição de rede (`window.__readPosts.length === 1`).
   - Primeira chamada grava `read_at` no banco; segunda chamada subsequente retorna HTTP 200 e preserva o mesmo timestamp no banco via `COALESCE(read_at, clock_timestamp())`.
   - DOM decrementa contador e remove indicadores visuais de não lido.
7. **`P7-BR-07A` — HTTP 404 Verdadeiro com remoção de item no banco:**
   - Remoção de notificação via migratorClient em `orium_test`; clique dispara 404 real da API; lista recarrega suavemente sem crash e remove o elemento.
8. **`P7-BR-07B` — HTTP 403 Verdadeiro com revogação de permissão no banco sob IDENTITY_LOCK:**
   - Revogação de `tasks.read` em `orium_test` sob `IDENTITY_LOCK 712041` via `DELETE RETURNING`; requisição da API falha com 403 real; DOM exibe banner específico e limpa lista; restauração via `restoreOwnPermissions` recupera o acesso e valida integridade dos grants contra o snapshot baseline.
9. **`P7-BR-07C` — HTTP 401 Verdadeiro com desativação de usuário:**
   - Atualização `active = false` no banco; requisição retorna 401 real; `onUnauthorized` é acionado e usuário é redirecionado para a tela de login.
10. **`P7-BR-08` — Resiliência a erro de transporte e retry com recuperação:**
    - Falha controlada de transporte da API de teste exibe banner com botão "Tentar novamente"; clique no retry recupera os dados e remove o banner de erro.
11. **`P7-BR-09` — Foco, preservação de página/filtro e atualização silenciosa:**
    - Disparo de `focus` dispara re-fetch que preserva estritamente a página e o filtro ativos (`unreadOnly=true`), preserva o elemento focado (`activeElement`) e não renderiza skeleton loader.
12. **`P7-BR-10` — Responsividade desktop/mobile e capturas com hash:**
    - Desktop (1280x800) e Mobile (390x844) sem overflow horizontal (`scrollWidth <= clientWidth`); persistência de capturas em `.local/phase7/browser/artifacts/` com cálculo de SHA-256.
13. **`P7-BR-11` — Teclado nativo com foco e ativação real de controle:**
    - Foco inicial em "Todos", envio de `Tab` nativo via Maestri, assert obrigatório de avanço de foco para "Não lidos", envio de `Enter`/`Space` nativo com assert de classe `.active` e assert de atualização da lista DOM para 15 notificações não lidas. Envio sem efeito real gera FAIL.
14. **`P7-BR-CONSOLE` — Integridade independente do console:**
    - Executado incondicionalmente em bloco `finally`, atestando 0 exceções não tratadas no console do navegador de forma independente de qualquer interação de UI.
15. **`P7-BR-CLN` — Teardown cirúrgico incondicional:**
    - Executado em bloco `finally`: restaura URL (`http://127.0.0.1:5173/`) e viewport do portal visível `Orium - Codex visivel`, encerra processos filhos (API e Web), libera leases de portas via `Find-FreePort.ps1`, restaura exclusivamente permissões próprias sob `IDENTITY_LOCK`, remove cirurgicamente todas as fixtures de negócio e de auditoria de identidade (`identity_event`, `identity_event_subject`), valida zero resíduos no banco via `migratorClient`, valida preservação de histórico não-rastreado (fingerprint SHA-256) e persiste `phase7-browser-residuals.json`.

---

## 4. Evidências de Checagem Estática e Sintaxe

### 4.1 Checagem de Sintaxe dos Módulos (`node --check`)
```powershell
node --check .local/phase7/browser/port-policy.mjs
node --check .local/phase7/browser/portal-helpers.mjs
node --check .local/phase7/browser/fixtures.mjs
node --check .local/phase7/browser/phase7-browser-runner.mjs
```
- **Resultado:** Exit code `0` em todos os 4 arquivos (0 erros de sintaxe).

### 4.2 Checagem de Dependências, Esquemas e Prontidão do Runner (`--check`)
```powershell
node .local/phase7/browser/phase7-browser-runner.mjs --check
```
- **Saída:**
```text
=== Fase 7: Checagem de Prontidão e Sintaxe do Runner Browser ===
Status das dependências do runner:
  - [OK] packages/contracts/dist 
  - [OK] NotificationsView.tsx 
  - [OK] Find-FreePort.ps1 
  - [OK] 0005_notifications.sql 
  - [OK] fixtures.mjs schema validation (zero nomes inventados) 
  - [OK] compose.yaml postgres-test (port 5433) 
  - [OK] IDENTITY_LOCK constant (712041) 
Resultado da checagem: PRONTO PARA EXECUÇÃO FUTURA
```
---

## 5. Histórico de Condições de Execução Real

1. **Gate e Estabilidade:**
   - Testes de backend e contratos validados por Codex (92/92 testes de integração verdes).
   - Fonte web estável (`NotificationsView.tsx` com `markRequestsRef` e `App.tsx` com tratamento cirúrgico de 403).
2. **Janela Exclusiva TEST:**
   - Suíte executada em conformidade com `PORT_POLICY.md` (`API=3100`, `Web=5180`, `orium_test=5433`).
   - Comando executado: `node --env-file=.env .local/phase7/browser/phase7-browser-runner.mjs --run`.

---

## 6. Resultado da Execução E2E Real da Suíte Browser (Rodada Final)

- **Timestamp de Conclusão:** 2026-10-14T02:07:28Z
- **Placar Geral:** **15 PASS / 1 FAIL (Limitação Técnica)** de 16 testes essenciais.
- **Artefato Consolidado:** `.local/phase7/browser/phase7-browser-run.json`

### 6.1 Matriz de Resultados Verificados

| ID | Nome do Teste | Status | Evidência / Validação Real |
| :--- | :--- | :---: | :--- |
| **`P7-BR-01`** | Login, aba não-inicial e caixa pessoal | **PASS** | Colab autenticado ('de trabalho'); Admin autenticado ('administrativos'); isolamento visual entre caixas pessoais. |
| **`P7-BR-02`** | Contador no Header (singular, plural e 99+) | **PASS** | Plural (`15`, `aria-label="15 notificações não lidas"`); cap 99+ dinâmico via lote temporário de 90 fixtures em `orium_test` (`99+`, `aria-label="105 notificações não lidas"`); singular (`1`, `aria-label="1 notificação não lida"`). |
| **`P7-BR-03`** | Filtros Todos/Não lidos e paginação exata | **PASS** | Total de 25 fixtures: Pág 1 de 2 (20 itens), Pág 2 de 2 (5 itens); filtro "Não lidos" exibe 15 itens unread exatos. |
| **`P7-BR-04`** | Ordem decrescente e fuso Cuiabá | **PASS** | Ordenação cronológica `createdAt DESC` e formatação textual terminando com `(horário de Cuiabá)`. |
| **`P7-BR-05A`**| Abrir tarefa sem POST read | **PASS** | Clique em "Abrir tarefa" navega para demandas, renderiza tarefa no DOM, retorno confirma item unread e 0 requisições `/read`. |
| **`P7-BR-05B`**| Abrir chamado sem POST read | **PASS** | Clique em "Abrir chamado" navega para demandas, renderiza demanda, retorno confirma item unread e 0 requisições `/read`. |
| **`P7-BR-06`** | Marcar lida explícito, single-flight e idempotência | **PASS** | Duplo clique em pending emite exatamente 1 POST de rede (`markRequestsRef` síncrono); idempotência com payload JSON (`body: '{}'`) preserva `read_at` no PostgreSQL. |
| **`P7-BR-07A`**| HTTP 404 Verdadeiro com remoção de item | **PASS** | Exclusão cirúrgica de linha no banco sem refresh prévio; clique dispara POST com status 404 real da API; reload silencioso recarrega e ajusta paginação no DOM. |
| **`P7-BR-07B`**| HTTP 403 Verdadeiro e recuperação de permissões | **PASS** | Revogação de `tasks.read` sob `IDENTITY_LOCK 712041`; API retorna 403; banner exibido, lista limpa, contador no Header removido (`null`); restauração recupera lista e valida baseline. |
| **`P7-BR-07C`**| HTTP 401 Verdadeiro e redirecionamento para login | **PASS** | Desativação de usuário no banco via `active = false`; API retorna 401 real; callback global redireciona para formulário de login. |
| **`P7-BR-08`** | Resiliência a erro de transporte e retry | **PASS** | Erro simulado em `window.fetch` exibe banner de erro; clique no botão de retry recupera a listagem e remove o banner. |
| **`P7-BR-09`** | Foco, preservação de página/filtro e atualização silenciosa | **PASS** | Evento `focus` dispara refresh em background preservando filtro `unreadOnly=true`, número da página, foco ativo (`activeElement`) e sem renderizar skeleton. |
| **`P7-BR-10`** | Responsividade desktop/mobile e capturas | **PASS** | Desktop 1280x800 e Mobile 390x844 sem overflow (`scrollWidth <= clientWidth`); capturas PNG íntegras geradas com SHA-256. |
| **`P7-BR-11`** | Teclado nativo com foco e ativação | **FAIL (Limitação)** | Limitação técnica de injeção física `Windows SendInput` no portal Maestri documentada honestamente (SendInput retornou 2 mas os eventos Tab/Enter não foram despachados pelo SO para o documento da webview do portal, resultando em foco inalterado no botão 'Todos'). Sem pontes artificiais ou foco sintético via JS. |
| **`P7-BR-CONSOLE`**| Integridade independente do console | **PASS** | Verificação independente no teardown confirmou 0 exceções não tratadas no console do navegador (`clean: true`, probe marker verificado). |
| **`P7-BR-CLN`**| Teardown cirúrgico e restauração de ambiente | **PASS** | Portal visível restaurado para `http://127.0.0.1:5173/`, processos API/Web finalizados, leases liberados, 0 resíduos nas 11 tabelas de `orium_test`, 23 grants e fingerprints de auditoria de identidade intactos. |

### 6.2 Evidências Visuais e Criptográficas (SHA-256)

- **Screenshot Desktop (1280x800):**
  - Arquivo: `.local/phase7/browser/artifacts/P7-BR-10-desktop.png`
  - Tamanho: 283.270 bytes
  - SHA-256: `9E6F2A3B974574461EDCE7B94C90C5DC11FFDE0C7A5A98F380F69D3EDA8D72F1`
- **Screenshot Mobile (390x844):**
  - Arquivo: `.local/phase7/browser/artifacts/P7-BR-10-mobile.png`
  - Tamanho: 160.769 bytes
  - SHA-256: `8CCE64C093EADD391C57FD9829A95104BD27F9485AA348A6A7DA2B1CF85FA5EA`

### 6.3 Auditoria de Resíduos e Integridade do Banco (`phase7-browser-residuals.json`)

- **Status de Limpeza:** `isClean: true` (0 resíduos em todas as 11 tabelas rastreadas: `notification`, `task`, `demand_event`, `demand`, `client`, `identity_event_subject`, `identity_event`, `session`, `account`, `user_role`, `user`).
- **Baseline de Permissões (PostgreSQL):** `grantsVerified: true` (23 grants ativos, `grantsDiff: null`).
- **Baseline de Auditoria de Identidade:** `identityAuditVerified: true` (449 eventos / 449 sujeitos preservados com hashes SHA-256 `a3df8ab7...` e `23008e19...`, `identityAuditDiff: null`).

