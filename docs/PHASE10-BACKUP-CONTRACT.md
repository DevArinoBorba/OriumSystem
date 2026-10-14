# Fase10 — backup externo GoogleDrive

Codex,14/10/2026. Responsável confirmou “sim vamos usar o google drive”. AgenteCofre(OpenCode) criado para esta frente independente; não substitui Antigravity operacionalVPS, OpenCode entrega ou QA provas.

## Ownership e implementação

Cofre owns deploy/backup/, docs/PHASE10-BACKUP-RESULT.md e .local/phase10/cofre/ somente helpers sem segredos. Segredos/credenciais/chave de recuperação em armazenamento protegido fora do repositório, por exemplo diretório do usuário .local/orium-backup com ACL exclusiva; nunca copiar conteúdo para mensagens/logs/artefatos. Demais código/config/migrations/produçãoREADONLY. MutaçãoVPS somente após checkpoint Codex e janelaoperacionalAntigravity.

Implementar dumpconsistente PostgreSQL formato custom, manifesto/chaves de recuperação/confignecessária protegidos, checksum e inclusão apenas do projeto próprio. RcloneDrive + crypt com nomes/conteúdo criptografados antes sair daVPS; pasta exclusivaOriumSystem, acessoOAuthmínimo compatível. Verificar fontes oficiais atuais. Nunca sincronizar/deletar a raizDrive, nem enviar dumpplaintext/chavedecriptografia ao destino junto do backup.

Defaultoperacional proposto: execução diária03:00America/Cuiaba, RPO24h, retenção30dias apenas arquivos do projeto criados pelo próprio mecanismo e jáconfirmadosremotamente. Registrar como parâmetro alterável; antes habilitar remoção, provar dryrunnegative/allowlist/destinoisolado. Manter backupnovo até upload+verificação/downloadrestorecomprovados; falhaupload não apaga únicacópialocal. Inicialização sem remoção remota do acervoexistente. Locksingleflight, timeoutreal, exitfailclosed e freshness/resultado sanitizados para monitoramento. Não imprimir args que contenham senha, tokens ouURLsDB.

## Autenticação humana

Preparar OAuth em navegador para o responsável, sem solicitar senha/token por chat. Capturar tokens diretamente em arquivo protegido; terminal só mostra URLpública de autorização/status. Caso callbacklocal use serviço/porta, PORT_POLICY/Find-FreePort previamente e flagcomprovada do CLI; não inventar flags/bindpúblico. Conferir expiração/revogação e limitação de projetoOAuth testing, não chamar agendamento permanente com token de sete dias sem registrarlimite. EscopopreferidoDrive.file/pasta criada pelo app quando suportado. Não usar conectores de leituraDrive como substituto de credencial para automaçãoVPS.

## Verificação e continuidade

Primeiro checkpoint: scripts executáveis/contratos/interface revisáveis, crypto local roundtrip e falhas reais sem OAuth. Avisar Codex que conexão humana está pronta com próximos passos exatos; não iniciar mutaçãoVPSautônoma concorrente. QA owns testeisoladorestore e fará download/decrypt/restorecontra volumeexclusivo depois autorizaçãoefetiva. Antigravity owns instalaçãooperacionalVPS/janelas; coordenar diretamente. Codex revisa scripts+OAuth/segredos antes liberar produção. Gatebackup externo exige uploadreal, list/downloadreal, checksum/decriptação/restauração e chave recuperável foraVPS; comandoenfileirado/sintaxe não constitui PASS.

Cada agente aplica AGENTS/AGENT-AUTONOMY/skillPostgres; início/evidências/conclusão exclusivamente própria seçãoCofre da notaexistente viaedit (pode inserir seçãoCofre sem mudartexto de colegas). Relatório até10linhas via helperbackground aoCodex. Sem nota nova/notewrite/releituraintegra repetida/provedor novo pago ou alteraçãoNegócio.
