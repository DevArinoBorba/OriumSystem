# ADR-0004 — Better Auth e RBAC próprio no backend

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase: 0.

## Contexto

São necessárias contas individuais e permissões reutilizáveis por web e futuros consumidores da API.

## Decisão aprovada

Usar Better Auth para autenticação. Usar RBAC próprio, centralizado no backend, para autorização. Não delegar regras de acesso de negócio ao frontend.

## Consequências

Reutiliza biblioteca para identidade e mantém política específica da agência sob controle do backend. Exige testes de acesso e separação entre autenticar identidade e autorizar ação.

## Pendências preservadas

As políticas de fundação foram aprovadas e registradas no ADR-0007: e-mail/senha, administradores Arino e Monique, Colaborador por padrão, sessões absolutas de 7 dias e inatividade de 12 horas, sem cadastro público. MFA e recuperação automática por SMTP ficam para depois. Algoritmo/parâmetros de hashing e escopos dos módulos não viram regras de negócio por este registro. Keycloak e Casbin não foram escolhidos para a fundação. Implementação da fundação foi autorizada posteriormente pelo responsável.
