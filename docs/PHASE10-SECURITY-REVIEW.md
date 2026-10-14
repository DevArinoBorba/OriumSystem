# Relatório de Revisão de Segurança — Fase 10 (Infraestrutura e Produção)

**Autor:** Sentinela (Claude Code)  
**Data:** 2026-10-14  
**Escopo:** Revisão CONCRETA e READONLY de segurança com base em `deploy/production/nginx.conf`, `apps/api/src/app.ts`, `apps/api/src/config.ts`, `deploy/production/Dockerfile`, `deploy/production/docker-compose.yaml`, `deploy/production/db-init/00-roles.sql`, `deploy/operations/*.mjs`, `deploy/backup/`, `docs/PHASE10-VPS-ROLLOUT-RESULT.md`, `docs/PHASE10-BACKUP-RESULT.md` e `docs/PHASE10-QA-RESULT.md` (Seção 7).

---

## 1. Omissão de Headers de Segurança em `location = /index.html` (Nginx)
- **Status:** **CONFIRMADO E SANADO** (`deploy/production/nginx.conf`, linhas 27–29).
- **Severidade:** Média (corrigida no rollout da Janela 3).
- **Análise Técnica (Causa Raiz de Herança):** No Nginx, blocos `location` que definem `add_header` descartam a herança do escopo `server`. A correção aplicada no rollout garantiu a inclusão dos 5 headers de segurança em todas as rotas do Nginx.

## 2. Tratamento de `X-Forwarded-For` e `trustProxy`
- **Status:** **CONFIRMADO E SEGURO** (`deploy/production/nginx.conf` e `apps/api/src/app.ts`).
- **Análise Técnica:** O Nginx injeta explicitamente `X-Forwarded-For $remote_addr;` protegendo contra spoofing externo direto de IP.

## 3. Auditoria dos Scripts de Release, Manifesto e Preflight
- **Status:** **CONFIRMADO / SEGURO** (`deploy/operations/ops-*.mjs`).
- **Análise Técnica:** Allowlist/denylist rigorosa, verificação preflight fail-closed de integridade criptográfica SHA-256 e guarda estrita contra downgrade de schema (`schemaDowngradeAllowed: false`).

## 4. Auditoria de Backup (Rclone Crypt, Dump e Orquestração)
- **Status:** **CONFIRMADO / SEGURO** (`deploy/backup/`).
- **Análise Técnica:** Uso de variáveis de ambiente restritas para senhas, criptografia client-side via `rclone crypt` e isolamento de restore.

## 5. Checklist de Segurança Pré-Ativação VPS (Status Consolidado)
1. [x] **Isolamento de Contêineres:** Acesso ao banco restrito à rede interna `backend` com `internal: true`.
2. [x] **Princípio do Menor Privilégio no Banco:** Execução de `00-roles.sql` separando `orium_migrator` e `orium_app`.
3. [x] **Prevenção de Path Traversal no Bundle:** Validação de caminhos relativos no preflight.
4. [x] **Segredos e Permissões de Backup:** Configurações e diretórios com permissões estritas (`chmod 700`/`600`).
5. [x] **Herança de Headers no Nginx:** Corrigido e validado ao vivo.

## 6. Parecer Final Pós-Rollout Janela 3 e Gates Humanos Pendentes
- **Itens Cumpridos e Provados na Janela 3:**
  - *Permissões Saneadas:* Diretórios ajustados para `755` e arquivos para `644`, preservando segredos em `600`.
  - *Cabeçalhos de Segurança Ativos:* Validação via `curl`/probes confirmou `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer` e `cache-control: no-store` ativos em `https://app.oriumdigital.tech/` (`securityValid: true` em 60/60 testes do QA).
  - *Backup Preventivo e Timer Systemd:* Dump real executado e timer systemd configurado para `03:00 America/Cuiaba` (`Persistent=true`), com frescura validada.
  - *CI/CD Aprovado:* Workflow no GitHub Actions (`phase10-local-gates.yml`, Run #38576163707) aprovado com `conclusion: success`.
- **Gates Humanos Externos Pendentes (Fora do Escopo de Automação Técnica):**
  - Autenticação OAuth do Google Drive para envio offsite com `ORIUM_DRY_RUN=0`.
  - Provisionamento e login real da conta da Monique em produção.
  - Configuração e subida de ambiente de *staging* quando expressamente solicitado pelo responsável.
