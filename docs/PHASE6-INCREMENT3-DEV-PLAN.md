# Fase 6 — ativação DEV do incremento 3

Coordenação Codex #2, 13/10/2026. Plano condicionado ao aceite do código e das evidências de TEST; não declara execução ou conclusão da fase.

## Gate

OpenCode mantém ownership de `clients.ts`, `app.ts`, suíte e relatório conforme `PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md`. O aceite requer typecheck/lint focal e testes PostgreSQL reais em `orium_test`: quatro mutações, permissões específicas, revogação em ambas as ordens, conflitos e rollback. Barreiras precisam observar os locks no banco atual; fixtures e permissões temporárias devem ser restauradas. Revisões READONLY do checklist e da segurança ajudam o gate, mas não substituem execução.

## Execução depois do gate

Antigravity executará a ativação, quando receber o aceite explícito da coordenação. A autorização do responsável para continuidade da fase abrange essa tarefa; não solicitar confirmações mecânicas. Ownership operacional: novos helpers próprios em `.local/phase6/increment3-dev/`, relatório `docs/PHASE6-INCREMENT3-DEV-ACTIVATION.md` e sua seção da nota. Não editar código, migrations, schemas, contratos ou dados de negócio.

1. Ler `PORT_POLICY.md`, conferir todas as portas necessárias com `Find-FreePort.ps1` e comprovar identidade dos processos e containers antes de reutilizá-los. Preservar serviços de outros projetos. Porta ocupada por outro serviço exige alternativa e URLs/proxy/Origin coerentes no próprio projeto.
2. Conferir somente metadados sanitizados de DEV: migrations, contagens de tabelas de negócio, duas contas administrativas ativas com credenciais presentes, grants e estado de prontidão. Não imprimir `.env`, URLs de banco, senhas, hashes ou cookies. Registrar snapshot antes para comparação.
3. Preservar uma cópia privada dos artefatos API atualmente implantados e do registro de startup para rollback. Nenhuma migration é necessária neste incremento; não executar migrate, bootstrap, recovery, fixtures ou cleanup em DEV.
4. Confirmar que OpenCode encerrou seus builds/testes e liberou os arquivos. Executar apenas o build necessário de API; foundation/contracts somente se houver dependência efetiva. Manter um build por pacote.
5. Substituir somente o processo comprovadamente deste projeto, conservando configuração e segredos. Startup com caminho absoluto e janela oculta; registrar PID/endereço/porta sem segredos. Se o processo anterior estiver ausente, iniciar diretamente após a verificação de porta.
6. Verificar prontidão HTTP 200, cabeçalhos de segurança, endpoints de clientes e auditoria anônimos com 401 na API e pelo proxy. Não usar credenciais reais nem criar clientes de teste em DEV.
7. Comprovar persistência do processo em outra invocação e snapshot depois igual ao anterior para dados/contas/grants/migrations. Em falha, restaurar apenas os artefatos e o serviço deste projeto e registrar a falha sem afirmar aceite.
8. Atualizar somente a seção Antigravity na nota contínua; entregar relatório sanitizado à coordenação, que verificará as evidências antes do aceite DEV.

## Limite da fase

O Bitwarden oficial foi escolhido com hospedagem posterior pelo responsável (ADR-0006). Instância, formato real da referência e acesso de teste ainda não existem nos documentos recebidos. Não presumir Bitwarden Cloud, provisionar infraestrutura ou afirmar abertura/autorização no cofre. Este incremento não encerra sozinho os critérios externos da Fase 6 nem resolve as pendências históricas da Fase 4.
