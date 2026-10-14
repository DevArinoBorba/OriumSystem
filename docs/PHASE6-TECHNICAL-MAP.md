# Fase 6 — Mapa técnico de Segurança e Cofre (READONLY)

**Documento preparatório**, não contrato nem evidência de implementação. Autor: Antigravity, 08/10/2026. Base: ADR-0006 (cofre externo, app guarda só referências; Vaultwarden candidato **não escolhido nem implantado**), ADR-0007 (sessões/RBAC), ADR-0004 (Better Auth + RBAC). Contrato e regras de acesso cabem ao Codex.

> Fronteira inegociável (ADR-0006): o OriumSystem **não** armazena, criptografa, revela nem desbloqueia segredos de clientes. Não há cofre interno, campo cifrado de senha, endpoint de revelação ou chave mestra no backend. Mudança exige nova aprovação explícita.

## 1. Superfícies de segurança atuais (estado real do código)

| Superfície | Onde | Estado | Observação |
| :--- | :--- | :--- | :--- |
| Configuração/segredos do app | `apps/api/src/config.ts` → `configSchema`, `loadConfig` | Zod restrito a hosts locais; `BETTER_AUTH_SECRET` ≥32 e sem placeholder; erros mostram só nomes de campo | `NODE_ENV` aceita apenas `development`/`test` — produção ainda não suportada (Fase 10) |
| Autenticação | `apps/api/src/auth.ts` → `createAuth` | E-mail/senha, `disableSignUp`, senha 1–128, `cookieCache` off, `disableSessionRefresh`, sessão 7 dias, cookies HttpOnly/SameSite=lax, Secure só com HTTPS, rate limit (sign-in 5/60s) | Hook bloqueia sessão de usuário inativo |
| Sessão/inatividade | `apps/api/src/identity.ts` → `authenticate` | UPDATE condicional: ativo, `expires_at`, criação <7d, `last_seen_at` <12h; sessão inválida é apagada | Atende ADR-0007 (absoluto 7d + inatividade 12h) |
| RBAC | `identity.ts` → `requirePermission`, `adminPermissions`, `publicIdentity`; `packages/contracts` → `roleSchema`, `permissionSchema` | Deny-by-default; permissões admin exigem papel `administrator` mesmo se concedidas | Serviços de domínio (ex.: `materials.ts` → `revalidateActor`) revalidam no banco |
| Serialização de identidade | `IDENTITY_LOCK` (712041), `serializeIdentity`, `changeIdentity`, `changeRolePermissions` | Login, troca de papel, desativação e recuperação serializados; sessões do alvo revogadas | — |
| Recuperação local | `apps/api/src/recovery.ts`, `cli.ts` (`pnpm db:recover`) | Só TTY local, reautenticação admin, revoga sessões | Sem SMTP/MFA (pendentes) |
| Proteção HTTP | `app.ts` → hook `onRequest`, `setErrorHandler` | Mutações exigem `Origin === WEB_ORIGIN`, rejeita `sec-fetch-site: cross-site`, exige JSON; `Cache-Control: no-store`, `nosniff`; body 16 KB; timeout 15 s; erros sem mensagem bruta | Sem CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS (HSTS só faz sentido com HTTPS/Fase 10) |
| Logs | `app.ts` logger `redact` e serializers | Redige cookie, authorization, set-cookie, password, token, secret, DATABASE_URL; loga só método/path/status | `redact` por chave de topo; não cobre corpos aninhados se algum dia forem logados |
| Auditoria de domínio | `demand_event`, `material_event` (`schema.ts`) | Ator, ação, `metadata` jsonb, timestamp | **Não há auditoria de identidade** (login, falha de login, troca de papel/permissão, desativação, recuperação só emite recibo em stdout) |
| URLs externas | `contracts` → `materialUrlSchema`; `task.preview_url` | http/https, sem credenciais embutidas, ≤2048, sem fetch no servidor | Não bloqueia hosts privados — irrelevante enquanto não houver fetch server-side |
| Dados pessoais/sensíveis | `client.contact_name/email/phone/notes` | Projeção mínima a colaboradores (id/name) | `notes` é texto livre: risco de alguém colar senha de cliente — conflita com ADR-0006 |

## 2. Modelo proposto de referência ao cofre (sem segredos)

Referência = **ponteiro** para um item no cofre externo, nunca o valor.

- Entidade sugerida `vault_reference` (aditiva, futura): `id`, `client_id` (FK RESTRICT), `demand_id`/`task_id` opcionais (mesma hierarquia de Materiais), `label` (ex.: "Hospedagem — painel"), `kind` (`hosting|domain|email|cms|other`), `vault_provider` (enum fechado após decisão), `vault_item_ref` (identificador opaco do item/coleção, validado por formato), `open_url` (http/https para o cofre, sem credenciais, mesmo validador de `materialUrlSchema`), `archived_at`, `version`, auditoria `created_by`, timestamps.
- **Proibido nos schemas**: campos `password`, `secret`, `token`, `username`+`password`, `totp`, `value`, ou qualquer `jsonb` livre que permita colar segredo. Validação Zod `.strict()` e lista de chaves proibidas no `metadata` de eventos.
- Abertura: a UI só navega para `open_url` no cofre; autenticação acontece **no cofre** (sessão do usuário lá). Backend não chama API do cofre nesta fase.
- Eventos `vault_reference_event` (criado/editado/arquivado/aberto?) com o mesmo padrão transacional de `material_event`; registrar "aberto" é decisão pendente (o app não sabe se o usuário de fato acessou o item).
- RBAC sugerido (a confirmar): `vault.read` (ver que existe referência), `vault.write`, `vault.archive` — com isolamento por atribuição idêntico a Materiais (`revalidateActor` + FOR SHARE em task). Acesso real ao segredo continua governado pelas coleções do cofre, não pelo app.

## 3. Riscos e recomendações implementáveis (sem segredos no app)

| # | Risco | Recomendação | Esforço |
| :--- | :--- | :--- | :--- |
| R1 | Segredos colados em `client.notes`, comentários, descrições de material/tarefa | Aviso de UI + detector heurístico **não bloqueante** no backend (padrões tipo `senha:`, `password=`, chaves) que rejeite ou marque; decisão de bloquear é de negócio | Baixo |
| R2 | Sem trilha de auditoria de identidade | Tabela aditiva `identity_event` (login ok/falha agregada, logout, desativação, troca de papel/permissões, recuperação) sem IP completo/senha; escrita na mesma transação dos fluxos existentes | Médio |
| R3 | Cabeçalhos ausentes | `Content-Security-Policy` restritiva no web/proxy, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` (protege `open_url`/IDs em links), `Permissions-Policy`; HSTS na Fase 10 | Baixo |
| R4 | Links para cofre vazarem via Referer/abertura | `rel="noopener noreferrer"`, `target=_blank`, sem query string com identificadores sensíveis | Baixo |
| R5 | Rate limit apenas no sign-in e em memória | Manter; em produção, armazenamento compartilhado e limite por conta além de IP (Fase 10) | Médio |
| R6 | MFA/SMTP ausentes | Planejar MFA TOTP do Better Auth para administradores antes de credenciais reais de clientes no cofre | Médio |
| R7 | `redact` do logger raso | Adicionar caminhos `*.password`, `*.secret`, `body.*` e teste unitário de redação | Baixo |
| R8 | Backups de banco (`pg_dump`) contêm e-mails/telefones | Política de retenção/cifra de backup é infra (Fase 10); cofre externo exige backup próprio | — |
| R9 | Item de cofre removido/renomeado → referência órfã | Referência é texto opaco; UI mostra "abrir no cofre", sem verificar existência (sem API) | — |

## 4. Decisões de negócio e acessos reais ainda necessários (bloqueantes)

1. **Produto do cofre**: Vaultwarden vs Bitwarden oficial vs outro; hospedagem, custódia e backups (ADR-0006 pendente).
2. **Formato da referência**: ID de item, ID de coleção ou URL direta? Depende do produto e de como ele expõe deep links.
3. **Quem pode ver que uma referência existe**: colaborador vê referências das suas tarefas? Só admin? Mesmo isolamento de Materiais?
4. **Registrar "abertura"** de referência como evento de auditoria (sabendo que não comprova acesso)?
5. **Bloquear ou só alertar** texto com aparência de segredo em notas/comentários (R1).
6. **MFA obrigatório** para administradores antes de cadastrar referências reais.
7. **Retenção** da auditoria de identidade e quais campos (IP truncado? user-agent?) — LGPD.
8. Acesso real a uma instância de cofre de teste: **não existe**; nenhuma integração pode ser declarada sem ela.

## 5. Limites para o contrato Codex

- Arquivos que um contrato futuro tocaria: `packages/contracts/src/index.ts` (schemas `vaultReference*`, novas permissões), `apps/api/src/schema.ts` + `db/migrations/0004_*.sql` (aditiva), novo `apps/api/src/vault-references.ts` seguindo `materials.ts`, `apps/api/src/app.ts` (rotas), `apps/api/src/identity.ts` (`identity_event`, se aprovado), testes de integração em `orium_test`.
- Fora de escopo: cofre próprio, criptografia de credenciais no app, chamada server-side à API do cofre, revelação/desbloqueio, produção/HTTPS.
- Este mapa não alterou código, banco, serviços ou DEV.
