# Checkpoint — Espelho do Google Drive na página Materiais (pausado em 2026-10-19)

Branch: `feat/drive-mirror` (trabalho em andamento, **não** está na `main` nem em produção).

## Objetivo (decisões do responsável)
- Página Materiais vira espelho da pasta `Agent/` do Google Drive: navegar, ver, baixar.
- Inclui arquivos colocados direto no Drive (escopo completo, já autorizado).
- Ações: enviar arquivos pelo sistema, status "a publicar"/"publicado", vincular a tarefa.
- Acesso:
  - administradores veem tudo;
  - colaboradores só os arquivos vinculados às próprias tarefas (ex.: "postar 4 vídeos" → vê os 4 vídeos).

## Feito
- **Autorização Google (escopo `drive`)** concluída.
  - Config separada na VPS: `/var/lib/orium-drive/rclone.conf` (700/600), remote `drive_mirror`, `root_folder_id` = pasta `Agent`. Validada: lista os 5 clientes.
  - `drive_dest` (agente) e a config dos backups não foram alterados.
- **Migration `0008_drive_mirror.sql`:**
  - `material.drive_file_id` e `material.drive_path`;
  - tabela `drive_file_status` (`to_publish`/`published`);
  - grant em `migrate.ts`.
- **Contratos:** `drivePathSchema` (bloqueia `..`, `/` inicial, `\`, NUL), `driveEntry`, list/my-files/status/link/upload; `createMaterialSchema` aceita `driveFileId`/`drivePath`.
- **`apps/api/src/drive.ts`:**
  - cliente do gateway rclone (`rcd --rc-serve`);
  - `listDrive` (só admin);
  - `openDriveFile` (stream com Range; HTML/SVG sempre download);
  - `setDriveFileStatus`, `linkDriveFile` (vincular cria material e status "a publicar"), `myDriveFiles`;
  - envio em partes de 4 MB (`receiveUploadChunk`/`completeUpload`, MD5 sem repetidos, nomes `AAAA-MM-DD_assunto_NN`, só pastas `Cliente/Categoria[/Lote]`).
- **Rotas em `app.ts`** (`/api/v1/drive/list|my-files|file|status|link|upload/chunk|upload/complete`). Exceção de content-type só para `upload/chunk` (octet-stream).
- **Agente:** `add-material` aceita `driveFileId`/`drivePath`.
- **Testes:** `tests/drive.integration.test.ts` com Drive falso em memória — **5/5 passando**.

## Falta
1. Rodar a suíte completa, lint e typecheck da raiz.
2. **Frontend** da página Materiais:
   - aba "Google Drive": navegação por pastas, grade com miniaturas, download, status, vincular a tarefa, arrastar e soltar para enviar em partes;
   - para colaborador: "Meus arquivos" por tarefa, marcar publicado;
   - manter a aba atual de links.
3. **Infra:**
   - serviço `drive-gateway` no `docker-compose.yaml` (imagem `rclone/rclone` com versão fixa, `rcd --rc-serve --rc-addr=:5572 --rc-user/--rc-pass`, volume `/var/lib/orium-drive/rclone.conf` montado com escrita para renovar token, só rede `backend`);
   - variáveis `DRIVE_GATEWAY_URL/USER/PASSWORD/FS` na API;
   - nginx: `location /api/v1/drive/` com `proxy_read_timeout` maior e `proxy_buffering off`.
4. **Hermes:**
   - skill `orium-drive` passa `driveFileId`/`drivePath` no `add-material`;
   - o `drive_url` do script já traz o ID.
5. **Deploy:**
   - backup, migration 0008 em produção, rebuild `api`/`web` + subir `drive-gateway`;
   - smoke tests; teste no navegador com admin e colaborador.

## Estado do ambiente
- Produção: commit `738f8ac` (sem espelho). Nada desta branch publicado.
- Dev local: Postgres (55432/5433), API 3002 e web 5173 ainda rodando (podem ser parados).
- Pendências antigas: data da demanda de 14/10 (prazo 16/10 vencido) e a 11ª imagem das 11h17.
