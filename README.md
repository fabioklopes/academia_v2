# Documentação — Sistema Oss (Gestão de Jiu-jitsu)
### Versão 2.0

---

Portal web para academias de Jiu-jitsu. Professores e administradores gerenciam turmas, alunos, presenças e avisos. Alunos acompanham metas, solicitam presença e recebem notificações.

---

## Índice

1. [Visão geral](#visão-geral)
2. [Tecnologias usadas](#tecnologias-usadas)
3. [Como iniciar o sistema](#como-iniciar-o-sistema)
4. [Tipos de usuário](#tipos-de-usuário)
5. [Estrutura de pastas](#estrutura-de-pastas)
6. [Como a aplicação inicia](#como-a-aplicação-inicia)
7. [Banco de dados](#banco-de-dados)
8. [Rotas da aplicação](#rotas-da-aplicação)
9. [Serviços (lógica reutilizável)](#serviços-lógica-reutilizável)
10. [Middleware (filtros da requisição)](#middleware-filtros-da-requisição)
11. [Funções auxiliares](#funções-auxiliares)
12. [Telas (views)](#telas-views)
13. [Variáveis de ambiente](#variáveis-de-ambiente)
14. [Testes](#testes)

---

## Visão geral

O **Sistema Oss** é um site interno da academia. Cada pessoa entra com e-mail e senha e vê um menu diferente conforme seu papel:

| Papel | Código | O que pode fazer |
|-------|--------|------------------|
| Aluno | `STD` | Ver dashboard, solicitar presença, ler avisos, metas, katas, perfil |
| Professor | `PRO` | Tudo do aluno + turmas, alunos, presenças, mensagens, relatórios |
| Administrador | `ADM` | Tudo do professor + logs de atividade e detalhes de usuário |

**Recursos principais:**

- Cadastro público de aluno (fica pendente até o professor aprovar)
- Turmas com matrícula de alunos
- Solicitação e aprovação de presença em aula
- Mensagens em massa do professor para turmas
- Metas de frequência por período
- Promoção de faixa/grau
- Relatórios em Excel e PDF
- Contas de dependentes (titular gerencia filhos)
- Notificações in-app
- Log de atividades para o administrador

---

## Tecnologias usadas

| Tecnologia | Para quê |
|------------|----------|
| **Node.js + Express 5** | Servidor web e rotas HTTP |
| **Sequelize + MySQL** | Banco de dados |
| **Handlebars** | Páginas HTML no servidor |
| **Argon2** | Senhas criptografadas |
| **express-session** | Manter usuário logado |
| **Multer + Sharp** | Upload e redimensionamento de fotos |
| **Nodemailer** | E-mails (reset de senha, troca de e-mail) |
| **ExcelJS / PDFKit** | Exportação de relatórios |
| **Jest + Supertest** | Testes automatizados |

---

## Como iniciar o sistema

### Pré-requisitos

- Node.js instalado
- MySQL rodando
- Arquivo `.env` na raiz do projeto (veja [Variáveis de ambiente](#variáveis-de-ambiente))

### Comandos

```bash
# Instalar dependências
npm install

# Desenvolvimento (reinicia ao salvar arquivos)
npm run dev

# Produção
npm start

# Testes
npm test

# Migração extra do perfil (se necessário)
npm run migrate:meuperfil
```

Por padrão o site abre na porta **3000** (`ENV_PORT` no `.env`).

---

## Tipos de usuário

### Aluno (`STD`)

- Acessa dashboard com progresso de meta e aniversariantes
- Solicita presença em aulas
- Lê avisos do professor na Central de Avisos
- Consulta katas por faixa
- Edita perfil (dados, medidas de kimono, senha)

### Professor (`PRO`)

- Gerencia turmas (criar, desativar, matricular alunos)
- Aprova ou nega cadastros e presenças
- Envia mensagens em massa para turmas
- Cria metas de aula
- Promove faixa/grau
- Gera relatórios

### Administrador (`ADM`)

- Tem as mesmas telas do professor
- Acessa log de atividades HTTP
- Vê detalhes de qualquer usuário
- Pode limpar logs antigos quando o limite se aproxima

### Titular e dependentes

Um adulto (titular) pode ter filhos cadastrados como dependentes. No menu, o titular alterna entre contas com **Trocar conta** (`/conta/trocar/:id`) e volta com **Voltar** (`/conta/voltar`). Enquanto visualiza um dependente, a sessão guarda `viewingAs`.

---

## Estrutura de pastas

```
teste-node/
├── app.js                 # Arquivo principal: quase todas as rotas e regras de negócio
├── bootstrap/
│   └── ensure_schema.js   # Ajustes automáticos no banco ao subir o servidor
├── config/
│   ├── constants.js       # Prazos e limites fixos (sessão, tokens, logs)
│   ├── multer_user_photo.js   # Configuração de upload de foto
│   ├── register_express_stack.js  # Helmet, sessão, arquivos estáticos
│   └── views_handlebars.js    # Motor de templates e helpers de data
├── routes/
│   └── auth.js            # Login, logout e redefinição de senha
├── middleware/            # Código que roda antes de cada página
├── models/                # Tabelas do banco (Sequelize)
├── services/              # Funções compartilhadas entre rotas
├── lib/
│   └── pure_helpers.js    # Funções puras (datas, faixas, nomes)
├── utils/                 # Geradores de código, telefone, frases
├── views/                 # Templates Handlebars (.handlebars)
├── public/                # CSS, JS e imagens públicas
├── uploads/               # Fotos enviadas pelos usuários
└── tests/                 # Testes unitários e de integração
```

---

## Como a aplicação inicia

Fluxo resumido ao rodar `node app.js`:

```
1. Carrega variáveis do .env
2. Valida SESSION_SECRET em produção (mínimo 32 caracteres)
3. Monta o Express (segurança, sessão, arquivos estáticos, Handlebars)
4. Registra middlewares globais (log, menu, autenticação)
5. Registra dezenas de rotas em app.js
6. Registra rotas de auth em routes/auth.js
7. Configura páginas de erro (404 e 500)
8. Ajusta schema do banco (bootstrap/ensure_schema.js)
9. Escuta na porta configurada
```

O arquivo `app.js` também exporta o app Express (`module.exports = app`) para os testes usarem sem subir o servidor de verdade.

---

## Banco de dados

Conexão em `models/db.js`. Variáveis: `ENV_DB_HOST`, `ENV_DB_USER`, `ENV_DB_PASSWORD`, `ENV_DB_NAME`, `ENV_DB_PORT`, `ENV_DB_DIALECT`.

### Tabelas principais

| Tabela | O que guarda |
|--------|--------------|
| `tb_usuarios` | Pessoas: nome, e-mail, senha, faixa, grau, papel, status |
| `tb_turmas` | Turmas de aula (código, nome, professor criador) |
| `tb_turma_alunos` | Quem está matriculado em cada turma |
| `tb_presenca` | Pedidos de presença (pendente, aprovado, negado) |
| `tb_mensagens_professores` | Avisos em massa para turmas |
| `tb_mensagens_professores_leituras` | Quais alunos já leram cada aviso |
| `tb_mensagens_professores_ocultacoes` | Avisos que o aluno ocultou |
| `tb_metas_aulas` | Metas de frequência por período |
| `tb_meta_aula_turmas` | Liga metas às turmas |
| `tb_notificacoes` | Avisos in-app (ex.: presença aprovada) |
| `tb_app_activity_logs` | Registro de ações HTTP (auditoria) |

### Status comuns

**Usuário (`user_status`):** `P` = pendente, `A` = ativo, `C` = cancelado/bloqueado

**Presença:** `P` = pendente, `A` = aprovada, `N` = negada, `C` = cancelada pelo aluno

**Mensagem do professor:** `A` = ativa, `E` = expirada

---

## Rotas da aplicação

### Rotas públicas (sem login)

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/auth/login` | Tela de login |
| POST | `/auth/verify` | Valida e-mail/senha |
| GET/POST | `/auth/forgot-password` | Esqueci minha senha |
| GET/POST | `/auth/reset-password` | Nova senha via link |
| GET | `/aluno/novo` | Formulário de cadastro |
| POST | `/aluno/cadastrar` | Salva novo aluno pendente |
| POST | `/aluno/verificar-titular` | Valida e-mail do responsável (JSON) |

### Autenticação

| Método | Caminho | Descrição |
|--------|---------|-----------|
| POST | `/auth/logout` | Encerra sessão |

### Geral

| Método | Caminho | Quem acessa |
|--------|---------|-------------|
| GET | `/` | Redireciona conforme papel |
| GET | `/dashboard` | Todos logados |

### Aluno

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/mensagens/mestre` | Central de avisos |
| POST | `/mensagens/ocultar` | Ocultar aviso |
| POST | `/mensagens/mestre/:id/lida` | Marcar como lida |
| GET | `/presenca` | Solicitar/ver presenças |
| POST | `/presenca/solicitar` | Novo pedido |
| GET | `/notificacoes` | Notificações |
| GET | `/katas-movimentos` | Katas por faixa |
| GET/POST | `/meuperfil/*` | Perfil pessoal |

### Professor / Admin

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET/POST | `/turmas/*` | Gestão de turmas |
| GET/POST | `/aluno/*` | Gestão de alunos |
| GET/POST | `/mensagens` | Divulgação em massa |
| GET/POST | `/metasdeaula` | Metas de aula |
| GET/POST | `/promoveraluno` | Promoção de faixa |
| GET/POST | `/presenca/*` | Aprovar/negar presenças |
| GET | `/relatorios/*` | Relatórios e downloads |

### Somente Admin

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/admin/logs` | Log de atividades |
| POST | `/admin/logs/executar-limpeza` | Limpar logs antigos |
| GET | `/admin/usuario/:user_code` | Detalhe do usuário |

### Contas dependentes

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/conta/trocar/:id` | Titular passa a ver conta do dependente |
| GET | `/conta/voltar` | Volta à conta do titular |

---

## Serviços (lógica reutilizável)

Pasta `services/` — funções chamadas por várias rotas.

### `effective_user_code.js`

| Função | O que faz |
|--------|-----------|
| `getEffectiveUserCode(req)` | Retorna o código do aluno “efetivo”: se o titular está vendo um dependente, usa o código dele |
| `normalizeUserCode(value)` | Padroniza código (maiúsculas, sem espaços) |
| `notificacaoRecipientCodes(raw)` | Lista códigos possíveis para buscar notificações (compatível com registros antigos) |

### `professor_mass_messages.js`

| Função | O que faz |
|--------|-----------|
| `getActiveTurmasForUser(userCode)` | Turmas ativas em que o aluno está matriculado |
| `expireProfessorMessagesIfNeeded()` | Marca mensagens vencidas como expiradas |
| `getTurmasDisponiveisParaMensagem(usuario)` | Turmas que o professor pode usar para enviar aviso |
| `toMassMessageViewModel(mensagem)` | Prepara dados da mensagem para exibir na tela |
| `getStudentMassMessageState(usuario)` | Estado completo da Central de Avisos do aluno |
| `markMassMessageAsRead(usuario, messageId)` | Marca aviso como lido |

### `password_reset.js`

| Função | O que faz |
|--------|-----------|
| `handleResetPasswordSubmit(req, res)` | Processa formulário de nova senha |
| `sendResetPasswordEmail(...)` | Envia e-mail com link de reset |
| `findUsuariosWithValidResetToken(email, token)` | Verifica se o link ainda é válido |

### `student_list_exports.js`

| Função | O que faz |
|--------|-----------|
| `exportStudentsToXlsx(...)` | Gera planilha Excel |
| `exportStudentsToPdf(...)` | Gera PDF com lista de alunos |

### `mail_transport.js` / `public_app_links.js`

- Configuram envio de e-mail (SMTP) e montam links absolutos para reset de senha e confirmação de e-mail.

---

## Middleware (filtros da requisição)

Código que roda **antes** de cada rota, na ordem registrada em `app.js`:

| Arquivo | O que faz |
|---------|-----------|
| `session_idle_timeout.js` | Desloga após 10 minutos sem uso (configurável) |
| `activity_log.js` | Grava cada ação do usuário logado no banco |
| `portal_locals.js` | Define variáveis do menu (título do portal, papel) |
| `dependents_menu.js` | Carrega lista de dependentes no menu |
| `student_nav_locals.js` | Contadores de avisos e notificações no sino |
| `admin_log_locals.js` | Aviso ao admin quando log está quase cheio |
| `require_auth.js` | Redireciona para login se não estiver autenticado |
| `authorization.js` | Bloqueia acesso de quem não é professor ou admin |

---

## Funções auxiliares

### `lib/pure_helpers.js`

Funções sem acesso a banco — datas, faixas, nomes, paginação:

- `hasProfessorAccess` — professor ou admin?
- `buildPaginationVm` — números de página para listagens
- `formatDateBrFromYmd` — data no formato brasileiro
- `getBeltBadgeClass` — classe CSS da faixa
- `areClassNamesTooSimilar` — evita turmas com nomes parecidos
- `normalizePersonName` — capitaliza nomes corretamente

### `utils/`

| Arquivo | O que faz |
|---------|-----------|
| `usercode_generator.js` | Gera código único de 5 caracteres para usuário |
| `classcode_generator.js` | Gera código único de 5 caracteres para turma |
| `phone_br.js` | Valida celular brasileiro (11 dígitos) |
| `motivational_phrases.js` | Frase aleatória no login |

### Funções internas em `app.js`

O arquivo principal concentra helpers de:

- **Relatórios** — `fetchAllStudentsForReports`
- **Turmas** — `generateUniqueClassCode`, `getActiveTurmasOptions`
- **Faixas** — `getBeltDisplayData`, `validateBeltAndDegree`
- **Aniversário** — `buildBirthdayWidgetData`, `buildBirthdayLoginModalData`
- **Fotos** — `replaceUserPhoto`, `optimizeImageTo1MB`
- **Presença** — `buildPresencaViewModel`, `getCurrentMetaProgressForStudent`
- **Admin** — funções de paginação de logs

---

## Telas (views)

Templates Handlebars em `views/`. Layout principal: `views/layouts/main.handlebars`.

| Template | Página |
|----------|--------|
| `login.handlebars` | Login |
| `dashboardprofessor.handlebars` | Dashboard professor/admin |
| `dashboardaluno.handlebars` | Dashboard aluno |
| `turmas.handlebars` | Turmas |
| `aluno.handlebars` | Lista de alunos |
| `formnovousuario.handlebars` | Cadastro/edição de aluno |
| `presenca.handlebars` | Presenças |
| `mensagens.handlebars` | Avisos (professor) |
| `mensagensmestre.handlebars` | Central de avisos (aluno) |
| `metasdeaula.handlebars` | Metas |
| `meuperfil.handlebars` | Meu perfil |
| `notificacoes.handlebars` | Notificações |
| `relatorios*.handlebars` | Relatórios |
| `admin_logs.handlebars` | Log administrativo |
| `errors/error.handlebars` | Erros 403, 404, 500 |

Menus laterais: `menuprofessor.handlebars` e `menualuno.handlebars`.

---

## Variáveis de ambiente

Crie um arquivo `.env` na raiz:

```env
# Banco de dados (obrigatório)
ENV_DB_HOST=localhost
ENV_DB_USER=root
ENV_DB_PASSWORD=sua_senha
ENV_DB_NAME=oss_db
ENV_DB_PORT=3306
ENV_DB_DIALECT=mysql

# Sessão (obrigatório em produção — mínimo 32 caracteres)
SESSION_SECRET=uma_chave_longa_e_aleatoria_aqui

# Servidor
ENV_PORT=3000
NODE_ENV=development

# Opcional: tempo de inatividade da sessão (milissegundos)
# SESSION_IDLE_TIMEOUT_MS=600000

# E-mail (opcional — sem isso, links aparecem no console em dev)
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASS=senha
SMTP_FROM=noreply@exemplo.com

# URL pública do site (para links em e-mails)
APP_BASE_URL=https://seusite.com.br

# Proxy reverso (nginx, etc.)
# TRUST_PROXY=1
```

---

## Testes

```bash
npm test
```

| Pasta | Tipo |
|-------|------|
| `tests/unit/` | Testes de funções isoladas |
| `tests/integration/` | Testes HTTP com Supertest |

Principais arquivos testados: `constants`, `pure_helpers`, modelos, middleware, serviços e sintaxe de todos os `.js`.

---

## Diagrama simplificado

```
┌─────────────┐     HTTP      ┌──────────────┐
│   Navegador │ ◄───────────► │   Express    │
│  (Handlebars)│              │   (app.js)   │
└─────────────┘               └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              Middleware         Services          Models
              (auth, log)    (mensagens, etc.)   (Sequelize)
                    │                │                │
                    └────────────────┴────────────────┘
                                     ▼
                              ┌─────────────┐
                              │    MySQL    │
                              └─────────────┘
```

---

## Observações importantes

1. **E-mail repetido:** o mesmo e-mail pode existir em vários cadastros (ex.: titular e filhos). A senha é compartilhada entre eles no login.
2. **Sessão:** cookie `oss.sid`, expira por inatividade (padrão 10 minutos).
3. **Fotos:** salvas em `uploads/users/`, redimensionadas para até 1 MB.
4. **Logs:** máximo de 5000 registros; admin recebe aviso perto do limite.
5. **Schema:** alterações leves no banco rodam automaticamente ao iniciar (`bootstrap/ensure_schema.js`).

---

*Documentação do projeto Sistema Oss — gestão de academia de Jiu-jitsu.*
