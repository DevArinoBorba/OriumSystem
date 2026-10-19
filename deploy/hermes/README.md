# Orium Agent (Hermes) — arquivos versionados

O Hermes roda na VPS (`hermes-gateway.service`) e opera o Orium System pelo WhatsApp.
Estes são os arquivos dele que tocam o sistema; a fonte da verdade passa a ser este diretório.

| Arquivo | Destino na VPS | Papel |
|---|---|---|
| `orium-agent` | `/usr/local/bin/orium-agent` | Escritas e buscas via `node dist/cli.js agent` no container da API — mesmas regras, permissões, notificações e auditoria do app (`apps/api/src/agent.ts`). |
| `orium-hermes-query` | `/usr/local/bin/orium-hermes-query` | Somente leitura (resumos) e cofre. As escritas antigas por SQL direto foram desativadas. |
| `orium-drive-upload` | `/usr/local/bin/orium-drive-upload` | Upload ao Google Drive. Lê mídias de `~/.hermes/cache/images`; caminho inexistente agora é erro (antes enviava outro arquivo). |
| `orium-vault-sync` | `/usr/local/bin/orium-vault-sync` | Sincroniza clientes/demandas com o Obsidian (cron a cada 15 min). |
| `skills/orium-secretary/SKILL.md` | `/root/.hermes/skills/orium-secretary/SKILL.md` | **Manual de operação** que o agente segue. |
| `SOUL.md` | `/root/.hermes/SOUL.md` | Identidade e regras-base, apontando para o manual. |

## Instalação / atualização

1. Publicar a API com `apps/api/src/agent.ts` (rebuild do container `api`).
2. Copiar os arquivos acima para os destinos (LF, `chmod 755` nos executáveis, `600` no `SOUL.md`).
3. Remover a skill antiga `orium-secretary-updated` (o conteúdo foi incorporado ao manual).
4. Reiniciar `hermes-gateway.service` para recarregar skills e SOUL.

## Testes

`tests/agent.integration.test.ts` cobre o comando `agent` contra o PostgreSQL de teste:
actor obrigatório, ambiguidade, permissões, fluxo completo de tarefa (criar → aceitar → iniciar → revisão → concluir), pausa formal, materiais e visibilidade.
