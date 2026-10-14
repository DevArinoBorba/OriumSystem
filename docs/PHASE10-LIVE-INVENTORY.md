# Relatório de Inventário Somente-Leitura da VPS de Produção (Fase 10)

- **Data da Inspeção:** 2026-10-14T12:30:00Z (08:30 local)
- **Executor Operacional:** Antigravity (sob governança de `docs/PHASE10-IMPLEMENTATION-CONTRACT.md` e `docs/AGENT-AUTONOMY.md`)
- **Modo de Execução:** Estritamente Read-Only via alias SSH `orium-vps` (sem mutação, sem reboot, sem alteração de DNS/firewall, sem instalação de pacotes e sem exposição de segredos/variáveis de ambiente).
- **Dados Brutos Estruturados:** `.local/phase10/antigravity/raw-inventory.json`

---

## 1. Identificação do Host e Acesso

| Parâmetro | Valor Identificado | Observações |
|---|---|---|
| **Hostname / Kernel** | `srv2061201` / `Linux 7.0.0-38-generic #38-Ubuntu x86_64` | Ubuntu 26.04.1 LTS (resolute) |
| **CPU** | 2 vCPUs (`AMD EPYC 9355P 32-Core Processor`) | 1 thread/core, 1 socket |
| **Memória RAM** | 7.935 MB total / 1.429 MB usados / 6.506 MB disponíveis | Swap: 0 MB |
| **Uptime / Carga** | ~2 horas / load average: 0.02, 0.05, 0.09 | Carga baixa e estável |
| **Acesso SSH** | Porta 22, usuário `root` | `PubkeyAuthentication yes`, `PasswordAuthentication no`, `PermitRootLogin prohibit-password` |
| **Firewall (UFW)** | Status: `active` | Apenas portas `22/tcp`, `80/tcp` e `443/tcp` liberadas externamente (IPv4/IPv6). Portas internas (5432, 6379, 3001, 8000) bloqueadas da internet. |

---

## 2. Espaço em Disco e Docker Storage

- **Sistema de Arquivos Root (`/dev/sda1`):**
  - Espaço: 96 GB total, 7.6 GB usados (8%), **89 GB livres**.
  - Inodes: 12.418.560 total, 263.414 usados (3%), **12.155.146 livres**.
- **Docker System DF:**
  - Imagens: 10 imagens (3.158 GB total, 651.6 MB recuperáveis).
  - Containers: 9 containers (8 ativos, 1 concluído; 13.79 MB usados).
  - Volumes Locais: 3 volumes (121.7 MB total, 0B recuperáveis).
  - Build Cache: 64 itens (2.416 GB total, 1.923 GB recuperáveis).

---

## 3. Containers em Execução e Saúde

### 3.1. Stack Orium (`/data/orium/production`)

Gerenciada via Docker Compose sob o projeto `orium-production`:

| Container | Imagem | Status / Health | Portas Mapeadas | Redes |
|---|---|---|---|---|
| `orium-production-web-1` | `orium-production-web:latest` (93.2 MB) | `Up` (running) | 80/tcp, 8080/tcp (sem host bind público) | `coolify`, `orium-production_backend` |
| `orium-production-api-1` | `orium-production-api:latest` (321 MB) | `Up (healthy)` | 3001/tcp (sem host bind público) | `orium-production_backend` |
| `orium-production-postgres-1` | `postgres:17.11-alpine` (424 MB) | `Up (healthy)` | 5432/tcp (sem host bind público) | `orium-production_backend` |
| `orium-production-migrate-1` | `orium-production-migrate:latest` (321 MB) | `Exited (0)` (one-shot concluído) | Nenhuma | `orium-production_backend` |

### 3.2. Infraestrutura Coolify e Reverse Proxy

| Container | Imagem | Status / Health | Portas Mapeadas no Host |
|---|---|---|---|
| `coolify-proxy` | `traefik:v3.7` (v3.7.14) | `Up (healthy)` | `0.0.0.0:80`, `0.0.0.0:443`, `127.0.0.1:8080` |
| `coolify` | `coollabsio/coolify:4.4.6` | `Up (healthy)` | `127.0.0.1:8000`, `127.0.0.1:6001-6002` |
| `coolify-sentinel` | `coollabsio/sentinel:1.0.2` | `Up (healthy)` | Nenhuma porta host exposta |
| `coolify-db` | `postgres:15-alpine` | `Up (healthy)` | 5432/tcp interno na rede `coolify` |
| `coolify-redis` | `redis:7-alpine` | `Up (healthy)` | 6379/tcp interno na rede `coolify` |

---

## 4. Redes e Volumes Docker

- **Redes:**
  - `coolify` (bridge, gateway `10.0.1.1`): interliga o proxy Traefik ao container `orium-production-web-1` (IP `10.0.1.7`) e ao painel Coolify.
  - `orium-production_backend` (bridge isolada): interliga exclusivamente a aplicação Orium: `web` (`10.0.2.4`), `api` (`10.0.2.3`), `postgres` (`10.0.2.2`).
- **Volumes:**
  - `orium-production_orium-postgres` (local, driver `local`, ~121 MB): armazena o diretório `/var/lib/postgresql/data` do PostgreSQL de produção.
  - `coolify-db` e `coolify-redis`: persistência do sistema Coolify.

---

## 5. Roteamento, Proxy Coolify e Verificação HTTP Live

- **Labels Traefik no container `orium-production-web-1`:**
  - `Host('app.oriumdigital.tech')`
  - Redirecionamento HTTP -> HTTPS automático (`orium-app-https`).
  - Certificado TLS automático emitido via Let's Encrypt (`acme.json` presente em `/data/coolify/proxy/acme.json`, 28.5 KB).
  - Target no container web: porta `8080` (Nginx interno).
- **Probes HTTP Reais Executados no Host:**
  - `curl -skI https://app.oriumdigital.tech/`: `HTTP/2 200` (HTML da aplicação web servido com `cache-control: no-store`).
  - `curl -skI https://app.oriumdigital.tech/api/v1/notifications`: `HTTP/2 401` com cabeçalhos de segurança completos (`content-security-policy: default-src 'none'...`, `strict-transport-security: max-age=31536000`, `x-frame-options: DENY`, `x-content-type-options: nosniff`).
  - `docker exec orium-production-api-1 wget -qO- http://127.0.0.1:3001/health/ready`: retorno `{"status":"ok"}`.

---

## 6. Estado e Conteúdo do Banco de Dados de Produção (`orium_prod`)

Conexão somente-leitura direta ao PostgreSQL 17.11 no container `orium-production-postgres-1`:

- **Nome do Banco:** `orium_prod` (tamanho: 9.102 kB).
- **Status das Migrations Drizzle:** 6 migrations aplicadas integralmente (`0000` a `0005`), com hashes idênticos ao repositório local.
- **Tabelas de Negócio e Dados Existentes:**
  - `auth_user`: **2 usuários** cadastrados:
    - `Arino` (`oriumdigitalrino@gmail.com`) — papel `administrator`
    - `Arino Estagiario` (`arinoestagi@gmail.com`) — papel `collaborator`
  - `auth_account`: 2 contas locais com credenciais com hash.
  - `auth_session`: 1 sessão registrada.
  - `client`: 3 clientes cadastrados.
  - `demand`: 1 demanda cadastrada com 1 `demand_event`.
  - `task`: 0 tarefas cadastradas.
  - `material`: 0 materiais cadastrados.
  - `notification`: 0 notificações registradas.
  - `identity_event`: 2 eventos de auditoria.
  - `role_permission`: 23 pares ativos.
  - `permission`: 17 permissões cadastradas.

---

## 7. Permissões de Arquivos e Estrutura de Diretórios

- **Diretórios Raiz:**
  - `/data`: `drwx------ root:root`
  - `/data/coolify`: `drwx------ root:root`
  - `/data/orium`: `drwx------ root:root`
  - `/data/orium/production`: `drwx------ root:root`
- **Arquivos Sensíveis:**
  - `/data/orium/production/deploy/production/.env`: `-rw------- root:root` (permissão estrita 600, root only).
  - `/data/orium/production/deploy/production/docker-compose.yaml`: `-rw------- root:root` (permissão estrita 600).
- **Observação Crítica de Permissões:**
  - Os diretórios `apps`, `db`, `deploy`, `packages` e arquivos de código sob `/data/orium/production` possuem permissões permissivas `drwxrwxrwx` (777) e `-rw-rw-rw-` (666), herdadas de operações anteriores. Devem ser saneadas para `755`/`644` no novo fluxo de deploy.

---

## 8. Timers e Rotinas de Backup Existentes (Diagnóstico)

1. **Systemd Timers:** 14 timers ativos, todos de manutenção do sistema operacional base (`apt`, `dpkg-db-backup`, `logrotate`, `sysstat`, `fstrim`). **Nenhum timer de backup do banco de dados ou do Orium configurado no sistema.**
2. **Cron:** Nenhum crontab para root (`no user crontab`). Apenas rotinas do sistema em `/etc/cron.*`.
3. **Coolify Backups:** O diretório `/data/coolify/backups` está vazio.
4. **Conclusão:** Atualmente a VPS **não possui nenhuma rotina automatizada de backup de produção**. A implementação da Fase 10 (backup automatizado, com dump consistente, verificação de integridade, criptografia e transferência externa) é urgente e necessária.

---

## 9. Limites e Não-Conformidades Observadas

1. **Sem Backup Automatizado:** Ausência total de rotina de snapshot/dump periódico em produção.
2. **Permissões Permissivas em Código:** Presença de permissões 777 em pastas de aplicação dentro de `/data/orium/production`.
3. **Ausência de Staging Isolado:** Não existe ambiente de staging ou container de homologação na VPS; apenas a stack de produção está ativa.
4. **Arquivos Antigos em `/root`:** Existem arquivos residuais de setups anteriores em `/root` (`orium-setup`, `orium-deploy-archive`, scripts soltos), que devem ser arquivados ou organizados.

---

## 10. Conclusão da Primeira Janela

O inventário da VPS foi realizado com êxito, de forma 100% passiva e sem qualquer impacto operacional. O ambiente de produção encontra-se saudável, com containers ativos, PostgreSQL 17.11 íntegro com migration 0005 aplicada, e rota HTTPS pública `https://app.oriumdigital.tech` operando com proteção Traefik/UFW.

O inventário está pronto para a revisão e deliberação da coordenação (Codex principal) para os próximos passos da Fase 10.
