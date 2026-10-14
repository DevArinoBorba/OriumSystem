# Fase 7 — contrato de ativação DEV e encerramento

Coordenação Codex #2. Execução operacional Antigravity após liberação explícita do gate; verificação independente da coordenação. Autorização do responsável: continuar até concluir Fase7. Preparação documental não libera execução antes dos gates abaixo.

## Gates

1. Incremento1 aceito TEST (já registrado).
2. Fundação API/sessão/visibilidade/privileges: suíte real Incremento2 e correções da revisão conferidas.
3. Geração transacional e calendário: Incremento3 implementado/testado conforme contrato e revisado; sem alteração do RBAC ou dados operacionais antigos.
4. Homologação API+UI no portal visível após revisão do runner: testes executados com dados exclusivos TEST, capturas reais desktop/mobile inspecionadas e console, teclado nativo comprovado ou limitação distinguida sem inventar PASS. Não reutilizar aprovação manual de outra fase como aceite desta superfície.
5. Cleanup TEST rastreado e baseline grants/histórico preservado, serviços temporários encerrados e portal restaurado.

## Execução quando liberada

Aplicar PORT_POLICY e Find-FreePort para cada serviço necessário; comprovar propriedade dos listeners/containers já ativos e reutilizar somente o próprio projeto. Não presumir PIDs/portas de relatórios antigos. Coordenar exclusividade de builds/TEST e garantir nenhum dono editando os artefatos publicados.

Antes da alteração: registrar snapshot sanitizado DEV de tabelas de negócio/usuários/roles/credenciais locais presentes, histórico e journal; backup consistente do banco e artefatos dist/configuração efetivamente alterados, sem imprimir segredos. Backup somente local sob .local/phase7/dev/ com metadados seguros. Nenhuma fixture de TEST em DEV.

Build único dos pacotes afetados no checkpoint final; usar artefatos atuais, não dist desatualizado. Migration0005 em orium_dev com papel migrator separado, somente mudanças previstas pelo contrato. Não apagar/recriar banco/volume, resetar grants globais ou aplicar seed de usuário.

Reiniciar somente API/web do próprio projeto que precisem usar novos artefatos. Processo persistente com janela oculta, caminho absoluto do projeto, PID/porta identificados e segredo via ambiente preservado. Atualizar proxy/Origin coerentemente se porta antiga indisponível; não liberar porta matando outro projeto. Não expor novos binds públicos. Serviços de projetos vizinhos intactos.

Verificar readiness e headers, API/proxy não autenticados 401, rota nova publicada, configurações de web/API coerentes e baseline de negócio/contas/grants/histórico antigo preservado. Mudança em auth_session por startup/autenticação legítima deve ser descrita; não fingir snapshot byte a byte inteiro se a verificação compara apenas campos selecionados. Tabela notification é nova e pode receber alertas pessoais legítimos quando consultada; não comparar sua contagem como dado preexistente.

Se falhar: diagnosticar causa, restaurar artefatos/configuração/serviço próprios para estado saudável usando backups, preservando dados/migration aplicada. Não DROP notification ou outras tabelas para rollback de publicação; não perder leitura/avisos. Registrar situação e não marcar fase concluída.

## Evidências de encerramento

Relatório docs/PHASE7-DEV-ACTIVATION.md com execução, exit codes, migration/grants, identidade de serviços, baseline antes/depois, backup local e limites. Codex confere readiness/API/proxy e artefatos de baseline independentemente, registra docs/PHASE7-CLOSURE.md e atualiza somente fase atual/checklist geral/ROADMAP com evidências dos gates reais. Fase6 Bitwarden externo e pendências históricas Fase4 permanecem registradas separadamente; fechar Fase7 não as apaga.

Cada agente registra início/evidências/conclusão só na própria seção de oriumsystem-acompanhamento. Sem publicação externa, SMTP/WhatsApp/push ou integrações/cofre declarados. Encerramento descreve central interna de notificações, geração por ações novas e calendário materializado oportunisticamente ao consultar a caixa pessoal, sem cron nem garantia de entrega fora do sistema.
