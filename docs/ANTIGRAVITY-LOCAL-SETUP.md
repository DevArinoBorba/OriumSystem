# Antigravity — configuração local de execução

O responsável autorizou execução sem confirmações por ferramenta. Retomar com `agy --continue --dangerously-skip-permissions`, ou usar o ID da conversa com `--conversation=<id>` e a mesma opção.

Em 2026-10-05 foi identificado um hook quebrado do plugin `googlecloudtools.datacloud_telemetry`, cujo caminho continha aspas internas inválidas no Windows. Remover somente a pasta não desativa o registro persistente.

Correção aplicada pelo comando oficial: `agy plugin disable googlecloudtools.datacloud_telemetry`. O arquivo de configuração do usuário `.gemini/config/config.json` passou a registrar `enabled: false` para esse plugin, preservando as demais configurações. A leitura de AGENTS.md por uma nova execução do CLI foi concluída com `HOOK_OK`.

Se o problema reaparecer, conferir se outra instalação/importação voltou a habilitar o plugin. Não apagar diretórios globais ou reinstalar plugins como tentativa de correção. Manter o plugin desativado até uma versão corrigida ser verificada.

O modo sem confirmações não amplia os limites de escopo, não autoriza exposição de segredos e não substitui revisão técnica.
