'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const argon2 = require('argon2');
const Usuario = require('../models/Usuario');
const { RESET_TOKEN_TTL_MINUTES, RESET_TOKEN_TTL_MS } = require('../config/constants');
const { getDefaultRedirectByRole, normalizeEmail } = require('../lib/pure_helpers');
const { getRandomMotivationalMessage } = require('../utils/motivational_phrases');
const {
    buildForgotPasswordMessages,
    buildForgotPasswordAcknowledgementMessage,
    buildResetPasswordMessages,
    renderForgotPasswordPage,
    sendResetPasswordEmail,
    findUsuariosByEmail,
    findUsuariosWithValidResetToken,
    handleResetPasswordSubmit
} = require('../services/password_reset');

/**
 * Registra rotas de autenticação: login, logout e redefinição de senha.
 * São rotas públicas — não exigem usuário logado (exceto logout).
 *
 * @param {import('express').Application} app - Aplicação Express
 * @param {{ buildBirthdayLoginModalData: (usuario: object) => object | null }} deps - Funções do app.js
 */
function registerAuthRoutes(app, deps) {
    const { buildBirthdayLoginModalData } = deps;

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
                role: usuario.role,
                actual_belt: usuario.actual_belt || null,
                actual_degree: usuario.actual_degree || null
            };
            req.session.lastActivity = Date.now();

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

    app.post('/auth/reset-password', handleResetPasswordSubmit);

    // Compatibilidade com formulários antigos
    app.post('/reset-password', handleResetPasswordSubmit);
}

module.exports = {
    registerAuthRoutes
};
