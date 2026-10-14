# Fase 4 — revisão de coordenação em andamento

Não é relatório de aprovação. Atualizado em 2026-10-07.

## Retomada de 2026-10-07

Os artefatos da rodada de 2026-10-06 registram 20 testes de integração e 9 casos de navegador aprovados. Isso é evidência histórica, ainda sujeita à revisão das asserções. A Fase 4 permanece em homologação; não repetir as suítes verdes sem alteração ou preocupação concreta.

Revisão atual do runner identificou lacunas adicionais, encaminhadas ao Antigravity QA com ownership exclusivo:

- P4-BR-03 aceita um contêiner genérico de detalhes. Exigir identidade e título do destino efetivamente carregado, tanto para tarefa quanto para chamado.
- P4-BR-04 verifica texto de horário que pode existir antes do clique. Comprovar nova requisição/resposta aplicada e estado de carregamento.
- O critério de teclado do contrato não aparece na rodada: verificar foco e ativação por teclado com resultado esperado no DOM.
- `collectLogs` tolera falha de captura com aviso; a ausência de captura não pode resultar em `logsClean: true`.
- Capturas têm caminhos nulos. Overflow e DOM não comprovam aprovação visual. A causa do timeout não foi diagnosticada de maneira conclusiva; minimização/DWM são hipóteses, não fatos comprovados.

Antigravity recebeu verificação da saúde atual de DEV e eventual restauração segura, sem disputa do portal e sem alteração de contas ou dados. OpenCode mantém ownership do frontend; qualquer falha funcional descoberta deve voltar ao dono. Sem aceite de fase, migração nova ou publicação nesta retomada.

Checkpoint de DEV: Codex confirmou independentemente listener API 3002/PID 67324 e WEB 5173/PID 26472 com caminho deste projeto na linha de comando, HTTP 200 em `/health/ready` e HTTP 401 em `/api/v1/dashboard` pelo proxy 5173. A restauração de DEV está verificada neste checkpoint; homologação do painel continua pendente. Evidências operacionais detalhadas em `PHASE4-DEV-ACTIVATION.md`.

## Achados iniciais

Revisão da entrega de QA de 2026-10-07: relatório registra 24 testes de integração e 10 casos browser PASS. **P4-BR-KB recusado**: o runner injeta `__keyboardA11yBridge`, listener global que converte keydown em `.click()`. Isso modifica o comportamento da aplicação e não demonstra ativação nativa por teclado. Exigir execução sem bridge; limitação da ferramenta deve ser registrada honestamente. P4-BR-04 ainda precisa comparar o horário/dados apresentados à nova resposta recebida. P4-BR-CLN deve comprovar encerramento/liberação e restauração real, sem tratar falhas ignoradas como sucesso. Correções devolvidas ao QA, sem repetir integração verde. Homologação visual continua pendente.

Rodada corrigida iniciada em 2026-10-07T15:45Z: 8 PASS e 2 FAIL. Navegação tarefa/chamado verifica os títulos esperados; atualização compara exatamente o horário do DOM à nova resposta; console exige captura ativa. Sem bridge, Enter/Space não acionaram ações pelo portal (P4-BR-KB FAIL; limitação de automação a diagnosticar, sem aprovação nativa). P4-BR-CLN FAIL por `apiPort is not defined` na verificação dos listeners; portal restaurado, leases liberados e fixtures limpas reportados, mas encerramento não comprovado. QA corrige a variável e deve verificar o encerramento real. A rodada 10/10 anterior não serve como aceite de teclado/teardown.

Backend inicial usa snapshot REPEATABLE READ READ ONLY, revalida usuário ativo/papéis/permissões e aplica atribuição antes de selecionar tarefas. DATE::text evita deslocamento do prazo pelo parser. Contadores são calculados no servidor antes do limite. Revisão final e execução ainda pendentes.

Pendências encaminhadas aos donos:

- Backend: query Zod estrita; status validado pelos enums existentes; itens task exigem taskId e startedAt (nullable), sem aceitar tarefas incompletas. Confirmar com versões finais e checagens.
- QA: substituir schema local flexível pelo compartilhado; conferir corpo bruto para vazamento. Limpeza usa Database.pool, colunas SQL user_id em auth_session/auth_account e encerramento garantido em finally. Evitar any no teste e validar lint.
- QA: testar janela +1 até +3, excluir +4, hoje separado, virada de calendário e meia-noite Cuiabá por now injetável/helper real, sem fake timers globais de autenticação. Testar revogação de acesso e carga protegida por users.read.
- Frontend: usar tipos realmente exportados (DashboardResponse['scope'] e keyof DashboardResponse['sections'] quando necessário); integrar navegação sem perder estado ou quebrar autorização existente.
- Evidências: copiar capturas reais para caminho durável da Fase 4 e abrir arquivos para revisão; erro de captura é limitação, não aprovação visual. Não modificar evidências arquivadas da Fase 3.
- Runner QA inicial: P4-BR-05 continha condição sempre verdadeira e PASS fixo; P4-BR-04/06 não lançavam falha para resultado falso. Homologação recusada até simulação real de erro/retry e assertions executáveis em cada caso. Gate exige IDs únicos 01..08+CLN presentes e aprovados. Não houve aceite desta versão.
- Runner QA: remover credenciais fixas, validar configuração TEST em memória, ler política antes startup, usar ReleaseLeaseId e comprovar encerramento/liberação no teardown. Não imprimir conteúdo de conexão ou respostas arbitrárias.

## Ambiente observado

Após o responsável responder `ok`, Codex tentou novamente `portal screenshot`: timeout. `maestri debug` confirmou transporte saudável (200); diagnóstico DOM retornou `visibility: visible`, `hidden: false`, `ready: complete`, viewport 1280x791, sem foco. A alternativa documentada `portal check` também falhou (exit 1); debug executado após a falha. Não há prova de minimização como causa. Diagnóstico objetivo da ferramenta delegado ao QA, sem repetir suíte ou alterar o produto.

Checkpoint final desta retomada: rodada de 2026-10-07T15:49:57Z registra **9 PASS / 1 FAIL**. P4-BR-CLN aprovado após correção do escopo das variáveis: URL do portal, listeners encerrados, leases liberados e fixtures limpas comprovados pelo runner. P4-BR-KB permanece FAIL sem bridge: foco funciona, mas Enter/Space pelo portal não acionam as ações esperadas. Isso exige verificação nativa/manual ou solução da limitação de automação; não autoriza alterar o produto para fazer o teste passar. Capturas válidas também pendentes. Integração: 24 PASS reportados e casos adicionais revisados; sem repetição desnecessária. Fase 4 permanece em homologação, impedida de aceite final por teclado e visual.

Root encontrou somente WEB 5173 ativo; API DEV 3002 sem listener e PID64256 registrado inexistente. Isso invalida qualquer afirmação de saúde atual baseada apenas no relatório histórico. Restaurar API com build validado, política de portas, prova de processo e readiness antes de encerrar. Não tocar contas reais nem processos sem propriedade comprovada.

## Limitação de escala a avaliar

A versão inicial seleciona todas as tarefas abertas do escopo para classificar no servidor; não há N+1 nem agregação no navegador. Os resultados limitados não limitam a leitura em memória do backend. Registrar esta característica honestamente; otimização por agregações SQL poderá ser necessária com volume maior. Não confundir lista limitada com leitura limitada do banco.
