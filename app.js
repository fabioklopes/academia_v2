// configurações de ambiente
require('dotenv').config();

const express = require('express');
const app = express();

const { engine } = require('express-handlebars');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const argon2 = require('argon2');
const { Op } = require('sequelize');
const moment = require('moment');
const Usuario = require('./models/Usuario');
const Presenca = require('./models/Presenca');
const Turma = require('./models/Turma');
const TurmaAluno = require('./models/TurmaAluno');
const MensagemProfessor = require('./models/MensagemProfessor');
const MensagemProfessorOcultacao = require('./models/MensagemProfessorOcultacao');
const MensagemProfessorLeitura = require('./models/MensagemProfessorLeitura');
const MetaAula = require('./models/MetaAula');
const MetaAulaTurma = require('./models/MetaAulaTurma');
const { sequelize, Sequelize } = require('./models/db');
const generatedCode = require('./utils/usercode_generator');
const generateClassCode = require('./utils/classcode_generator');

MetaAula.belongsTo(Usuario, {
    as: 'criador',
    foreignKey: 'created_by',
    targetKey: 'user_code'
});
MetaAula.belongsToMany(Turma, {
    through: MetaAulaTurma,
    foreignKey: 'meta_id',
    otherKey: 'class_code',
    targetKey: 'class_code',
    as: 'turmas'
});
Turma.belongsToMany(MetaAula, {
    through: MetaAulaTurma,
    foreignKey: 'class_code',
    otherKey: 'meta_id',
    sourceKey: 'class_code',
    as: 'metas'
});
MetaAulaTurma.belongsTo(MetaAula, {
    foreignKey: 'meta_id',
    targetKey: 'id'
});
MetaAulaTurma.belongsTo(Turma, {
    foreignKey: 'class_code',
    targetKey: 'class_code'
});

// Usado apenas para o "Esqueci a minha senha"
const crypto = require('crypto');
const nodemailer = require('nodemailer');


const RESET_TOKEN_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;
const MOTIVATIONAL_PHRASES_PATH = path.join(__dirname, 'utils', 'frases_motivacionais.txt');




// configuração gerais da aplicação / momento de execução
function loadMotivationalPhrases() {
    try {
        return fs.readFileSync(MOTIVATIONAL_PHRASES_PATH, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    } catch (err) {
        console.error('Erro ao carregar frases motivacionais:', err);
        return [];
    }
}

const motivationalPhrases = loadMotivationalPhrases();

function getRandomMotivationalMessage() {
    if (motivationalPhrases.length === 0) {
        return '';
    }

    const randomIndex = Math.floor(Math.random() * motivationalPhrases.length);
    return motivationalPhrases[randomIndex];
}

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && (!sessionSecret || sessionSecret.trim().length < 32)) {
    throw new Error('SESSION_SECRET ausente/curto demais. Defina um valor forte no ambiente de produção.');
}

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static('public'));
app.use(session({
    name: 'oss.sid',
    secret: sessionSecret || 'oss_session_secret_dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 8
    }
}));

// Carrega na seção a informação do Portal
app.use((req, res, next) => {
    res.locals.usuarioLogado = req.session.usuario || null;
    res.locals.viewingAs = req.session.viewingAs || null;

    const role = req.session.usuario ? req.session.usuario.role : null;
    res.locals.isRoleSTD = role === 'STD';
    res.locals.isRolePRO = role === 'PRO';
    res.locals.isRoleADM = role === 'ADM';

    if (role === 'ADM') {
        res.locals.portalMenuTitulo = 'PORTAL DO ADMINISTRADOR';
    } else if (role === 'PRO') {
        res.locals.portalMenuTitulo = 'PORTAL DO PROFESSOR';
    } else {
        res.locals.portalMenuTitulo = 'PORTAL DO ALUNO';
    }

    res.locals.useProfessorMenu = role === 'PRO' || role === 'ADM';
    next();
});

// Carrega lista de dependentes do titular logado para o menu
app.use(async (req, res, next) => {
    const usuario = req.session.usuario;
    if (usuario && !req.session.viewingAs) {
        try {
            const dependentes = await Usuario.findAll({
                where: { responsible_id: usuario.id, user_status: 'A' },
                attributes: ['id', 'first_name', 'last_name'],
                order: [['first_name', 'ASC']]
            });
            res.locals.dependentes = dependentes.length > 0
                ? dependentes.map(d => d.get({ plain: true }))
                : null;
        } catch (_err) {
            res.locals.dependentes = null;
        }
    } else {
        res.locals.dependentes = null;
    }
    next();
});

app.use(async (req, res, next) => {
    res.locals.birthdayLoginModal = req.session.birthdayLoginModal || null;
    res.locals.studentMassMessageBell = null;
    res.locals.motivationalMessage = req.session.motivationalMessage || '';

    if (req.session.birthdayLoginModal) {
        delete req.session.birthdayLoginModal;
    }

    try {
        if (req.session.usuario) {
            await expireProfessorMessagesIfNeeded();
        }

        const usuarioSessao = req.session.usuario;
        if (usuarioSessao && usuarioSessao.role === 'STD') {
            const massMessageState = await getStudentMassMessageState(usuarioSessao);
            res.locals.studentMassMessageBell = buildStudentMassMessageBellViewModel(massMessageState);
        }
    } catch (err) {
        console.error('Erro ao preparar modal de mensagem em massa:', err.message);
        res.locals.studentMassMessageBell = null;
    }

    next();
});

// Rotas isentas de verificação de login
function isPublicRoute(pathname) {
    const publicRoutes = new Set([
        '/auth/login',
        '/auth/verify',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/reset-password',
        '/aluno/novo',
        '/aluno/cadastrar',
        '/aluno/verificar-titular'
    ]);

    return publicRoutes.has(pathname) || pathname.startsWith('/uploads/');
}

// Redirecionamento para o login caso não esteja autenticado
function requireAuth(req, res, next) {
    if (isPublicRoute(req.path)) {
        return next();
    }

    if (req.session.usuario) {
        return next();
    }

    const redirectPath = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/auth/login?redirect=${redirectPath}`);
}

app.use(requireAuth);

// Equiparação de acesso para professor e administrador
function hasProfessorAccess(usuarioSessao) {
    return !!usuarioSessao && ['PRO', 'ADM'].includes(usuarioSessao.role);
}

function getDefaultRedirectByRole(role) {
    return '/dashboard';
}

// Helper para exibir o nome completo do perfil do usuário
function getRoleLabel(role) {
    if (role === 'ADM') {
        return 'Administrador';
    }

    if (role === 'PRO') {
        return 'Professor';
    }

    if (role === 'STD') {
        return 'Aluno';
    }

    return role;
}

function normalizeClassName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function tokenizeClassName(value) {
    const stopWords = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos']);
    return normalizeClassName(value)
        .split(/\s+/)
        .filter((token) => token && !stopWords.has(token));
}

function levenshteinDistance(a, b) {
    const aLen = a.length;
    const bLen = b.length;

    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;

    const matrix = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0));

    for (let i = 0; i <= aLen; i++) matrix[i][0] = i;
    for (let j = 0; j <= bLen; j++) matrix[0][j] = j;

    for (let i = 1; i <= aLen; i++) {
        for (let j = 1; j <= bLen; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[aLen][bLen];
}

function areClassNamesTooSimilar(nameA, nameB) {
    const tokensA = tokenizeClassName(nameA);
    const tokensB = tokenizeClassName(nameB);

    if (tokensA.length === 0 || tokensB.length === 0) {
        return false;
    }

    const sortedA = [...tokensA].sort().join(' ');
    const sortedB = [...tokensB].sort().join(' ');
    if (sortedA === sortedB) {
        return true;
    }

    const compactA = tokensA.join('');
    const compactB = tokensB.join('');
    if (compactA === compactB || compactA.includes(compactB) || compactB.includes(compactA)) {
        return true;
    }

    const distance = levenshteinDistance(compactA, compactB);
    const maxLen = Math.max(compactA.length, compactB.length);
    const similarity = maxLen === 0 ? 1 : 1 - (distance / maxLen);
    return similarity >= 0.82;
}

async function generateUniqueClassCode() {
    const maxAttempts = 40;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const classCode = generateClassCode(5);
        const existing = await Turma.findOne({ where: { class_code: classCode } });
        if (!existing) {
            return classCode;
        }
    }

    throw new Error('Nao foi possivel gerar um codigo unico para a turma. Tente novamente.');
}

async function getActiveTurmasOptions(selectedClassCode = '') {
    const turmas = await Turma.findAll({
        where: { active: 'Y' },
        attributes: ['class_code', 'class_name'],
        order: [['class_name', 'ASC']]
    });

    return turmas.map((turma) => {
        const plain = turma.get({ plain: true });
        return {
            ...plain,
            selected: plain.class_code === selectedClassCode
        };
    });
}

async function getActiveTurmasForUser(userCode) {
    if (!userCode) {
        return [];
    }

    const vinculos = await TurmaAluno.findAll({
        where: {
            user_code: userCode,
            active: 'Y'
        },
        attributes: ['class_code']
    });

    const classCodes = [...new Set(vinculos.map((item) => item.class_code).filter(Boolean))];
    if (classCodes.length === 0) {
        return [];
    }

    const turmas = await Turma.findAll({
        where: {
            active: 'Y',
            class_code: { [Op.in]: classCodes }
        },
        attributes: ['class_code', 'class_name'],
        order: [['class_name', 'ASC']]
    });

    return turmas.map((turma) => turma.get({ plain: true }));
}

async function getStudentMassMessageAudience(usuarioSessao) {
    if (!usuarioSessao || usuarioSessao.role !== 'STD' || !usuarioSessao.user_code) {
        return {
            turmasAluno: [],
            turmaByCode: {},
            classCodes: []
        };
    }

    const turmasAluno = await getActiveTurmasForUser(usuarioSessao.user_code);
    const classCodes = [...new Set(turmasAluno.map((turma) => turma.class_code).filter(Boolean))];
    const turmaByCode = turmasAluno.reduce((acc, turma) => {
        acc[turma.class_code] = turma.class_name;
        return acc;
    }, {});

    return {
        turmasAluno,
        turmaByCode,
        classCodes
    };
}

function formatDateTimeForInput(dateValue) {
    if (!dateValue) {
        return '';
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimePtBr(dateValue) {
    if (!dateValue) {
        return '-';
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateTimePtBrWithAs(dateValue) {
    return formatDateTimePtBr(dateValue).replace(',', ' às');
}

function parseDateTimeInput(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

async function expireProfessorMessagesIfNeeded() {
    await MensagemProfessor.update(
        { status: 'E' },
        {
            where: {
                status: 'A',
                expires_at: {
                    [Op.not]: null,
                    [Op.lte]: new Date()
                }
            }
        }
    );
}

function formatDateForInput(dateValue) {
    if (!dateValue) {
        return '';
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function getTurmasDisponiveisParaMensagem(usuarioSessao) {
    if (!usuarioSessao) {
        return [];
    }

    const where = { active: 'Y' };
    if (usuarioSessao.role !== 'ADM') {
        where.created_by = usuarioSessao.user_code;
    }

    const turmas = await Turma.findAll({
        where,
        attributes: ['class_code', 'class_name'],
        order: [['class_name', 'ASC']]
    });

    return turmas.map((turma) => turma.get({ plain: true }));
}

function toMassMessageViewModel(mensagem, turmaByCode = {}) {
    const plain = typeof mensagem.get === 'function'
        ? mensagem.get({ plain: true })
        : mensagem;

    const className = turmaByCode[plain.class] || plain.class;
    const now = new Date();
    const hasExpireAt = !!plain.expires_at;
    const expiresAtDate = hasExpireAt ? new Date(plain.expires_at) : null;
    const hasValidExpireAt = expiresAtDate && !Number.isNaN(expiresAtDate.getTime());
    const msUntilExpire = hasValidExpireAt ? (expiresAtDate.getTime() - now.getTime()) : null;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    let statusLabel = 'Ativo';
    let statusBadge = 'primary';

    if (plain.status === 'E' || (hasValidExpireAt && msUntilExpire <= 0)) {
        statusLabel = 'Expirado';
        statusBadge = 'secondary';
    } else if (hasValidExpireAt && msUntilExpire <= twentyFourHoursMs) {
        statusLabel = 'Expira em breve';
        statusBadge = 'warning';
    }

    return {
        id: plain.id,
        title: plain.title,
        content: plain.content,
        class_code: plain.class,
        class_name: className,
        class_display: `${className} (${plain.class})`,
        status: plain.status,
        statusLabel,
        statusBadge,
        expiresAtLabel: formatDateTimePtBr(plain.expires_at),
        expiresAtValue: plain.expires_at,
        createdAtLabel: formatDateTimePtBr(plain.createdAt),
        createdAtValue: plain.createdAt,
        expiresAtInputValue: formatDateTimeForInput(plain.expires_at),
        deliveryKey: buildMassMessageDeliveryKey(plain)
    };
}

function buildMassMessageDeliveryKey(mensagem) {
    const plain = typeof mensagem.get === 'function'
        ? mensagem.get({ plain: true })
        : mensagem;

    const createdAt = plain.createdAt ? new Date(plain.createdAt).toISOString() : '';
    const updatedAt = plain.updatedAt ? new Date(plain.updatedAt).toISOString() : '';
    const expiresAt = plain.expires_at ? new Date(plain.expires_at).toISOString() : '';

    return [
        plain.id,
        plain.class,
        plain.title,
        plain.content,
        plain.status,
        expiresAt,
        createdAt,
        updatedAt
    ].join('|');
}

function buildStudentMassMessageBellViewModel(state) {
    return {
        href: '/mensagens/mestre',
        unreadCount: state.unreadCount,
        totalCount: state.totalCount,
        hasUnread: state.unreadCount > 0
    };
}

async function getStudentMassMessageState(usuarioSessao) {
    const emptyState = {
        messages: [],
        unreadMessages: [],
        unreadCount: 0,
        totalCount: 0,
        turmaByCode: {},
        classCodes: []
    };

    if (!usuarioSessao || usuarioSessao.role !== 'STD') {
        return emptyState;
    }

    const audience = await getStudentMassMessageAudience(usuarioSessao);
    if (audience.classCodes.length === 0) {
        return {
            ...emptyState,
            turmaByCode: audience.turmaByCode,
            classCodes: audience.classCodes
        };
    }

    const [ocultacoes, leituras] = await Promise.all([
        MensagemProfessorOcultacao.findAll({
            where: { user_code: usuarioSessao.user_code },
            attributes: ['message_id']
        }),
        MensagemProfessorLeitura.findAll({
            where: { user_code: usuarioSessao.user_code },
            attributes: ['message_id', 'viewed_at']
        })
    ]);

    const hiddenIds = ocultacoes
        .map((item) => Number(item.message_id))
        .filter((id) => Number.isInteger(id) && id > 0);

    const readByMessageId = new Map(
        leituras
            .map((item) => {
                const id = Number(item.message_id);
                if (!Number.isInteger(id) || id <= 0) {
                    return null;
                }

                // Alguns registros antigos podem ter `viewed_at` nulo.
                // A existência do registro indica que a mensagem foi marcada como lida.
                return [id, item.viewed_at || true];
            })
            .filter(Boolean)
    );

    const where = {
        status: { [Op.in]: ['A', 'E'] },
        class: { [Op.in]: audience.classCodes }
    };

    if (hiddenIds.length > 0) {
        where.id = { [Op.notIn]: hiddenIds };
    }

    const mensagens = await MensagemProfessor.findAll({
        where,
        order: [['createdAt', 'DESC']]
    });

    const messages = mensagens.map((mensagem) => {
        const vm = toMassMessageViewModel(mensagem, audience.turmaByCode);
        const messageId = Number(vm.id);
        const readMarker = readByMessageId.get(messageId) || null;
        const isRead = readByMessageId.has(messageId);
        const readAt = readMarker && readMarker !== true ? readMarker : null;
        const isExpired = vm.statusLabel === 'Expirado';

        return {
            ...vm,
            isExpired,
            isRead,
            readAtLabel: readAt ? formatDateTimePtBrWithAs(readAt) : '',
            readStateLabel: readAt ? 'Lida' : 'Nova',
            readStateBadge: readAt ? 'secondary' : 'danger'
        };
    });

    const unreadMessages = messages.filter((message) => !message.isRead && !message.isExpired);

    return {
        messages,
        unreadMessages,
        unreadCount: unreadMessages.length,
        totalCount: messages.length,
        turmaByCode: audience.turmaByCode,
        classCodes: audience.classCodes
    };
}

async function findVisibleMassMessageForStudent(usuarioSessao, messageId) {
    const audience = await getStudentMassMessageAudience(usuarioSessao);
    if (audience.classCodes.length === 0) {
        return null;
    }

    return MensagemProfessor.findOne({
        where:
            {
                id: messageId,
                status: { [Op.in]: ['A', 'E'] },
                class: { [Op.in]: audience.classCodes }
            }
    });
}

async function markMassMessageAsRead(usuarioSessao, messageId) {
    const mensagem = await findVisibleMassMessageForStudent(usuarioSessao, messageId);
    if (!mensagem) {
        throw new Error('Mensagem não encontrada.');
    }

    const [leitura] = await MensagemProfessorLeitura.findOrCreate({
        where: {
            message_id: messageId,
            user_code: usuarioSessao.user_code
        },
        defaults: {
            viewed_at: new Date()
        }
    });

    const state = await getStudentMassMessageState(usuarioSessao);

    return {
        unreadCount: state.unreadCount,
        readAtLabel: formatDateTimePtBrWithAs(leitura.viewed_at)
    };
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizePersonName(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) {
        return '';
    }

    return text
        .split(' ')
        .map((word) => {
            const w = word.trim();
            if (!w) {
                return '';
            }

            const lower = w.toLocaleLowerCase('pt-BR');
            return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
        })
        .filter(Boolean)
        .join(' ');
}

function getResetPasswordBaseUrl(req) {
    const configuredBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL;
    if (configuredBaseUrl) {
        return configuredBaseUrl.replace(/\/$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
}

function buildResetPasswordLink(req, email, token) {
    const params = new URLSearchParams({
        email,
        token
    });

    return `${getResetPasswordBaseUrl(req)}/auth/reset-password?${params.toString()}`;
}

function getPasswordResetTransportConfig() {
    const service = process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE;
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const portValue = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;

    if (!user || !pass || (!service && !host)) {
        return null;
    }

    const port = portValue ? parseInt(portValue, 10) : undefined;
    const secureSetting = process.env.SMTP_SECURE || process.env.EMAIL_SECURE;
    const secure = typeof secureSetting === 'string'
        ? secureSetting.toLowerCase() === 'true'
        : port === 465;

    const transportConfig = {
        auth: { user, pass }
    };

    if (service) {
        transportConfig.service = service;
    } else {
        transportConfig.host = host;
        transportConfig.port = Number.isInteger(port) ? port : 587;
        transportConfig.secure = secure;
    }

    return transportConfig;
}

function buildForgotPasswordMessages(options) {
    const messages = [];

    if (typeof options.emailFound === 'boolean') {
        if (options.emailFound) {
            messages.push({
                variant: 'success',
                title: 'E-mail localizado',
                text: 'Encontramos cadastro(s) vinculado(s) ao e-mail informado.'
            });
        } else {
            messages.push({
                variant: 'warning',
                title: 'E-mail não localizado',
                text: 'Não encontramos esse e-mail em nossa base de dados.'
            });
        }
    }

    if (typeof options.deliveryStatus === 'string') {
        if (options.deliveryStatus === 'sent') {
            messages.push({
                variant: 'success',
                title: 'Mensagem enviada',
                text: 'Enviamos a mensagem de redefinição para o e-mail informado.'
            });
        } else if (options.deliveryStatus === 'preview') {
            messages.push({
                variant: 'info',
                title: 'Mensagem não enviada',
                text: 'O envio de e-mail não está configurado neste ambiente. Para teste local, use o link de redefinição exibido abaixo.'
            });
        } else if (options.deliveryStatus === 'not_found') {
            messages.push({
                variant: 'secondary',
                title: 'Mensagem não enviada',
                text: 'Nenhuma mensagem foi enviada porque o e-mail informado não foi encontrado.'
            });
        } else {
            messages.push({
                variant: 'warning',
                title: 'Mensagem não enviada',
                text: 'Não foi possível enviar a mensagem de redefinição neste momento. Tente novamente em instantes.'
            });
        }
    }

    if (options.hasDuplicateEmail) {
        messages.push({
            variant: 'info',
            title: 'Cadastros vinculados ao mesmo e-mail',
            text: 'A nova senha definida pelo link será aplicada a todos os registros associados a este e-mail.'
        });
    }

    if (options.errorMessage) {
        messages.push({
            variant: 'danger',
            title: 'Não foi possível concluir a solicitação',
            text: options.errorMessage
        });
    }

    messages.push({
        variant: 'info',
        title: 'Prazo do link',
        text: `O link de redefinição pode ser usado por apenas ${RESET_TOKEN_TTL_MINUTES} minutos. Depois disso, será necessário fazer uma nova solicitação.`
    });

    return messages;
}

function buildForgotPasswordAcknowledgementMessage() {
    return [
        {
            variant: 'primary',
            paragraphs: [
                'Se o e-mail informado existir no nosso banco de dados, uma mensagem será enviada com um link para a redefinição da senha.',
                'O prazo para utilização do link é de 10 minutos.',
                'Após o uso ou após o período, o link será inutilizado e será necessário fazer uma nova solicitação.'
            ]
        }
    ];
}

function buildResetPasswordMessages(options) {
    const messages = [];

    if (options.successMessage) {
        messages.push({
            variant: 'success',
            title: 'Senha redefinida',
            text: options.successMessage
        });
    }

    if (options.errorMessage) {
        messages.push({
            variant: 'danger',
            title: 'Link inválido ou expirado',
            text: options.errorMessage
        });
    }

    if (options.infoMessage) {
        messages.push({
            variant: 'info',
            title: 'Importante',
            text: options.infoMessage
        });
    }

    return messages;
}

function renderForgotPasswordPage(res, overrides = {}) {
    const email = typeof overrides.email === 'string' ? overrides.email : '';

    return res.render('resetpassword', {
        pageTitle: overrides.pageTitle || 'Redefinição de Senha',
        email,
        requestMode: overrides.requestMode !== false,
        resetMode: !!overrides.resetMode,
        resetCompleted: !!overrides.resetCompleted,
        statusMessages: overrides.statusMessages || [],
        token: overrides.token || '',
        previewResetLink: overrides.previewResetLink || '',
        previewResetMessage: overrides.previewResetMessage || '',
        canSubmitReset: overrides.canSubmitReset !== false,
        showBackToLogin: overrides.showBackToLogin !== false
    });
}

async function sendResetPasswordEmail(req, email, token, totalUsuarios) {
    const resetLink = buildResetPasswordLink(req, email, token);
    const transportConfig = getPasswordResetTransportConfig();
    if (!transportConfig) {
        return {
            deliveryStatus: 'preview',
            resetLink
        };
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || transportConfig.auth.user;
    const pluralLabel = totalUsuarios > 1 ? 'cadastros' : 'cadastro';

    await transporter.sendMail({
        from,
        to: email,
        subject: 'Redefinição de senha',
        text: [
            'Recebemos uma solicitação para redefinir sua senha.',
            '',
            `Este link ficará disponível por ${RESET_TOKEN_TTL_MINUTES} minutos:`,
            resetLink,
            '',
            totalUsuarios > 1
                ? `A nova senha será aplicada a todos os ${pluralLabel} vinculados a este e-mail.`
                : `A nova senha será aplicada ao ${pluralLabel} vinculado a este e-mail.`,
            '',
            'Se você não fez essa solicitação, ignore esta mensagem.'
        ].join('\n'),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #212529;">
                <h2 style="margin-bottom: 16px;">Redefinição de senha</h2>
                <p>Recebemos uma solicitação para redefinir sua senha.</p>
                <p>Use o link abaixo em até <strong>${RESET_TOKEN_TTL_MINUTES} minutos</strong>:</p>
                <p><a href="${resetLink}">${resetLink}</a></p>
                <p>${totalUsuarios > 1
                ? 'A nova senha será aplicada a todos os cadastros vinculados a este e-mail.'
                : 'A nova senha será aplicada ao cadastro vinculado a este e-mail.'}</p>
                <p>Se você não fez essa solicitação, ignore esta mensagem.</p>
            </div>
        `
    });

    return {
        deliveryStatus: 'sent',
        resetLink
    };
}

async function findUsuariosByEmail(email) {
    return Usuario.findAll({
        where: { email },
        order: [['id', 'ASC']]
    });
}

async function findUsuariosWithValidResetToken(email, token) {
    const usuarios = await findUsuariosByEmail(email);
    const now = new Date();
    const validUsuarios = [];

    for (const usuario of usuarios) {
        if (!usuario.reset_token_hash || !usuario.reset_token_expires) {
            continue;
        }

        if (new Date(usuario.reset_token_expires) < now) {
            continue;
        }

        const tokenValido = await argon2.verify(usuario.reset_token_hash, token);
        if (tokenValido) {
            validUsuarios.push(usuario);
        }
    }

    return validUsuarios;
}

const uploadsDir = path.join(__dirname, 'uploads', 'users');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const tempName = `temp_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '.jpg')}`;
        cb(null, tempName);
    }
});

const upload = multer({ storage });

// Faixas x valor x label
const BELT_OPTIONS = [
    { value: 'white', label: 'Branca', order: 1 },
    { value: 'gray_white', label: 'Cinza e Branca', order: 2 },
    { value: 'gray', label: 'Cinza', order: 3 },
    { value: 'gray_black', label: 'Cinza e Preta', order: 4 },
    { value: 'yellow_white', label: 'Amarela e Branca', order: 5 },
    { value: 'yellow', label: 'Amarela', order: 6 },
    { value: 'yellow_black', label: 'Amarela e Preta', order: 7 },
    { value: 'orange_white', label: 'Laranja e Branca', order: 8 },
    { value: 'orange', label: 'Laranja', order: 9 },
    { value: 'orange_black', label: 'Laranja e Preta', order: 10 },
    { value: 'green_white', label: 'Verde e Branca', order: 11 },
    { value: 'green', label: 'Verde', order: 12 },
    { value: 'green_black', label: 'Verde e Preta', order: 13 },
    { value: 'blue', label: 'Azul', order: 14 },
    { value: 'purple', label: 'Roxa', order: 15 },
    { value: 'brown', label: 'Marrom', order: 16 },
    { value: 'black', label: 'Preta', order: 17 }
];
const BLACK_BELT_VALUE = 'black';

const BELT_MAP = BELT_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option;
    return acc;
}, {});

const BIRTHDAY_MESSAGE_FILE_CANDIDATES = [
    path.join(__dirname, 'utils', 'frases_aniversariantes.txt'),
    path.join(__dirname, 'utils', 'frases_aniversario.txt')
];

const DEFAULT_BIRTHDAY_LEAD_MESSAGES = [
    'Seu aniversário está chegando. Que estes próximos dias sejam leves e especiais.',
    'Mais um passo para celebrar sua jornada. Que seu novo ciclo venha com paz e boas conquistas.',
    'A contagem regressiva começou. Que seu coração se encha de alegria a cada novo dia.',
    'Falta pouco para o seu aniversário. Que este tempo seja de gratidão e bons encontros.',
    'Amanhã é o seu grande dia. Que você receba carinho, paz e muitas alegrias.'
];

const BIRTHDAY_CELEBRATION_MODAL = {
    title: '🎈 FELIZ ANIVERSÁRIO! 🎈',
    bodyHtml: 'Que você tenha muita saúde, paz, prosperidade e que todos os seus desejos se transformem em vitórias e conquistas.<br><br>✨<br><b>Curta seu dia!</b>'
};

const MONTH_NAMES_PT_BR = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro'
];

function loadBirthdayLeadMessages() {
    for (const filePath of BIRTHDAY_MESSAGE_FILE_CANDIDATES) {
        try {
            if (!fs.existsSync(filePath)) {
                continue;
            }

            const fileContent = fs.readFileSync(filePath, 'utf8');
            const messages = fileContent
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            if (messages.length > 0) {
                return messages;
            }
        } catch (error) {
            console.error('Erro ao carregar mensagens de aniversario:', error.message);
        }
    }

    return DEFAULT_BIRTHDAY_LEAD_MESSAGES;
}

const BIRTHDAY_LEAD_MESSAGES = loadBirthdayLeadMessages();

function getMaxDegreeForBelt(actualBelt) {
    return actualBelt === BLACK_BELT_VALUE ? 6 : 4;
}

function getDegreeValidationMessage(actualBelt) {
    return actualBelt === BLACK_BELT_VALUE
        ? 'Faixa preta permite graus entre 0 e 6.'
        : 'A faixa selecionada permite graus entre 0 e 4.';
}

function parseDegreeStrict(value) {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized)) {
        return null;
    }

    const degree = parseInt(normalized, 10);
    return Number.isInteger(degree) ? degree : null;
}

function normalizeDegreeForBelt(actualBelt, actualDegree) {
    const parsedDegree = parseDegree(actualDegree);
    const maxDegree = getMaxDegreeForBelt(actualBelt);
    return Math.min(Math.max(parsedDegree, 0), maxDegree);
}

function validateBeltAndDegree(actualBelt, actualDegree) {
    const beltValue = String(actualBelt || '').trim();
    if (!beltValue || !BELT_MAP[beltValue]) {
        return {
            isValid: false,
            field: 'actual_belt',
            message: 'Faixa selecionada é inválida.'
        };
    }

    const parsedDegree = parseDegreeStrict(actualDegree);
    const maxDegree = getMaxDegreeForBelt(beltValue);

    if (parsedDegree === null || parsedDegree < 0 || parsedDegree > maxDegree) {
        return {
            isValid: false,
            field: 'actual_degree',
            message: getDegreeValidationMessage(beltValue)
        };
    }

    return {
        isValid: true,
        beltValue,
        degreeValue: String(parsedDegree)
    };
}

function parseDegree(value) {
    const degree = parseInt(value, 10);
    if (!Number.isInteger(degree) || degree < 0) {
        return 0;
    }
    return degree;
}

function getBeltDisplayData(actualBelt, actualDegree) {
    const beltValue = (actualBelt || '').trim();
    const degree = normalizeDegreeForBelt(beltValue, actualDegree);

    if (!beltValue || !BELT_MAP[beltValue]) {
        return {
            beltValue,
            beltLabel: '-',
            degree,
            degreeLabel: 'Nenhum Grau',
            summaryLabel: '-',
            imagePath: '/img/belts/white_0.png'
        };
    }

    const beltLabel = BELT_MAP[beltValue].label;
    const degreeLabel = degree === 0 ? 'Nenhum Grau' : `${degree} ${degree === 1 ? 'Grau' : 'Graus'}`;

    return {
        beltValue,
        beltLabel,
        degree,
        degreeLabel,
        summaryLabel: `${beltLabel} - ${degreeLabel}`,
        imagePath: `/img/belts/${beltValue}_${degree}.png`
    };
}

function parseBirthDateParts(birthDateValue) {
    if (!birthDateValue) {
        return null;
    }

    const isValidCalendarDate = (year, month, day) => {
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
            return false;
        }

        if (month < 1 || month > 12 || day < 1 || day > 31) {
            return false;
        }

        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year
            && date.getMonth() === (month - 1)
            && date.getDate() === day;
    };

    let year;
    let month;
    let day;

    if (birthDateValue instanceof Date) {
        if (Number.isNaN(birthDateValue.getTime())) {
            return null;
        }

        // DATEONLY pode chegar como Date em UTC (00:00:00Z).
        // Usamos componentes UTC para evitar regressao de um dia por fuso.
        year = birthDateValue.getUTCFullYear();
        month = birthDateValue.getUTCMonth() + 1;
        day = birthDateValue.getUTCDate();
    } else {
        const normalized = String(birthDateValue || '').trim();
        if (!normalized) {
            return null;
        }

        const isoMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
        const brMatch = normalized.match(/(\d{2})\/(\d{2})\/(\d{4})/);

        if (isoMatch) {
            year = parseInt(isoMatch[1], 10);
            month = parseInt(isoMatch[2], 10);
            day = parseInt(isoMatch[3], 10);
        } else if (brMatch) {
            day = parseInt(brMatch[1], 10);
            month = parseInt(brMatch[2], 10);
            year = parseInt(brMatch[3], 10);
        } else {
            const parsed = new Date(normalized);
            if (Number.isNaN(parsed.getTime())) {
                return null;
            }

            year = parsed.getFullYear();
            month = parsed.getMonth() + 1;
            day = parsed.getDate();
        }
    }

    if (!isValidCalendarDate(year, month, day)) {
        return null;
    }

    return { year, month, day };
}

function calculateAgeFromBirthDateParts(parts, todayDate = new Date()) {
    if (!parts) {
        return 0;
    }

    const todayYear = todayDate.getFullYear();
    const todayMonth = todayDate.getMonth() + 1;
    const todayDay = todayDate.getDate();

    let age = todayYear - parts.year;
    const birthdayPassed = todayMonth > parts.month || (todayMonth === parts.month && todayDay >= parts.day);

    if (!birthdayPassed) {
        age -= 1;
    }

    return Math.max(age, 0);
}

function buildBirthdayWidgetData(users = [], todayDate = new Date()) {
    const todayDay = todayDate.getDate();
    const todayMonthIndex = todayDate.getMonth();

    const birthdays = users
        .map((user) => {
            const plain = user.get({ plain: true });
            const birthParts = parseBirthDateParts(plain.birth_date);
            if (!birthParts) {
                return null;
            }

            const fullName = `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code;
            const age = calculateAgeFromBirthDateParts(birthParts, todayDate);
            const beltDisplay = getBeltDisplayData(plain.actual_belt, plain.actual_degree);
            const birthMonthIndex = birthParts.month - 1;
            const birthMonthLabel = MONTH_NAMES_PT_BR[birthMonthIndex] || '-';
            const isToday = birthParts.day === todayDay && birthMonthIndex === todayMonthIndex;

            return {
                user_code: plain.user_code,
                full_name: fullName,
                avatar: plain.photo || '/uploads/users/default.jpg',
                age,
                birth_year: birthParts.year,
                birth_month_index: birthMonthIndex,
                birth_day: birthParts.day,
                birth_month_label: birthMonthLabel,
                birth_short: `${String(birthParts.day).padStart(2, '0')}/${String(birthParts.month).padStart(2, '0')}`,
                birth_full: `${String(birthParts.day).padStart(2, '0')}/${String(birthParts.month).padStart(2, '0')}/${birthParts.year}`,
                is_today: isToday,
                belt_label: beltDisplay.beltLabel,
                degree_label: beltDisplay.degreeLabel,
                belt_summary_label: beltDisplay.summaryLabel,
                belt_image_path: beltDisplay.imagePath
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.birth_month_index !== b.birth_month_index) {
                return a.birth_month_index - b.birth_month_index;
            }

            if (a.birth_day !== b.birth_day) {
                return a.birth_day - b.birth_day;
            }

            return a.full_name.localeCompare(b.full_name, 'pt-BR');
        });

    return {
        currentMonth: todayMonthIndex,
        currentMonthLabel: MONTH_NAMES_PT_BR[todayMonthIndex],
        birthdays
    };
}

function buildBirthdayOccurrenceDate(parts, referenceDate = new Date()) {
    if (!parts) {
        return null;
    }

    const referenceYear = referenceDate.getFullYear();
    const candidate = new Date(referenceYear, parts.month - 1, parts.day);

    if (
        referenceDate.getMonth() > candidate.getMonth()
        || (referenceDate.getMonth() === candidate.getMonth() && referenceDate.getDate() > candidate.getDate())
    ) {
        return new Date(referenceYear + 1, parts.month - 1, parts.day);
    }

    return candidate;
}

function getDiffInDays(startDate, endDate) {
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    const diffMs = end.getTime() - start.getTime();
    return Math.round(diffMs / 86400000);
}

function getRandomBirthdayLeadMessage() {
    const messages = Array.isArray(BIRTHDAY_LEAD_MESSAGES) && BIRTHDAY_LEAD_MESSAGES.length > 0
        ? BIRTHDAY_LEAD_MESSAGES
        : DEFAULT_BIRTHDAY_LEAD_MESSAGES;

    if (messages.length === 0) {
        return 'Seu aniversário está chegando!';
    }

    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex];
}

function isBirthdayMessagesDisabledForYear(usuario, referenceDate = new Date()) {
    if (!usuario || !usuario.birthday_messages_disabled) {
        return false;
    }

    const currentYear = referenceDate.getFullYear();
    const disabledYear = parseInt(usuario.birthday_messages_disabled_year, 10);
    return Number.isInteger(disabledYear) && disabledYear === currentYear;
}

function buildBirthdayLoginModalData(usuario, todayDate = new Date()) {
    if (!usuario || isBirthdayMessagesDisabledForYear(usuario, todayDate)) {
        return null;
    }

    const birthParts = parseBirthDateParts(usuario.birth_date);
    if (!birthParts) {
        return null;
    }

    const nextBirthday = buildBirthdayOccurrenceDate(birthParts, todayDate);
    if (!nextBirthday) {
        return null;
    }

    const daysUntilBirthday = getDiffInDays(todayDate, nextBirthday);

    if (daysUntilBirthday === 0) {
        return {
            title: BIRTHDAY_CELEBRATION_MODAL.title,
            bodyHtml: BIRTHDAY_CELEBRATION_MODAL.bodyHtml,
            isBirthday: true,
            checkboxLabel: 'não exibir mais as mensagens de aniversário'
        };
    }

    if (daysUntilBirthday < 1 || daysUntilBirthday > 5) {
        return null;
    }

    return {
        title: 'Seu aniversário está chegando!',
        bodyHtml: getRandomBirthdayLeadMessage(),
        isBirthday: false,
        checkboxLabel: 'não exibir mais as mensagens de aniversário'
    };
}

function formatTimestampForFile(dateValue) {
    const date = new Date(dateValue);
    const pad = (n) => String(n).padStart(2, '0');

    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function optimizeImageTo1MB(inputPath, outputPath) {
    const maxBytes = 1048576; // 1MB
    let quality = 90;
    let buffer;

    while (quality >= 30) {
        buffer = await sharp(inputPath)
            .resize(200, 200, {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality, progressive: true })
            .toBuffer();

        if (buffer.length <= maxBytes) {
            break;
        }
        quality -= 5;
    }

    await fs.promises.writeFile(outputPath, buffer);
    return buffer.length;
}

async function removeExistingUserImages(userId) {
    const idPrefix = `${userId}_`;
    const files = await fs.promises.readdir(uploadsDir);

    const filesToDelete = files.filter((fileName) => fileName.startsWith(idPrefix));

    await Promise.all(filesToDelete.map(async (fileName) => {
        const filePath = path.join(uploadsDir, fileName);
        await fs.promises.unlink(filePath);
    }));
}

async function replaceUserPhoto(usuario, tempFileName) {
    const timestamp = formatTimestampForFile(new Date());
    const finalFileName = `${usuario.id}_${timestamp}.jpg`;
    const tempFilePath = path.join(uploadsDir, tempFileName);
    const finalFilePath = path.join(uploadsDir, finalFileName);

    try {
        await removeExistingUserImages(usuario.id);
        const fileSize = await optimizeImageTo1MB(tempFilePath, finalFilePath);

        if (tempFilePath !== finalFilePath && fs.existsSync(tempFilePath)) {
            await fs.promises.unlink(tempFilePath);
        }

        usuario.photo = `/uploads/users/${finalFileName}`;
        await usuario.save();

        return { finalFileName, fileSize };
    } catch (error) {
        if (fs.existsSync(tempFilePath)) {
            await fs.promises.unlink(tempFilePath);
        }
        throw error;
    }
}

function getFileNameFromPhotoPath(photoPath) {
    if (typeof photoPath !== 'string') {
        return '';
    }

    return path.basename(photoPath);
}

function isTempPhotoPath(photoPath) {
    const fileName = getFileNameFromPhotoPath(photoPath);
    return fileName.startsWith('temp_');
}

async function deleteUserTempPhotoIfExists(usuario) {
    if (!isTempPhotoPath(usuario.photo)) {
        return false;
    }

    const fileName = getFileNameFromPhotoPath(usuario.photo);
    const filePath = path.join(uploadsDir, fileName);

    if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
    }

    usuario.photo = '/uploads/users/default.jpg';
    await usuario.save();
    return true;
}

async function finalizePendingPhotoIfNeeded(usuario) {
    if (!isTempPhotoPath(usuario.photo)) {
        return null;
    }

    const tempFileName = getFileNameFromPhotoPath(usuario.photo);
    return replaceUserPhoto(usuario, tempFileName);
}

function buildUserFormViewModel(usuario, isEditMode, turmaOptions = []) {
    const formData = usuario
        ? usuario.get({ plain: true })
        : {
            first_name: '',
            last_name: '',
            email: '',
            phone: '',
            birth_date: '',
            actual_belt: '',
            actual_degree: '0',
            wagi_size: '',
            zubon_size: '',
            obi_size: '',
            photo: '/uploads/users/default.jpg',
            class_code: ''
        };

    const selectedClassCode = formData.class_code || '';

    return {
        isEditMode,
        title: isEditMode ? 'Editar Aluno' : 'Novo Aluno',
        submitLabel: isEditMode ? 'Salvar alterações' : 'Enviar',
        formAction: isEditMode ? `/aluno/editar/${formData.id}` : '/aluno/cadastrar',
        usuario: formData,
        beltOptions: BELT_OPTIONS.map((option) => ({
            ...option,
            selected: option.value === formData.actual_belt
        })),
        turmaOptions: turmaOptions.map((turma) => ({
            ...turma,
            selected: turma.class_code === selectedClassCode
        }))
    };
}

// ### CONFIGURAÇÃO DAS ROTAS ###
// rota principal
app.get('/', (req, res) => {
    return res.redirect(getDefaultRedirectByRole(req.session.usuario.role));
});

app.get('/dashboard', async (req, res) => {
    try {
        const birthdayUsers = await Usuario.findAll({
            where: {
                role: 'STD',
                user_status: 'A',
                birth_date: {
                    [Op.not]: null
                }
            },
            attributes: [
                'user_code',
                'first_name',
                'last_name',
                'birth_date',
                'photo',
                'actual_belt',
                'actual_degree'
            ],
            order: [['first_name', 'ASC'], ['last_name', 'ASC']]
        });

        const birthdayWidget = buildBirthdayWidgetData(birthdayUsers);

        if (hasProfessorAccess(req.session.usuario)) {
            const pendingStudentCount = await Usuario.count({
                where: {
                    role: 'STD',
                    user_status: 'P'
                }
            });
            const pendingPresencaCount = await Presenca.count({
                where: { status: 'P' }
            });

            return res.render('dashboardprofessor', {
                birthdayWidget,
                pendingStudentCount,
                pendingPresencaCount
            });
        }

        const userCode = await getEffectiveUserCode(req);
        const metaProgress = userCode ? await getCurrentMetaProgressForStudent(userCode) : null;
        return res.render('dashboardaluno', { birthdayWidget, metaProgress });
    } catch (err) {
        console.error('Erro ao carregar dashboard com aniversariantes:', err);

        if (hasProfessorAccess(req.session.usuario)) {
            const pendingStudentCount = await Usuario.count({
                where: {
                    role: 'STD',
                    user_status: 'P'
                }
            });
            const pendingPresencaCount = await Presenca.count({
                where: { status: 'P' }
            });

            return res.render('dashboardprofessor', {
                birthdayWidget: {
                    currentMonth: new Date().getMonth(),
                    currentMonthLabel: MONTH_NAMES_PT_BR[new Date().getMonth()],
                    birthdays: []
                },
                pendingStudentCount,
                pendingPresencaCount
            });
        }

        const userCode = await getEffectiveUserCode(req);
        const metaProgress = userCode ? await getCurrentMetaProgressForStudent(userCode) : null;
        return res.render('dashboardaluno', {
            birthdayWidget: { currentMonth: new Date().getMonth(), currentMonthLabel: MONTH_NAMES_PT_BR[new Date().getMonth()], birthdays: [] },
            metaProgress
        });
    }
});

app.get('/dashboardaluno', (req, res) => {
    return res.redirect('/dashboard');
});

app.get('/mensagens/mestre', async (req, res) => {
    const usuarioSessao = req.session.usuario;
    if (!usuarioSessao || usuarioSessao.role !== 'STD') {
        const mensagem = 'Acesso restrito ao aluno.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        const state = await getStudentMassMessageState(usuarioSessao);

        return res.render('mensagensmestre', {
            mensagem: req.query.mensagem || '',
            tipoMensagem: req.query.tipo || 'info',
            mensagens: state.messages,
            totalMensagens: state.totalCount,
            totalNaoLidas: state.unreadCount,
            totalLidas: state.totalCount - state.unreadCount
        });
    } catch (err) {
        return res.render('mensagensmestre', {
            mensagem: 'Erro ao carregar mensagens do mestre: ' + err.message,
            tipoMensagem: 'danger',
            mensagens: [],
            totalMensagens: 0,
            totalNaoLidas: 0,
            totalLidas: 0
        });
    }
});

app.get('/mensagens', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Acesso restrito a professor e administrador.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        await expireProfessorMessagesIfNeeded();

        const turmasDisponiveis = await getTurmasDisponiveisParaMensagem(req.session.usuario);
        const turmaByCode = turmasDisponiveis.reduce((acc, turma) => {
            acc[turma.class_code] = turma.class_name;
            return acc;
        }, {});

        const where = {};
        if (req.session.usuario.role !== 'ADM') {
            where.created_by = req.session.usuario.user_code;
        }

        const mensagensAtivas = await MensagemProfessor.findAll({
            where: {
                ...where,
                status: 'A'
            },
            order: [['expires_at', 'ASC']]
        });

        const mensagensExpiradas = await MensagemProfessor.findAll({
            where: {
                ...where,
                status: 'E'
            },
            order: [['createdAt', 'DESC']]
        });

        const mensagensAtivasVm = mensagensAtivas.map((mensagem) => toMassMessageViewModel(mensagem, turmaByCode));
        const mensagensExpiradasVm = mensagensExpiradas.map((mensagem) => toMassMessageViewModel(mensagem, turmaByCode));

        const defaultExpireDate = new Date();
        defaultExpireDate.setDate(defaultExpireDate.getDate() + 7);

        return res.render('mensagens', {
            mensagem: req.query.mensagem || '',
            tipoMensagem: req.query.tipo || 'info',
            mensagensAtivas: mensagensAtivasVm,
            mensagensExpiradas: mensagensExpiradasVm,
            totalMensagens: mensagensAtivasVm.length + mensagensExpiradasVm.length,
            turmas: turmasDisponiveis,
            defaultExpireAt: formatDateTimeForInput(defaultExpireDate)
        });
    } catch (err) {
        return res.render('mensagens', {
            mensagem: 'Erro ao carregar mensagens: ' + err.message,
            tipoMensagem: 'danger',
            mensagensAtivas: [],
            mensagensExpiradas: [],
            totalMensagens: 0,
            turmas: [],
            defaultExpireAt: ''
        });
    }
});

app.get('/metasdeaula', async (req, res) => {
    const usuarioSessao = req.session.usuario;
    if (!usuarioSessao) {
        return res.redirect('/dashboard');
    }

    try {
        const isProfessorPage = hasProfessorAccess(usuarioSessao);
        const isStudentPage = usuarioSessao.role === 'STD';

        if (!isProfessorPage && !isStudentPage) {
            const mensagem = 'Acesso restrito ao sistema.';
            return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
        }

        if (isProfessorPage) {
            const turmas = await Turma.findAll({ where: { active: 'Y' }, order: [['class_name', 'ASC']] });
            const turmasVm = turmas.map((turma) => turma.get({ plain: true }));
            const where = {};
            if (usuarioSessao.role !== 'ADM') {
                where.created_by = usuarioSessao.user_code;
            }

            const metas = await MetaAula.findAll({
                where,
                include: [{ model: Turma, as: 'turmas', through: { attributes: [] } }],
                order: [['createdAt', 'DESC']]
            });

            const metasVm = metas.map((meta) => {
                const plain = meta.get({ plain: true });
                const classesLabel = (plain.turmas || []).map((turma) => turma.class_name).join(', ') || '-';
                
                // Formatar datas
                const startDateFormatted = plain.start_date ? new Date(plain.start_date).toLocaleDateString('pt-BR') : '-';
                const endDateFormatted = plain.end_date ? new Date(plain.end_date).toLocaleDateString('pt-BR') : '-';
                
                return {
                    ...plain,
                    classesLabel,
                    start_date: startDateFormatted,
                    end_date: endDateFormatted,
                    statusLabel: plain.status === 'A' ? 'Ativa' : 'Encerrada'
                };
            });

            return res.render('metasdeaula', {
                mensagem: req.query.mensagem || '',
                tipoMensagem: req.query.tipo || 'info',
                isProfessorPage: true,
                turmas: turmasVm,
                metas: metasVm
            });
        }

        const turmasAluno = await TurmaAluno.findAll({
            where: { user_code: usuarioSessao.user_code, active: 'Y' },
            attributes: ['class_code']
        });
        const classCodes = [...new Set(turmasAluno.map((item) => item.class_code))].filter(Boolean);

        console.log('=== DEBUG GET /metasdeaula (Aluno) ===');
        console.log('Aluno:', usuarioSessao.user_code, usuarioSessao.first_name);
        console.log('Turmas do aluno:', classCodes);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        console.log('Data de filtro (today):', today);

        const pageSize = 10;
        const currentPage = Math.max(1, parseInt(req.query.page, 10) || 1);
        const offset = (currentPage - 1) * pageSize;

        let metasResult = { count: 0, rows: [] };
        if (classCodes.length > 0) {
            metasResult = await MetaAula.findAndCountAll({
                where: {
                    status: 'A',
                    end_date: {
                        [Op.gte]: today
                    }
                },
                include: [
                    {
                        model: Turma,
                        as: 'turmas',
                        through: { attributes: [] },
                        where: { class_code: { [Op.in]: classCodes } }
                    },
                    {
                        model: Usuario,
                        as: 'criador',
                        attributes: ['first_name', 'last_name']
                    }
                ],
                order: [['start_date', 'ASC']],
                limit: pageSize,
                offset,
                distinct: true,
                raw: false
            });
        }

        const totalMetas = metasResult.count || 0;
        const totalPages = Math.max(1, Math.ceil(totalMetas / pageSize));
        const currentPageSafe = Math.min(currentPage, totalPages);
        const pageNumbers = totalPages > 1 ? Array.from({ length: totalPages }, (_, index) => index + 1) : [];
        const metas = metasResult.rows || [];

        console.log('Metas encontradas:', totalMetas);
        if (metas.length > 0) {
            console.log('Primeira meta:', metas[0].dataValues);
        }

        const metasVm = metas.map((meta) => {
            const plain = meta.get({ plain: true });
            const classesLabel = (plain.turmas || []).map((turma) => turma.class_name).join(', ') || '-';
            
            // Formatar datas
            const startDateFormatted = plain.start_date ? new Date(plain.start_date).toLocaleDateString('pt-BR') : '-';
            const endDateFormatted = plain.end_date ? new Date(plain.end_date).toLocaleDateString('pt-BR') : '-';
            
            return {
                ...plain,
                classesLabel,
                start_date: startDateFormatted,
                end_date: endDateFormatted
            };
        });

        return res.render('metasdeaula', {
            mensagem: req.query.mensagem || '',
            tipoMensagem: req.query.tipo || 'info',
            isProfessorPage: false,
            metas: metasVm,
            currentPage: currentPageSafe,
            totalPages,
            pageNumbers,
            prevPage: Math.max(1, currentPageSafe - 1),
            nextPage: Math.min(totalPages, currentPageSafe + 1)
        });
    } catch (err) {
        console.error('Erro ao carregar metas para aluno:', err);
        return res.render('metasdeaula', {
            mensagem: 'Erro ao carregar metas de aula: ' + err.message,
            tipoMensagem: 'danger',
            isProfessorPage: hasProfessorAccess(req.session.usuario),
            turmas: [],
            metas: []
        });
    }
});

app.post('/metasdeaula', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Acesso restrito a professor e administrador.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        const parseDateOnlyFlexible = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return null;

            // aceita yyyy-mm-dd (input type="date") ou dd/mm/yyyy (máscara)
            const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (isoMatch) {
                const d = new Date(raw);
                if (Number.isNaN(d.getTime())) return null;
                return { iso: raw, date: d };
            }

            const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (brMatch) {
                const dd = parseInt(brMatch[1], 10);
                const mm = parseInt(brMatch[2], 10);
                const yyyy = parseInt(brMatch[3], 10);
                const d = new Date(yyyy, mm - 1, dd);
                if (Number.isNaN(d.getTime())) return null;
                // valida consistência (ex: 31/02 vira março)
                if (d.getFullYear() !== yyyy || (d.getMonth() + 1) !== mm || d.getDate() !== dd) return null;
                const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
                return { iso, date: d };
            }

            return null;
        };

        const title = String(req.body.title || '').trim();
        const description = String(req.body.description || '').trim();
        const totalClasses = Number.parseInt(String(req.body.total_classes || '').trim(), 10);
        const minClasses = Number.parseInt(String(req.body.min_classes || '').trim(), 10);
        const startDateRaw = String(req.body.start_date || '').trim();
        const endDateRaw = String(req.body.end_date || '').trim();
        const examStartRaw = String(req.body.exam_start_date || '').trim();
        const examEndRaw = String(req.body.exam_end_date || '').trim();
        const sendNotice = String(req.body.send_notice || 'no').trim().toLowerCase();
        const rawClassCodes = Array.isArray(req.body.class_codes)
            ? req.body.class_codes
            : req.body.class_codes
                ? [req.body.class_codes]
                : [];

        const classCodes = [...new Set(rawClassCodes.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];

        if (!title) {
            throw new Error('Informe o título da meta de aula.');
        }
        if (title.length > 50) {
            throw new Error('Título deve ter no máximo 50 caracteres.');
        }
        if (!description) {
            throw new Error('Informe a descrição da meta de aula.');
        }
        if (!Number.isInteger(totalClasses) || totalClasses < 0) {
            throw new Error('Quantidade total de aulas inválida.');
        }
        if (!Number.isInteger(minClasses) || minClasses < 0) {
            throw new Error('Quantidade mínima de aulas inválida.');
        }
        if (minClasses > totalClasses) {
            throw new Error('A quantidade mínima de aulas não pode ser maior que a quantidade total.');
        }
        if (!startDateRaw) {
            throw new Error('Informe a data de início da meta.');
        }
        if (!endDateRaw) {
            throw new Error('Informe a data de término da meta.');
        }
        if (!examStartRaw) {
            throw new Error('Informe o início do período de exame.');
        }
        if (!examEndRaw) {
            throw new Error('Informe o término do período de exame.');
        }

        const startParsed = parseDateOnlyFlexible(startDateRaw);
        const endParsed = parseDateOnlyFlexible(endDateRaw);
        const examStartParsed = parseDateOnlyFlexible(examStartRaw);
        const examEndParsed = parseDateOnlyFlexible(examEndRaw);

        if (!startParsed) {
            throw new Error('Data de início inválida.');
        }
        if (!endParsed) {
            throw new Error('Data de término inválida.');
        }
        if (!examStartParsed) {
            throw new Error('Início do período de exame inválido.');
        }
        if (!examEndParsed) {
            throw new Error('Término do período de exame inválido.');
        }

        if (startParsed.date > endParsed.date) {
            throw new Error('A data de início deve ser anterior ou igual à data de término.');
        }
        if (examStartParsed.date > examEndParsed.date) {
            throw new Error('O início do período de exame deve ser anterior ou igual ao término do período de exame.');
        }
        if (examStartParsed.date < startParsed.date || examEndParsed.date > endParsed.date) {
            throw new Error('O período de exame deve estar dentro do período da meta (início e término).');
        }
        if (classCodes.length === 0) {
            throw new Error('Selecione pelo menos uma turma para aplicar a meta.');
        }

        const activeTurmas = await Turma.findAll({ where: { active: 'Y' }, attributes: ['class_code'] });
        const allowedCodes = new Set(activeTurmas.map((item) => item.class_code));
        const invalidClass = classCodes.some((code) => !allowedCodes.has(code));
        if (invalidClass) {
            throw new Error('Uma ou mais turmas selecionadas não estão disponíveis.');
        }

        // Observação: não bloqueamos títulos "parecidos".
        // Exemplos válidos: "Graduação - 1º Semestre - 2026" e "Graduação - 2º Semestre - 2026".

        const meta = await MetaAula.create({
            title,
            description,
            total_classes: totalClasses,
            min_classes: minClasses,
            start_date: startParsed.iso,
            end_date: endParsed.iso,
            exam_start_date: examStartParsed.iso,
            exam_end_date: examEndParsed.iso,
            keep_notices: sendNotice === 'yes',
            created_by: req.session.usuario.user_code,
            status: 'A'
        });

        await MetaAulaTurma.bulkCreate(classCodes.map((classCode) => ({
            meta_id: meta.id,
            class_code: classCode
        })));

        let mensagem = 'Meta de aula criada com sucesso.';
        let tipo = 'success';

        if (sendNotice === 'yes') {
            const expiresAt = new Date(`${endParsed.iso}T23:59:59`);
            const noticePayload = classCodes.map((classCode) => ({
                title: 'Nova meta de aula',
                content: `Uma nova meta de aula foi criada pelo professor ${req.session.usuario.first_name || ''} ${req.session.usuario.last_name || ''}. Fique ligado(a)!`,
                class: classCode,
                created_by: req.session.usuario.user_code,
                expires_at: expiresAt,
                status: 'A'
            }));

            try {
                const novasMensagens = await MensagemProfessor.bulkCreate(noticePayload);
                
                // Buscar todos os alunos das turmas selecionadas
                const enrollments = await TurmaAluno.findAll({
                    where: { class_code: { [Op.in]: classCodes }, active: 'Y' },
                    attributes: ['user_code']
                });
                const studentUserCodes = [...new Set(enrollments.map((e) => e.user_code))].filter(Boolean);

                // Criar registros de "não lida" para cada aluno em cada mensagem
                if (studentUserCodes.length > 0 && novasMensagens.length > 0) {
                    const leituraPayload = [];
                    novasMensagens.forEach((msg) => {
                        studentUserCodes.forEach((userCode) => {
                            leituraPayload.push({
                                message_id: msg.id,
                                user_code: userCode,
                                viewed_at: null
                            });
                        });
                    });
                    
                    try {
                        await MensagemProfessorLeitura.bulkCreate(leituraPayload);
                    } catch (leituraError) {
                        console.error('Erro ao marcar mensagens como não-lidas:', leituraError);
                    }
                }
                
                mensagem += ' Aviso enviado aos alunos matriculados.';
            } catch (noticeError) {
                console.error('Erro ao enviar aviso:', noticeError);
                mensagem += ' Não foi possível enviar o aviso aos alunos.';
                tipo = 'warning';
            }
        }

        return res.redirect(`/metasdeaula?mensagem=${encodeURIComponent(mensagem)}&tipo=${tipo}`);
    } catch (err) {
        return res.redirect(`/metasdeaula?mensagem=${encodeURIComponent(err.message)}&tipo=danger`);
    }
});

app.post('/mensagens', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Acesso restrito a professor e administrador.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        const title = String(req.body.title || '').trim();
        const content = String(req.body.content || '').trim();
        const expiresAtInput = String(req.body.expires_at || '').trim();
        const rawClassCodes = Array.isArray(req.body.class_codes)
            ? req.body.class_codes
            : [req.body.class_codes || req.body.class];

        const classCodes = [...new Set(rawClassCodes.map((item) => String(item || '').trim()).filter(Boolean))];
        const submissionKey = JSON.stringify({
            title,
            content,
            expiresAtInput,
            classCodes: [...classCodes].sort()
        });

        const lastSubmission = req.session.lastMassMessageSubmission;
        const isRepeatedSubmission = Boolean(
            lastSubmission
            && lastSubmission.key === submissionKey
            && (Date.now() - Number(lastSubmission.at || 0)) < 10000
        );

        if (isRepeatedSubmission) {
            const mensagemDuplicada = 'Envio duplicado detectado. A mensagem ja foi processada agora mesmo.';
            return res.redirect(`/mensagens?mensagem=${encodeURIComponent(mensagemDuplicada)}&tipo=warning`);
        }

        if (!title) {
            throw new Error('Informe o titulo da mensagem.');
        }
        if (title.length > 50) {
            throw new Error('Titulo deve ter no maximo 50 caracteres.');
        }

        if (!content) {
            throw new Error('Informe o conteudo da mensagem.');
        }
        if (content.length > 255) {
            throw new Error('Mensagem deve ter no maximo 255 caracteres.');
        }

        if (classCodes.length === 0) {
            throw new Error('Selecione pelo menos uma turma para receber a mensagem.');
        }

        const expiresAt = parseDateTimeInput(expiresAtInput);
        if (!expiresAt) {
            throw new Error('Informe uma data de expiracao valida.');
        }
        if (expiresAt <= new Date()) {
            throw new Error('A data de expiracao deve ser maior que o momento atual.');
        }

        const turmasDisponiveis = await getTurmasDisponiveisParaMensagem(req.session.usuario);
        const allowedCodes = new Set(turmasDisponiveis.map((item) => item.class_code));
        const hasInvalidClass = classCodes.some((code) => !allowedCodes.has(code));
        if (hasInvalidClass) {
            throw new Error('Uma ou mais turmas selecionadas nao estao disponiveis para o seu perfil.');
        }

        const payload = classCodes.map((classCode) => ({
            title,
            content,
            class: classCode,
            created_by: req.session.usuario.user_code,
            expires_at: expiresAt,
            status: 'A'
        }));

        const novasMensagens = await MensagemProfessor.bulkCreate(payload);
        
        // Buscar todos os alunos das turmas selecionadas e marcar mensagens como não-lidas
        const enrollments = await TurmaAluno.findAll({
            where: { class_code: { [Op.in]: classCodes }, active: 'Y' },
            attributes: ['user_code']
        });
        const studentUserCodes = [...new Set(enrollments.map((e) => e.user_code))].filter(Boolean);

        if (studentUserCodes.length > 0 && novasMensagens.length > 0) {
            const leituraPayload = [];
            novasMensagens.forEach((msg) => {
                studentUserCodes.forEach((userCode) => {
                    leituraPayload.push({
                        message_id: msg.id,
                        user_code: userCode,
                        viewed_at: null
                    });
                });
            });
            
            try {
                await MensagemProfessorLeitura.bulkCreate(leituraPayload);
            } catch (leituraError) {
                console.error('Erro ao marcar mensagens como não-lidas:', leituraError);
            }
        }

        req.session.lastMassMessageSubmission = {
            key: submissionKey,
            at: Date.now()
        };

        const mensagem = classCodes.length > 1
            ? 'Mensagens em massa criadas com sucesso para as turmas selecionadas.'
            : 'Mensagem em massa criada com sucesso.';

        return res.redirect(`/mensagens?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        return res.redirect(`/mensagens?mensagem=${encodeURIComponent(err.message)}&tipo=danger`);
    }
});

app.post('/mensagens/:id/reativar', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Acesso restrito a professor e administrador.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        await expireProfessorMessagesIfNeeded();

        const messageId = parseInt(req.params.id, 10);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            throw new Error('Mensagem invalida para reativacao.');
        }

        const title = String(req.body.reactivate_title || '').trim();
        const content = String(req.body.reactivate_content || '').trim();
        const expiresAt = parseDateTimeInput(req.body.reactivate_expires_at);
        const rawClassCodes = Array.isArray(req.body.reactivate_class_codes)
            ? req.body.reactivate_class_codes
            : [req.body.reactivate_class_codes || req.body.reactivate_class_code || ''];
        const classCodes = [...new Set(rawClassCodes.map((item) => String(item || '').trim()).filter(Boolean))];

        if (!title) {
            throw new Error('Informe o titulo da mensagem.');
        }
        if (title.length > 50) {
            throw new Error('Titulo deve ter no maximo 50 caracteres.');
        }

        if (!content) {
            throw new Error('Informe o conteudo da mensagem.');
        }
        if (content.length > 255) {
            throw new Error('Mensagem deve ter no maximo 255 caracteres.');
        }

        if (classCodes.length === 0) {
            throw new Error('Selecione a turma alvo da mensagem.');
        }

        if (!expiresAt) {
            throw new Error('Informe uma nova data de expiracao valida.');
        }
        if (expiresAt <= new Date()) {
            throw new Error('A nova data de expiracao deve ser maior que o momento atual.');
        }

        const turmasDisponiveis = await getTurmasDisponiveisParaMensagem(req.session.usuario);
        const allowedCodes = new Set(turmasDisponiveis.map((item) => item.class_code));
        const hasInvalidClass = classCodes.some((code) => !allowedCodes.has(code));
        if (hasInvalidClass) {
            throw new Error('Uma ou mais turmas selecionadas nao estao disponiveis para o seu perfil.');
        }

        const where = { id: messageId };
        if (req.session.usuario.role !== 'ADM') {
            where.created_by = req.session.usuario.user_code;
        }

        const mensagemExistente = await MensagemProfessor.findOne({ where });
        if (!mensagemExistente) {
            throw new Error('Mensagem nao encontrada ou sem permissao para reativar.');
        }

        mensagemExistente.title = title;
        mensagemExistente.content = content;
        mensagemExistente.class = classCodes[0];
        mensagemExistente.expires_at = expiresAt;
        mensagemExistente.status = 'A';
        await mensagemExistente.save();

        // Reativacao deve voltar como mensagem nova para os alunos.
        await Promise.all([
            MensagemProfessorLeitura.destroy({
                where: { message_id: mensagemExistente.id }
            }),
            MensagemProfessorOcultacao.destroy({
                where: { message_id: mensagemExistente.id }
            })
        ]);

        const additionalClassCodes = classCodes.slice(1);
        if (additionalClassCodes.length > 0) {
            const additionalMensagens = await MensagemProfessor.bulkCreate(
                additionalClassCodes.map((classCode) => ({
                    title,
                    content,
                    class: classCode,
                    created_by: req.session.usuario.user_code,
                    expires_at: expiresAt,
                    status: 'A'
                }))
            );

            // Marcar mensagens replicadas como não-lidas para todos os alunos
            const enrollments = await TurmaAluno.findAll({
                where: { class_code: { [Op.in]: additionalClassCodes }, active: 'Y' },
                attributes: ['user_code']
            });
            const studentUserCodes = [...new Set(enrollments.map((e) => e.user_code))].filter(Boolean);

            if (studentUserCodes.length > 0) {
                const leituraPayload = [];
                additionalMensagens.forEach((msg) => {
                    studentUserCodes.forEach((userCode) => {
                        leituraPayload.push({
                            message_id: msg.id,
                            user_code: userCode,
                            viewed_at: null
                        });
                    });
                });
                
                try {
                    await MensagemProfessorLeitura.bulkCreate(leituraPayload);
                } catch (leituraError) {
                    console.error('Erro ao marcar mensagens replicadas como não-lidas:', leituraError);
                }
            }
        }

        const mensagem = classCodes.length > 1
            ? 'Mensagem reativada e replicada com sucesso para as turmas selecionadas.'
            : 'Mensagem reativada com sucesso.';
        return res.redirect(`/mensagens?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        return res.redirect(`/mensagens?mensagem=${encodeURIComponent(err.message)}&tipo=danger`);
    }
});

app.get('/turmas', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Acesso restrito a professor e administrador.';
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }

    try {
        const usuarioSessao = req.session.usuario;
        const turmas = await Turma.findAll({
            where: { active: 'Y' },
            order: [['class_name', 'ASC']]
        });

        const activeClassCodes = turmas.map(t => t.class_code);
        const enrolledUserCodes = activeClassCodes.length > 0
            ? await TurmaAluno.findAll({
                where: { class_code: { [Op.in]: activeClassCodes }, active: 'Y' },
                attributes: ['user_code'],
                group: ['user_code']
            }).then(results => results.map(r => r.user_code))
            : [];

        const matriculas = await TurmaAluno.findAll({
            where: { active: 'Y' },
            attributes: ['class_code']
        });

        const countByClassCode = matriculas.reduce((acc, item) => {
            const classCode = item.class_code;
            acc[classCode] = (acc[classCode] || 0) + 1;
            return acc;
        }, {});

        const alunos = await Usuario.findAll({
            where: {
                role: 'STD',
                user_status: 'A',
                user_code: { [Op.notIn]: enrolledUserCodes }
            },
            attributes: ['user_code', 'first_name', 'last_name', 'photo'],
            order: [['first_name', 'ASC'], ['last_name', 'ASC']]
        });

        const turmasVm = turmas.map((turma) => {
            const plain = turma.get({ plain: true });
            const canManage = usuarioSessao.role === 'ADM' || plain.created_by === usuarioSessao.user_code;
            return {
                ...plain,
                canManage,
                enrolled_count: countByClassCode[plain.class_code] || 0
            };
        });

        const alunosVm = alunos.map((aluno) => {
            const plain = aluno.get({ plain: true });
            return {
                ...plain,
                full_name: `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code,
                avatar: plain.photo || '/uploads/users/default.jpg'
            };
        });

        const matriculasDetalhadas = await TurmaAluno.findAll({
            where: { active: 'Y' },
            attributes: ['class_code', 'user_code']
        });

        const userCodesMatriculados = [...new Set(matriculasDetalhadas.map((item) => item.user_code).filter(Boolean))];
        const alunosMatriculados = userCodesMatriculados.length > 0
            ? await Usuario.findAll({
                where: {
                    user_code: { [Op.in]: userCodesMatriculados },
                    role: 'STD',
                    user_status: 'A'
                },
                attributes: ['user_code', 'first_name', 'last_name', 'photo']
            })
            : [];

        const alunoByCode = alunosMatriculados.reduce((acc, item) => {
            const plain = item.get({ plain: true });
            acc[plain.user_code] = {
                user_code: plain.user_code,
                full_name: `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code,
                avatar: plain.photo || '/uploads/users/default.jpg'
            };
            return acc;
        }, {});

        const alunosByTurma = matriculasDetalhadas.reduce((acc, item) => {
            const classCode = item.class_code;
            const aluno = alunoByCode[item.user_code];
            if (!classCode || !aluno) {
                return acc;
            }

            if (!acc[classCode]) {
                acc[classCode] = [];
            }

            acc[classCode].push(aluno);
            return acc;
        }, {});

        Object.keys(alunosByTurma).forEach((classCode) => {
            alunosByTurma[classCode].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'));
        });

        return res.render('turmas', {
            mensagem: req.query.mensagem || '',
            tipoMensagem: req.query.tipo || 'info',
            turmas: turmasVm,
            alunos: alunosVm,
            totalAlunosAtivos: alunosVm.length,
            alunosByTurmaJSON: JSON.stringify(alunosByTurma)
        });
    } catch (err) {
        return res.render('turmas', {
            mensagem: 'Erro ao carregar turmas: ' + err.message,
            tipoMensagem: 'danger',
            turmas: [],
            alunos: [],
            totalAlunosAtivos: 0,
            alunosByTurmaJSON: '{}'
        });
    }
});

app.post('/turmas/criar', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode criar turma.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }

    try {
        const className = String(req.body.class_name || '').trim();
        if (!className) {
            throw new Error('Informe o nome da turma.');
        }

        const turmasAtivas = await Turma.findAll({
            where: { active: 'Y' },
            attributes: ['class_name']
        });

        const hasVerySimilarName = turmasAtivas.some((turma) => {
            const existingName = turma.class_name;
            return areClassNamesTooSimilar(existingName, className);
        });

        if (hasVerySimilarName) {
            throw new Error('Ja existe turma com nome igual ou muito parecido. Use um nome mais especifico.');
        }

        const classCode = await generateUniqueClassCode();

        await Turma.create({
            class_name: className,
            class_code: classCode,
            created_by: req.session.usuario.user_code,
            active: 'Y'
        });

        const mensagem = 'Turma criada com sucesso.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        const mensagem = err.message || 'Erro ao criar turma.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }
});

app.post('/turmas/desativar/:classCode', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode alterar turmas.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }

    try {
        const classCode = String(req.params.classCode || '').trim().toUpperCase();
        const turma = await Turma.findOne({ where: { class_code: classCode } });
        if (!turma) {
            throw new Error('Turma nao encontrada.');
        }

        const isAdmin = req.session.usuario.role === 'ADM';
        const isOwner = turma.created_by === req.session.usuario.user_code;

        if (!isAdmin && !isOwner) {
            throw new Error('Voce pode visualizar esta turma, mas nao pode alterar ou excluir.');
        }

        turma.active = 'N';
        await turma.save();

        await TurmaAluno.update(
            { active: 'N' },
            { where: { class_code: classCode } }
        );

        const mensagem = 'Turma desativada com sucesso.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        const mensagem = err.message || 'Erro ao desativar turma.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }
});

app.post('/turmas/matricular', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode matricular alunos.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }

    try {
        const classCode = String(req.body.class_code || '').trim().toUpperCase();
        const userCodesRaw = Array.isArray(req.body.user_codes)
            ? req.body.user_codes
            : req.body.user_codes
                ? [req.body.user_codes]
                : [];
        const userCodes = [...new Set(userCodesRaw.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean))];

        if (!classCode) {
            throw new Error('Selecione a turma para matricula.');
        }

        if (userCodes.length === 0) {
            throw new Error('Selecione ao menos um aluno para matricular.');
        }

        const turma = await Turma.findOne({ where: { class_code: classCode, active: 'Y' } });
        if (!turma) {
            throw new Error('Turma selecionada nao esta disponivel.');
        }

        const alunos = await Usuario.findAll({
            where: {
                user_code: { [Op.in]: userCodes },
                role: 'STD',
                user_status: 'A'
            },
            attributes: ['user_code']
        });

        if (alunos.length === 0) {
            throw new Error('Nenhum aluno ativo valido foi encontrado para matricula.');
        }

        let matriculados = 0;
        for (const aluno of alunos) {
            const vinculo = await TurmaAluno.findOne({
                where: {
                    class_code: classCode,
                    user_code: aluno.user_code
                }
            });

            if (!vinculo) {
                await TurmaAluno.create({
                    class_code: classCode,
                    user_code: aluno.user_code,
                    active: 'Y',
                    enrolled_by: req.session.usuario.user_code
                });
                matriculados += 1;
                continue;
            }

            if (vinculo.active !== 'Y') {
                vinculo.active = 'Y';
                vinculo.enrolled_by = req.session.usuario.user_code;
                await vinculo.save();
                matriculados += 1;
            }
        }

        await Usuario.update(
            { class_code: classCode },
            { where: { user_code: { [Op.in]: alunos.map((item) => item.user_code) } } }
        );

        const mensagem = `${matriculados} aluno(s) matriculado(s) com sucesso.`;
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        const mensagem = err.message || 'Erro ao matricular alunos.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }
});

app.post('/turmas/remover-alunos', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode remover alunos de turmas.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }

    try {
        const classCode = String(req.body.class_code || '').trim().toUpperCase();
        const userCodesRaw = Array.isArray(req.body.user_codes)
            ? req.body.user_codes
            : req.body.user_codes
                ? [req.body.user_codes]
                : [];
        const userCodes = [...new Set(userCodesRaw.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean))];

        if (!classCode) {
            throw new Error('Turma nao informada para remocao.');
        }

        if (userCodes.length === 0) {
            throw new Error('Selecione ao menos um aluno para remover.');
        }

        const turma = await Turma.findOne({ where: { class_code: classCode, active: 'Y' } });
        if (!turma) {
            throw new Error('Turma nao encontrada ou inativa.');
        }

        const isAdmin = req.session.usuario.role === 'ADM';
        const isOwner = turma.created_by === req.session.usuario.user_code;
        if (!isAdmin && !isOwner) {
            throw new Error('Voce pode visualizar esta turma, mas nao pode alterar alunos matriculados.');
        }

        const [affectedRows] = await TurmaAluno.update(
            { active: 'N' },
            {
                where: {
                    class_code: classCode,
                    user_code: { [Op.in]: userCodes },
                    active: 'Y'
                }
            }
        );

        if (affectedRows > 0) {
            await Usuario.update(
                { class_code: null },
                {
                    where: {
                        user_code: { [Op.in]: userCodes },
                        class_code: classCode
                    }
                }
            );
        }

        const mensagem = `${affectedRows} aluno(s) removido(s) da turma com sucesso.`;
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=success`);
    } catch (err) {
        const mensagem = err.message || 'Erro ao remover alunos da turma.';
        return res.redirect(`/turmas?mensagem=${encodeURIComponent(mensagem)}&tipo=danger`);
    }
});

// FUNÇÕES DE ALUNOS
app.get('/aluno', async (req, res) => {
    const hasProfessorPrivileges = hasProfessorAccess(req.session.usuario);
    const searchTerm = (req.query.q || '').trim();
    const pageRaw = parseInt(req.query.page, 10);
    const currentPageRequested = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const itemsPerPage = 10;
    const pagesPerBlock = 8;

    try {
        const whereClauses = [];

        if (!hasProfessorPrivileges) {
            whereClauses.push({ user_status: 'A' });
        }

        if (searchTerm) {
            const normalizedPhone = searchTerm.replace(/\D/g, '');
            const searchFilters = [
                { first_name: { [Op.like]: `%${searchTerm}%` } },
                { last_name: { [Op.like]: `%${searchTerm}%` } },
                { email: { [Op.like]: `%${searchTerm}%` } }
            ];

            if (normalizedPhone) {
                searchFilters.push({ phone: { [Op.like]: `%${normalizedPhone}%` } });
            }

            whereClauses.push({ [Op.or]: searchFilters });
        }

        const where = whereClauses.length > 0 ? { [Op.and]: whereClauses } : {};

        const usuarios = await Usuario.findAll({
            where,
            include: [{
                model: Usuario,
                as: 'responsavel',
                attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'birth_date', 'photo', 'actual_belt', 'actual_degree', 'user_status', 'role', 'wagi_size', 'zubon_size', 'obi_size'],
                required: false
            }],
            order: [['first_name', 'ASC'], ['last_name', 'ASC']]
        });

        const lista = usuarios.map((u) => {
            const usuario = u.get({plain: true});
            const beltDisplay = getBeltDisplayData(usuario.actual_belt, usuario.actual_degree);

            return {
                ...usuario,
                role_label: getRoleLabel(usuario.role),
                user_status_label: usuario.user_status === 'P' ? 'Pendente' : usuario.user_status === 'A' ? 'Ativo' : 'Cancelado',
                can_approve: hasProfessorPrivileges && usuario.user_status === 'P',
                belt_label: beltDisplay.beltLabel,
                degree_label: beltDisplay.degreeLabel,
                belt_summary_label: beltDisplay.summaryLabel,
                belt_image_path: beltDisplay.imagePath,
                responsavel_nome: usuario.responsavel ? `${usuario.responsavel.first_name} ${usuario.responsavel.last_name}` : null,
                responsavel_dados: usuario.responsavel ? {
                    id: usuario.responsavel.id,
                    first_name: usuario.responsavel.first_name,
                    last_name: usuario.responsavel.last_name,
                    email: usuario.responsavel.email,
                    phone: usuario.responsavel.phone,
                    birth_date: usuario.responsavel.birth_date,
                    photo: usuario.responsavel.photo,
                    actual_belt: usuario.responsavel.actual_belt,
                    actual_degree: usuario.responsavel.actual_degree,
                    user_status: usuario.responsavel.user_status,
                    role: usuario.responsavel.role,
                    wagi_size: usuario.responsavel.wagi_size,
                    zubon_size: usuario.responsavel.zubon_size,
                    obi_size: usuario.responsavel.obi_size,
                    belt_label: getBeltDisplayData(usuario.responsavel.actual_belt, usuario.responsavel.actual_degree).beltLabel,
                    degree_label: getBeltDisplayData(usuario.responsavel.actual_belt, usuario.responsavel.actual_degree).degreeLabel,
                    belt_summary_label: getBeltDisplayData(usuario.responsavel.actual_belt, usuario.responsavel.actual_degree).summaryLabel,
                    belt_image_path: getBeltDisplayData(usuario.responsavel.actual_belt, usuario.responsavel.actual_degree).imagePath,
                    user_status_label: usuario.responsavel.user_status === 'P' ? 'Pendente' : usuario.responsavel.user_status === 'A' ? 'Ativo' : 'Cancelado',
                    role_label: getRoleLabel(usuario.responsavel.role)
                } : null
            };
        });

        const sortByName = (a, b) => {
            const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
            const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
            return nameA.localeCompare(nameB);
        };

        const pendentes = hasProfessorPrivileges
            ? lista.filter((usuario) => usuario.user_status === 'P').sort(sortByName)
            : [];
        const ativos = lista.filter((usuario) => usuario.user_status === 'A').sort(sortByName);
        const cancelados = hasProfessorPrivileges
            ? lista.filter((usuario) => usuario.user_status === 'C').sort(sortByName)
            : [];
        const listaOrdenada = hasProfessorPrivileges
            ? pendentes.concat(ativos, cancelados)
            : ativos;

        const totalItems = listaOrdenada.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
        const currentPage = Math.min(currentPageRequested, totalPages);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const usuariosPaginados = listaOrdenada.slice(startIndex, startIndex + itemsPerPage);

        const startPage = Math.floor((currentPage - 1) / pagesPerBlock) * pagesPerBlock + 1;
        const endPage = Math.min(startPage + pagesPerBlock - 1, totalPages);
        const visiblePages = endPage - startPage + 1;

        const pageNumbers = Array.from({length: visiblePages}, (_unused, index) => {
            const pageNumber = startPage + index;
            return {
                number: pageNumber,
                isCurrent: pageNumber === currentPage
            };
        });

        res.render('aluno', {
            mensagem: req.query.mensagem || '',
            usuarios: usuariosPaginados,
            hasProfessorPrivileges,
            searchTerm,
            hasSearchTerm: !!searchTerm,
            searchTermEncoded: encodeURIComponent(searchTerm),
            pagination: {
                currentPage,
                totalPages,
                totalItems,
                hasPrev: currentPage > 1,
                hasNext: currentPage < totalPages,
                prevPage: currentPage > 1 ? currentPage - 1 : 1,
                nextPage: currentPage < totalPages ? currentPage + 1 : totalPages,
                pageNumbers
            }
        });
    } catch (err) {
        res.render('aluno', {
            mensagem: 'Erro ao carregar alunos: ' + err.message,
            usuarios: [],
            hasProfessorPrivileges,
            searchTerm,
            hasSearchTerm: !!searchTerm,
            searchTermEncoded: encodeURIComponent(searchTerm),
            pagination: {
                currentPage: 1,
                totalPages: 1,
                totalItems: 0,
                hasPrev: false,
                hasNext: false,
                prevPage: 1,
                nextPage: 1,
                pageNumbers: [{ number: 1, isCurrent: true }]
            }
        });
    }
});

// Verifica se o e-mail pertence a um titular ativo (chamada AJAX pública)
app.post('/aluno/verificar-titular', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) {
        return res.json({ ok: false, mensagem: 'Informe o e-mail.' });
    }

    try {
        const titular = await Usuario.findOne({
            where: { email, user_status: 'A', responsible_id: null }
        });

        if (!titular) {
            return res.json({ ok: false, mensagem: 'E-mail não encontrado ou o usuário ainda não foi aprovado.' });
        }

        return res.json({ ok: true, id: titular.id, first_name: titular.first_name, last_name: titular.last_name, email: titular.email });
    } catch (err) {
        return res.json({ ok: false, mensagem: 'Erro ao verificar: ' + err.message });
    }
});

// Troca a visualização para a conta de um dependente
app.get('/conta/trocar/:id', async (req, res) => {
    const dependenteId = parseInt(req.params.id, 10);
    const usuarioLogado = req.session.usuario;

    if (!usuarioLogado) {
        return res.redirect('/auth/login');
    }

    try {
        const dependente = await Usuario.findByPk(dependenteId);
        if (!dependente || dependente.responsible_id !== usuarioLogado.id) {
            const mensagem = 'Dependente não encontrado ou sem permissão.';
            return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
        }

        if (dependente.user_status !== 'A') {
            const mensagem = 'Este dependente ainda não foi aprovado por um professor/administrador.';
            return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
        }

        req.session.viewingAs = {
            id: dependente.id,
            first_name: dependente.first_name,
            last_name: dependente.last_name,
            responsible_id: dependente.responsible_id
        };

        return res.redirect('/dashboard');
    } catch (err) {
        const mensagem = 'Erro ao trocar conta: ' + err.message;
        return res.redirect(`/dashboard?mensagem=${encodeURIComponent(mensagem)}`);
    }
});

// Volta para a conta titular
app.get('/conta/voltar', (req, res) => {
    req.session.viewingAs = null;
    return res.redirect('/dashboard');
});

app.get('/aluno/novo', async (req, res) => {
    try {
        const turmaOptions = await getActiveTurmasOptions();
        const vm = buildUserFormViewModel(null, false, turmaOptions);

        // Capturar mensagem da sessão se existir
        if (req.session.mensagem) {
            vm.mensagem = req.session.mensagem;
            vm.tipoMensagem = req.session.tipoMensagem || 'info';
            vm.redirectUrl = req.session.redirectUrl;
            vm.redirectDelay = req.session.redirectDelay;

            // Limpar dados da sessão após usar
            delete req.session.mensagem;
            delete req.session.tipoMensagem;
            delete req.session.redirectUrl;
            delete req.session.redirectDelay;
        } else {
            // Capturar mensagem de query param se existir (compatibilidadecom redirecionamentos antigos)
            vm.mensagem = req.query.mensagem || '';
            vm.tipoMensagem = req.query.tipo || 'info';
        }

        return res.render('formnovousuario', vm);
    } catch (err) {
        return res.render('formnovousuario', {
            ...buildUserFormViewModel(null, false, []),
            mensagem: 'Erro ao carregar formulario: ' + err.message,
            tipoMensagem: 'erro'
        });
    }
});

app.post('/aluno/cadastrar', upload.single('photo'), async (req, res) => {
    // Função para renderizar o formulário com dados preservados em caso de erro
    const renderFormWithError = async (errorMessage, fieldErrors = {}) => {
        const responsibleId = req.body.responsible_id ? parseInt(req.body.responsible_id, 10) : null;
        const turmaOptions = await getActiveTurmasOptions(req.body.class_code || '');

        const formData = {
            first_name: req.body.first_name || '',
            last_name: req.body.last_name || '',
            email: req.body.email || '',
            phone: req.body.phone || '',
            birth_date: req.body.birth_date || '',
            actual_belt: req.body.actual_belt || '',
            actual_degree: req.body.actual_degree || '0',
            wagi_size: req.body.wagi_size || '',
            zubon_size: req.body.zubon_size || '',
            obi_size: req.body.obi_size || '',
            photo: '/uploads/users/default.jpg',
            responsible_id: responsibleId,
            class_code: req.body.class_code || ''
        };

        const vm = {
            isEditMode: false,
            title: 'Novo Aluno',
            submitLabel: 'Enviar',
            formAction: '/aluno/cadastrar',
            usuario: formData,
            beltOptions: BELT_OPTIONS.map((option) => ({
                ...option,
                selected: option.value === formData.actual_belt
            })),
            turmaOptions,
            mensagem: errorMessage,
            tipoMensagem: 'erro',
            camposErro: fieldErrors
        };

        res.render('formnovousuario', vm);
    };

    try {
        const requiredFields = [
            'first_name',
            'last_name',
            'phone',
            'birth_date',
            'actual_belt',
            'actual_degree',
            'wagi_size',
            'zubon_size',
            'obi_size',
            'class_code'
        ];
        const missing = requiredFields.filter((field) => !String(req.body[field] || '').trim());
        if (missing.length > 0) {
            const fieldErrors = {};
            missing.forEach((field) => {
                fieldErrors[field] = 'Campo obrigatório.';
            });
            if (!req.body.email && !req.body.responsible_id) {
                fieldErrors.email = 'Campo obrigatório.';
            }
            if (!req.body.password1 || !req.body.password2) {
                fieldErrors.password = 'Campo obrigatório.';
            }
            if (!req.file) {
                fieldErrors.photo = 'Envie uma foto para continuar.';
            }
            return renderFormWithError('Preencha todos os campos obrigatórios para continuar.', fieldErrors);
        }

        const responsibleId = req.body.responsible_id ? parseInt(req.body.responsible_id, 10) : null;
        const isDependent = !!responsibleId;
        const classCode = String(req.body.class_code || '').trim().toUpperCase();
        let titular = null;
        const beltDegreeValidation = validateBeltAndDegree(req.body.actual_belt, req.body.actual_degree);
        const turmaSelecionada = classCode
            ? await Turma.findOne({ where: { class_code: classCode, active: 'Y' } })
            : null;

        if (!turmaSelecionada) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }
            return renderFormWithError('Selecione uma turma valida para continuar.', { class_code: 'Selecione uma turma valida.' });
        }

        // Validar titular se for dependente
        if (isDependent) {
            titular = await Usuario.findByPk(responsibleId);
            if (!titular || titular.user_status !== 'A' || titular.responsible_id !== null) {
                if (req.file) {
                    const tempFilePath = path.join(uploadsDir, req.file.filename);
                    if (fs.existsSync(tempFilePath)) {
                        await fs.promises.unlink(tempFilePath);
                    }
                }
                return renderFormWithError('Conta titular invalida ou nao encontrada.');
            }
        }

        const senha = req.body.password2 || '';
        const fieldErrors = {};

        if (!req.body.password1 || req.body.password1 !== senha) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }
            fieldErrors.password = 'As senhas não conferem.';
            return renderFormWithError('Corrija os campos em desconformidade abaixo.', fieldErrors);
        }

        if (senha.length < 8) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }
            fieldErrors.password = 'A senha deve ter no mínimo 8 caracteres.';
            return renderFormWithError('Corrija os campos em desconformidade abaixo.', fieldErrors);
        }

        if (!beltDegreeValidation.isValid) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }

            fieldErrors[beltDegreeValidation.field] = beltDegreeValidation.message;
            return renderFormWithError('Corrija os campos em desconformidade abaixo.', fieldErrors);
        }

        const passwordHash = await argon2.hash(senha);

        let emailFinal = (req.body.email || '').trim().toLowerCase();
        if (isDependent) {
            emailFinal = (titular.email || '').trim().toLowerCase();
        }

        const firstNameFinal = normalizePersonName(req.body.first_name);
        const lastNameFinal = normalizePersonName(req.body.last_name);

        if (!firstNameFinal || !lastNameFinal) {
            const fieldErrors = {};
            if (!firstNameFinal) fieldErrors.first_name = 'Campo obrigatório.';
            if (!lastNameFinal) fieldErrors.last_name = 'Campo obrigatório.';
            return renderFormWithError('Corrija os campos em desconformidade abaixo.', fieldErrors);
        }

        const usuario = await Usuario.create({
            user_code: generatedCode(),
            first_name: firstNameFinal,
            last_name: lastNameFinal,
            email: emailFinal,
            password: passwordHash,
            role: 'STD',
            user_status: 'P',
            phone: req.body.phone,
            birth_date: req.body.birth_date,
            actual_belt: beltDegreeValidation.beltValue,
            actual_degree: beltDegreeValidation.degreeValue,
            wagi_size: req.body.wagi_size,
            zubon_size: req.body.zubon_size,
            obi_size: req.body.obi_size,
            responsible_id: responsibleId || null,
            class_code: classCode
        });

        await TurmaAluno.findOrCreate({
            where: {
                class_code: classCode,
                user_code: usuario.user_code
            },
            defaults: {
                class_code: classCode,
                user_code: usuario.user_code,
                enrolled_by: req.session.usuario ? req.session.usuario.user_code : usuario.user_code,
                active: 'Y'
            }
        });

        if (req.file) {
            // Cadastro pendente mantém foto temporária até aprovação.
            usuario.photo = `/uploads/users/${req.file.filename}`;
            await usuario.save();
        }

        // Armazenar mensagem de sucesso na sessão com indicador de redirecionamento
        req.session.mensagem = isDependent ? 'Cadastro de dependente enviado com sucesso.' : 'Aluno criado com sucesso.';
        req.session.tipoMensagem = 'sucesso';
        req.session.redirectUrl = '/auth/login';
        req.session.redirectDelay = 3000; // 3 segundos

        res.redirect(`/aluno/novo?sucesso=1`);
    } catch (err) {
        console.error('Erro no cadastro:', err);

        // Extrair mensagens de erro de validação do Sequelize
        const fieldErrors = {};
        let mensagemGeral = 'Erro ao criar aluno. ';

        if (err.name === 'SequelizeValidationError') {
            err.errors.forEach((error) => {
                if (error.path) {
                    // Traduzir erros comuns
                    if (error.path === 'email' && error.type === 'unique violation') {
                        fieldErrors[error.path] = 'Este e-mail já está cadastrado.';
                    } else if (error.path === 'email' && error.type === 'Validation isEmail') {
                        fieldErrors[error.path] = 'E-mail inválido.';
                    } else if (error.path === 'phone' && error.type === 'Validation is') {
                        fieldErrors[error.path] = 'Telefone deve conter 11 dígitos.';
                    } else if (error.path === 'birth_date') {
                        fieldErrors[error.path] = 'Data de nascimento inválida ou futura.';
                    } else if (error.path === 'actual_belt') {
                        fieldErrors[error.path] = 'Faixa selecionada é inválida.';
                    } else if (error.path === 'actual_degree') {
                        fieldErrors[error.path] = 'Grau inválido para a faixa selecionada.';
                    } else {
                        fieldErrors[error.path] = error.message;
                    }
                }
            });
            mensagemGeral = 'Corrija os campos em desconformidade abaixo.';
        } else if (err.name === 'SequelizeUniqueConstraintError') {
            const field = err.fields ? Object.keys(err.fields)[0] : 'email';
            if (field === 'email') {
                fieldErrors[field] = 'Este e-mail já está cadastrado.';
            } else {
                fieldErrors[field] = `${field} já existe no sistema.`;
            }
            mensagemGeral = 'Corrija os campos em desconformidade abaixo.';
        } else {
            mensagemGeral += err.message;
        }

        if (req.file) {
            const tempFilePath = path.join(uploadsDir, req.file.filename);
            if (fs.existsSync(tempFilePath)) {
                fs.unlink(tempFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Erro ao deletar arquivo temporário:', unlinkErr);
                });
            }
        }

        return renderFormWithError(mensagemGeral, fieldErrors);
    }
});

app.get('/aluno/editar/:id', async (req, res) => {
    const alunoId = req.params.id;

    try {
        const usuario = await Usuario.findByPk(alunoId);
        if (!usuario) {
            const mensagem = 'Aluno não encontrado.';
            return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
        }

        return res.render('formnovousuario', buildUserFormViewModel(usuario, true));
    } catch (err) {
        const mensagem = 'Erro ao carregar aluno: ' + err.message;
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }
});

app.post('/aluno/editar/:id', upload.single('photo'), async (req, res) => {
    const alunoId = req.params.id;
    const beltDegreeValidation = validateBeltAndDegree(req.body.actual_belt, req.body.actual_degree);

    try {
        const usuario = await Usuario.findByPk(alunoId);
        if (!usuario) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }

            const mensagem = 'Aluno não encontrado.';
            return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
        }

        usuario.email = req.body.email;
        usuario.phone = req.body.phone;

        if (!beltDegreeValidation.isValid) {
            if (req.file) {
                const tempFilePath = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
            }

            const mensagem = beltDegreeValidation.message;
            return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
        }

        usuario.actual_belt = beltDegreeValidation.beltValue;
        usuario.actual_degree = beltDegreeValidation.degreeValue;
        usuario.wagi_size = req.body.wagi_size;
        usuario.zubon_size = req.body.zubon_size;
        usuario.obi_size = req.body.obi_size;

        if (req.body.password1 || req.body.password2) {
            if (req.body.password1 !== req.body.password2) {
                if (req.file) {
                    const tempFilePath = path.join(uploadsDir, req.file.filename);
                    if (fs.existsSync(tempFilePath)) {
                        await fs.promises.unlink(tempFilePath);
                    }
                }

                const mensagem = 'As senhas não conferem.';
                return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
            }

            usuario.password = await argon2.hash(req.body.password2);
        }

        await usuario.save();

        if (req.file) {
            if (usuario.user_status === 'P') {
                await deleteUserTempPhotoIfExists(usuario);
                usuario.photo = `/uploads/users/${req.file.filename}`;
                await usuario.save();
                console.log(`Imagem temporária atualizada: ${req.file.filename}`);
            } else {
                const result = await replaceUserPhoto(usuario, req.file.filename);
                console.log(`Imagem atualizada: ${result.finalFileName} (${(result.fileSize / 1024).toFixed(2)}KB)`);
            }
        }

        const mensagem = 'Dados do aluno atualizados com sucesso.';
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    } catch (err) {
        if (req.file) {
            const tempFilePath = path.join(uploadsDir, req.file.filename);
            if (fs.existsSync(tempFilePath)) {
                await fs.promises.unlink(tempFilePath);
            }
        }

        console.error('Erro ao atualizar aluno:', err);
        const mensagem = 'Erro ao atualizar aluno: ' + err.message;
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }
});
app.get('/aluno/status/:id', (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode aprovar cadastros.';
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }

    const alunoId = req.params.id;
    Usuario.findByPk(alunoId).then(async function (usuario) {
        if (usuario) {
            if (usuario.user_status !== 'P') {
                throw new Error('Somente cadastros pendentes podem ser aprovados');
            }

            usuario.user_status = 'A';
            await usuario.save();
            const finalizedPhoto = await finalizePendingPhotoIfNeeded(usuario);
            return finalizedPhoto;
        } else {
            throw new Error('Aluno não encontrado');
        }
    }).then(function (finalizedPhoto) {
        if (finalizedPhoto) {
            console.log(`Imagem aprovada: ${finalizedPhoto.finalFileName} (${(finalizedPhoto.fileSize / 1024).toFixed(2)}KB)`);
        }

        const mensagem = 'Cadastro aprovado com sucesso.';
        res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }).catch(function (err) {
        const mensagem = 'Erro: ' + err.message;
        res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    });
});

app.get('/aluno/status/negar/:id', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        const mensagem = 'Apenas professor ou administrador pode negar cadastros.';
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }

    const alunoId = req.params.id;

    try {
        const usuario = await Usuario.findByPk(alunoId);
        if (!usuario) {
            throw new Error('Aluno não encontrado');
        }

        if (usuario.user_status !== 'P') {
            throw new Error('Somente cadastros pendentes podem ser negados');
        }

        // Apaga foto temporária (se existir) e depois remove o registro do aluno,
        // garantindo que nenhum dado de cadastro pendente permaneça no sistema.
        await deleteUserTempPhotoIfExists(usuario);
        await usuario.destroy();

        const mensagem = 'Cadastro negado e dados removidos com sucesso.';
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    } catch (err) {
        const mensagem = 'Erro: ' + err.message;
        return res.redirect(`/aluno?mensagem=${encodeURIComponent(mensagem)}`);
    }
});

// Atualizar status do aluno (POST)
app.post('/aluno/status/:id', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        return res.status(403).json({ error: 'Acesso não permitido' });
    }

    const alunoId = req.params.id;
    const newStatus = req.body.newStatus || (req.query.status || '').trim();

    try {
        const usuario = await Usuario.findByPk(alunoId);
        if (!usuario) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }

        // Validar transição de status
        const validTransitions = {
            'P': ['A', 'C'],      // Pendente pode ir para Ativo ou Cancelado
            'A': ['C'],           // Ativo pode ir para Cancelado
            'C': ['A']            // Cancelado pode ir para Ativo
        };

        if (!validTransitions[usuario.user_status] || !validTransitions[usuario.user_status].includes(newStatus)) {
            return res.status(400).json({ 
                error: `Transição inválida de ${usuario.user_status} para ${newStatus}` 
            });
        }

        usuario.user_status = newStatus;
        await usuario.save();

        return res.status(200).json({ 
            ok: true, 
            message: 'Status atualizado com sucesso',
            newStatus 
        });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao atualizar status: ' + err.message });
    }
});

// Retorna estatísticas da meta atual do aluno (para modal /aluno)
app.get('/aluno/:id/meta-atual', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        return res.status(403).json({ ok: false, mensagem: 'Acesso não permitido.' });
    }

    try {
        const alunoId = parseInt(req.params.id, 10);
        if (!Number.isInteger(alunoId) || alunoId <= 0) {
            return res.status(400).json({ ok: false, mensagem: 'ID inválido.' });
        }

        const aluno = await Usuario.findByPk(alunoId, { attributes: ['id', 'user_code', 'role'] });
        if (!aluno || aluno.role !== 'STD') {
            return res.status(404).json({ ok: false, mensagem: 'Aluno não encontrado.' });
        }

        const progress = await getCurrentMetaProgressForStudent(aluno.user_code);
        return res.json({ ok: true, progress });
    } catch (err) {
        return res.status(500).json({ ok: false, mensagem: 'Erro ao calcular meta atual: ' + err.message });
    }
});

// FUNÇÕES DE PRESENÇAS

/** Calendário das aulas / contagem no fuso de Brasília (sem horário de verão). */
const PRESENCA_BR_UTC_OFFSET_MIN = -180;

function presencaDatePartsFromYmd(dateStr) {
    const p = String(dateStr || '')
        .trim()
        .split('-')
        .map((x) => parseInt(x, 10));
    if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
        return null;
    }
    return { y: p[0], mo: p[1], d: p[2] };
}

/** Intervalo UTC do dia civil YYYY-MM-DD (armazenamento e deduplicação). */
function presencaUtcRangeForYmd(dateStr) {
    const parts = presencaDatePartsFromYmd(dateStr);
    if (!parts) {
        return null;
    }
    const { y, mo, d } = parts;
    return {
        start: new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0)),
        end: new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999)),
        noon: new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0))
    };
}

/** Dia civil Y-M-D a partir do instante gravado (UTC) — meio-dia UTC evita mudar o dia civil. */
function presencaCivilYmdFromDbDate(requestDate) {
    const dt = requestDate instanceof Date ? requestDate : new Date(requestDate);
    if (Number.isNaN(dt.getTime())) {
        return null;
    }
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dia da semana (0=dom..2=ter) para uma data civil YYYY-MM-DD (Gregoriano, independente de fuso). */
function civilDateWeekdaySun0FromYmd(ymd) {
    const parts = presencaDatePartsFromYmd(ymd);
    if (!parts) {
        return null;
    }
    const { y, mo, d } = parts;
    return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0)).getUTCDay();
}

/** Y-M-D civil no calendário de Brasília (terça-feira = grade da academia). */
function presencaCivilYmdBrasil(requestDate) {
    const m = moment(requestDate);
    if (!m.isValid()) {
        return null;
    }
    return m.utcOffset(PRESENCA_BR_UTC_OFFSET_MIN).format('YYYY-MM-DD');
}

function presencaMatchesSolicitacaoDay(requestDate, dateStr) {
    const br = presencaCivilYmdBrasil(requestDate);
    const utc = presencaCivilYmdFromDbDate(requestDate);
    return dateStr === br || dateStr === utc;
}

function presencaDuplicateQueryRange(dateStr) {
    const parts = presencaDatePartsFromYmd(dateStr);
    if (!parts) {
        return null;
    }
    const { y, mo, d } = parts;
    const center = moment.utc([y, mo - 1, d, 12, 0, 0]);
    return {
        start: center.clone().subtract(1, 'day').startOf('day').toDate(),
        end: center.clone().add(1, 'day').endOf('day').toDate()
    };
}

/**
 * Peso da presença aprovada por solicitação:
 * - Terça-feira: Integral = 2; Gi ou No-Gi = 1 cada.
 * - Demais dias: 1 por solicitação (Integral ou outro).
 */
function presencaPesoPorSolicitacao(requestDate, classType) {
    const ct = String(classType || '').trim();
    const ymd = presencaCivilYmdBrasil(requestDate);
    if (!ymd) {
        return 1;
    }
    const dow = civilDateWeekdaySun0FromYmd(ymd);
    if (dow === null) {
        return 1;
    }
    const isTuesday = dow === 2;
    if (isTuesday) {
        if (ct === 'Integral') {
            return 2;
        }
        return 1;
    }
    return 1;
}

// Retorna o user_code efetivo (viewingAs ou logado)
async function getEffectiveUserCode(req) {
    if (req.session.viewingAs) {
        const dep = await Usuario.findByPk(req.session.viewingAs.id);
        return dep ? dep.user_code : null;
    }
    return req.session.usuario ? req.session.usuario.user_code : null;
}

function normalizeDateOnlyToStart(dateOnlyIso) {
    // dateOnlyIso: YYYY-MM-DD
    return new Date(`${dateOnlyIso}T00:00:00`);
}

function normalizeDateOnlyToEnd(dateOnlyIso) {
    // dateOnlyIso: YYYY-MM-DD
    return new Date(`${dateOnlyIso}T23:59:59.999`);
}

async function getCurrentMetaProgressForStudent(userCode, { referenceDate = new Date() } = {}) {
    const normalizedUserCode = String(userCode || '').trim().toUpperCase();
    if (!normalizedUserCode) {
        return {
            hasMeta: false,
            metaId: null,
            metaTitle: '',
            totalClasses: 0,
            minClasses: 0,
            approvedCount: 0,
            presencasNaMeta: 0,
            percent: 0
        };
    }

    const turmasAluno = await TurmaAluno.findAll({
        where: { user_code: normalizedUserCode, active: 'Y' },
        attributes: ['class_code']
    });
    const classCodes = [...new Set(turmasAluno.map((t) => t.class_code))].filter(Boolean);
    if (classCodes.length === 0) {
        return {
            hasMeta: false,
            metaId: null,
            metaTitle: '',
            totalClasses: 0,
            minClasses: 0,
            approvedCount: 0,
            presencasNaMeta: 0,
            percent: 0
        };
    }

    const todayIso = moment(referenceDate).startOf('day').format('YYYY-MM-DD');

    const metaAtual = await MetaAula.findOne({
        where: {
            status: 'A',
            start_date: { [Op.lte]: todayIso },
            end_date: { [Op.gte]: todayIso }
        },
        include: [
            {
                model: Turma,
                as: 'turmas',
                through: { attributes: [] },
                where: { class_code: { [Op.in]: classCodes } },
                required: true
            }
        ],
        order: [['start_date', 'DESC'], ['id', 'DESC']]
    });

    if (!metaAtual) {
        return {
            hasMeta: false,
            metaId: null,
            metaTitle: '',
            totalClasses: 0,
            minClasses: 0,
            approvedCount: 0,
            presencasNaMeta: 0,
            percent: 0
        };
    }

    const metaPlain = metaAtual.get({ plain: true });
    const metaClassCodes = [...new Set((metaPlain.turmas || []).map((t) => t.class_code))].filter(Boolean);

    const startIso = metaPlain.start_date;
    const effectiveEndIso = moment.min(
        moment(todayIso, 'YYYY-MM-DD'),
        moment(metaPlain.end_date, 'YYYY-MM-DD')
    ).format('YYYY-MM-DD');

    const startAt = normalizeDateOnlyToStart(startIso);
    const endAt = normalizeDateOnlyToEnd(effectiveEndIso);

    const approvedRows = await Presenca.findAll({
        where: {
            user_code: normalizedUserCode,
            status: 'A',
            class_code: metaClassCodes.length > 0 ? { [Op.in]: metaClassCodes } : undefined,
            request_date: { [Op.between]: [startAt, endAt] }
        },
        attributes: ['request_date', 'class_type']
    });

    const approvedCount = approvedRows.reduce(
        (sum, row) => sum + presencaPesoPorSolicitacao(row.request_date, row.class_type),
        0
    );

    const totalClasses = Number(metaPlain.total_classes) || 0;
    const minClasses = Number(metaPlain.min_classes) || 0;
    const percentRaw = totalClasses > 0 ? (approvedCount / totalClasses) * 100 : 0;
    const percent = Math.max(0, Math.min(100, Math.round(percentRaw)));
    const presencasNaMeta = Number(approvedCount) || 0;

    return {
        hasMeta: true,
        metaId: metaPlain.id,
        metaTitle: metaPlain.title || '',
        totalClasses,
        minClasses,
        approvedCount: presencasNaMeta,
        presencasNaMeta,
        percent
    };
}

function buildPresencaViewModel(p) {
    const plain = p.get ? p.get({ plain: true }) : p;
    const statusMap = { P: 'Pendente', A: 'Aprovada', N: 'Negada', C: 'Solicitação cancelada' };
    const statusClassMap = { P: 'text-warning', A: 'text-success', N: 'text-danger', C: 'text-secondary' };
    const classTypeDisplayMap = { Integral: 'Integral', Gi: 'Gi (1ª Aula)', 'No-Gi': 'No-Gi (2ª Aula)' };
    const ymd = presencaCivilYmdBrasil(plain.request_date) || moment(plain.request_date).format('YYYY-MM-DD');
    return {
        ...plain,
        request_date_formatted: moment(ymd, 'YYYY-MM-DD').format('DD/MM/YYYY'),
        request_date_ts: moment(plain.createdAt || plain.request_date).format('DD/MM/YYYY HH:mm:ss'),
        request_date_iso: ymd,
        status_label: statusMap[plain.status] || plain.status,
        status_class: statusClassMap[plain.status] || '',
        class_type_display: classTypeDisplayMap[plain.class_type] || plain.class_type
    };
}

app.get('/presenca', async (req, res) => {
    const pageRaw = parseInt(req.query.page, 10);
    const currentPageRequested = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const itemsPerPage = 10;
    const pagesPerBlock = 8;

    try {
        const hasProfessorPrivileges = hasProfessorAccess(req.session.usuario);
        let listaCompleta = [];
        let turmasSolicitacao = [];
        let requiresTurmaSelection = false;
        let defaultClassCode = '';

        if (hasProfessorPrivileges) {
            const pendentes = await Presenca.findAll({
                where: { status: 'P' },
                order: [['request_date', 'DESC']]
            });

            const userCodes = [...new Set(pendentes.map((p) => p.user_code).filter(Boolean))];
            const usuarios = userCodes.length > 0
                ? await Usuario.findAll({
                    where: { user_code: { [Op.in]: userCodes } },
                    attributes: ['user_code', 'first_name', 'last_name', 'photo']
                })
                : [];

            const usuarioMap = usuarios.reduce((acc, u) => {
                const plain = u.get({ plain: true });
                acc[plain.user_code] = {
                    fullName: `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code,
                    photo: plain.photo || '/uploads/users/default.jpg'
                };
                return acc;
            }, {});

            listaCompleta = pendentes.map((p) => {
                const vm = buildPresencaViewModel(p);
                const aluno = usuarioMap[vm.user_code] || {
                    fullName: vm.user_code,
                    photo: '/uploads/users/default.jpg'
                };
                return {
                    ...vm,
                    aluno_nome: aluno.fullName,
                    aluno_nome_completo: aluno.fullName,
                    aluno_photo: aluno.photo
                };
            });
        } else {
            const userCode = await getEffectiveUserCode(req);
            if (!userCode) {
                return res.redirect('/auth/login');
            }

            turmasSolicitacao = await getActiveTurmasForUser(userCode);
            requiresTurmaSelection = turmasSolicitacao.length > 1;
            if (turmasSolicitacao.length === 1) {
                defaultClassCode = turmasSolicitacao[0].class_code;
            }

            const todasPresencas = await Presenca.findAll({
                where: { user_code: userCode },
                order: [['request_date', 'DESC']]
            });

            listaCompleta = todasPresencas.map(buildPresencaViewModel);
        }

        const totalItems = listaCompleta.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
        const currentPage = Math.min(currentPageRequested, totalPages);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const presencasPaginadas = listaCompleta.slice(startIndex, startIndex + itemsPerPage);

        const startPage = Math.floor((currentPage - 1) / pagesPerBlock) * pagesPerBlock + 1;
        const endPage = Math.min(startPage + pagesPerBlock - 1, totalPages);
        const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_u, i) => ({
            number: startPage + i,
            isCurrent: startPage + i === currentPage
        }));

        return res.render('presenca', {
            mensagem: req.query.mensagem || '',
            tipoMensagem: req.query.tipo || 'danger',
            presencas: presencasPaginadas,
            todasPresencasJSON: hasProfessorPrivileges ? '[]' : JSON.stringify(listaCompleta),
            hasProfessorPrivileges,
            turmasSolicitacao,
            requiresTurmaSelection,
            defaultClassCode,
            pagination: {
                currentPage,
                totalPages,
                totalItems,
                hasPrev: currentPage > 1,
                hasNext: currentPage < totalPages,
                prevPage: currentPage > 1 ? currentPage - 1 : 1,
                nextPage: currentPage < totalPages ? currentPage + 1 : totalPages,
                pageNumbers
            }
        });
    } catch (err) {
        const hasProfessorPrivileges = hasProfessorAccess(req.session.usuario);
        return res.render('presenca', {
            mensagem: 'Erro ao carregar presenças: ' + err.message,
            presencas: [],
            todasPresencasJSON: '[]',
            hasProfessorPrivileges,
            turmasSolicitacao: [],
            requiresTurmaSelection: false,
            defaultClassCode: '',
            pagination: {
                currentPage: 1, totalPages: 1, totalItems: 0,
                hasPrev: false, hasNext: false, prevPage: 1, nextPage: 1,
                pageNumbers: [{ number: 1, isCurrent: true }]
            }
        });
    }
});

app.post('/presenca/status/:id/aprovar', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        return res.json({ ok: false, mensagem: 'Apenas professor ou administrador pode aprovar solicitações.' });
    }

    try {
        const presencaId = parseInt(req.params.id, 10);
        if (!Number.isInteger(presencaId)) {
            throw new Error('ID inválido.');
        }

        const presenca = await Presenca.findByPk(presencaId);
        if (!presenca) {
            throw new Error('Solicitação não encontrada.');
        }
        if (presenca.status !== 'P') {
            throw new Error('Somente solicitações pendentes podem ser aprovadas.');
        }

        presenca.status = 'A';
        presenca.processed_by = req.session.usuario.user_code;
        await presenca.save();

        return res.json({ ok: true, mensagem: 'Solicitação aprovada com sucesso.' });
    } catch (err) {
        return res.json({ ok: false, mensagem: 'Erro ao aprovar solicitação: ' + err.message });
    }
});

app.post('/presenca/status/:id/negar', async (req, res) => {
    if (!hasProfessorAccess(req.session.usuario)) {
        return res.json({ ok: false, mensagem: 'Apenas professor ou administrador pode negar solicitações.' });
    }

    try {
        const presencaId = parseInt(req.params.id, 10);
        if (!Number.isInteger(presencaId)) {
            throw new Error('ID inválido.');
        }

        const observation = String(req.body.observation || '').trim();
        if (!observation) {
            throw new Error('Informe a observação para negar a solicitação.');
        }

        const presenca = await Presenca.findByPk(presencaId);
        if (!presenca) {
            throw new Error('Solicitação não encontrada.');
        }
        if (presenca.status !== 'P') {
            throw new Error('Somente solicitações pendentes podem ser negadas.');
        }

        presenca.status = 'N';
        presenca.observation = observation;
        presenca.processed_by = req.session.usuario.user_code;
        await presenca.save();

        return res.json({ ok: true, mensagem: 'Solicitação negada com sucesso.' });
    } catch (err) {
        return res.json({ ok: false, mensagem: 'Erro ao negar solicitação: ' + err.message });
    }
});

app.post('/presenca/solicitar', async (req, res) => {
    try {
        const userCode = await getEffectiveUserCode(req);
        if (!userCode) {
            return res.json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const turmasAluno = await getActiveTurmasForUser(userCode);
        if (turmasAluno.length === 0) {
            return res.json({ ok: false, mensagem: 'Voce nao possui turma ativa para solicitar presenca.' });
        }

        let selectedClassCode = String(req.body.classCode || '').trim().toUpperCase();
        if (turmasAluno.length === 1) {
            selectedClassCode = turmasAluno[0].class_code;
        }

        const turmaPermitida = turmasAluno.some((turma) => turma.class_code === selectedClassCode);
        if (!selectedClassCode || !turmaPermitida) {
            return res.json({ ok: false, mensagem: 'Selecione uma turma valida para a solicitacao.' });
        }

        const { dates, classTypes } = req.body;

        if (!Array.isArray(dates) || dates.length === 0) {
            return res.json({ ok: false, mensagem: 'Nenhuma data selecionada.' });
        }

        const todayBrYmd = moment().utcOffset(PRESENCA_BR_UTC_OFFSET_MIN).format('YYYY-MM-DD');
        const limitBrYmd = moment()
            .utcOffset(PRESENCA_BR_UTC_OFFSET_MIN)
            .subtract(15, 'days')
            .format('YYYY-MM-DD');
        const results = [];
        const errors = [];

        for (const dateStr of dates) {
            if (!moment(dateStr, 'YYYY-MM-DD', true).isValid()) {
                errors.push({ date: dateStr, error: 'Data inválida.' });
                continue;
            }
            if (dateStr > todayBrYmd) {
                errors.push({ date: dateStr, error: 'Não é permitido solicitar para datas futuras.' });
                continue;
            }
            if (dateStr < limitBrYmd) {
                errors.push({
                    date: dateStr,
                    error: `Anterior ao limite de 15 dias (${moment(limitBrYmd, 'YYYY-MM-DD').format('DD/MM/YYYY')}).`
                });
                continue;
            }

            const range = presencaUtcRangeForYmd(dateStr);
            if (!range) {
                errors.push({ date: dateStr, error: 'Data inválida.' });
                continue;
            }

            const dupWindow = presencaDuplicateQueryRange(dateStr);
            const candidatosDup =
                dupWindow &&
                (await Presenca.findAll({
                    where: {
                        user_code: userCode,
                        request_date: { [Op.between]: [dupWindow.start, dupWindow.end] },
                        status: { [Op.ne]: 'C' }
                    },
                    attributes: ['id', 'request_date']
                }));
            if (candidatosDup && candidatosDup.some((row) => presencaMatchesSolicitacaoDay(row.request_date, dateStr))) {
                errors.push({ date: dateStr, error: 'Já existe uma solicitação para este dia.' });
                continue;
            }

            const dayOfWeek = civilDateWeekdaySun0FromYmd(dateStr); // 0=Dom ... 2=Ter
            let class_type = 'Integral';
            if (dayOfWeek === 2) {
                const ct = classTypes && classTypes[dateStr] ? classTypes[dateStr] : 'Integral';
                if (!['Integral', 'Gi', 'No-Gi'].includes(ct)) {
                    errors.push({ date: dateStr, error: 'Tipo de aula inválido.' });
                    continue;
                }
                class_type = ct;
            }

            const presenca = await Presenca.create({
                request_date: range.noon,
                user_code: userCode,
                status: 'P',
                class_type,
                class_code: selectedClassCode
            });

            const vm = buildPresencaViewModel(presenca);
            results.push(vm);
        }

        return res.json({ ok: true, results, errors });
    } catch (err) {
        return res.json({ ok: false, mensagem: 'Erro interno: ' + err.message });
    }
});

app.post('/presenca/cancelar/:id', async (req, res) => {
    try {
        const userCode = await getEffectiveUserCode(req);
        if (!userCode) {
            return res.json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const presencaId = parseInt(req.params.id, 10);
        if (!Number.isInteger(presencaId)) {
            return res.json({ ok: false, mensagem: 'ID inválido.' });
        }

        const presenca = await Presenca.findByPk(presencaId);
        if (!presenca) {
            return res.json({ ok: false, mensagem: 'Solicitação não encontrada.' });
        }
        if (presenca.user_code !== userCode) {
            return res.json({ ok: false, mensagem: 'Sem permissão para cancelar esta solicitação.' });
        }
        if (presenca.status !== 'P') {
            return res.json({ ok: false, mensagem: 'Apenas solicitações pendentes podem ser canceladas.' });
        }

        presenca.status = 'C';
        await presenca.save();

        return res.json({ ok: true });
    } catch (err) {
        return res.json({ ok: false, mensagem: 'Erro ao cancelar: ' + err.message });
    }
});

app.post('/aniversario/mensagens/desativar', async (req, res) => {
    try {
        const usuarioSessao = req.session.usuario;
        if (!usuarioSessao || !usuarioSessao.id) {
            return res.status(401).json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const usuario = await Usuario.findByPk(usuarioSessao.id);
        if (!usuario) {
            return res.status(404).json({ ok: false, mensagem: 'Usuário não encontrado.' });
        }

        usuario.birthday_messages_disabled = true;
        usuario.birthday_messages_disabled_year = new Date().getFullYear();
        await usuario.save();
        delete req.session.birthdayLoginModal;

        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, mensagem: 'Erro ao atualizar preferência: ' + err.message });
    }
});

app.post('/mensagens/ocultar', async (req, res) => {
    try {
        const usuarioSessao = req.session.usuario;
        if (!usuarioSessao || !usuarioSessao.user_code) {
            return res.status(401).json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const messageId = parseInt(req.body.message_id, 10);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ ok: false, mensagem: 'Mensagem inválida.' });
        }

        const mensagem = await findVisibleMassMessageForStudent(usuarioSessao, messageId);
        if (!mensagem) {
            return res.status(403).json({ ok: false, mensagem: 'Sem turma ativa para esta operação.' });
        }

        await MensagemProfessorOcultacao.findOrCreate({
            where: {
                message_id: messageId,
                user_code: usuarioSessao.user_code
            },
            defaults: {
                hidden_at: new Date()
            }
        });

        const state = await getStudentMassMessageState(usuarioSessao);

        return res.json({
            ok: true,
            unreadCount: state.unreadCount,
            totalCount: state.totalCount
        });
    } catch (err) {
        return res.status(500).json({ ok: false, mensagem: 'Erro ao ocultar mensagem: ' + err.message });
    }
});

app.post('/mensagens/mestre/:id/lida', async (req, res) => {
    try {
        const usuarioSessao = req.session.usuario;
        if (!usuarioSessao || usuarioSessao.role !== 'STD' || !usuarioSessao.user_code) {
            return res.status(401).json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const messageId = parseInt(req.params.id, 10);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ ok: false, mensagem: 'Mensagem inválida.' });
        }

        const result = await markMassMessageAsRead(usuarioSessao, messageId);
        return res.json({ ok: true, unreadCount: result.unreadCount, readAtLabel: result.readAtLabel });
    } catch (err) {
        if (err.message === 'Mensagem não encontrada.') {
            return res.status(404).json({ ok: false, mensagem: err.message });
        }

        return res.status(500).json({ ok: false, mensagem: 'Erro ao registrar leitura: ' + err.message });
    }
});

app.post('/mensagens/mestre/:id/naoLida', async (req, res) => {
    try {
        const usuarioSessao = req.session.usuario;
        if (!usuarioSessao || usuarioSessao.role !== 'STD' || !usuarioSessao.user_code) {
            return res.status(401).json({ ok: false, mensagem: 'Não autenticado.' });
        }

        const messageId = parseInt(req.params.id, 10);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ ok: false, mensagem: 'Mensagem inválida.' });
        }

        // Verify message exists and is accessible to student
        const message = await findVisibleMassMessageForStudent(usuarioSessao, messageId);
        if (!message) {
            return res.status(404).json({ ok: false, mensagem: 'Mensagem não encontrada.' });
        }

        // Delete read record to mark as unread
        await MensagemProfessorLeitura.destroy({
            where: {
                message_id: messageId,
                user_code: usuarioSessao.user_code
            }
        });

        // Get updated state
        const state = await getStudentMassMessageState(usuarioSessao);
        return res.json({ ok: true, unreadCount: state.unreadCount });
    } catch (err) {
        if (err.message === 'Mensagem não encontrada.') {
            return res.status(404).json({ ok: false, mensagem: err.message });
        }

        return res.status(500).json({ ok: false, mensagem: 'Erro ao marcar como não lida: ' + err.message });
    }
});


// GRUPO DE ROTAS DE AUTENTICAÇÃO / RESET PASSWORD
app.get('/auth/login', function (req, res) {
    if (req.session.usuario) {
        return res.redirect(getDefaultRedirectByRole(req.session.usuario.role));
    }

    const redirect = typeof req.query.redirect === 'string' && req.query.redirect.startsWith('/')
        ? req.query.redirect
        : '/dashboard';

    res.render('login', {
        layout: false,
        erro: req.query.erro || '',
        aviso: req.query.aviso || '',
        redirect
    });
});
app.post('/auth/verify', function (req, res) {
    const { email, password } = req.body;
    const requestedRedirect = typeof req.body.redirect === 'string' && req.body.redirect.startsWith('/')
        ? req.body.redirect
        : '/dashboard';

    if (!email || !password) {
        const erro = encodeURIComponent('Informe e-mail e senha.');
        return res.redirect(`/auth/login?erro=${erro}&redirect=${encodeURIComponent(requestedRedirect)}`);
    }

    Usuario.findAll({ where: { email: (email || '').trim().toLowerCase() } }).then(async function (usuarios) {
        if (!usuarios || usuarios.length === 0) {
            const erro = encodeURIComponent('Credenciais inválidas.');
            return res.redirect(`/auth/login?erro=${erro}&redirect=${encodeURIComponent(requestedRedirect)}`);
        }

        const candidatosComSenhaValida = [];

        for (const candidato of usuarios) {
            let senhaCandidataValida = false;

            if (typeof candidato.password === 'string' && candidato.password.startsWith('$argon2')) {
                senhaCandidataValida = await argon2.verify(candidato.password, password);
            } else {
                senhaCandidataValida = candidato.password === password;

                if (senhaCandidataValida) {
                    candidato.password = await argon2.hash(password);
                    await candidato.save();
                }
            }

            if (senhaCandidataValida) {
                candidatosComSenhaValida.push(candidato);
            }
        }

        if (candidatosComSenhaValida.length === 0) {
            const erro = encodeURIComponent('Credenciais inválidas.');
            return res.redirect(`/auth/login?erro=${erro}&redirect=${encodeURIComponent(requestedRedirect)}`);
        }

        const usuario = candidatosComSenhaValida.find((item) => item.user_status === 'A') || candidatosComSenhaValida[0];

        if (usuario.user_status === 'P') {
            const aviso = encodeURIComponent('Seu cadastro está pendente de aprovação. Fale com o seu professor.');
            return res.redirect(`/auth/login?aviso=${aviso}&redirect=${encodeURIComponent(requestedRedirect)}`);
        }

        if (usuario.user_status === 'C') {
            const aviso = encodeURIComponent('Seu acesso está bloqueado. Se você acha que isso é algum engano, fale com o seu professor.');
            return res.redirect(`/auth/login?aviso=${aviso}&redirect=${encodeURIComponent(requestedRedirect)}`);
        }

        if (!['STD', 'PRO', 'ADM'].includes(usuario.role)) {
            const erro = encodeURIComponent('Seu nível de acesso não está autorizado para este portal.');
            return res.redirect(`/auth/login?erro=${erro}&redirect=${encodeURIComponent(requestedRedirect)}`);
        }

        req.session.usuario = {
            id: usuario.id,
            user_code: usuario.user_code,
            first_name: usuario.first_name,
            last_name: usuario.last_name,
            email: usuario.email,
            role: usuario.role
        };

        req.session.birthdayLoginModal = buildBirthdayLoginModalData(usuario);
        req.session.motivationalMessage = getRandomMotivationalMessage();

        const redirectNeedsNormalization = new Set(['/', '/aluno', '/dashboardaluno']);
        const redirect = redirectNeedsNormalization.has(requestedRedirect)
            ? getDefaultRedirectByRole(usuario.role)
            : requestedRedirect;

        return res.redirect(redirect);
    }).catch(function (err) {
        const erro = encodeURIComponent('Erro ao verificar credenciais: ' + err.message);
        res.redirect(`/auth/login?erro=${erro}&redirect=${encodeURIComponent(requestedRedirect)}`);
    });
});
app.post('/auth/logout', function (req, res) {
    req.session.destroy(function () {
        res.clearCookie('oss.sid');
        const erro = encodeURIComponent('Sessão encerrada. Faça login novamente.');
        res.redirect(`/auth/login?erro=${erro}`);
    });
});

app.get('/auth/forgot-password', (req, res) => {
    renderForgotPasswordPage(res);
});

app.post('/auth/forgot-password', async (req, res) => {
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return renderForgotPasswordPage(res, {
            email,
            statusMessages: buildForgotPasswordMessages({
                errorMessage: 'Informe o e-mail cadastrado para continuar.'
            })
        });
    }

    try {
        const usuarios = await findUsuariosByEmail(email);
        const emailFound = usuarios.length > 0;

        if (emailFound) {
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = await argon2.hash(token);
            const reset_token_expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
            const usuarioIds = usuarios.map((usuario) => usuario.id);

            await Usuario.update(
                { reset_token_hash: tokenHash, reset_token_expires },
                {
                    where: {
                        id: { [Op.in]: usuarioIds }
                    }
                }
            );

            try {
                await sendResetPasswordEmail(req, email, token, usuarios.length);
            } catch (mailError) {
                console.error('Falha ao enviar e-mail de redefinição:', mailError.message);
            }
        }

        return renderForgotPasswordPage(res, {
            requestMode: false,
            email: '',
            statusMessages: buildForgotPasswordAcknowledgementMessage()
        });
    } catch (error) {
        console.error('Erro ao processar solicitação de redefinição:', error);
        return renderForgotPasswordPage(res, {
            requestMode: false,
            email: '',
            statusMessages: buildForgotPasswordAcknowledgementMessage()
        });
    }
});

app.get('/auth/reset-password', async (req, res) => {
    const email = normalizeEmail(req.query.email);
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

    if (!email || !token) {
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            canSubmitReset: false,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'O link de redefinição está incompleto. Solicite um novo link para continuar.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }

    try {
        const validUsuarios = await findUsuariosWithValidResetToken(email, token);
        if (validUsuarios.length === 0) {
            return renderForgotPasswordPage(res, {
                requestMode: false,
                resetMode: true,
                canSubmitReset: false,
                email,
                token,
                statusMessages: buildResetPasswordMessages({
                    errorMessage: 'Este link é inválido ou já expirou. Solicite uma nova redefinição.',
                    infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
                })
            });
        }

        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                infoMessage: validUsuarios.length > 1
                    ? 'A senha que você definir agora será aplicada a todos os cadastros vinculados a este e-mail.'
                    : `Defina sua nova senha. Este link expira em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    } catch (error) {
        console.error('Erro ao validar link de redefinição:', error);
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            canSubmitReset: false,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'Não foi possível validar este link agora. Solicite uma nova redefinição.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }
});

async function handleResetPasswordSubmit(req, res) {
    const email = normalizeEmail(req.body.email);
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const newPassword = String(req.body.newPassword || '').trim();
    const confirmPassword = String(req.body.confirmPassword || '').trim();

    if (!email || !token) {
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            canSubmitReset: false,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'O link de redefinição é inválido. Solicite um novo link para continuar.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }

    if (!newPassword) {
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'Informe a nova senha para concluir a redefinição.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }

    if (newPassword.length < 6) {
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'A nova senha precisa ter pelo menos 6 caracteres.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'A confirmação da senha não confere.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }

    try {
        const validUsuarios = await findUsuariosWithValidResetToken(email, token);
        if (validUsuarios.length === 0) {
            return renderForgotPasswordPage(res, {
                requestMode: false,
                resetMode: true,
                canSubmitReset: false,
                email,
                token,
                statusMessages: buildResetPasswordMessages({
                    errorMessage: 'Este link é inválido ou já expirou. Solicite uma nova redefinição.',
                    infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
                })
            });
        }

        const newHash = await argon2.hash(newPassword);
        const validIds = validUsuarios.map((usuario) => usuario.id);

        await Usuario.update(
            {
                password: newHash,
                reset_token_hash: null,
                reset_token_expires: null
            },
            {
                where: {
                    id: { [Op.in]: validIds }
                }
            }
        );

        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            resetCompleted: true,
            canSubmitReset: false,
            email,
            statusMessages: buildResetPasswordMessages({
                successMessage: validUsuarios.length > 1
                    ? 'Sua senha foi redefinida com sucesso em todos os cadastros vinculados a este e-mail.'
                    : 'Sua senha foi redefinida com sucesso.',
                infoMessage: 'Se precisar, você já pode voltar ao login e acessar o sistema com a nova senha.'
            })
        });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        return renderForgotPasswordPage(res, {
            requestMode: false,
            resetMode: true,
            email,
            token,
            statusMessages: buildResetPasswordMessages({
                errorMessage: 'Ocorreu um erro ao redefinir a senha. Solicite um novo link e tente novamente.',
                infoMessage: `Os links de redefinição expiram em ${RESET_TOKEN_TTL_MINUTES} minutos.`
            })
        });
    }
}

app.post('/auth/reset-password', handleResetPasswordSubmit);

// Compatibilidade com formulários antigos
app.post('/reset-password', handleResetPasswordSubmit);

// ### FORMATADORES PARA HANDLEBARS ###
const Handlebars = require("handlebars");

// data no formato DD/MM/YYYY
Handlebars.registerHelper("formatDate", function (date) {
    if (!date) return "";
    return moment(date).format("DD/MM/YYYY");
});

// hora no formato HH:mm:ss
Handlebars.registerHelper("formatTime", function (timestamp) {
    if (!timestamp) return "";
    return moment(timestamp).format("HH:mm:ss");
});

// data hora no formato dd/mm/yyyy HH:mm:ss
Handlebars.registerHelper("formatTimestamp", function (timestamp) {
    if (!timestamp) return "";
    return moment(timestamp).format("DD/MM/YYYY HH:mm:ss");
});

// formatação do telefone para o formato (XX) XXXXX-XXXX
Handlebars.registerHelper("formatPhone", function (phone) {
    if (!phone) return "";
    const cleaned = ('' + phone).replace(/\D/g, '');
    const match = cleaned.match(/^(\d{2})(\d{5})(\d{4})$/);
    if (match) {
        return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return phone;
});

// Helper para comparação de igualdade
Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
});

async function ensureUsuarioEmailNotUnique() {
    const dialect = sequelize.getDialect();

    if (dialect !== 'mysql' && dialect !== 'mariadb') {
        return;
    }

    const [indexes] = await sequelize.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tb_usuarios'
          AND COLUMN_NAME = 'email'
          AND NON_UNIQUE = 0
          AND INDEX_NAME <> 'PRIMARY'
    `);

    for (const row of indexes) {
        if (!row || !row.INDEX_NAME) {
            continue;
        }

        await sequelize.query(`ALTER TABLE tb_usuarios DROP INDEX \`${row.INDEX_NAME}\``);
        console.log(`Indice unico removido em tb_usuarios.email: ${row.INDEX_NAME}`);
    }
}

async function ensureUsuarioClassCodeColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.class_code) {
        await queryInterface.addColumn('tb_usuarios', 'class_code', {
            type: Sequelize.STRING(5),
            allowNull: true
        });
        console.log('Coluna class_code adicionada em tb_usuarios.');
    }
}

async function ensureUsuarioBirthdayMessagesDisabledColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.birthday_messages_disabled) {
        await queryInterface.addColumn('tb_usuarios', 'birthday_messages_disabled', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
        console.log('Coluna birthday_messages_disabled adicionada em tb_usuarios.');
    }
}

async function ensureUsuarioBirthdayMessagesDisabledYearColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.birthday_messages_disabled_year) {
        await queryInterface.addColumn('tb_usuarios', 'birthday_messages_disabled_year', {
            type: Sequelize.INTEGER,
            allowNull: true
        });
        console.log('Coluna birthday_messages_disabled_year adicionada em tb_usuarios.');
    }

    await queryInterface.bulkUpdate(
        'tb_usuarios',
        { birthday_messages_disabled_year: new Date().getFullYear() },
        {
            birthday_messages_disabled: true,
            birthday_messages_disabled_year: null
        }
    );
}

async function ensureTurmaSchema() {
    await Turma.sync();
    await TurmaAluno.sync();
    await MensagemProfessor.sync();
    await MensagemProfessorOcultacao.sync();
    await MensagemProfessorLeitura.sync();
    await ensureUsuarioClassCodeColumn();
    await ensureUsuarioBirthdayMessagesDisabledColumn();
    await ensureUsuarioBirthdayMessagesDisabledYearColumn();
}





// ### CONFIGURAÇÕES GERAIS ### 
// engine de template de visualização
app.engine('handlebars', engine({
    defaultLayout: 'main',
    partialsDir: [path.join(__dirname, 'views', 'layouts')]
}));

app.set('view engine', 'handlebars');

app.set('views', path.join(__dirname, 'views'));

function getErrorViewModel(statusCode) {
    const normalizedStatusCode = Number(statusCode) || 500;
    const map = {
        403: {
            title: 'Acesso negado',
            message: 'Você não tem permissão para acessar este recurso.',
            iconClass: 'fa-ban'
        },
        404: {
            title: 'Página não encontrada',
            message: 'A página solicitada não existe ou foi movida.',
            iconClass: 'fa-triangle-exclamation'
        },
        429: {
            title: 'Muitas solicitações',
            message: 'Você fez muitas requisições em pouco tempo. Tente novamente em instantes.',
            iconClass: 'fa-gauge-high'
        },
        500: {
            title: 'Erro interno',
            message: 'Ocorreu um erro inesperado no servidor.',
            iconClass: 'fa-bug'
        },
        501: {
            title: 'Não implementado',
            message: 'Essa funcionalidade ainda não está disponível.',
            iconClass: 'fa-screwdriver-wrench'
        },
        502: {
            title: 'Falha no gateway',
            message: 'O servidor recebeu uma resposta inválida de um serviço externo.',
            iconClass: 'fa-plug-circle-xmark'
        },
        503: {
            title: 'Serviço indisponível',
            message: 'O serviço está temporariamente indisponível. Tente novamente em instantes.',
            iconClass: 'fa-power-off'
        },
        504: {
            title: 'Tempo esgotado',
            message: 'O servidor não respondeu a tempo. Tente novamente.',
            iconClass: 'fa-hourglass-end'
        }
    };

    if (normalizedStatusCode === 443) {
        return { statusCode: 443, title: 'Acesso negado', message: 'Acesso bloqueado.', iconClass: 'fa-ban' };
    }

    const fallback = map[500];
    const viewModel = map[normalizedStatusCode] || {
        statusCode: normalizedStatusCode,
        title: fallback.title,
        message: fallback.message,
        iconClass: fallback.iconClass
    };

    return { statusCode: normalizedStatusCode, ...viewModel };
}

function renderErrorPage(res, statusCode) {
    const vm = getErrorViewModel(statusCode);
    return res.status(vm.statusCode).render('errors/error', vm);
}

// 404: rota não encontrada (deve ficar depois das rotas)
app.use((req, res) => {
    if (res.headersSent) {
        return;
    }

    if (req.accepts(['html', 'json']) === 'json') {
        return res.status(404).json({ ok: false, error: 'Not Found' });
    }

    return renderErrorPage(res, 404);
});

// Handler central de erros
app.use((err, req, res, _next) => {
    const statusCode = Number(err && (err.statusCode || err.status)) || 500;
    const message = isProduction ? undefined : (err && err.message ? err.message : undefined);

    if (res.headersSent) {
        return;
    }

    if (req.accepts(['html', 'json']) === 'json') {
        return res.status(statusCode).json({
            ok: false,
            error: statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
            message
        });
    }

    const vm = getErrorViewModel(statusCode);
    if (!isProduction && message) {
        vm.message = message;
    }

    return res.status(vm.statusCode).render('errors/error', vm);
});


// execução do servidor
const PORT = process.env.ENV_PORT || 3000;
ensureUsuarioEmailNotUnique()
    .then(() => {
        return ensureTurmaSchema();
    })
    .then(() => {
        app.listen(PORT, function () {
            console.clear();
            console.log('');
            console.log('\n\nServidor funcionando...');
            console.log(`Acesse http://localhost:${PORT} para ver o app.`);
        });
    })
    .catch((err) => {
        console.error('Falha ao inicializar ajuste de indice de e-mail:', err.message);
        process.exit(1);
    });
