# Procedimento Operacional de Restauração em DEV — Fase 4: Dashboard

**Documento:** `docs/PHASE4-DEV-ACTIVATION.md`  
**Data:** 07/10/2026 (Retomada e verificação de saúde)  
**Autor:** Antigravity (Backend Developer)  
**Script Automatizado:** `.local/phase4-dev-restore.mjs`  
**Status Atual:** RESTAURADO E OPERACIONAL (Restauração do serviço confirmada com readiness 200, proxy 401, prova de caminho absoluto WMI, persistência pós-startup e contas reais orium_dev intactas).

---

## 1. Contexto e Objetivo

Restauração mecânica segura da API de desenvolvimento (`API DEV`), garantindo a disponibilidade do backend atualizado com o endpoint `GET /api/v1/dashboard` e os contratos da Fase 4.

A restauração reutilizou as salvaguardas consolidadas nas fases anteriores, preservando a base de dados `orium_dev`, as credenciais administrativas existentes, os serviços WEB e sem interferência em outros processos do sistema operacional.

---

## 2. Princípios de Segurança, Portas e Prova Estrita de Processos

1. **Conformidade com PORT_POLICY e Find-FreePort Mandatório:**
   - Leitura mandatória de `C:/Users/arino/.maestri/PORT_POLICY.md`.
   - Consulta e reserva preventiva via lease de porta por `Find-FreePort.ps1` a CADA inicialização, inclusive com porta preferencial 3002 livre.
   - Liberação de lease garantida em bloco `finally`, cobrindo cenários de sucesso e eventuais falhas durante update ou spawn.
   - Nenhuma porta de outro projeto foi forçada ou encerrada.
2. **Guardas de Integridade do Banco (`orium_dev`):**
   - Conexão estritamente restrita a loopback (`127.0.0.1`, porta 55432).
   - Roles separadas: `orium_migrator` para migrações e `orium_app` para a aplicação.
   - O banco `orium_dev` não recebeu migrações adicionais (a Fase 4 não introduz novas tabelas).
   - Nenhuma fixture, credencial ou alteração em contas reais foi aplicada; integridade do bootstrap preservada.
3. **Prova Estrita de Propriedade do Servidor WEB (Porta 5173):**
   - O processo ativo na porta 5173 (PID 26472) teve sua linha de comando inspecionada via WMI:
     `"C:\Program Files\nodejs\node.exe" C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\web\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort`
   - O caminho absoluto apontando para o workspace deste projeto foi comprovado antes do reuso do serviço.
4. **Preservação de Portas e Configuração:**
   - Como a porta preferencial `3002` encontrava-se livre e foi confirmada via lease, o `.env` e o arquivo `apps/web/vite.config.ts` foram preservados sem necessidade de alteração ou alocação de fallback.
5. **Transparência e Prova Estrita de Processo da API:**
   - Em auditoria prévia pelo Codex, constatou-se que a primeira tentativa de inicialização (PID 55308) possuía linha de comando com caminho relativo (`apps/api/dist/server.js`), tornando inconsistente a afirmação de "prova absoluta".
   - Essa contradição foi corrigida: o processo anterior foi substituído por uma instância cuja linha de comando foi comprovada via WMI com caminho absoluto integral:
     `"C:\Program Files\nodejs\node.exe" --env-file=C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\.env C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\api\dist\server.js`
   - Critério `absoluteProjectServerPath = true` devidamente validado.
   - Working directory documentado: `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem`.
6. **Sanitização de Probes de Rede em `verifyProxy`:**
   - Probes de proxy sanitizados em `verifyProxy`: jamais exibem corpo arbitrário de resposta ou `err.message` bruta, registrando apenas código padronizado (`UNAUTHENTICATED`) e status HTTP.
7. **Modelo de Persistência no Windows e Checagem Pós-Execução:**
   - No Windows, subprocessos disparados por comandos curtos com término síncrono são encerrados quando o Job Object associado ao processo-pai é fechado. Por esse motivo, a persistência do serviço de desenvolvimento é gerenciada por task daemon em background (`IsDaemon: true`).
   - A persistência foi comprovada por checagens executadas em comandos independentes após a finalização da task de startup, atestando que o processo não depende do processo-pai ativo para continuar em escuta.

---

## 3. Roteiro e Evidências de Execução (`phase4-dev-restore.mjs`)

### 3.1 Etapas do Helper
1. `[0/6]` Leitura da política global de portas em `PORT_POLICY.md` confirmada.
2. `[1/6]` Guardas de banco validadas em memória com sigilo estrito de segredos (`BETTER_AUTH_SECRET` e `WEB_ORIGIN`).
3. `[2/6]` Propriedade comprovada do WEB 5173 (PID 26472) com caminho absoluto validado.
4. `[3/6]` Avaliação da porta preferencial 3002 confirmada como livre e obtenção mandatória de lease via `Find-FreePort.ps1`.
5. `[4/6]` Disparo da API DEV com caminho absoluto.
6. `[5/6]` Health check aprovado na porta 3002 com PID comprovado.
7. `[6/6]` Proxy reverso validado via porta 5173 retornando HTTP 401 UNAUTHENTICATED de forma sanitizada.
8. Liberação de lease garantida em bloco `finally`.

### 3.2 Evidências de Prontidão e Conectividade Atual (Retomada 2026-10-07)
- **Listener da API:**
  - Porta: `3002`
  - PID Ativo: `67324`
  - Working Directory: `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem`
  - Linha de comando comprovada via WMI: `"C:\Program Files\nodejs\node.exe" --env-file=C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\.env C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\api\dist\server.js`
  - Prova de caminho absoluto: validada com sucesso via WMI (`absoluteProjectServerPath = true`).
- **Readiness Direto (Porta 3002):**
  ```powershell
  curl.exe -s http://127.0.0.1:3002/health/ready
  ```
  **Resposta:** `{"status":"ok"}` (HTTP 200).
- **Roteamento Proxy Reverso (Vite 5173 -> API 3002):**
  ```powershell
  curl.exe -s -i http://127.0.0.1:5173/api/v1/me
  ```
  **Resposta:** `HTTP/1.1 401 Unauthorized`, `{"error":{"code":"UNAUTHENTICATED","requestId":"req-1"}}`.
- **Endpoint da Fase 4 via Proxy:**
  ```powershell
  curl.exe -s -i http://127.0.0.1:5173/api/v1/dashboard
  ```
  **Resposta:** `HTTP/1.1 401 Unauthorized`, `{"error":{"code":"UNAUTHENTICATED","requestId":"req-2"}}` (comprovando registro do novo endpoint e proteção por autenticação).
- **Registro de PIDs:** `.local/test-pids.json` atualizado com `{ "api": 67324, "web": 26472, "port": 3002 }`.
- **Integridade de Banco (`orium_dev`):**
  - Verificação readonly confirmou 2 administradores cadastrados e ativos ("Arino" e "Monique") com credenciais locais presentes. Dados e estrutura preservados integralmente.

---

## 4. Limites e Próximos Passos

Esta entrega representa estritamente a **restauração e disponibilidade operacional do serviço de desenvolvimento**. A homologação final dos fluxos visuais do painel, validação de responsividade e a suíte completa de testes de integração continuam sob ownership exclusivo do **Antigravity QA** e **OpenCode**, sob a coordenação do **Codex**.
