# Relatório de Ativação DEV da Fase 7 — Central de Notificações

- **Data/Hora:** 2026-10-14T07:59:00-04:00 (11:59 UTC)
- **Executor Operacional:** Antigravity (autorização contínua até conclusão, sob coordenação de Codex #2)
- **Contrato:** `docs/PHASE7-DEV-ACTIVATION-CONTRACT.md`
- **Ambiente:** `orium_dev` (PostgreSQL local em 127.0.0.1:55432, container `orium-local-postgres-1`)
- **Serviços Persistentes:** API em `http://127.0.0.1:3002` (PID 18796) e WEB em `http://127.0.0.1:5173` (PID 9188)

---

## 1. Verificação de Política de Portas e Serviços Vizinhos

Conforme `C:/Users/arino/.maestri/PORT_POLICY.md` e execução de `C:/Users/arino/.maestri/Find-FreePort.ps1`:
- **Porta 3002 (API DEV):**
  - Checagem inicial via `Find-FreePort.ps1 -Preferred 3002 -Service 'orium-api-dev' -Project <root>` -> reserva confirmada e liberada para bind do processo.
  - Listener ativo exclusivamente em `127.0.0.1:3002` sob processo do projeto.
- **Porta 5173 (WEB DEV):**
  - Checagem inicial via `Find-FreePort.ps1 -Preferred 5173 -Service 'orium-web-dev' -Project <root>` -> reserva confirmada e liberada para bind do processo.
  - Listener ativo exclusivamente em `127.0.0.1:5173` sob processo do projeto.
- **Porta 55432 (Postgres DEV):**
  - Container Docker `orium-local-postgres-1` saudável em `127.0.0.1:55432`.
- **Serviços de Terceiros e Outros Containers:**
  - Preservados estritamente intactos: `ecommerce-postgres` (5432) e `ecommerce-redis` (6379) mantidos em execução sem interrupção. Nenhum processo externo foi encerrado.

---

## 2. Backup Local e Snapshot Pré-Ativação

Antes de qualquer alteração de schema ou runtime, foi realizado o backup consistente e snapshot sanitizado:

1. **Backup de Banco de Dados (`orium_dev`):**
   - Dump binário customizado (`pg_dump -Fc`): `.local/phase7/dev/activation-2026-10-14/backup/orium_dev-before-0005.dump` (119.454 bytes).
   - Dump SQL textual (`pg_dump`): `.local/phase7/dev/activation-2026-10-14/backup/orium_dev-before-0005.sql`.
2. **Backup de Artefatos Compilados Anteriores:**
   - Cópia recursiva de `apps/api/dist/` para `.local/phase7/dev/activation-2026-10-14/backup/api-dist/`.
   - Cópia recursiva de `packages/contracts/dist/` para `.local/phase7/dev/activation-2026-10-14/backup/contracts-dist/`.
   - Cópia recursiva de `apps/web/dist/` para `.local/phase7/dev/activation-2026-10-14/backup/web-dist/`.
3. **Snapshot Pré-Ativação (`snapshot-before.json`):**
   - Database: `orium_dev` (OID válido, `orium_app` sem superuser).
   - Migrations aplicadas: 5 (migrations `0000` a `0004`).
   - Tabela `notification`: não existia (`notificationTableExists: false`).
   - Baseline administrativo: 2 contas ativas (`Arino`, `Monique`), 2 credenciais locais com hash, 23 pares `role_permission`.
   - Tabelas de negócio: `client: 0`, `demand: 0`, `task: 0`, `material: 0`, `identity_event: 0`, `identity_event_subject: 0`.

---

## 3. Compilação dos Pacotes (Checkpoint Final Único)

Executado build único dos pacotes afetados no monorepo:

| Pacote | Comando | Exit Code | Observação |
|---|---|---|---|
| `@orium/contracts` | `pnpm --filter @orium/contracts build` | `0` | Schemas de notificação e tipos exportados |
| `@orium/api` | `pnpm --filter @orium/api build` | `0` | Compilação TypeScript limpa (`server.js`, `notifications.js`, etc.) |
| `@orium/web` | `pnpm --filter @orium/web build` | `0` | Bundle Vite cliente gerado com sucesso |

Nenhum arquivo de código de domínio (`demands.ts`, `notifications.ts`, etc.) foi alterado durante esta ativação (READONLY estrito preservado).

---

## 4. Aplicação da Migration 0005 em `orium_dev`

- **Comando:** `node --env-file=.env apps/api/dist/cli.js migrate`
- **Exit Code:** `0` (`Migrations aplicadas.`)
- **Papel de Migração:** `orium_migrator` (separado da aplicação), sob advisory lock `712040`.
- **Alterações Efetivas no Schema:**
  - Tabela criada: `public.notification`.
  - 9 Constraints:
    - `notification_pkey` (PRIMARY KEY id)
    - `notification_recipient_user_id_fkey` (FOREIGN KEY auth_user ON DELETE CASCADE)
    - `notification_demand_id_fkey` (FOREIGN KEY demand ON DELETE CASCADE)
    - `notification_task_id_fkey` (FOREIGN KEY task ON DELETE CASCADE)
    - `notification_source_event_id_fkey` (FOREIGN KEY demand_event ON DELETE CASCADE)
    - `notification_kind_check` (CHECK 12 kinds autorizados)
    - `notification_single_source_check` (CHECK exclusividade source_event_id vs source_delivery_date)
    - `notification_kind_source_check` (CHECK compatibilidade kinds com origem de evento ou data)
    - `notification_kind_task_check` (CHECK compatibilidade kinds de task com task_id preenchido)
  - 9 Índices:
    - `notification_pkey`
    - `notification_event_dedup_idx` (UNIQUE dedup em recipient, kind, source_event_id)
    - `notification_calendar_task_dedup_idx` (UNIQUE dedup calendário por task)
    - `notification_calendar_demand_dedup_idx` (UNIQUE dedup calendário por demand)
    - `notification_recipient_created_at_idx` (recipient_user_id, created_at DESC, id DESC)
    - `notification_recipient_unread_idx` (recipient_user_id WHERE read_at IS NULL)
    - `notification_demand_id_idx`
    - `notification_task_id_idx`
    - `notification_source_event_id_idx`
- **Privilégios Aplicados para `orium_app`:**
  - `SELECT`: concedido (`has_table_privilege = true`).
  - `INSERT`: concedido (`has_table_privilege = true`).
  - `UPDATE`: negado a nível de tabela (`has_table_privilege = false`).
  - `UPDATE (read_at)`: concedido estritamente a nível de coluna (`has_column_privilege = true`).
  - `UPDATE` em outras colunas (`kind`, `id`, etc.): negado (`has_column_privilege = false`).
  - `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`: revogados/negados (`has_table_privilege = false`).

---

## 5. Inicialização Persistente dos Serviços DEV

Processos iniciados de forma desacoplada da sessão do terminal utilizando `Win32_Process.Create` com `ShowWindow = 0` (janela oculta) e caminhos absolutos:

- **API DEV:**
  - PID: `18796`
  - Porta: `3002` (`127.0.0.1`)
  - Comando: `"C:\Program Files\nodejs\node.exe" --env-file=.env "C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\api\dist\server.js"`
  - Working Directory: `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem`
- **WEB DEV:**
  - PID: `9188`
  - Porta: `5173` (`127.0.0.1`)
  - Comando: `"C:\Program Files\nodejs\node.exe" "C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\web\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort`
  - Working Directory: `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem\apps\web`
- **Registro:** Metadados salvos em `.local/phase7/dev/activation-2026-10-14/services.json`.

---

## 6. Verificação de Saúde e Probes HTTP (`verify-dev-http.ps1`)

Executada a suite de sondagens HTTP diretas e via proxy (`ALL_DEV_HTTP_VERIFICATIONS_PASSED`):

| Alvo | Método / Rota | Código Esperado | Código Obtido | Resultado |
|---|---|---|---|---|
| API Direta | `GET http://127.0.0.1:3002/health/ready` | `200` | `200` | PASS |
| API Direta | `GET http://127.0.0.1:3002/health/live` | `200` | `200` | PASS |
| API Direta (Headers) | `cache-control: no-store` | Exato | Exato | PASS |
| API Direta (Headers) | `x-content-type-options: nosniff` | Exato | Exato | PASS |
| API Direta (Headers) | `content-security-policy` (default-src 'none'...) | Exato | Exato | PASS |
| API Direta (Headers) | `x-frame-options: DENY` | Exato | Exato | PASS |
| API Direta (Headers) | `referrer-policy: no-referrer` | Exato | Exato | PASS |
| API Direta (Headers) | `permissions-policy: camera=(), microphone=(), geolocation=()` | Exato | Exato | PASS |
| API Direta | `GET /api/v1/notifications` (não autenticado) | `401` | `401` | PASS |
| API Direta | `POST /api/v1/notifications/:id/read` (não autenticado) | `401` | `401` | PASS |
| API Direta | `GET /api/v1/clients` (não autenticado) | `401` | `401` | PASS |
| API Direta | `GET /api/v1/identity-events` (não autenticado) | `401` | `401` | PASS |
| Web Root | `GET http://127.0.0.1:5173/` | `200` | `200` | PASS |
| Web Proxy | `GET /api/v1/notifications` (não autenticado) | `401` | `401` (CSP match) | PASS |
| Web Proxy | `POST /api/v1/notifications/:id/read` (não autenticado) | `401` | `401` (CSP match) | PASS |
| Web Proxy | `GET /api/v1/me` (não autenticado) | `401` | `401` (CSP match) | PASS |
| Web Proxy | `GET /api/v1/clients` (não autenticado) | `401` | `401` (CSP match) | PASS |
| Web Proxy | `GET /api/v1/identity-events` (não autenticado) | `401` | `401` (CSP match) | PASS |
| Web Proxy | `GET /api/v1/materials` (não autenticado) | `401` | `401` (CSP match) | PASS |

---

## 7. Comparativo de Baseline e Integridade

Comparação dos snapshots sanitizados antes (`snapshot-before.json`) e após a ativação (`snapshot-final.json`):

| Item de Baseline | Antes | Depois | Status de Integridade |
|---|---|---|---|
| Banco / Usuário App | `orium_dev` / `orium_app` | `orium_dev` / `orium_app` | Idêntico |
| Migrations Aplicadas | 5 | 6 (`0005_notifications` adicionada) | Esperado conforme contrato |
| Tabela `notification` | Não existia | Criada (0 registros) | Esperado conforme contrato |
| Privilégios `notification` | N/A | SELECT/INSERT ok, UPDATE restrito a read_at | Restrição estrita de privilégios |
| Contas Administrativas Ativas | 2 (`Arino`, `Monique`) | 2 (`Arino`, `Monique`) | Preservado |
| Credenciais Locais com Hash | 2 | 2 | Preservado |
| Pares `role_permission` | 23 | 23 | Preservado |
| Permissões Totais | 17 | 17 | Preservado |
| Dados Operacionais (`client`, `demand`, `task`, `material`) | 0 | 0 | Preservado |
| Eventos de Identidade (`identity_event`, `subject`) | 0 | 0 | Preservado |
| Sessões de Autenticação (`auth_session_total`) | 1 | 1 | Preservado |

---

## 8. Escopo e Limites da Entrega

- A ativação em DEV disponibiliza a central interna de notificações, a geração transacional de eventos nas transições de demandas/tarefas e a materialização oportunista do calendário pessoal ao consultar a caixa de entrada.
- Não existem cron jobs em segundo plano, nem serviços externos de envio (SMTP, WhatsApp, Web Push) nem integrações com cofres em nuvem (Bitwarden externo permanece registrado para resolução posterior em sua fase própria).
- Nenhuma fixture de TEST, mock de dados ou usuário seed foi inserido em DEV.
- Nenhum serviço de outro projeto da máquina foi afetado ou interrompido.
