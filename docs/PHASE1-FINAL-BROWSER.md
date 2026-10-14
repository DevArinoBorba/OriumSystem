# Relatório e Planejamento de Validação Visual no Navegador — Fase 1 (Fundação)

**Documento Oficial de Garantia da Qualidade (QA)**  
**Escopo**: Validação E2E no Navegador Visível (Portal Maestri) com Backend Conectado ao PostgreSQL de Teste  
**Conformidade**: [AGENTS.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/AGENTS.md), [PORT_POLICY.md](file:///C:/Users/arino/.maestri/PORT_POLICY.md), [PROJECT_CONTEXT.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/PROJECT_CONTEXT.md) e [ROADMAP.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/ROADMAP.md).  
**Portal Alvo no Canvas**: `Orium - Codex visivel`  
**Validador Exclusivo**: Antigravity QA  

---

## 1. Princípios e Regras Operacionais

1. **Navegador Real Visível no Canvas**:
   - Proibição absoluta de testes "headless" artificiais, injeção simulada de cookies ou interceptação de requisições com mocks no frontend.
   - Toda a interação é realizada através do portal visível no canvas do Maestri (`Orium - Codex visivel`), utilizando os comandos oficiais `maestri portal snapshot`, `fill`, `click`, `navigate` e `screenshot`.
   - O portal e o terminal Shell devem permanecer **abertos** após a conclusão das verificações, permitindo inspeção visual pelo usuário.
2. **Conformidade com a Política Global de Portas (`PORT_POLICY.md`)**:
   - Antes de qualquer reinicialização ou bind de serviços locais, executar `C:/Users/arino/.maestri/Find-FreePort.ps1` para assegurar portas livres com reserva gerenciada.
   - Manter coerência estrita entre `API_ORIGIN`, `WEB_ORIGIN`, portas do Vite e proxies Fastify/CORS.
   - Reutilizar serviços ativos somente após comprovar propriedade do processo (PID owned pertencente ao projeto OriumSystem).
   - Preservar segredos locais; nunca expor credenciais em URLs ou logs.
3. **Contas Reais Estritamente Preservadas**:
   - As contas reais (`arinoborba@gmail.com` e `moniquiborges_5@gmail.com`) **NÃO** são utilizadas nos testes de navegador.
   - Serão utilizadas contas de fixture temporárias (`qa-fixture-admin-***@example.test`) criadas especificamente para o teste e limpas cirurgicamente ao final.
4. **Isolamento de Banco de Dados**:
   - O backend em execução no teste conecta-se unicamente ao banco `/orium_test` com a role restrita `orium_app`.

---

## 2. Matriz de Casos de Teste no Navegador

| Caso | Cenário | Ações no Portal | Resultado Esperado | Critério de Aceite |
| :--- | :--- | :--- | :--- | :--- |
| **BR-01** | **Acesso Não Autenticado** | Navegar para a URL da aplicação web (`WEB_ORIGIN`). | Redirecionamento ou exibição da tela de login. Campos de e-mail e senha visíveis. | Formulário presente no snapshot de acessibilidade; sem erros no console. |
| **BR-02** | **Tentativa com Credenciais Inválidas** | Preencher e-mail e senha inválidos de teste; clicar em "Entrar". | Mensagem de erro de autenticação visível na interface. Nenhuma sessão concedida. | Usuário permanece na tela de login; sem vazamento de stacktrace ou detalhes de banco. |
| **BR-03** | **Login Válido com Fixture** | Preencher e-mail e senha da fixture autorizada; clicar em "Entrar". | Backend processa via Better Auth, define cookie `HttpOnly` `Secure` e responde com sucesso. Frontend navega para a área protegida. | Dashboard ou menu restrito visível; identidade do usuário exibida no DOM. |
| **BR-04** | **Persistência de Sessão no Reload** | Executar recarregamento completo da página (`reload` / `navigate` para URL atual). | A sessão permanece ativa via cookie HttpOnly. Não solicita novo login. | Usuário continua na tela protegida após o recarregamento. |
| **BR-05** | **Logout Explícito** | Clicar no botão "Sair" / "Logout". | O backend revoga a sessão em `auth_session` e limpa os cookies. Frontend redireciona para a tela de login. | Retorno à tela de login; snapshot confirma campos de autenticação vazios. |
| **BR-06** | **Acesso Protegido Pós-Logout** | Tentar navegar diretamente para a rota interna protegida. | O acesso é negado e o usuário é redirecionado para a tela de login. | Não renderiza dados confidenciais ou módulos administrativos. |
| **BR-07** | **Limpeza Cirúrgica e Estado Final** | Remover do banco de teste exclusivamente as credenciais da fixture criada para o teste de navegador. | Fixture excluída com sucesso; banco retoma estado limpo. Portal e Shell continuam abertos no canvas. |

---

## 3. Evidências Coletadas

1. Snapshot do formulário inicial de login.
2. Snapshot da transição para a área autenticada pós-login com fixture.
3. Avaliação de segurança confirmando ausência absoluta de tokens expostos em `localStorage` (`[]`).
4. Snapshot de confirmação de logout e bloqueio persistente de rotas protegidas.
5. Recibo da remoção cirúrgica da fixture (`auth_user: 0`).

---

## 4. Resultados e Evidências da Execução no Navegador Visível (2026-10-05)

Execução realizada no portal nativo visível **`Orium - Codex visivel`** (`http://127.0.0.1:5173`), conectado à API recompilada (Fastify 5.12.5) apontando estritamente para o banco de teste `/orium_test` (role `orium_app`), sem headless, sem mocks e sem injeção de cookies.

| ID | Caso de Teste | Status | Detalhes da Execução / Asserções no Portal |
| :--- | :--- | :---: | :--- |
| **BR-01** | Exibição da Tela de Login para Acesso Não Autenticado | **PASS** | Navegação inicial para `http://127.0.0.1:5173`. Formulário de login exibido (`label E-mail`, `input type=email`, `label Senha`, `input type=password`, `button "Entrar"`). |
| **BR-02** | Rejeição Visual de Credenciais Inválidas | **PASS** | Submissão de credenciais inválidas. Resposta 401 processada e exibição de aviso visual no DOM: `alert "Não foi possível entrar. Confira suas credenciais e tente no"`. |
| **BR-03** | Login Válido com Fixture e Área Protegida | **PASS** | Credenciais da fixture de administrador preenchidas. Autenticação via Better Auth com cookie HttpOnly seguro. Transição imediata para área restrita com cabeçalho exibindo `Administrador`, nome do usuário e botão `Sair`. |
| **BR-04** | Persistência de Sessão no Recarregamento | **PASS** | Recarregamento completo da página (`navigate` para URL). Sessão mantida ativa via cookie HttpOnly sem exigir nova autenticação. Identidade preservada. |
| **BR-SEC** | Ausência de Tokens em localStorage | **PASS** | Avaliação JavaScript via portal (`evaluate`): `localStorage` inspecionado retornou `[]`. Nenhum token de autenticação, segredo ou credencial persistido no armazenamento do navegador. |
| **BR-05** | Logout Explícito e Revogação de Acesso | **PASS** | Clique no botão `Sair` (`.signout-button`). Sessão revogada no backend (`auth_session`), cookie limpo e redirecionamento imediato para a tela de login (`Entrar`). |
| **BR-06** | Acesso Protegido Permanece Bloqueado Pós-Logout | **PASS** | Nova tentativa de acesso direto à aplicação via URL raiz. Acesso bloqueado, permanecendo estritamente na tela de login desautenticada. |
| **BR-07** | Limpeza Cirúrgica de Fixture no TestDB (finally) | **PASS** | Exclusão cirúrgica restrita ao identificador da fixture criada (`ownedUserIds`). Banco `/orium_test` restaurado a exatamente `auth_user: 0`. |

**Resumo da Bateria**: 8 casos executados, **8 aprovados (100%)**, 0 falhas.  
Evidência estruturada persistida em [`.local/phase1-visible-results.json`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase1-visible-results.json).  
O portal `Orium - Codex visivel` e o terminal `QA Entrada` permanecem **abertos** para inspeção visual do responsável.

