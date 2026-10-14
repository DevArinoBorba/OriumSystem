# ADR-0009 — Dashboard operacional da Fase 4

Status: decisão de implementação; homologação pendente. Data: 2026-10-06.

## Contexto

O painel reúne o fluxo já implementado, sem introduzir novos estados. Os prazos são datas informadas pelo criador. O responsável confirmou a janela de próximas entregas em três dias. Colaboradores não podem acessar trabalho alheio, nem por totais agregados.

## Decisão

Uma API de leitura agrega produção, itens dependendo de ação, pendências e carga da equipe. A autorização e o filtro de atribuição precedem as agregações. O servidor fornece totais exatos e listas limitadas do mesmo snapshot, com ordenação determinística; o navegador apenas apresenta os resultados. A carga nominal da equipe exige função administrator e users.read.

O servidor calcula a data de referência em America/Cuiaba. Hoje é separado dos próximos três dias de calendário. Atraso operacional exige início explícito e estado de execução, revisão ou ajustes. Bloqueio e pausa não são atraso operacional. O prazo vencido do chamado é um alerta separado sobre a data de entrega comprometida.

O painel é a primeira aba permitida quando demands.read e tasks.read estão presentes. Abrir um item reutiliza a tela de detalhes existente, com suas verificações de acesso. Estados de erro e atualização não mostram números inventados nem dados desatualizados como se fossem atuais.

## Consequências

Não há migração, serviço externo, percentuais de capacidade presumida ou mudança no fluxo de pausa. Listas limitadas podem não mostrar todos os itens; a interface informa total e limite. A janela de três dias é fixa nesta fase. O contrato detalhado está em PHASE4-IMPLEMENTATION-CONTRACT.md; esta decisão não afirma implementação ou aprovação dos testes.
