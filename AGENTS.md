# Instruções para os agentes do OriumSystem

Leia PROJECT_CONTEXT.md e ROADMAP.md antes de modificar o projeto. Respeite a fase autorizada e as decisões de arquitetura existentes.

## Portas e outros projetos

Antes de iniciar serviços ou testes de navegador, aplique a regra global `C:/Users/arino/.maestri/PORT_POLICY.md` e use `C:/Users/arino/.maestri/Find-FreePort.ps1`. Portas ocupadas exigem alternativa livre com todas as URLs/Origin/proxy/Compose atualizadas de forma coerente. Nunca interrompa serviços de outro projeto para liberar portas. Os testes de navegador devem usar portal visível no canvas conforme pedido do responsável.

## Continuidade autorizada

Em 2026-10-05, o responsável autorizou continuar autonomamente pelas próximas partes até concluir o projeto. Não solicite nova autorização apenas para avançar de fase: essa instrução substitui proibições históricas de avançar sem novo pedido. Preserve os critérios de conclusão, registre evidências e mantenha o roadmap atualizado. Decisões de negócio ainda indefinidas devem ser esclarecidas; continue o trabalho independente enquanto aguarda. Não declare integrações, infraestrutura externa ou publicação concluídas sem acesso e verificação reais.

## Distribuição de trabalho e economia de tokens

Por determinação do responsável, Codex é o coordenador principal: responde pela arquitetura, planejamento, decisões que exigem raciocínio complexo, regras de negócio, segurança e revisão dos resultados.

Codex deve delegar ao OpenCode ou ao Antigravity todas as tarefas simples, mecânicas ou que não exijam alto nível de lógica. Exemplos: instalação e diagnóstico de ferramentas, execução de comandos e testes, correções pontuais de tipos ou configuração, implementação com especificação definida e atualização de documentação com evidências.

Use os agentes conectados pelo Maestri; execute `maestri list` para confirmar os nomes. Não crie agentes adicionais quando OpenCode e Antigravity atenderem à tarefa. Se estiverem indisponíveis, registre o impedimento e prossiga com o que for necessário para não bloquear o trabalho.

O responsável autorizou Antigravity com acesso total às ferramentas, sem confirmações por comando. Ao iniciar ou retomar o CLI para este projeto, use `agy --continue --dangerously-skip-permissions` (ou `--conversation=<id>` com a mesma opção). Preserve o escopo das tarefas e a proteção de segredos mesmo nesse modo.

Cada delegação deve informar objetivo, escopo, arquivos permitidos, critérios de aceitação e verificações. Peça uma resposta curta com arquivos alterados, resultado dos comandos e impedimentos, sem segredos. Evite reenviar tarefas em execução; consulte o estado do agente. Não permita alterações concorrentes nos mesmos arquivos.

Codex deve revisar os resultados e as evidências antes de aceitar a entrega ou marcar uma fase como concluída. Delegação não autoriza mudar arquitetura, inventar regras de negócio, avançar fases ou publicar em produção.

Não exponha credenciais em mensagens, logs ou documentação. Não sobrescreva configurações locais existentes nem remova dados para destravar testes.

## Autonomia operacional dos agentes

Por determinação do responsável em 2026-10-06, aplique `docs/AGENT-AUTONOMY.md` em toda delegação. Dentro do contrato e dos arquivos atribuídos, o agente deve implementar, diagnosticar, corrigir, verificar e documentar até entregar evidências, sem pedir ao Codex confirmação de comandos ou decisões mecânicas. Coordene incompatibilidades diretamente com o dono do arquivo; não assuma ownership do colega. Codex continua responsável por negócio, arquitetura, segurança e aceite final.

Notificações pelo Maestri não devem bloquear trabalho: `maestri ask` espera o destinatário ficar ocioso. Execute notificações em background com `scripts/maestri-send.mjs` (quando disponível) ou a execução em background da própria ferramenta, sem esperar a resposta para continuar tarefas independentes. Não invente `maestri tell` ou flags não documentadas. Atualize apenas sua seção na nota oficial e informe Codex em marcos verificáveis, conclusão ou impedimento real; evite mensagens de rotina e polling contínuo. Não declare envio concluído apenas porque o processo foi criado.

## Economia de contexto e diagnóstico

Por determinação do responsável, todo agente deve economizar tokens ao ler e diagnosticar código:

- Leitura integral de skill/contexto é obrigatória apenas na 1ª aplicação. Em reaplicações, consulte apenas o necessário.
- Em código, use busca por símbolo (`rg`) e leitura parcial (`GetContent` com Skip/First) em vez de reler o arquivo inteiro. Evite repetir a leitura integral de um mesmo arquivo estável.
- Se duas releituras não trazem fato novo, pare o ciclo de releitura e teste uma hipótese específica com assert/diagnóstico objetivo. Relate achados e limitações ao coordenador (Codex) sem pedir permissão mecânica para avançar.
- Após três falhas com a mesma causa-raiz, mude a estratégia de diagnóstico. Não finja passo (PASS) nem contorne asserções: registre a falha de forma honesta.
- Rode rechecks verdes somente após novas alterações, falhas ou preocupações reais. Documentação sozinha não justifica rerun de ferramenta/suite.
- Diagnóstico JS multilinha: use arquivo helper temporário ou `apply_patch` no lugar de insistir em quoting de `node -e` no PowerShell.
- Nunca imprima `loadConfig` inteiro, conteúdo de `.env`, URLs de banco ou senhas em logs/mensagens. Exponha apenas booleanos, nomes de campo ou status.
- Entregas devem terminar com resumo curto: arquivos alterados + checagens realizadas + pendências, e a seção própria na nota compartilhada.
- Não editar frontend/outros documentos nem rodar testes apenas por instrução reversível neste tópico.
- Exceções legítimas à economia de leitura: leituras obrigatórias (PORT_POLICY e regras deste arquivo quando aplicáveis) e arquivos que foram efetivamente alterados.
- Maestri `portal evaluate` pode retornar `stdout` com `Error:`/`error:` e exit 0 (root comprovou via throw readonly → `ORIUM_EVALUATE_DIAGNOSTIC`). Wrappers de avaliação devem rejeitar erros textuais do stdout, executar `maestri debug` PRIMEIRO em falha e validar o DOM/estado esperado após a ação — nunca considerar apenas exit 0 como PASS.

## Atualização obrigatória de notas compartilhadas no Maestri

Regra permanente solicitada pelo responsável: manter um único bloco de acompanhamento como na Fase 1, atualizando a fase atual e o checklist continuamente.
- A nota oficial única e contínua para todas as fases é `oriumsystem-acompanhamento` (renomeada automaticamente pelo Maestri a partir da nota inicial `fase-1-lista-do-maestro`, preservando conexões e histórico).
- É proibido criar nota nova por fase: o mesmo bloco acompanha todo o ciclo de vida do projeto.
- A coordenação (Codex) é responsável por atualizar o cabeçalho, a fase atual e o checklist geral.
- Cada agente atualiza **EXCLUSIVAMENTE** sua própria seção via `maestri note edit`, informando no início, no fim e em qualquer impedimento: tarefa atual, resultado verificável com evidências concretas, impedimentos e pendências/próximo passo.
- É expressamente proibido usar `maestri note write` para sobrescrever a nota inteira ou modificar seções de outros colegas.
- O histórico das fases anteriores deve ser preservado dentro da nota contínua.
- Não declarar runners, testes ou ferramentas aprovados apenas com base em verificações de sintaxe (`node --check`); validação real de execução E2E é mandatória.
- Toda delegação entre agentes deve incluir explicitamente a instrução de registrar início, evidências e conclusão na nota compartilhada.
