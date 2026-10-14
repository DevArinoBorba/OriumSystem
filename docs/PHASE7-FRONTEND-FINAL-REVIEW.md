# Fase 7 — revisão final da interface

Codex #2, 13/10/2026. Estado: revisão estática e correções verificadas; homologação completa ainda pendente. OpenCode retomou a revisão e enviou checkpoint (ver seção OpenCode). Fechar o CLI não encerrou sua tarefa no servidor em background: houve uma versão transitória durante o QA com `markControllersRef` indefinido, registrada em `.local/phase7/frontend/native-keyboard-console.txt`. A sessão terminou com `outcome=succeeded`; a fonte final usa `markRequestsRef`. A rodada com esse erro não constitui aceite de console limpo.

## Correções funcionais

- App.tsx agora distingue HTTP403 na atualização do contador: remove o valor após revogação real, somente se a resposta ainda pertence ao flight atual. Erro de rede mantém o valor anterior. Callback401 de request cancelado/antigo não encerra uma sessão posterior.
- NotificationsView.tsx protege cada marcação com Map síncrono antes do render, evitando POST duplicado no mesmo turno. POSTs de itens diferentes usam controllers próprios, separados do GET. Cleanup aborta todas as marcações no unmount; respostas canceladas não disparam atualização posterior do contador ou callback401.
- Layout, textos, classes, estilos, navegação inicial, polling60s e mundo visual incumbente preservados. Abrir tarefa/chamado continua sem marcar leitura.

## Verificações

- ESLint focal dos dois arquivos: exit0.
- Web typecheck: exit0.
- Web build após correções: exit0, Vite122 módulos; assets index-gHg0_2oa.js/index-2EJNEWT8.css. Rebuild foi necessário pelas alterações funcionais, não por documentação.
- Checkpoint final OpenCode: uma rodada pertinente de lint focal e typecheck web, ambos exit0, seguida de build web exit0 às21:57. Hashes da fonte estável em `.local/phase7/frontend/stable-source-hashes.json`. Nenhuma suíte backend repetida por este checkpoint. Nova homologação usa preview iniciado após a estabilização da fonte.
- Impeccable aplicado em modo Operate, contexto/surface brief/craft floor lidos. Detector dos dois arquivos alterados: exit0, zero achados. Sem redesign ou reparo de mundo preexistente.
- Cálculo estático dos tokens atuais em .local/phase7/frontend/contrast.json: seis combinações de texto entre5,52:1 e16,27:1; contador branco/vermelho6,47:1. Este cálculo não substitui inspeção de estilos computados, foco, teclado, screenshots ou declaração de conformidade integral.

## Runtime e limites

QA executou uma rodada completa de navegador com4PASS/11FAIL. A revisão encontrou cascata de estado/conta errados após falha do primeiro caso, asserção minúscula incompatível com tab Demandas e tentativa de captura sem renderização. PASS de atualização silenciosa em tela errada não foi aceito. Runner permanece com Antigravity QA para corrigir precondições/isolamento/asserções, repetir testes e preservar rodada anterior.

Responsável confirmou portal visível; janela principal Maestri também foi comprovada aberta, não minimizada e em primeiro plano. Isso não equivale a screenshot válido ou aceite visual. Não marcar Q7-20/21/27 ou a Fase7 como homologados antes das evidências reais e da revisão Codex. DEV ainda sem ativação nesta revisão.

## OpenCode — revisão final estática da superfície (13/10/2026)

- Correções dos dois defeitos comprovados no ownership (implementadas e verificadas): NotificationsView `handleMarkRead` (guarda síncrona ref `markRequestsRef`, POST por item com controller próprio, sem abortar mutação de colega, cleanup aborta no unmount) e App.tsx `refreshUnread` (catch distingue `ApiError 403` → `setUnreadCount(null)` no flight atual; rede preserva contador; `ApiError` importado).
- Reconciliação nesta retomada: revisado o estado integral (refs, efeitos, load, handleMarkRead, render); confirmado que `markRequestsRef` é a única fonte síncrona e que render/aria/filtros/botões ficaram íntegros.
- Detector Impeccable (`detect --json` sobre NotificationsView.tsx): `[]` (zero achados) — verificação mecânica única após acabamento.
- Verificações estáticas adicionais (sem execução browser — QA exclusivo):
  - Contraste calculado: `.notifications-counter` #fff/#b91c1c ≈6,47:1; `.filter-button` #59677c ≈5,74:1; `.filter-button.active` #fff/#3159a5 ≈6,77:1; `.action-btn.edit`/`.secondary` #334155/#f1f5f9 ≈9,45:1; `.muted-notification` ≈5,74:1; `.notification-kind.unread` #3159a5 ≈6,77:1 — todos ≥4,5:1. Foco visível global `button:focus-visible` (outline 3px focus-ring em styles.css l121-123).
  - aria-live silenciosa (Q7-15/16): lista sem `aria-live`; skeleton `role="status"` só na carga inicial; erro `role="alert"`; polling 60s+focus só com `visibilityState==='visible'` (App e NotificationsView); contador sem aria-live. Single-flight GET confirmado (`requestRef` + guarda + cleanup) e `refreshUnread` no App.
  - Q7-09: Abrir não marca como lido — `handleOpen` chama apenas `onOpenItem`, sem POST read.
- Checkpoint de lint/typecheck/build pertinente único solicitado ao Codex #2 (aguardando execução; nenhuma suite/serviço/build concorrente rodado — verificação estática apenas).
- QA notificado diretamente sobre regras P7BR06/P7BR07B (requests reais; contador após revogação real) — arquivos do QA intocados.

**Não declaro PASS de navegador:** não há execução browser nesta revisão; conformidade integral depende das evidências reais (screenshots, teclado, estilos computados) após API ativa no portal — Q7-20/21/27 e Fase7 aguardam o checkpoint coordenado e a revisão do Codex.
