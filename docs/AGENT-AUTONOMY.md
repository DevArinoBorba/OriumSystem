# Protocolo de autonomia — OriumSystem

Determinação do responsável, 2026-10-06. Objetivo: executar contratos completos com menos intervenções do Codex, preservando evidências e limites existentes.

## Contrato curto de delegação

Toda tarefa informa objetivo, dono, arquivos permitidos, dependências, critérios de aceite e verificações. A instrução de início/evidências/conclusão na própria seção de `oriumsystem-acompanhamento` é obrigatória. Contratos de fase são a fonte de verdade; não reenviar contexto inteiro quando um link e o trecho alterado bastam.

## Ciclo do agente

1. Confirmar escopo e registrar início uma vez. Ler contexto/skills obrigatórios só quando ainda não carregados; buscar símbolos e trechos necessários.
2. Implementar o menor resultado verificável. Não gastar a tarefa inteira em preparação ou releitura.
3. Executar verificações pertinentes. Corrigir autonomamente tipos, imports, configuração local, quoting, seletores, fixtures e falhas relacionadas à própria alteração. Não pedir autorização para essas correções.
4. Em divergência entre componentes, comunicar diretamente ao dono: arquivo/símbolo, comportamento esperado, evidência e correção necessária. O dono corrige; não editar arquivos concorrentes. Seguir com trabalho independente enquanto aguarda.
5. Entregar resultado e evidências curtas. PASS exige execução real do critério, nunca sintaxe, artefato existente ou exit0 isolado. Codex revisa o aceite final.

## Escalar somente o que precisa do coordenador

- Regra de negócio sem resposta nas decisões existentes.
- Mudança de arquitetura, novo serviço/integração, migração não prevista ou alteração de autorização.
- Risco real a segredos, contas/dados reais, outro projeto, publicação ou ação irreversível fora do escopo.
- Impedimento persistente após três tentativas com hipóteses distintas, indicando causa, evidência, alternativas e trabalho independente que continua.

Pedir ajuda não transfere automaticamente a tarefa nem autoriza mudar assertions. Corrigir sozinho não autoriza apagar dados ou flexibilizar regras para obter PASS. Portas seguem a política global, inclusive em testes. Serviços de outro projeto nunca são encerrados.

## Comunicação e retomada

`maestri list` confirma nomes. `maestri ask` é bloqueante até o destinatário ficar ocioso. Para aviso de marco, correção ou entrega, preferir `node scripts/maestri-send.mjs --agent "Nome" --message-file caminho.txt`: enfileira o comando em background, sem interromper a implementação. O arquivo deve conter somente mensagem sanitizada. O helper retorna ID e caminho de recibo; estado queued é apenas enfileiramento local, não entrega ou leitura confirmada. Verificar recibo no checkpoint seguinte. Em falha Maestri executar debug primeiro e registrar o impedimento, sem reenviar cegamente.

Evitar perguntas síncronas recíprocas entre agentes. Publicar contratos em arquivo primeiro; avisar os colegas e seguir. Não esperar pelo término inteiro do frontend para continuar backend. Não aguardar resposta a relatório final para liberar o próprio turno.

Consultar progresso apenas quando houver dependência concreta, novo evento, atraso real ou checkpoint combinado. Não fazer loops de check/leituras iguais. Se duas leituras não acrescentam fatos, mudar para uma hipótese específica. Após três falhas com a mesma causa, mudar estratégia. Rechecks verdes apenas após mudança, falha ou preocupação objetiva.

Manter até um build por pacote em execução. Avisar checkpoint estável antes de outro agente executar integração. Não compilar dist do colega enquanto ele edita/compila. QA pode preparar fixtures/runner sem iniciar suites contra implementação incompleta.

No próximo checkpoint, se contexto estiver ficando longo, registrar handoff curto: tarefa, arquivos alterados, checks/resultados, pendências e próximo comando. Compactar/retomar pela ferramenta oficial, sem reler arquivos estáveis. Antigravity usa acesso sem confirmações já autorizado e ID exato ao retomar com múltiplos terminais: `agy --conversation=<id> --dangerously-skip-permissions`.

## Formato da entrega

Até dez linhas, com detalhes no relatório do projeto:

```text
Tarefa: <objetivo>; estado: concluída|em andamento|bloqueada.
Arquivos: <lista curta>.
Verificações: <comandos + exit/status + contagem real>.
Evidência: <relatório/recibo/capturas duráveis>.
Pendências: <nenhuma ou limites reais>.
Nota: <seção própria atualizada>.
```

Este protocolo não é um serviço de execução contínua nem garantia quantitativa de economia de tokens. Torna explícitas as decisões operacionais que cada agente deve resolver dentro da tarefa, com revisão final preservada.
