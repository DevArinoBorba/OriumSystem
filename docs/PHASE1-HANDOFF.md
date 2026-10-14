# Continuidade da Fase 1 sem Codex

Instrução explícita do responsável em 2026-10-05: os agentes devem continuar sem Codex enquanto seus tokens são renovados. Prioridade exclusiva: concluir integralmente a Fase 1. Preservar a Fase 2 existente, sem avançar fases nem inventar regras de negócio.

## Coordenação e fronteiras

- **Antigravity** assume a coordenação temporária, revisão de entregas e documentação. Pode orientar correções necessárias da fundação, preservando fronteiras de escrita. Não precisa esperar Codex para correções autorizadas, reversíveis e dentro desta fase.
- **OpenCode** conclui os testes de recuperação/concorrência, lockfile e verificações automatizadas. É dono de `tests/recovery.integration.test.ts` e `pnpm-lock.yaml` nesta etapa.
- **Antigravity QA** valida CLI em terminal real e autenticação em navegador visível. É dono de `.local/phase1-cli-*`, `.local/phase1-visible-*`, `docs/PHASE1-CLI-VALIDATION.md` e `docs/PHASE1-FINAL-BROWSER.md`.
- Ambos os Antigravity estão com acesso total. Os três agentes estão conectados entre si. Use `maestri list` para os nomes atuais e comunique diretamente entre colegas, sem depender de respostas do Codex.

## Estado real e próximos passos

1. Recuperação local implementada em `apps/api/src/recovery.ts`: `recoverUserAccess(database, {adminEmail, adminPassword, targetEmail, newPassword})`. Administrador ativo com `roles.manage` e senha atual; alvo ativo com credencial local; atualização do hash e revogação das sessões em transação sob `IDENTITY_LOCK`. Sem endpoint público, SMTP, MFA, reativação ou alteração de papéis. Perda das senhas de TODOS os administradores não é suportada por este procedimento.
2. `serializeIdentity` em `identity.ts` enfileira operações antes de tomar conexões. Login em `app.ts` mantém o mesmo lock entre verificação da senha e criação da sessão, evitando criação tardia de sessão com senha antiga. Revisar e comprovar com os testes de concorrência e fila; não retirar essas proteções para facilitar testes.
3. CLI valida banco/privilégios/estado vazio antes de solicitar senhas e revalida o estado vazio na transação. Entrada oculta absorve sequências de escape; Ctrl+C deve cancelar. Erros usam whitelist estática, sem imprimir mensagens arbitrárias de PostgreSQL/configuração.
4. Fastify atualizado para `5.12.5` nos manifests. Auditoria de produção já retornou zero vulnerabilidades em `.local/phase1-dependency-audit.json`. OpenCode deve confirmar instalação/lockfile e auditoria completa, incluindo desenvolvimento.
5. **Testes ainda em correção e sem aceite final**: OpenCode está aplicando `.local/phase1-review-findings.md`. Corrigir os cinco pontos, rodar typecheck/lint/build/suíte completa e auditorias pertinentes. Não usar skips. Conferir testes do último administrador, rollback real após atualização do hash e concorrência de login/recuperação. Reportar contagens reais, não reutilizar os antigos 45/64 como resultado desta rodada.
6. Somente depois de OpenCode liberar o banco, QA pode executar fixtures de CLI/browser. Confirmar `/orium_test`, loopback, protocolo PostgreSQL e usuário `orium_app`; preservar dados desconhecidos. Exigir zero usuários antes de testar bootstrap; limpar somente IDs/prefixos próprios em `finally`.

## Validação interativa e navegador

- Terminal atual: **`QA Entrada`**, conectado ao Antigravity QA. `node -p process.stdin.isTTY` retornou **true** no terminal real. O comando inline inicial perdeu aspas e falhou; foi substituído pelo probe simples. O terminal ficou no PowerShell. Não recriar terminais duplicados se ele ainda existir.
- Não aceitar shims que falsifiquem `isTTY`/`setRawMode` como evidência de ConPTY. O antigo `.local/phase1-cli-tty-shim.cjs` é um rascunho rejeitado e não deve ser usado.
- Executar o CLI oficial por arquivo no terminal real. O wrapper de teste deve permitir **apenas bootstrap/recover**; remover `migrate` da lista permitida, pois o CLI usa outra URL de migration e o guard do banco de teste não protegeria essa operação.
- Controlador deve esperar prompts NOVOS da execução atual, sem confundir texto antigo do histórico com o prompt atual. Gerar senhas de fixtures somente em memória; não imprimir entradas, argumentos de erro, hashes ou transcrições contendo segredos.
- Casos: cancelamento antes do commit, confirmação incorreta, sucesso com dois administradores/hash válido, recusa de bootstrap ocupado antes de pedir senha e recuperação local autorizada/recusada. Limpeza própria deve acontecer também nas falhas.
- Portal atual: **`Orium - Codex visivel`**. Testar login, área autorizada, logout e reload com backend recompilado. Nenhum headless, cookie injetado ou mock. Imports Better Auth locais são ESM `index.mjs`, não `index.cjs`. Preferir `provisionUser`/`connectDatabase` às transações feitas com `pool.query` em conexões potencialmente diferentes.
- Identificar os serviços próprios em `.local/test-pids.json`. A API anterior estava na porta 3001, Web na 5173. A API precisa ser reiniciada após o build para incorporar as alterações; não assumir que processo antigo está executando código novo.
- Ler `C:/Users/arino/.maestri/PORT_POLICY.md` e executar `Find-FreePort.ps1` antes de cada startup. Confirmar propriedade antes de reutilizar/parar processos. Ajustes estritamente necessários de porta/proxy/Origin/configuração local estão autorizados, preservando segredos. Nunca encerrar serviços de outros projetos.
- Bancos próprios: desenvolvimento em 55432, teste em 5433, conforme configuração vigente; confirmar antes de reutilizar. Não remover volumes.

## Contas reais e encerramento

- E-mails confirmados pelo responsável: Arino **arinoborba@gmail.com**; Monique **moniquiborges_5@gmail.com**. Usar exatamente esses endereços.
- As senhas devem ser escolhidas/digitadas pelo responsável localmente em entrada oculta (12–128 caracteres, com confirmação). Não pedir senhas no chat nem gerar senhas padrão ou inventar credenciais.
- Após o QA, preparar o terminal para `pnpm db:bootstrap` contra **orium_dev**, conferindo identidade, estado vazio e configuração. Preparar também a API de desenvolvimento e o portal coerentes com esse banco, para que as contas reais possam entrar. Não deixar o portal apontando para a API de TESTE e declarar as contas reais utilizáveis.
- O responsável só precisa fornecer as entradas pessoais que os agentes não possuem. Até esse cadastro ocorrer, manter a Fase 1 operacional aberta; pode registrar a conclusão técnica com essa pendência explícita.
- Antigravity deve consolidar README, TODO, relatório/encerramento da Fase 1, ADR-0007 e ROADMAP com evidências finais. As verificações antigas continuam históricas; remover divergências atuais sobre Docker, portas, recuperação e autorização de fases. Não afirmar auditoria formal ou ausência absoluta de falhas.
- Quando terminar, registrar um resumo curto em `docs/PHASE1-HANDOFF-RESULT.md`: arquivos alterados, checks/contagens/resultados, CLI/browser, limpeza, estado das contas reais e única próxima ação, se existir. Esse arquivo permitirá ao Codex retomar sem repetir verificações já concluídas.

Não esperar Codex para continuar o trabalho autorizado. Não encerrar a fase nem avançar enquanto restarem critérios da Fase 1 sem comprovação.
