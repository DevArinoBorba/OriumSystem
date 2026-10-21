# Espelho do Google Drive na página Materiais — entregue em 2026-10-21

Iniciado em 19/10 (checkpoint na branch `feat/drive-mirror`), concluído e publicado em 21/10.
Commits na `main`: `8817dfa` (backend), `20adc35` (Kanban de outro agente, incluído no deploy), `0bd45cf`, `0af50cc` (frontend, infra, Hermes).

## O que faz
- **Materiais › Google Drive (administradores):**
  - navegação pela pasta `Agent/` inteira, inclusive arquivos colocados à mão no Drive;
  - miniaturas, visualização de imagem e vídeo, download;
  - status "a publicar"/"publicado" e filtro "só a publicar";
  - vincular arquivo a uma tarefa;
  - envio por botão ou arrastar e soltar, em partes de 4 MB (até 1 GB), sem repetidos (MD5 na pasta do cliente) e com nomes `AAAA-MM-DD_assunto_NN`, só em `Cliente/Categoria[/Lote]`.
- **Materiais › Meus arquivos (colaboradores):** arquivos vinculados às próprias tarefas abertas, agrupados por tarefa, com download e "Publicado". Arquivos de outras pessoas devolvem 404.
- **Materiais › Links:** a tela anterior, sem mudanças.
- **Orium Agent:** `orium-drive-upload` devolve `drive_file_id`/`relative_path`; as skills mandam gravar no `add-material`. O arquivo entra como "a publicar" e aparece para o responsável.

## Arquitetura
- `drive-gateway` (rclone 1.68.2 `rcd --rc-serve`):
  - rede interna `backend` + rede `egress` só dele;
  - senha em `DRIVE_GATEWAY_PASSWORD` (.env 600);
  - config `/var/lib/orium-drive/rclone.conf` (escopo `drive`, `root_folder_id` = `Agent`).
- A API não tem internet nem credenciais do Google. Ela valida acesso e faz o streaming.
- HTML/SVG nunca abrem inline.
- Migration `0008_drive_mirror.sql`: `material.drive_file_id`/`drive_path` e `drive_file_status`.

## Evidências
- **Local:**
  - lint e typecheck limpos;
  - **406/406** testes (inclui `tests/drive.integration.test.ts`, com Drive falso que reproduz o formato real do rclone);
  - build ok;
  - fase 10: 60/60;
  - `nginx -t` e `docker compose config` ok.
- **CI GitHub:** `0af50cc` success.
- **Portão validado na VPS antes do deploy (container temporário):**
  - listagem com ID/MD5;
  - Range 206;
  - upload;
  - 404 em pasta inexistente;
  - 401 sem senha.
  - Achado corrigido: `Path` recursivo é relativo à raiz do remote.
- **Produção:**
  - drift: 17/17 arquivos iguais a `738f8ac` antes; 17/17 iguais a `0af50cc` depois;
  - migration: exit 0, 9 migrations, colunas e grant ok, 4 usuários e 9 materiais preservados;
  - containers: `drive-gateway`, `api` (healthy) e `web` no ar; postgres sem reinício;
  - a API alcança o portão (8 pastas) e continua sem internet;
  - públicos: ready 200, `/` e `/materiais` 200, rotas `/api/v1/drive/*` 401 sem login, bundle `index-DtQ2rWxx.js`;
  - listagem real como Arino: lote do Gordinho com 9 arquivos.
  - Os 9 materiais de 19/10 foram completados com `drive_file_id`/`drive_path` (9/9, transação) e marcados "a publicar".
- **Hermes:** `orium-drive-upload` e as 2 skills instalados idênticos ao git; gateway `active`.

## Backups e rollback
- **Backups:**
  - `/var/lib/orium-backup/staging/orium_prod_pre_20261021-drive.dump` (107.819 bytes, 234 TOC);
  - `code_pre_20261021-drive.tar.gz` (arquivos + .env);
  - `hermes_pre_20261021-drive.tar.gz`;
  - imagens `orium-production-{api,web}:pre-drive-20261021`.
- **Rollback:** restaurar os tarballs, retag das imagens, `docker compose up -d --no-build --no-deps --force-recreate api web` e `docker compose rm -sf drive-gateway`. As colunas novas da migration 0008 são aditivas e podem ficar.

## Pendente
- Conferência visual logada em produção (admin e colaborador).
- Kanban (`20adc35`): ao arrastar para "Em produção", um administrador inicia tarefas de outra pessoa, o que contorna a regra "só o responsável inicia". Decidir se é intencional.
