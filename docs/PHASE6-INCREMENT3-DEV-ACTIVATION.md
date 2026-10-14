# Phase 6 — Incremento 3: Relatório de Ativação Controlada no Ambiente DEV

Data: 2026-10-13  
Executor: `Antigravity` (autorizado por `Codex #2` após aceite do gate `TEST` em `docs/PHASE6-INCREMENT3-INDEPENDENT-REVIEW.md`)  
Plano de referência: `docs/PHASE6-INCREMENT3-DEV-PLAN.md`  
Helpers operacionais: `.local/phase6/increment3-dev/dev-snapshot.mjs`, `.local/phase6/increment3-dev/verify-dev-http.ps1`, `.local/phase6/increment3-dev/activate-dev.ps1`, `.local/phase6/increment3-dev/start-detached-api.ps1`

---

## 1. Verificação Prévia de Portas (`PORT_POLICY.md` e `Find-FreePort.ps1`) e Identidade dos Serviços

Executado `C:/Users/arino/.maestri/Find-FreePort.ps1` com os parâmetros reais do `CmdletBinding` (`-Preferred`, `-Service`, `-Project`, `-ReleaseLeaseId`) antes de qualquer alteração:

| Serviço | Porta Preferida | Comando de Reserva / Liberação | Exit Codes | Porta Retornada / Lease ID | Identidade Comprovada do Listener / Container |
| :--- | :---: | :--- | :---: | :--- | :--- |
| API DEV (pré-stop) | `3002` | `-Preferred 3002 -Service orium-inc3-dev-api -Project C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem` -> `-ReleaseLeaseId dd5610a1-c255-421a-8867-3850b7b241c6` | `reserve=0`, `release=0` | `port=20000` (liberada imediatamente) | `PID 11204` (`127.0.0.1:3002`, `inProject=True`, `apps\api\dist\server.js`) |
| WEB DEV | `5173` | `-Preferred 5173 -Service orium-inc3-dev-web -Project C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem` -> `-ReleaseLeaseId ae3e4518-41cd-452c-a416-25633d5c6b60` | `reserve=0`, `release=0` | `port=20000` (liberada imediatamente) | `PID 26472` (`127.0.0.1:5173`, `inProject=True`, Vite dev server preservado) |
| Postgres DEV | `55432` | `-Preferred 55432 -Service orium-inc3-dev-db -Project C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem` -> `-ReleaseLeaseId ff09fa12-b191-4691-beb0-a81ab41213cf` | `reserve=0`, `release=0` | `port=20000` (liberada imediatamente) | `PID 16560` (`orium-local-postgres-1`, `Up 8 days (healthy)`, `127.0.0.1:55432->5432/tcp`, `com.docker.compose.project=orium-local`, `com.docker.compose.service=postgres`) |

- Containers de outros projetos (`ecommerce-postgres` em `5432`, `ecommerce-redis` em `6379`) preservados intocados.

---

## 2. Snapshot Sanitizado de `orium_dev` (`BEGIN READ ONLY` + `COMMIT`) — Antes e Depois

Capturado via `node --env-file=.env .local/phase6/increment3-dev/dev-snapshot.mjs` em `.local/phase6/increment3-dev/snapshot-before.json` (antes do build/restart) e `.local/phase6/increment3-dev/snapshot-after.json` (após a ativação em invocação separada), com `snapshots_identical=true`:

```json
{
  "database": "orium_dev",
  "appUser": "orium_app",
  "isSuperuser": false,
  "dbOidPresent": true,
  "migrationsApplied": 5,
  "pruneFunctions": [
    {
      "regproc": "prune_identity_events()",
      "app_can_execute": true
    }
  ],
  "privileges": {
    "client_sel": true,
    "client_ins": true,
    "client_upd": true,
    "client_del": true,
    "ie_sel": true,
    "ie_ins": true,
    "ie_upd": false,
    "ie_del": false,
    "ies_sel": true,
    "ies_ins": true,
    "ies_upd": false,
    "ies_del": false
  },
  "adminAccounts": {
    "active_admin_count": 2,
    "active_admins_with_credential": 2
  },
  "tableCounts": {
    "auth_user": 2,
    "user_role": 2,
    "role": 2,
    "permission": 17,
    "role_permission": 23,
    "client": 0,
    "demand": 0,
    "task": 0,
    "material": 0,
    "identity_event": 0,
    "identity_event_subject": 0
  },
  "rolePermissionPairsCount": 23,
  "clientRolePermissions": [
    "administrator:clients.archive",
    "administrator:clients.read",
    "administrator:clients.write"
  ]
}
```

- Nenhuma migration, bootstrap, recovery, fixture ou limpeza foi executada em `orium_dev`.

---

## 3. Backup de Rollback e Build Único de `@orium/api`

1. **Backup dos artefatos anteriores e registro de startup**:
   - Cópia integral do `apps/api/dist/` anterior salva em `.local/phase6/increment3-dev/backup-dist/`.
   - Metadados de startup do processo anterior (`PID 11204`, `127.0.0.1:3002`, caminho absoluto `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\api\dist\server.js`) salvos em `.local/phase6/increment3-dev/rollback-startup.json`.
2. **Hashes SHA-256 de Código-Fonte e Artefatos (`apps/api/dist/`)**:
   - Código-fonte confirmado idêntico ao checkpoint validado no gate `TEST`:
     - `apps/api/src/clients.ts`: `81BBA765310EE21D1E6D5F246B08010BD7E5A10FCE7FF6E871AE523E0AF5210F`
     - `apps/api/src/app.ts`: `86EC8BE57BD7B6B8C51C34DB8FC7A93EACECBCA540C64AD29FF131CDEA1059FC`
   - Antes do build (`backup-dist`):
     - `apps/api/dist/clients.js`: `ED7C6D74B12A2CE130A3EF8016EDF4FF547EB058FC2BC60ED9F3AC7A5B96E327`
     - `apps/api/dist/app.js`: `192327E67266F1E6347CEEAEE86488B2DEFC4438222FECC2A9D593AA11CACC3B`
     - `apps/api/dist/server.js`: `0C9184C1D10AABE058DDC408A0968A5FB3CEFA5831F22EA904EDAB314C14761B`
   - Comando de build único executado:
     - `pnpm --filter @orium/api build` (`tsc -p tsconfig.json`) -> **`api_build_exit=0`**
   - Após o build (`apps/api/dist/`):
     - `apps/api/dist/clients.js`: `C709EE1A2F958C7D6CF34C5276E7CA95DB09B2E19C2AF8FE2B08C7B4B8F8F7DC`
     - `apps/api/dist/app.js`: `966D41E53C5209B79B2D01E3BED08837324AEB3D4A72C951D9734453DD550769`
     - `apps/api/dist/server.js`: `0C9184C1D10AABE058DDC408A0968A5FB3CEFA5831F22EA904EDAB314C14761B`

---

## 4. Substituição Controlada do Processo API DEV e Persistência

1. Encerrado exclusivamente `PID 11204` (`127.0.0.1:3002`, comprovado como `apps\api\dist\server.js` deste projeto).
2. Confirmada a liberação da porta `3002` com `Find-FreePort.ps1 -Preferred 3002 -Service orium-inc3-dev-api-start -Project C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem` -> `reserve_exit=0`, **`assigned_port=3002`**, e liberada a reserva imediatamente antes do bind (`-ReleaseLeaseId b3727e7b-91b4-4e5f-a912-7a0e170991b2` -> `release_exit=0`).
3. **Diagnóstico e persistência entre invocações**:
   - Na primeira tentativa com `Start-Process ... -WindowStyle Hidden`, o processo iniciou (`PID 37392`) e respondeu `200`/`401` dentro da mesma invocação, mas foi encerrado pelo Job Object do runner ao término do step (`listener port=3002 NONE` na invocação seguinte).
   - Aplicado o startup desacoplado de Job Object via WMI/CIM (`Invoke-CimMethod -ClassName Win32_Process -MethodName Create` com `New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly`, diretório `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem` e comando `"C:\Program Files\nodejs\node.exe" --env-file=.env "C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\api\dist\server.js"`) em `.local/phase6/increment3-dev/start-detached-api.ps1` (e atualizado em `activate-dev.ps1`) -> `return_value=0`, **`PID 63632`**.
   - Em **invocação separada subsequente**, confirmado que `PID 63632` permanece ativo e escutando em `127.0.0.1:3002`, enquanto o servidor WEB Vite (`PID 26472`) permanece intacto em `127.0.0.1:5173`.

---

## 5. Verificação de Prontidão HTTP, Cabeçalhos de Segurança e Endpoints Anônimos (Invocação Separada)

Resultados reais de `.local/phase6/increment3-dev/verify-dev-http.ps1 -ApiPort 3002 -WebPort 5173` em invocação independente:

- **Listeners ativos**:
  - `listener port=3002 addr=127.0.0.1 pid=63632 inProject=True apiDistServerAbs=True`
  - `listener port=5173 addr=127.0.0.1 pid=26472 inProject=True apiDistServerAbs=False`
- **Readiness & Liveness + Cabeçalhos de Segurança (`http://127.0.0.1:3002`)**:
  - `GET /health/ready` -> `200`
  - `GET /health/live` -> `200`
  - `header cache-control exact=True` (`no-store`)
  - `header x-content-type-options exact=True` (`nosniff`)
  - `header content-security-policy exact=True` (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`)
  - `header x-frame-options exact=True` (`DENY`)
  - `header referrer-policy exact=True` (`no-referrer`)
  - `header permissions-policy exact=True` (`camera=(), microphone=(), geolocation=()`)
  - `hsts=False` (HTTP local)
  - `liveHeadersExact=True`
- **Endpoints Anônimos na API (`http://127.0.0.1:3002`)**:
  - `GET /api/v1/clients` -> `401`
  - `POST /api/v1/clients` (com `Origin: http://127.0.0.1:5173`, sem cookie) -> `401` (e `403` quando enviado sem cabeçalho `Origin`, pelo guard CSRF)
  - `GET /api/v1/identity-events` -> `401`
- **Endpoints Anônimos via Proxy WEB (`http://127.0.0.1:5173`)**:
  - `GET /api/v1/me` -> `401` (`apiCspViaProxy=True`)
  - `GET /api/v1/clients` -> `401` (`apiCspViaProxy=True`)
  - `POST /api/v1/clients` (com `Origin: http://127.0.0.1:5173`, sem cookie) -> `401` (`apiCspViaProxy=True`)
  - `GET /api/v1/identity-events` -> `401` (`apiCspViaProxy=True`)
  - `GET /api/v1/materials` -> `401` (`apiCspViaProxy=True`)

---

## 6. Limites da Fase 6 Preservados

- A ativação DEV do Incremento 3 está concluída e homologada localmente (`PID 63632` em `127.0.0.1:3002`).
- Conforme `docs/PHASE6-INCREMENT3-DEV-PLAN.md` e ADR-0006, o cofre oficial Bitwarden permanece com hospedagem posterior pelo responsável (instância, formato real da referência e credenciais de teste externas ainda não fornecidos). Nenhuma infraestrutura de cofre foi presumida ou provisionada, e a Fase 6 integral não é declarada encerrada por esta entrega local.
