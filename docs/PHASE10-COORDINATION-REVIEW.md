# Fase 10 — revisão e decisões Codex

14/10/2026. Trabalho em execução; nenhum aceite final ou mutação VPS liberada neste checkpoint.

## Achados confirmados

- ProvaHTTP read-only da coordenação12:18:46UTC: HEAD https://app.oriumdigital.tech retorna200/Cache-Controlno-store/Servernginx, sem HSTS/X-Content-Type-Options/X-Frame-Options/Referrer-Policy. `deploy/production/nginx.conf` define esses headers no server, mas locationindexhtml define apenas Cache-Control. Revisão de causa por Sentinela; correção e verificação real antes deploy.
- `apps/api/src/config.ts` exige hostnameapp em NODE_ENVproduction e impede stagingHTTPS num hostnamepróprio. Evoluir apenas para allowlist explícita de origens de aplicação/staging, sem remover proteção de local/topologia ou aceitar hosts arbitrários. Validação independente dos protocolos/origemsempath e coerência daAPI/web. Migrações/schema de negócio preservados.
- `apps/api/src/app.ts` trustProxyproductiontrue e nginx sobrescreveXForwardedFor comremote_addr. Isso impede assumir spoofexterno só pelo booleano, mas perde IPreal do cliente atrásproxyCoolify e pode agrupar rate-limit. Definir fronteira de confiança baseada na topologia real antes mudar cabeçalhos; não confiar em XFF arbitrário recebido daInternet.

## Entregas esperadas e dependências reais

Backup externo: GoogleDrivecriptografado foi proposto ao responsável, aguardando escolha/autorizaçãoOAuth; preparar interface sem enviar arquivos antes da conexão. Chave de recuperação fora daVPS, rotina de dumpconsistente e download/restore real são gates. Sem destinoautenticado não declarar backup externo.

CI/CD: workspace não possui .git/remote inicialmente observado; solicitado endereço do repositório. Toolinglocal e YAML podem avançar, mas execuçãocloud real depende de origem/autenticação. Não criar/reconfigurar conta/assinatura arbitrária.

Staging: banco/secrets/volumes exclusivos. Nome técnico proposto staging.oriumdigital.tech; verificar disponibilidade e infraestruturaDNSexistente antes publicação. Não mudar domínioativo/serviçosvizinhos. Sem cópia de dadosreais para fixtures ou restore no volumeativo.

Monitoramento: logs limitados e health/freshness de backup/resultado dos timers. Destino de alerta externo depende de canal realmente confirmado; registrar falha local não é entrega de alerta ao responsável.

Contrato de execução em PHASE10-IMPLEMENTATION-CONTRACT.md. Primeira janelaVPS somenteleitura; operacional liberado pela coordenação após inventário/backup e especificação concreta, não por mensagemqueued.
