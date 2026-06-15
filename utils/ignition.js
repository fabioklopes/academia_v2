'use strict';

/**
 * Configuração inicial do sistema (primeira execução).
 * Quando não há administrador ativo ou turma ativa, guia o operador
 * pela criação do ADMIN, credenciais e primeira turma.
 */

const argon2 = require('argon2');
const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const Turma = require('../models/Turma');
const { sequelize } = require('../models/db');
const { ensureUsuarioEmailNotUnique, ensureTurmaSchema } = require('../bootstrap/ensure_schema');
const { generateUniqueClassCode } = require('./create_turma_manual');
const {
    normalizeEmail,
    normalizePersonName,
    formatLastNameWithConnectives,
    normalizeClassName
} = require('../lib/pure_helpers');

const ADMIN_USER_CODE = 'ADMIN';
const IGNITION_PATH = '/ignition';
const MIN_PASSWORD_LENGTH = 8;

/** null = ainda não verificado; boolean após primeira checagem ao banco. */
let ignitionRequiredCache = null;

function clearIgnitionCache() {
    ignitionRequiredCache = null;
}

/** Sincroniza tabelas essenciais antes da primeira configuração. */
async function ensureIgnitionSchema() {
    await ensureUsuarioEmailNotUnique();
    await ensureTurmaSchema();
}

/** Administrador ativo com senha já protegida por Argon2. */
async function hasActiveAdministrator() {
    const admin = await Usuario.findOne({
        where: {
            role: 'ADM',
            user_status: 'A'
        },
        attributes: ['id', 'password']
    });

    if (!admin) {
        return false;
    }

    return typeof admin.password === 'string' && admin.password.startsWith('$argon2');
}

/** Pelo menos uma turma ativa no sistema. */
async function hasActiveTurma() {
    const count = await Turma.count({ where: { active: 'Y' } });
    return count > 0;
}

/** Indica se o assistente de configuração inicial deve ser exibido (somente leitura no banco). */
async function computeIgnitionRequired() {
    const [adminOk, turmaOk] = await Promise.all([
        hasActiveAdministrator(),
        hasActiveTurma()
    ]);
    return !adminOk || !turmaOk;
}

async function isIgnitionRequired() {
    if (ignitionRequiredCache !== null) {
        return ignitionRequiredCache;
    }

    try {
        await sequelize.authenticate();
        ignitionRequiredCache = await computeIgnitionRequired();
    } catch (err) {
        console.error('Ignition: não foi possível verificar o banco:', err.message);
        // Em caso de falha, mantém o assistente acessível em vez de mandar ao login.
        ignitionRequiredCache = true;
    }

    return ignitionRequiredCache;
}

/** Pré-carrega o estado na subida do servidor. */
async function initializeIgnition() {
    ignitionRequiredCache = null;
    return isIgnitionRequired();
}

function isIgnitionRoute(pathname) {
    return pathname === IGNITION_PATH;
}

function validateIgnitionPayload(body) {
    const errors = {};
    const firstName = normalizePersonName(body.first_name);
    const lastName = formatLastNameWithConnectives(body.last_name);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const passwordConfirm = String(body.password_confirm || '');
    const className = String(body.class_name || '').trim();

    if (!firstName) {
        errors.first_name = 'Informe o primeiro nome do administrador.';
    }
    if (!lastName) {
        errors.last_name = 'Informe o sobrenome do administrador.';
    }
    if (!email) {
        errors.email = 'Informe o e-mail do administrador.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'E-mail inválido.';
    }
    if (!password) {
        errors.password = 'Informe a senha.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
        errors.password = `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (password !== passwordConfirm) {
        errors.password_confirm = 'As senhas não conferem.';
    }
    if (!className) {
        errors.class_name = 'Informe o nome da primeira turma.';
    } else if (normalizeClassName(className).length < 2) {
        errors.class_name = 'Nome da turma muito curto.';
    }

    return {
        ok: Object.keys(errors).length === 0,
        errors,
        values: { firstName, lastName, email, password, className }
    };
}

async function persistIgnitionSetup(values) {
    const passwordHash = await argon2.hash(values.password);
    const classCode = await generateUniqueClassCode();

    await sequelize.transaction(async (transaction) => {
        let admin = await Usuario.findOne({
            where: { user_code: ADMIN_USER_CODE },
            transaction
        });

        const adminPayload = {
            user_code: ADMIN_USER_CODE,
            first_name: values.firstName,
            last_name: values.lastName,
            email: values.email,
            password: passwordHash,
            role: 'ADM',
            birth_date: '1990-01-01',
            actual_belt: 'white',
            actual_degree: '0',
            wagi_size: 'A1P',
            zubon_size: 'A1P',
            obi_size: 'A1',
            user_status: 'A',
            photo: '/uploads/users/default.jpg'
        };

        const emailInUse = await Usuario.findOne({
            where: {
                email: values.email,
                user_code: { [Op.ne]: ADMIN_USER_CODE }
            },
            transaction
        });
        if (emailInUse) {
            const err = new Error('Este e-mail já está em uso por outro usuário.');
            err.code = 'EMAIL_IN_USE';
            throw err;
        }

        if (admin) {
            await admin.update(adminPayload, { transaction });
        } else {
            admin = await Usuario.create(adminPayload, { transaction });
        }

        const existingTurma = await Turma.findOne({
            where: { class_name: values.className },
            transaction
        });

        if (existingTurma) {
            if (existingTurma.active !== 'Y') {
                await existingTurma.update({ active: 'Y', created_by: ADMIN_USER_CODE }, { transaction });
            }
        } else {
            await Turma.create({
                class_name: values.className,
                class_code: classCode,
                created_by: ADMIN_USER_CODE,
                active: 'Y'
            }, { transaction });
        }
    });
}

function createIgnitionMiddleware() {
    return async function ignitionMiddleware(req, res, next) {
        if (req.method === 'GET' && (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/img/'))) {
            return next();
        }

        let required;
        try {
            required = await isIgnitionRequired();
        } catch (_err) {
            return res.redirect(IGNITION_PATH);
        }

        if (required && !isIgnitionRoute(req.path)) {
            return res.redirect(IGNITION_PATH);
        }

        if (!required && isIgnitionRoute(req.path)) {
            return res.redirect('/auth/login');
        }

        return next();
    };
}

function registerIgnitionRoutes(app) {
    app.get(IGNITION_PATH, async (req, res) => {
        try {
            const required = await isIgnitionRequired();
            if (!required) {
                return res.redirect('/auth/login');
            }

            return res.render('ignition', {
                layout: false,
                erro: '',
                valores: {
                    first_name: '',
                    last_name: '',
                    email: '',
                    class_name: ''
                },
                camposErro: {}
            });
        } catch (err) {
            return res.status(500).render('ignition', {
                layout: false,
                erro: 'Não foi possível conectar ao banco de dados. Verifique o arquivo .env.',
                valores: {},
                camposErro: {}
            });
        }
    });

    app.post(IGNITION_PATH, async (req, res) => {
        const renderWithFeedback = (erro, camposErro = {}) => {
            res.status(erro ? 400 : 200).render('ignition', {
                layout: false,
                erro,
                valores: {
                    first_name: req.body.first_name || '',
                    last_name: req.body.last_name || '',
                    email: req.body.email || '',
                    class_name: req.body.class_name || ''
                },
                camposErro
            });
        };

        try {
            const required = await isIgnitionRequired();
            if (!required) {
                return res.redirect('/auth/login');
            }

            const validation = validateIgnitionPayload(req.body);
            if (!validation.ok) {
                return renderWithFeedback('Corrija os campos destacados abaixo.', validation.errors);
            }

            await ensureIgnitionSchema();
            await persistIgnitionSetup(validation.values);
            clearIgnitionCache();
            ignitionRequiredCache = false;

            const admin = await Usuario.findOne({
                where: { user_code: ADMIN_USER_CODE, user_status: 'A' }
            });

            if (!admin) {
                return renderWithFeedback('Configuração salva, mas o administrador não foi encontrado. Tente novamente.');
            }

            req.session.usuario = {
                id: admin.id,
                user_code: admin.user_code,
                first_name: admin.first_name,
                last_name: admin.last_name,
                email: admin.email,
                role: admin.role,
                actual_belt: admin.actual_belt || null,
                actual_degree: admin.actual_degree || null
            };
            req.session.lastActivity = Date.now();

            return res.redirect('/dashboard');
        } catch (err) {
            if (err.code === 'EMAIL_IN_USE') {
                return renderWithFeedback(err.message, { email: err.message });
            }

            const mensagem = err.message || 'Erro ao concluir a configuração inicial.';
            return renderWithFeedback(mensagem);
        }
    });
}

module.exports = {
    ADMIN_USER_CODE,
    IGNITION_PATH,
    MIN_PASSWORD_LENGTH,
    clearIgnitionCache,
    ensureIgnitionSchema,
    hasActiveAdministrator,
    hasActiveTurma,
    computeIgnitionRequired,
    isIgnitionRequired,
    initializeIgnition,
    validateIgnitionPayload,
    createIgnitionMiddleware,
    registerIgnitionRoutes
};
