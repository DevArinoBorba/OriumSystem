# Ativação DEV — Fase 5 (Materiais e Linha do Tempo)

**Data:** 08/10/2026 · **Executor:** Antigravity · **Gate:** autorizado pelo Codex (revisão 0003 aditiva + 36 integração / 12 funcionais + timeline PASS).
**Escopo:** restauração do serviço DEV com migração 0003. **Não** é homologação final da UI; E2E, captura visual e teclado nativo seguem com suas próprias provas.

## 1. Ferramentas usadas (helpers locais)
- `.local/phase5-dev-activate.mjs` — modos `snapshot` (readonly `REPEATABLE READ READ ONLY`), `backup` (pg_dump no container próprio `orium-local-postgres-1`) e `migrate` (migrador oficial `migrateDatabase`, advisory lock 712040). Valida que as URLs apontam para `orium_dev` local (55432) com papéis `orium_migrator`/`orium_app`; imprime apenas contagens/booleanos e erros estáticos.
- `.local/note-edit-antigravity.mjs` — edita só a seção `## Antigravity`, delimitada pelo próximo heading `## `, com guarda de headings (nunca até EOF, nunca `note write`).

## 2. Sequência executada
| Passo | Resultado |
| :--- | :--- |
| Snapshot readonly **before** | 3 migrations; `material`/`material_event` ausentes; auth_user 2 (2 ativos, 2 admins, 2 com credencial); client/demand/task/demand_event/task_comment = 0 |
| Backup local | `.local/phase5-dev/orium_dev-before-0003-2026-10-08T13-17-11-825Z.dump` (41.426 bytes, formato custom) |
| Build | Sem rebuild: dist de API (07/10 14:27) e contracts (08/10 09:02) mais recentes que todo `src`; QA havia concluído frontend/E2E (sem builds concorrentes) |
| Migração oficial | `migrate: OK` |
| Snapshot readonly **after** | 4 migrations; tabelas presentes; contas e contagens idênticas ao before; material/material_event = 0 (sem fixtures); permissões `administrator:materials.{archive,read,write}`, `collaborator:materials.{read,write}`; grants `orium_app` SELECT/INSERT/UPDATE/DELETE em ambas |

Snapshots completos: `.local/phase5-dev/before.json` e `.local/phase5-dev/after.json`.

## 3. Portas e serviços (PORT_POLICY)
- `Find-FreePort` executado para API (preferida 3002 → **3002 livre**, lease liberada após bind) e WEB (5173 ocupada; alternativa 20000 retornada e liberada sem uso). Nenhuma alteração de `.env`/proxy/Origin necessária.
- WEB 5173: PID 26472 (`node.exe`), linha de comando contém o caminho do projeto → reutilizado, não reiniciado.
- API anterior: inexistente (3002 livre após restart do servidor de agentes) — nenhum processo encerrado.

### Incidente de persistência e mudança de estratégia
1. `Start-Process` destacado (PID 63040, caminho absoluto comprovado) escutou em 127.0.0.1:3002, mas foi encerrado junto com o shell que o criou (log limpo, sem erro); readiness respondeu falha e proxy 502.
2. Estratégia alterada: task daemon dedicada com caminho absoluto:
   `node --env-file="<root>\.env" "<root>\apps\api\dist\server.js"` (workdir `<root>` = `C:\Users\arino\OneDrive\Documentos\Projetos\OriumSystem`).

## 4. Verificação final
- Listener 127.0.0.1:3002 → **PID 24568**, `absoluteProjectServerPath=true`.
- `GET /health/ready` (3002) → **200**.
- Via proxy WEB 5173 anônimo: `/api/v1/me` **401**, `/api/v1/materials` **401**, `/api/v1/materials/targets?kind=client` **401**, `/api/v1/materials/client-timeline/<uuid>` **401** (rotas registradas e protegidas; 404 não ocorreu).
- Persistência conferida em invocação separada após o término do comando de start (ver seção 5).

## 5. Persistência
Invocação separada, ~15 s após o fim do comando de verificação (08/10 09:20): `persist24568=true`, readiness **200**, WEB PID 26472 ativo.

## 6. Limites e pendências
- A persistência da task daemon depende do servidor de agentes; em reinício dele, repetir o passo de startup (Find-FreePort + caminho absoluto). Alternativa autorizada para maior durabilidade: terminal Maestri Shell dedicado à API.
- Autenticação e ações funcionais seguem comprovadas em TEST; nenhuma credencial real foi solicitada ou usada; nenhuma fixture criada em DEV.
- Em caso de rollback: restaurar a partir do dump acima somente com decisão do Codex; não manipular journal.
