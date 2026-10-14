# Fase 7 — Notificações: início autorizado

Em 13/10/2026, o responsável autorizou explicitamente iniciar a Fase 7. Essa decisão permite avançar enquanto a hospedagem e homologação do Bitwarden continuam pendentes na Fase 6; não representa encerramento integral da Fase 6. As pendências históricas da Fase 4 permanecem registradas.

## Objetivo

Avisar a equipe sobre novas tarefas, desbloqueios, prazos próximos, atrasos, comentários, revisões, aprovações e alterações importantes, conforme o roadmap e o fluxo operacional existente.

## Preparação e ownership

- Codex #2: arquitetura, contrato de implementação, definição de destinatários, segurança e aceite; ownership deste documento, ROADMAP.md e atualização geral da nota oficial.
- Antigravity: inventário técnico READONLY de produtores de eventos, transações, permissões e infraestrutura; pode escrever exclusivamente docs/PHASE7-INTEGRATION-MAP.md nesta tarefa.
- OpenCode: inventário READONLY da interface e contratos consumidos; pode escrever exclusivamente docs/PHASE7-UI-INVENTORY.md nesta tarefa.
- Sentinela: levantamento READONLY de riscos e critérios de segurança; pode escrever exclusivamente docs/PHASE7-SECURITY-CHECKLIST.md nesta tarefa.

Nenhum inventário autoriza alterar código, schema, permissões, dependências ou serviços. A implementação será atribuída por contrato após revisão dos mapas. Agentes registram início, evidências e conclusão apenas na seção própria de oriumsystem-acompanhamento e enviam resultado sanitizado para Codex #2 usando o helper de mensagens, sem esperar resposta para finalizar.

## Restrições iniciais

Reaproveitar a arquitetura existente. A visibilidade dos avisos deve respeitar identidade ativa e atribuição atual; um aviso não pode conceder acesso permanente a trabalho reatribuído. Não incluir senhas, tokens ou referências do cofre em mensagens. Não enviar mensagens externas sem escopo e integração definidos.

O canal inicial proposto é a central dentro do sistema; preferência por canais externos está sendo consultada. Janela de prazo próximo, destinatários por evento, tratamento de pausas/bloqueios e deduplicação serão definidos no contrato antes de implementar os comportamentos correspondentes. Não inventar regras de negócio ou assumir que auditoria histórica equivale a notificações entregues.

## Critérios da preparação

Mapear símbolos e arquivos reais, alterações necessárias, transações de origem, formas de revalidação, testes relevantes e lacunas. Sem builds, testes com serviços, migrations ou restart de DEV nesta etapa. Aplicar AGENTS.md e docs/AGENT-AUTONOMY.md; para posterior uso de serviços, aplicar PORT_POLICY e Find-FreePort.ps1.
