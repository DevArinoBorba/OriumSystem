# Fase 7 — revisão independente do navegador

## Retomada Codex principal — 14/10/2026

Estado mais recente: artefato final `.local/phase7/browser/phase7-browser-run.json`, de 02:07:28Z, registra **15 PASS / 1 FAIL**, sem fatalError; BR11 permanece em missingRequired. O runner não aprovou o teclado: houve timeout aguardando `native-keyboard-result.json`. O relato de limitação SendInput não converte esse resultado em PASS. As seções abaixo preservam a revisão anterior.

BR06 foi corrigido e executado: uma requisição de leitura, timestamps inicial/segunda chamada iguais e idempotência registrada. Console independente e cleanup têm PASS no artefato; residuals registra onze contagens zero, 23 grants iguais e fingerprints dos 449 eventos/sujeitos preservados. Captura mobile final inspecionada nesta retomada: central renderizada, controles legíveis e ações acessíveis no layout empilhado; capturas desktop/mobile já haviam sido examinadas na revisão anterior. Nenhum rerun dos casos verdes nesta retomada.

Limite de BR09: o runner confirma filtro não lido, igualdade do foco por texto, igualdade da paginação e ausência de skeleton após evento focus. O URL publicado em requestPreserved é a consulta do contador (pageSize=1); isoladamente não prova que a requisição da lista preservou página não inicial. Não declarar cobertura desse cenário adicional a partir dessa string.

Fase7 não encerrada. Ativação DEV continua conforme contrato e decisão sobre o gate de teclado, com a falha preservada. Publicação VPS relatada no handoff posterior não substitui esses gates nem a verificação independente DEV.

Codex #2, 13/10/2026. Ainda sem aceite final: segunda rodada executada com14PASS/2FAIL. Produto backend/UI estável, 92 testes pertinentes aprovados e builds verdes. Runner/TEST/portal pertencem ao Antigravity QA; Codex não opera DOM concorrentemente.

## Rodadas

Preparações de sintaxe não foram aceitas como homologação. Tentativas de startup falharam antes dos casos; somente cleanup executado não equivale a PASS da superfície. Corrigidos nomes/estados reais de banco, grants próprios, fingerprints históricos, carregamento seguro de env, resolução do plugin React no Vite, registro de fatalError/exit1 e checker DB/portas/prova Docker.

Primeira rodada completa, final01:20:44Z: **4PASS/11FAIL**. Sessão errada após falha no primeiro caso contaminou os demais. Asserção da aba procurava demandas minúsculo; um PASS de atualização foi obtido numa tela de detalhes e não foi aceito. Captura falhou por renderização indisponível.

Segunda rodada, final01:27:52Z: **14PASS/2FAIL**, 16 casos. Imagens reais da central renderizada em1280x800 e390x844 CSS px foram geradas e inspecionadas juntas por Codex. Layout preserva o mundo incumbente, títulos/metadados/controles legíveis, ações empilham no mobile, sem overflow horizontal observado. Nenhum ajuste visual/redesign necessário nessa inspeção.

Responsável confirmou portal visível. Windows comprovou janela principal Maestri aberta, não minimizada e em primeiro plano. Confirmação de visibilidade não foi tratada como aprovação manual de teclado ou screenshots.

## Duas pendências específicas

- BR06: alvo SQL escolhido no array de seed é o primeiro unread cronológico mais antigo; botão acionado na lista DESC é outro item. Corrigir runner para usar o ID do POST capturado/GET da página atual, provar antes/depois da linha correspondente, exatamente1 POST e idempotência/readAt. Não alterar produto por erro de fixture/asserção.
- BR11: comando Maestri key Tab não deslocou o foco de Todos. Falha verdadeira da ferramenta, sem ponte DOM para mascarar. Helper alternativo nativo preparado em .local/phase7/frontend/native-keyboard.ps1, usando UIAutomation e Windows SendInput com observação isTrusted e alteração real de filtro/lista; ainda não executado nesta revisão. Execução coordenada exige pausa exclusiva do portal, sessão fixture e URL TEST exata.

## Higiene conferida

.local/phase7/browser/artifacts/phase7-browser-residuals.json: onze contagens de resíduos zero,23grants preservados e fingerprints de449 identity_event/449 subjects idênticos antes/depois. Serviços temporários e leases próprios encerrados/liberados e portal restaurado. Sem fixture ou restart DEV.

Capturas em .local/phase7/browser/artifacts/P7-BR-10-desktop.png e P7-BR-10-mobile.png. A ausência de defeito visual nestas imagens não substitui critérios funcionais ainda pendentes. Ativação DEV permanece bloqueada pelo gate de homologação, sem solicitar nova autorização para continuar o desenvolvimento.
