# Relatório de Revisão de Segurança — Fase 10 (Infraestrutura e Produção)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-14  
**Escopo:** Revisão CONCRETA e READONLY de segurança com base em `deploy/production/nginx.conf`, `apps/api/src/app.ts`, `apps/api/src/config.ts`, `deploy/production/Dockerfile`, `deploy/production/docker-compose.yaml`, `deploy/production/db-init/00-roles.sql`, `deploy/operations/*.mjs` e `deploy/backup/`.

---

## 1. Omissão de Headers de Segurança em `location = /index.html` (Nginx)
- **Status:** **CONFIRMADO** (`deploy/production/nginx.conf`, linhas 27–29).
- **Severidade:** Média.
- **Reprodutibilidade:** 100% no build estático servido pelo Nginx na rota `/index.html`.
- **Análise Técnica (Causa Raiz de Herança):** No Nginx, quando um bloco `location` define explicitamente qualquer diretiva `add_header`, **toda** a herança de `add_header` definida no escopo pai (`server`) é descartada para aquele bloco. O bloco `location = /index.html` declara apenas `add_header Cache-Control "no-store" always;`, suprimindo os headers globais de segurança (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `HSTS`) nessa rota específica.
- **Evidência no Código:** `deploy/production/nginx.conf` (linhas 8–11 vs linha 28).

## 2. Tratamento de `X-Forwarded-For` e `trustProxy`
- **Status:** **CONFIRMADO COM RISCO AVALIADO** (`deploy/production/nginx.conf` linhas 17–18 e `apps/api/src/app.ts` linha 103).
- **Severidade:** Baixa / Operacional.
- **Análise Técnica:** O `nginx.conf` define explicitamente `proxy_set_header X-Forwarded-For $remote_addr;` com a variável nativa do Nginx, impedindo spoofing externo direto de IP. A API utiliza `trustProxy: true` em produção, confiando no Nginx local da rede Docker interna.

## 3. Auditoria dos Scripts de Release, Manifesto e Preflight
- **Status:** **CONFIRMADO / SEGURO** (`deploy/operations/ops-config.mjs`, `ops-manifest.mjs`, `ops-preflight.mjs`, `ops-release.mjs`, `ops-rollback.mjs`).
- **Severidade:** N/A (Boas práticas robustas aplicadas).
- **Análise Técnica:** 
  - *Allowlist/Denylist:* `ops-config.mjs` restringe estritamente os arquivos permitidos e bane explicitamente extensões sensíveis (`.env`, `.pem`, `.key`, `.dump`, `.backup`).
  - *Preflight Fail-Closed:* `ops-preflight.mjs` valida integridade física (tamanho, sha256) de cada arquivo declarado no manifesto contra a árvore local antes de qualquer release ou rollback, abortando em caso de qualquer divergência (`CHECKSUM_MISMATCH`, `FILE_NOT_FOUND`, `SECRET_DETECTED`).
  - *Rollback de Schema:* `ops-rollback.mjs` implementa guarda estrita impedindo qualquer downgrade automático de schema (`schemaDowngradeAllowed: false`).

## 4. Auditoria de Backup (Rclone Crypt, Dump e Orquestração)
- **Status:** **CONFIRMADO / SEGURO** (`deploy/backup/orium-backup.conf.example`, `deploy/backup/scripts/dump.sh`, `deploy/backup/scripts/crypt.sh`, `deploy/backup/scripts/freshness.sh`).
- **Severidade:** N/A.
- **Análise Técnica:**
  - *Credenciais:* O `dump.sh` e o `crypt.sh` recebem senhas estritamente via variáveis de ambiente (`PGPASSWORD`, `ORIUM_RCLONE_PASSWORD`), nunca expondo segredos em `argv`. O `crypt.sh` utiliza `--password-command` seguro.
  - *Criptografia Cliente-Side:* O rclone crypt realiza a criptografia de dados e metadados de nomes localmente antes de qualquer transmissão para o destino externo (escopo restrito `drive.file`), protegendo contra vazamentos no storage.
  - *Isolamento e Retenção:* A retenção padrão opera em modo `dryrun` por segurança e o restore é isolado para evitar sobrescrita acidental da base ativa.

## 5. Checklist de Segurança Pré-Ativação VPS
1. [ ] **Isolamento de Contêineres:** Confirmar que o serviço `postgres` no `docker-compose.yaml` não expõe a porta `5432` ao host publicamente (`ports:` ausente ou vinculado estritamente a `127.0.0.1`), mantendo acesso restrito à rede interna `backend` com `internal: true`.
2. [ ] **Princípio do Menor Privilégio no Banco:** Verificar a execução do script `00-roles.sql`, garantindo a separação estrita de privilégios entre o dono das migrações (`orium_migrator`) e a aplicação runtime (`orium_app`), sem privilégios de superusuário para a API.
3. [ ] **Prevenção de Path Traversal no Bundle:** Validar que o `ops-preflight.mjs` bloqueia caminhos relativos maliciosos (`..`) ou absolutos em todas as entradas do manifesto (`files[i].path`).
4. [ ] **Segredos e Permissões de Rclone/Backup:** Assegurar que o arquivo de configuração do rclone e o arquivo de configuração de backup (`orium-backup.conf`) possuam permissões estritas de leitura exclusiva pelo usuário do sistema operativo (ex: `chmod 600`), fora da árvore versionada do repositório.
5. [ ] **Herança de Headers no Nginx:** Aplicar a repetição dos headers globais de segurança em `location = /index.html` em `deploy/production/nginx.conf` para evitar a supressão por quebra de herança do Nginx.
