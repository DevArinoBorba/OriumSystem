# ADR-0006 — Direção preferencial de cofre externo e referências

Status: **Aceito pelo responsável no escopo abaixo**. Data do registro: 05/10/2026. Fase de implementação: 6.

## Contexto

Credenciais de hospedagem/domínio são sensíveis e não devem aparecer em logs, frontend, repositório ou prompts de IA. Um cofre especializado reduz a responsabilidade criptográfica da aplicação operacional.

## Decisão aprovada

Preferir cofre externo para credenciais de clientes. O OriumSystem armazena apenas referências. Vaultwarden é o candidato inicial a avaliar/homologar. Isso não equivale à escolha definitiva de produto nem à autorização de implantação.

## Consequências

A aplicação operacional não incorpora valores secretos de clientes em seu banco. Integração deve preservar essa fronteira. Mudança para armazenamento interno de credenciais exige revisão e aprovação explícitas.

## Pendências e alternativas

### Decisão complementar — 08/10/2026

O responsável também definiu **hospedar Bitwarden oficial posteriormente**. Instância e homologação externa ficam para essa etapa; não provisionar Vaultwarden nem presumir Bitwarden Cloud.

O responsável escolheu **Bitwarden oficial** e determinou que **somente administradores** podem visualizar referências no OriumSystem. Vaultwarden deixa de ser o candidato para implementação. A escolha não comprova uma instância disponível nem autoriza presumir região, plano, custódia ou acesso a coleções. A autorização no Bitwarden permanece independente do papel no OriumSystem. Contrato vigente: `docs/PHASE6-IMPLEMENTATION-CONTRACT.md`. As pendências abaixo registram o estado original; produto e visibilidade foram resolvidos por este complemento.

Bitwarden oficial permanece alternativa. APIs reais, acesso às coleções, auditoria, autenticação do cofre, abertura de referências, custódia, backups e ambiente serão definidos antes da Fase 6 ou de usar credenciais reais. Não presumir API pública completa pela compatibilidade com clientes Bitwarden. Não foram aprovados mecanismo de revelação dentro do OriumSystem, desbloqueio geral pelo backend ou implementação de cofre próprio.
