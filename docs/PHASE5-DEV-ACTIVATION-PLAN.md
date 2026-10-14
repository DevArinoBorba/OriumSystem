# Ativação DEV — Materiais

Plano operacional, não evidência de execução. Executar somente depois do aceite técnico da migração e testes pertinentes pelo Codex.

1. Confirmar configuração em memória: banco local orium_dev, migrator/app separados, sem imprimir URLs, senha, .env ou loadConfig. Consulta readonly antes: migrations aplicadas, contagens de entidades e contas reais ativas/credenciais presentes como booleanos, sem hashes ou dados privados.
2. Revisar 0003_materials.sql/journal/schema/grants. Migração aditiva somente: novas tabelas/índices/permissões; sem fixtures, resets, recover, DDL destrutivo ou alteração de dados de clientes/tarefas. Usar migrador oficial e seu lock; não reaplicar SQL manualmente sobre migration registrada.
3. Build validado e estável de contracts/API/web, sem compilar enquanto outro agente edita. Guardar registro sanitizado dos processos atuais e comprovar caminho absoluto do projeto antes de qualquer substituição do serviço próprio.
4. Antes de startup ler PORT_POLICY e executar Find-FreePort para cada porta. Reutilizar WEB/API apenas com propriedade comprovada; nunca encerrar outro projeto. Se fallback, alinhar configuração local, Origin, proxy e portal. Liberar apenas leases próprios em finally.
5. Aplicar migração oficial em orium_dev após gate. Consulta readonly após: journal0003/tabelas/permissões esperadas, contas reais preservadas e contagens anteriores intactas. Não cadastrar fixtures em DEV para provar UI.
6. Substituir apenas API comprovadamente deste projeto; iniciar por caminho absoluto, manter persistência, validar readiness200, proxy/auth401 e rota Materiais registrada. Autenticação e ações funcionais continuam comprovadas no ambiente TEST; abrir portal DEV restaurado sem pedir nem revelar credenciais reais.
7. Documentar migration/builds/checks/propriedade/readiness/portas/contas preservadas em PHASE5-DEV-ACTIVATION.md e seção própria da nota. Não declarar E2E, captura visual, teclado nativo, timeline ou integração externa concluídos sem suas provas.

Em falha de migração, registrar estado real e diagnosticar sem excluir tabelas/dados ou manipular journal. Em falha de startup, manter dados e usar processo próprio anterior compatível quando viável, com prova de propriedade; nunca remover migration aplicada apenas para obter status verde.
