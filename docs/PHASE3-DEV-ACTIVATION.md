# Procedimento Operacional de Ativação Segura em DEV — Fase 3

**Documento:** `docs/PHASE3-DEV-ACTIVATION.md`  
**Objetivo:** Instruções e garantias para migração do banco `orium_dev` e reinício exclusivo da API local após aprovação integral do QA (testes de integração e homologação visual de browser).  
**Script Automatizado:** `.local/phase3-activate-dev.mjs`  
**Status Atual:** EXECUTADO E VERIFICADO (Migração aplicada em `orium_dev`, API DEV ativa na porta 3002, bootstrap intacto e proxy Vite validado).

---

## 1. Condição Prévia Mandatória (Gating)

A execução deste procedimento **NÃO DEVE** ser realizada antes da conclusão satisfatória dos seguintes passos:
1. Execução verde da suíte completa de testes de integração (`tests/demands.integration.test.ts`) pelo agente **Antigravity QA** contra o banco de testes exclusivo `orium_test` (porta 5433).
2. Validação visual e homologação de fluxos pelo navegador no portal visível conforme solicitado pelo responsável.
3. Sinal interno de liberação emitido pela coordenação (**Codex**), dispensando nova solicitação ao usuário conforme autorização de continuidade contínua de 2026-10-05.

---

## 2. Princípios de Segurança e Não-Interferência

### Prova Estrita de Processo (Safe Stop Proof)
- A prova de propriedade da API exige **obrigatoriamente o caminho ABSOLUTO normalizado** apontando para `apps/api/dist/server.js` na raiz do workspace deste projeto (`ROOT`).
- É estritamente **proibido** utilizar flags genéricas como `--env-file=.env` para presumir ownership.
- **Proteção contra Reciclagem de PIDs:** O script recheca a assinatura e o caminho absoluto do PID imediatamente antes de cada sinal de parada (`SIGTERM`), antes de invocar `Stop-Process`, e antes de qualquer retry forçado. Se o PID tiver sido reaproveitado pelo sistema operacional para outro executável, a parada é cancelada imediatamente.
- **Divergência de Registro / Processos Relativos:** Se o listener ocupando a porta preferencial possuir apenas caminho relativo (ou se o PID divergir do registrado em `.local/test-pids.json`), o script **NÃO ENCERRA O PROCESSO**. O listener existente é preservado intacto. O script consulta `Find-FreePort.ps1`, aloca automaticamente uma nova porta livre via lease, atualiza as configurações locais (`.env` e proxy Vite) e inicia a nova API com caminho absoluto, registrando o listener anterior observado como não verificado (`unverifiedPreviousListener`).

### Sigilo e Omissão de Dados Sensíveis
- Mensagens de erro e logs de diagnóstico **jamais imprimem a linha de comando (`commandLine`) de outros processos** (que poderia conter credenciais ou tokens em argumentos).
- Mensagens de exceção de conexão com banco de dados e erros de subprocessos **jamais imprimem strings de conexão (`DATABASE_URL`), `err.message` bruto ou senhas**; são utilizadas mensagens estáticas seguras sanitizadas.
- O script valida a presença não-vazia e formato de `BETTER_AUTH_SECRET` e `WEB_ORIGIN` com sigilo estrito, sem imprimir seus valores em tela ou logs.

### Guardas de Integridade do Banco de Dados e Configuração
Antes de qualquer tentativa de migração ou inicialização de serviço, o script carrega as variáveis de ambiente em memória via `node:util.parseEnv` (preservando aspas e comentários nativamente) e valida:
1. `MIGRATION_DATABASE_URL` e `DATABASE_URL` devem apontar obrigatoriamente para loopback (`127.0.0.1`, `localhost`, `[::1]`).
2. O banco de dados alvo deve ser estritamente `orium_dev`.
3. As roles devem ser separadas: `MIGRATION_DATABASE_URL` com `orium_migrator` e `DATABASE_URL` com `orium_app`.
4. Ambas as URLs devem apontar obrigatoriamente para o **mesmo hostname** e a **mesma porta** local.
5. A porta TCP do banco de dados (ex.: 55432) é verificada via probe de socket antes de executar comandos para assegurar que o serviço está ativo e responsivo conforme `PORT_POLICY`.
6. **Injeção Explícita de Ambiente Validado:** O script retorna o mapa `parsedEnv` validado (incluindo `BETTER_AUTH_SECRET`, `WEB_ORIGIN`, `LOG_LEVEL` do próprio projeto) e passa explicitamente no `env` do subprocesso `migrate` e no `spawn` da API. Na inicialização da API, sobrepõe exclusivamente `NODE_ENV`, `API_HOST`, `API_PORT` e `API_ORIGIN`, garantindo que `WEB_ORIGIN` venha do valor validado no arquivo de configuração do projeto em vez de herança indevida do terminal ou fallback.

### Conformidade com PORT_POLICY e Convívio
- Leitura direta obrigatória de `C:/Users/arino/.maestri/PORT_POLICY.md` no início do procedimento antes de qualquer startup.
- Utilização de `C:/Users/arino/.maestri/Find-FreePort.ps1` com `-Preferred <porta> -Service "orium-api-dev" -Project "<ROOT>"`.
- Nenhuma porta de outro projeto ou processo alienígena é forçada ou encerrada.
- **Atualização Pré-validada de Configuração e Proxy:** Na eventualidade de fallback de porta, o script prepara ambos os textos (`.env` e `apps/web/vite.config.ts`) em memória, valida o regex e o target exato (`target: 'http://127.0.0.1:<porta>'`), e falha seguro antes de gravar qualquer arquivo se o proxy não corresponder ao esperado, garantindo que o `.env` nunca seja alterado sem o proxy correspondente (atualização pré-validada em memória antes da escrita em disco, sem promessa de transação atômica de filesystem).
- Nenhum volume Docker ou contêiner sofre shutdown ou perda de dados.

### Health Check Anti-Race
- Monitoramento contínuo durante o loop de `/health/ready` (deadline de 45 segundos, polling a cada 500ms com timeout individual de fetch de 3s via `AbortSignal.timeout(3000)`).
- Verificação contínua se o processo filho permanece vivo (`child.exitCode === null && !child.killed`). Se o filho morrer prematuramente, o script aborta de imediato.
- Validação pós-resposta HTTP 200 de que o processo ativo na porta corresponde exatamente ao PID disparado (`listenerPid === expectedPid`) com caminho absoluto comprovado, impedindo que outro serviço ocupando a porta em corrida seja aceito por engano.

---

## 3. Roteiro de Execução do Procedimento

Quando autorizado internamente pelo Codex após QA verde (testes de integração e homologação no navegador):

```powershell
node --env-file=.env .local/phase3-activate-dev.mjs
```

### Passo a Passo Executado pelo Script:

1. **[0/5] Leitura de PORT_POLICY (`readPortPolicy`):**
   - Lê e valida o conteúdo de `C:/Users/arino/.maestri/PORT_POLICY.md`.
2. **[1/5] Validação de Guardas de Banco e Configuração (`validateDatabaseGuards`):**
   - Carrega `.env` via `node:util.parseEnv`, valida presença sigilosa de `BETTER_AUTH_SECRET` e `WEB_ORIGIN`, protocolo, loopback, banco `orium_dev`, roles, equivalência estrita de hostname e porta, e probe TCP na porta do banco.
3. **[2/5] Avaliação de Processos (`resolveProcessProof`):**
   - Compara PID registrado com listener da porta preferencial.
   - Aplica verificação restrita de caminho absoluto.
   - Se comprovado, encerra com `safeStopProcess` com rechecagem prévia de PID. Se não comprovado, preserva o processo existente e marca para realocação de porta.
4. **[3/5] Migração Segura (`runMigration`):**
   - Executa `apps/api/dist/cli.js migrate` com injeção explícita das variáveis validadas (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `MIGRATION_APP_ROLE`).
   - Aplica migração com advisory lock e concede privilégios a `orium_app`.
5. **[4/5] Reserva de Porta e Atualização Pré-validada (`requestPortReservation` & `updateConfigurationForPort`):**
   - Invoca `Find-FreePort.ps1` obtendo porta livre garantida por lease.
   - Se a porta diferir da anterior, prepara ambos os arquivos em memória, valida regex/target e aplica a atualização pré-validada em `.env` e `apps/web/vite.config.ts` (sem promessa de transação atômica de filesystem).
6. **[5/5] Disparo com Caminho Absoluto e Health Check Anti-Race (`spawnApiServer`, `waitForHealthReady`, `updateRegistry`):**
   - Spawns `apps/api/dist/server.js` passando caminho absoluto completo e variáveis de configuração validadas (`parsedEnv` + `NODE_ENV`, `API_HOST`, `API_PORT`, `API_ORIGIN`).
   - Redireciona logs para `.local/api-dev.log` e `.local/api-dev.err.log`.
   - Monitora se o processo filho continua vivo e aguarda 200 OK em `/health/ready` (deadline 45s, fetch timeout 3s) conferindo se o listener PID é igual ao PID iniciado.
   - Atualiza `.local/test-pids.json` e libera o lease do `Find-FreePort.ps1`.

---

## 4. Diagnóstico em Modo Verificação (--check)

Para testar todas as validações de guardas, leitura de PORT_POLICY, validação de regex do proxy e a prova de processo de forma não destrutiva (somente-leitura):

```powershell
node --env-file=.env .local/phase3-activate-dev.mjs --check
```

---

## 5. Evidências de Execução e Verificação Real (2026-10-06)

### 5.1 Liberação do Gate de QA
- **Artefato Oficial:** `.local/phase3-qa-results.json` (timestamp: `2026-10-06T16:30:32.086Z`).
- **Resultado:** 16/16 testes PASS (exit code 0), documentados em `PHASE3-BROWSER-REPORT.md`.

### 5.2 Execução de Ativação (`phase3-activate-dev.mjs`)
- **Comando:** `node --env-file=.env .local/phase3-activate-dev.mjs`
- **Resultado:** Exit code 0.
- **Evidências do Processo:**
  1. `[0/5]` Política de portas lida e confirmada (`PORT_POLICY.md`).
  2. `[1/5]` Guardas de integridade validadas em sigilo (segredos preservados, loopback 127.0.0.1, banco `orium_dev` na porta 55432 com roles `orium_migrator` e `orium_app`).
  3. `[2/5]` Processo anterior na porta 3001 (PID 27784) com linha de comando relativa preservado intacto por ausência de prova estrita de caminho absoluto deste projeto.
  4. `[3/5]` Migrações aplicadas com sucesso em `orium_dev` via `apps/api/dist/cli.js migrate`.
  5. `[4/5]` Alocação segura de porta livre via `Find-FreePort.ps1` (Porta 3002, lease concedido e posteriormente liberado). Atualização pré-validada síncrona de `.env` (`API_PORT=3002`, `API_ORIGIN=http://127.0.0.1:3002`) e proxy `apps/web/vite.config.ts` (`target: 'http://127.0.0.1:3002'`).
  6. `[5/5]` Instância da API DEV iniciada e confirmada via `/health/ready` com HTTP 200 `{"status":"ok"}`.

### 5.3 Verificação de Contas Bootstrap (`verify-bootstrap.mjs`)
- **Comando:** `node --env-file=.env .local/verify-bootstrap.mjs`
- **Resultado:** Exit code 0.
- **Saída Sanitizada:**
  ```json
  {
    "totalUsers": 2,
    "accounts": [
      {
        "name": "Arino",
        "email": "arinoborba@gmail.com",
        "active": true,
        "roles": ["administrator"],
        "credentialCount": 1,
        "hasCredential": true
      },
      {
        "name": "Monique",
        "email": "moniquiborges_5@gmail.com",
        "active": true,
        "roles": ["administrator"],
        "credentialCount": 1,
        "hasCredential": true
      }
    ]
  }
  ```
  Nenhum segredo ou hash exposto; 2 administradores íntegros e ativos em `orium_dev`.

### 5.4 Verificação de Conectividade e Roteamento Proxy
- **Endpoint Direto:** `curl.exe -s http://127.0.0.1:3002/health/ready` -> `{"status":"ok"}`.
- **Proxy Web (Vite 5173 -> API 3002):** `curl.exe -s -i http://127.0.0.1:5173/api/v1/me` -> `HTTP/1.1 401 Unauthorized`, `{"error":{"code":"UNAUTHENTICATED","requestId":"req-2"}}` (comprovando roteamento reverso transparente e saudável).
- **Processos Ativos:**
  * Port 3001: PID 27784 (preservado).
  * Port 3002: Fastify API DEV (ativo).
  * Port 5173: Vite Web DEV (PID 26472, ativo com proxy para 3002).
  * Registry `.local/test-pids.json` atualizado.

