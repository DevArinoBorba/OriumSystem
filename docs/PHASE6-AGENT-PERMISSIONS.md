# Fase 6 — permissões dos agentes

13/10/2026. O responsável autorizou os agentes em full access, sem confirmações mecânicas, e a continuidade da Fase 6. Codex #2 mantém a coordenação, os contratos e o aceite das evidências.

| Terminal | Estado verificado | Evidência |
| --- | --- | --- |
| Codex #2 | Full access | Ambiente `danger-full-access`, aprovação `never` recebido nesta sessão |
| Codex original | Full access | `/permissions` aplicado e `/status` confirmou `Permissions: Full Access`; retomada da mesma sessão com `--dangerously-bypass-approvals-and-sandbox`, mantendo conta e diretório |
| Antigravity | Sem confirmações | Processo `agy.exe` com `--dangerously-skip-permissions`; sem reinício |
| Antigravity QA | Sem confirmações | Processo `agy.exe` com `--dangerously-skip-permissions`; sem reinício |
| Sentinela | Sem confirmações | Retomada com `claude --resume <mesma sessão> --dangerously-skip-permissions` depois de terminar o trabalho; TUI confirmou `bypass permissions on` |
| Prisma | Sem confirmações | Terminal estava ocioso e sem conversa ativa exibida; mesmo nó retomado com `claude --dangerously-skip-permissions`, TUI confirmou `bypass permissions on` |
| OpenCode | Auto accept ativo na mesma sessão | Palette `Ctrl+P` → `Permissions` → `Settings`: alterado de `prompt` para `auto accept`; TUI confirmou `Build auto`. Sem reinício, sem interromper o agente e sem sessão duplicada |
| QA Entrada | Terminal PowerShell | Terminal interativo preservado; não possui seletor de aprovação de agente |

As conexões diretas entre Codex #2, OpenCode, Antigravity QA e Prisma foram criadas pelo terminal ocioso do coordenador original, mantendo os nós, contas e conversas. O coordenador original permanece sem quota; ampliar permissões não resolve quota ou erros de rede dos provedores.

Permissões ampliadas não transferem ownership, dispensam testes ou autorizam mudanças em dados de terceiros. Permanecem a política de portas, a proteção de segredos/dados, o isolamento de `orium_test` e o gate antes da ativação DEV. Hospedagem e homologação real do Bitwarden continuam posteriores, conforme decisão do responsável.

A opção Full Access do Codex foi conferida na [documentação oficial de sandbox e permissões](https://learn.chatgpt.com/docs/sandboxing). As flags dos demais CLIs foram conferidas em seus `--help` locais nesta máquina.
