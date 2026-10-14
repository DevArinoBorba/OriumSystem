# Fase 10 — contrato de execução coordenada

Codex principal, 14/10/2026. Responsável autorizou desenvolver/concluir com vários agentes; Fases8–9 adiadas. Usar equipe existente: OpenCode, Antigravity, Antigravity QA e Sentinela (Claude). Codex decide arquitetura, segurança, regras e aceite. Não encerrar com gates externos apenas propostos.

## Objetivo e arquitetura preservada

Tornar a publicação existente reproduzível, operável e recuperável: VPS/Docker/PostgreSQL, proxyHTTPS, backups/restauração, monitoramento/logs, staging, entrega automatizada e rollback. Preservar Fastify/React/PostgreSQL, dados/contas e serviços vizinhos. Publicação anterior em /data/orium/production com aliasSSH orium-vps é insumo, não prova atual. Sem mobile/IA/Hermes/Bitwarden neste contrato.

## Primeira janela — inventário sem mutação externa

- Antigravity: verificar VPS via SSH aliasexistente, containers/redes/volumes/health, permissões de arquivos sem conteúdo, releases/proxyCoolify, espaço, timers/backups existentes e mecanismo de acesso. Relatório exclusivo docs/PHASE10-LIVE-INVENTORY.md. Helpers exclusivos .local/phase10/antigravity/. Sem env, dockerinspectEnv, senhas, mudançaVPS, reboot, reset, firewall/DNS ou instalação nesta janela. Codex libera a execução operacional após revisar inventário.
- OpenCode: ownership deploy/operations/ e .github/workflows/ (novos), docs/PHASE10-DELIVERY-RESULT.md. Implementar tooling de empacotamento com allowlist sem secrets/fixtures/distobsoleto, manifestos/hash, preflight e release/rollback; pipeline verificável localmente com gates failclosed. Não modificar deploy/production existente até contrato refinado por Codex. Nenhuma execução/mutaçãoVPS ou pushes. CI externo real depende de repositório/credenciais verificáveis; YAML sozinho não aprova CI.
- Antigravity QA: ownership deploy/verification/ (novo), tests/phase10/ (novo), docs/PHASE10-QA-RESULT.md. Preparar e executar provas locais reais de backup/restore isolado, verificação de manifestos/rollback negativo e probesHTTPS/API; aguardar interface de scripts OpenCode e baseline do inventário para provas integradas. Não restaurar sobre DEV/TEST/produção, criar usuário real ou acessar senha de administrador. Provar isolamento antes de restore; PORT_POLICY/Find-FreePort para cada serviço temporário. Sem backend/frontend existentes ou suite ampla concorrente.
- Sentinela/Claude: ownership docs/PHASE10-SECURITY-REVIEW.md somente; demais arquivosREADONLY. Revisar superfícies de deploy/segredos/RBAC/proxy/backup/restore/rollback/CI e critérios de aceite, com achados concretos e severidade. Pode consultar SSH exclusivamente read-only e fontes primárias oficiais; não duplicar inventário inteiro ou acessar configsecreta. Nenhuma mutação de host/repos/contas.

## Dependências e gates

1. Inventário real e baseline seguro; um executor operacionalVPS por vez.
2. Backup consistente com checksum, permissões restritas, criptografia antes de envio externo, retenção isolada na pasta do projeto e recuperação da chave fora daVPS. Destino externo em decisão; GoogleDrive/rclonecrypt proposto. Sem upload ou apagar backups remotos antes autenticação/definição efetivas. Guardar segredo só em configuração protegida, nunca argv/log/prompts/repo.
3. Restore real em banco/volumeisolado, verificação de schema/grants/contagens/fingerprints e health. Nunca DROP ou restore no volumeativo para simular teste.
4. Release com imagemidentificável, migrationone-shot separada, readiness antes servir, rollback aplicação sem downgrade/drop do schema, compatibilidade verificada e backups mantidos.
5. Stagingisolado, com secrets/banco/volumes próprios, sem copiar dados reais desnecessariamente. DNS/serviços de outros projetos intactos. Se novo domínio/custo estiver indefinido, escalar negócio e seguir independente.
6. Logs limitados/redigidos, health real e alerta com destino confirmado; não inventar entrega de alerta. Monitorar falha de backup e falta de freshness, não só saúdeHTTP.
7. Login/fluxo real autorizado em portalvisível; credenciais inseridas pelo responsável quando necessário. ContaMoniqueprodução depende de procedimento seguro definido, não inventar senha nem enviar credenciais.
8. CI/CD realmente executado no repositório/provedor existente; sem acesso externo, registrar impedimento e testar pipeline local sem alegar CIcloud.
9. Codex revisa artefatos, resultados reais e riscos antes de docs/PHASE10-CLOSURE.md/ROADMAP.

## Autonomia e comunicação

Aplicar AGENTS.md e docs/AGENT-AUTONOMY.md. Cada agente registra início/evidências/conclusão ou impedimento EXCLUSIVAMENTE na própria seção de oriumsystem-acompanhamento via noteedit, nunca notewrite/nota nova. Comunicação pelo scripts/maestri-send.mjs em background, destinatárioCodex; queued não é entregue. Notificar pares sobre interfaces/ownership, sem bloqueio síncrono recíproco. Entrega até10linhas com arquivos, comandos/exit/contagens, provasduráveis e limites reais. Nenhum PASS por sintaxe/fakeassertions/catchsilencioso. Não repetir leituras estáveis ou suites verdes sem motivo; helpersmultilinha em arquivos, nunca quotingarriscado. SkillPostgres antes SQL/restore; consultar fontesprimárias atuais para ferramentas/plataformas quando aplicável. Não imprimir configs/URLsDB/chaves/tokens ou conteúdo de dumps.
