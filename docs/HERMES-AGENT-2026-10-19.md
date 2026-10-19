# Orium Agent (Hermes) operando pelas regras do sistema — 2026-10-19

## Problema
O Hermes escrevia direto no banco (`orium-hermes-query` via `psql` como `orium_migrator`):
- ignorava as regras do app: iniciar sem aceite/requisitos, pausar sem aprovação e nova data, concluir sem revisão;
- toda ação ficava registrada como "Arino (via Orium Agent)";
- escolhia cliente, demanda, tarefa e responsável pelo primeiro resultado parecido (`LIMIT 1`);
- usava padrões silenciosos: responsável não encontrado virava Arino, prazo ausente virava +7 dias;
- o código não estava no git nem em testes.

Também estava quebrado:
- `orium-drive-upload latest` procurava fotos em `~/.hermes/image_cache`, mas o Hermes grava em `~/.hermes/cache/images`;
- com caminho errado, enviava em silêncio o último arquivo recebido.

## Solução (commit `6b61cd4`)
- **`apps/api/src/agent.ts` + `cli.js agent <cmd>`:** cada comando reproduz a rota HTTP correspondente. Faz `requirePermission` com o mesmo schema do contrato e chama a mesma função de domínio, com a identidade do usuário real (`actor`, por e-mail, via `publicIdentity`). Assim herda notificações, auditoria, visibilidade e desbloqueio de dependências.
  - Conecta com a identidade da aplicação (`orium_app`, verificada por `assertApplicationDatabase`).
  - Escritas só com UUIDs. As buscas `find-*` devolvem `AMBIGUOUS`/`NOT_FOUND` com `candidates` e `needsClarification` (código de saída 2).
  - `create-task` exige prazo. `create-client` não duplica nome.
  - `hoje`/`amanha` e `today {"at":"HH:MM"}` → `schedule: "in Nm"` para lembretes, no fuso de Cuiabá.
- **`deploy/hermes/`:** scripts versionados.
  - `orium-agent` é o wrapper `docker exec -i … node dist/cli.js agent`.
  - `orium-hermes-query` ficou só com leitura e cofre.
  - `orium-drive-upload` foi corrigido.
  - Skill `orium-secretary` reescrita como manual de operação (quem é o actor, quando perguntar, fluxos passo a passo, exemplo das fotos + lembrete, erros e proibições). `SOUL.md` aponta para o manual.
- **Testes:** `tests/agent.integration.test.ts`, com 8 casos em `orium_test`. Suíte completa: **401/401**; lint, typecheck e build OK.

## Rollout na VPS
- **Backups:**
  - `hermes_pre_20261019-agent.tar.gz` (scripts, SOUL, skills, `cli.ts`; 600);
  - imagem `orium-production-api:pre-agent-20261019`;
  - skill antiga movida para `/var/lib/orium-backup/staging/hermes-retired/`.
- **API:** `agent.ts` e `cli.ts` idênticos ao git; rebuild só do `api` (healthy; web e postgres intocados).
- **Hermes:** 4 scripts (755), `SOUL.md` (600) e `SKILL.md` instalados idênticos ao git; `hermes-gateway` reiniciado, `active`, WhatsApp `connected`.
- **Verificação em produção (somente leitura, nenhum dado criado):**
  - `today {"at":"18:00"}` → `in 178m`;
  - `whoami` (Arino, administrator);
  - `find-client gordinho` → match único "Gordinho Locacoes";
  - actor desconhecido → `ACTOR_NOT_FOUND`;
  - escrita antiga desativada;
  - `overview` OK;
  - upload com caminho inexistente → erro (não envia outro arquivo).

## Rollback
1. Restaurar `hermes_pre_20261019-agent.tar.gz` (`tar xzf … -C /`).
2. Mover a skill antiga de volta.
3. `docker tag orium-production-api:pre-agent-20261019 orium-production-api:latest` e recriar `api`.
4. Reiniciar `hermes-gateway`.

## Pendências (decisões do responsável)
- Número de WhatsApp da Moniqui (e de designers quando forem ativados) para a tabela de actors do manual. Até lá, pedidos dela não geram escrita.
- Horário de "final do dia" para lembretes: definido como 18:00 (ajustável no manual).
- Cofre (`credentials`/`save-credential`) continua no script antigo, por SQL direto.
- Teste real pelo WhatsApp com o exemplo das fotos.
