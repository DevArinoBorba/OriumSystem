# Fase 5 — Revisão Codex

Sem aceite final. Backend e interface implementados, em revisão e validação.

Achados objetivos:
- materials.ts calcula isAdmin da sessão sem revalidar usuário ativo, papéis e permissões no banco dentro da operação. Exigir padrão de identidade/locks existente, antes de acessar ou mutar dados; leitura no snapshot e escrita com lock de identidade usado pelas operações administrativas.
- updateMaterial bloqueia somente material; atribuição da task vem de LEFT JOIN sem lock da tarefa. Revalidar task sob FOR SHARE compatível com reatribuição; não permitir escrita depois de uma reatribuição concorrente concluída. Demanda própria usa task bloqueada.
- getMaterialHistory autoriza em getMaterial numa conexão e depois consulta eventos sem snapshot. Autorização, contagem e lista precisam pertencer ao mesmo snapshot autorizado.
- MaterialsView carrega apenas page1/pageSize50 dos targets, sem acesso aos demais; catches silenciosos mascaram falha. Implementar paginação/pesquisa e erro/retry. Abortar e guardar respostas por seletor para impedir resultados atrasados após trocar cliente/chamado ou desmontar.
- Interface não pode usar papel administrator como bypass de materials.read/write/archive revogadas. Backend é autoridade; esconder ações pela permissão real e limpar dados após403.

Devolvidos aos donos dos arquivos. Testes de integração de Materiais atribuídos ao backend após correção; frontend preserva runners anteriores. Não ativar migration DEV até revisão e execução real contra orium_test.

Gate de integração: usuário não autenticado, papel/permissões forjados, usuário desativado e permissão revogada; CRUD administrativo; colaborador cria/edita próprio e recebe404 em tarefa de terceiro no mesmo chamado; material só de cliente e archive/restore negados ao colaborador; filtros/targets/contadores exatos sem terceiros e paginação >50; vínculos inconsistentes/imutáveis; URLs perigosas/credenciais rejeitadas sem fetch;409 preserva histórico e versão; auditoria transacional; reatribuição e corrida de escrita; histórico autorizado e contagem/lista consistente; limpeza apenas das fixtures próprias. Nenhum PASS baseado somente em build ou sintaxe.

Checkpoint: backend corrigiu identidade/locks/snapshot, frontend removeu bypass e adicionou seletores paginados/abort/erro. Primeira suíte registra27PASS, ainda em revisão: teste12.2 aguardava100ms como única prova de bloqueio e liberava conexão sem rollback no finally; exigir observação objetiva do bloqueio, reatribuição efetiva concorrente, validação de versão/eventos e rollback garantido antes de release. Complementos de sessão forjada e >50 alvos solicitados ao dono. Não considerar “27PASS” como gate completo até essas provas.

Checkpoint Codex — 08/10/2026:
- Gates backend revisados: 36 testes reais, incluindo bloqueio vinculado por pg_blocking_pids, rollback em finally, isolamento e paginação da timeline. Migração 0003 aditiva revisada; ativação DEV autorizada e executada pelo Antigravity, com backup e contagens preservadas. Readiness 200 confirmado independentemente pela coordenação.
- Frontend: cenários 01..12 e CLN passaram na rodada 13:19Z; tsc/lint/build verdes reportados. Correção loadTimeline revisada: identidade do AbortController protege success/catch/finally e rótulo anterior limpo. Aceite final ainda aguarda prova focal de gerações concorrentes/paginação/retry; o subteste inicial clicava botão disabled e não demonstrava a segunda request.
- Capturas desktop/mobile reais de 13:09Z examinadas por Codex, preservadas em .local/phase5-artifacts. Falhas de captura em rodada posterior não apagam essas provas; causa do timeout não foi estabelecida.
- Responsável confirmou manualmente teclado físico e interface com "tudo certo"; runner sintético permanece com FAIL histórico e não foi reinterpretado como PASS.
- Revisão Claude independente sem bloqueadores críticos; limitações descritas são hipóteses de escala/sem exploração comprovada, não defeitos de autorização novos.

Aceite final 08/10: provas focais corrigidas e executadas na rodada13:30:57Z, 14PASS/1FAIL sintético; teclado manual confirmado pelo responsável. DEV ativado com contas/contagens preservadas e readiness200 confirmado. Fase5 concluída; ver PHASE5-CLOSURE.md.
