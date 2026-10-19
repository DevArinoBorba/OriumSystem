---
name: orium-drive
description: Padrão oficial para salvar arquivos de clientes no Google Drive da Orium (pastas, nomes, lotes, sem duplicatas) e vincular ao Orium System como material. Use SEMPRE que receber fotos, vídeos, PDFs ou documentos para guardar ou anexar a uma tarefa.
---

# Orium Agent — Organização do Google Drive

Objetivo: **cada arquivo em um único lugar previsível, com nome claro, sem repetição, e ligado à tarefa no sistema.**
Use junto com a skill `orium-secretary` (quem pediu, cliente, demanda, tarefa).

---

## 1. Estrutura de pastas (fixa — nunca crie outras no nível da categoria)

```
Agent/
└── <Cliente>/                      ← nome igual ao da pasta existente (ex.: "Gordinho Locacoes")
    ├── Comprovantes/               PIX, recibos, notas, boletos
    ├── Contratos/                  contratos, propostas, aditivos
    ├── Identidade Visual/          logos, manual da marca, paletas, fontes
    ├── Criativos e Midias/         fotos, artes, vídeos, materiais de campanha/anúncio/site
    │   └── AAAA-MM <Assunto>/      ← subpasta por LOTE/trabalho (ex.: "2026-10 Anuncios do site")
    ├── Relatorios/                 relatórios, métricas, fechamentos
    └── Documentos Gerais/          briefings, atas, outros
```

- **Categoria**: sempre uma das 6 acima. "Anúncios", "fotos do site", "posts" → `Criativos e Midias`.
- **Subpasta de lote** (`--folder`): use quando vierem **2 ou mais arquivos do mesmo assunto** ou quando forem para uma tarefa. Formato: `AAAA-MM Assunto` (mês atual, assunto curto com maiúscula inicial, sem acentos). Reutilize a mesma subpasta se o assunto já existir (veja com `--list`).
- Comprovantes e contratos avulsos podem ficar direto na categoria (sem subpasta).

## 2. Nome dos arquivos (o script aplica — você só passa o assunto)

Passe `--name "<assunto curto>"` e o script gera:
- vários arquivos: `AAAA-MM-DD_<assunto>_01.jpg`, `_02`, `_03`… (na **ordem em que você listar** os arquivos)
- um arquivo: `AAAA-MM-DD_<assunto>.pdf`

Regras para o assunto: 2 a 4 palavras, o que é o conteúdo — ex.: `anuncios site`, `comprovante pix setembro`, `contrato social`, `logo principal`. Nada de "foto", "imagem", "arquivo" sozinhos.
Se já houver arquivos do mesmo dia/assunto na pasta, a numeração **continua** de onde parou. Nada é sobrescrito.

## 3. Repetidos — o script bloqueia, você confere

Antes de enviar, o script compara o **conteúdo** (hash MD5) de cada arquivo com **tudo o que já existe na pasta do cliente** e também entre os arquivos do mesmo lote:
- repetido → **não é enviado**; aparece em `duplicates_skipped` com o arquivo que já existe (e o link dele).
- Diga isso ao usuário: *"9 fotos salvas; 1 era repetida e não foi duplicada."*
- O WhatsApp às vezes entrega a mesma foto duas vezes — é normal o lote ter repetidos.
- **Nunca** reenvie um arquivo "com outro nome" para contornar o bloqueio.

## 4. Comando

Envie **todas as fotos do pedido em uma única chamada**, com os caminhos exatos que vieram em `[User sent an image: <caminho>]`, na ordem em que chegaram:

```bash
/usr/local/bin/orium-drive-upload \
  "/root/.hermes/cache/images/img_aaa.jpg" "/root/.hermes/cache/images/img_bbb.jpg" \
  --client "Gordinho Locacoes" --category "Criativos e Midias" \
  --folder "2026-10 Anuncios do site" --name "anuncios site"
```

Resposta:
```json
{"ok": true, "folder": "Agent/Gordinho Locacoes/Criativos e Midias/2026-10 Anuncios do site",
 "uploaded": [{"file_name": "2026-10-19_anuncios-site_01.jpg", "drive_url": "https://drive.google.com/file/d/…/view", …}],
 "duplicates_skipped": [{"local": "…", "already_in_drive": "Agent/…/2026-10-19_anuncios-site_01.jpg", "drive_url": "…"}]}
```

- Erros (`"ok": false`) — **nada foi confirmado**; leia `error`:
  - *Cliente não encontrado/ambíguo* → confirme o cliente (`orium-agent find-client`). Cliente novo: cadastre no sistema e rode `orium-drive-upload --init-clients "<Nome>"`.
  - *Categoria inválida* → escolha uma das 6.
  - *Arquivo local não encontrado* → use o caminho exato; nunca troque por outro arquivo.
- `latest` só para **um** arquivo recebido nos últimos 15 minutos; com mais de um, sempre caminhos exatos.
- Os links (`drive_url`) **não são públicos**: abrem para quem já tem acesso ao Drive da Orium.

Ver o que já existe: `orium-drive-upload --list "Gordinho Locacoes"`.

## 5. Ligar ao sistema (página Materiais)

Se os arquivos são para uma **tarefa ou demanda**, registre **cada arquivo enviado** como material (não registre os `duplicates_skipped` de novo se já estiverem vinculados à mesma tarefa):

```bash
/usr/local/bin/orium-agent add-material <<'JSON'
{"actor":"<email de quem pediu>","clientId":"<id>","demandId":"<id>","taskId":"<id>",
 "title":"Anúncios site 01","category":"drive","url":"<drive_url>",
 "description":"Foto enviada por <pessoa> no WhatsApp em <data>."}
JSON
```

- `title`: o assunto + número (`Anúncios site 01`), igual à ordem do Drive.
- `category`: `drive` para arquivos no Drive. Logo/manual da marca → `brand`.
- Só arquivos do cliente sem tarefa? Registre com `clientId` apenas (sem demanda/tarefa) — só administradores.

## 6. Resposta ao usuário

> 📁 9 fotos salvas em *Gordinho Locacoes › Criativos e Midias › 2026-10 Anuncios do site* (`anuncios-site_01` a `_09`).
> 1 foto repetida não foi duplicada.
> 📎 Anexadas à tarefa *Adicionar as fotos nos anúncios do site*.

Nunca diga "salvei" se o comando não retornou `"ok": true` com o arquivo em `uploaded` ou em `duplicates_skipped`.
