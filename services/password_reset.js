'use strict';

const { Op } = require('sequelize');
const nodemailer = require('nodemailer');
const argon2 = require('argon2');
const Usuario = require('../models/Usuario');
const { RESET_TOKEN_TTL_MINUTES } = require('../config/constants');
const { normalizeEmail } = require('../lib/pure_helpers');
const { getPasswordResetTransportConfig } = require('./mail_transport');
const { buildResetPasswordLink } = require('./public_app_links');

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

module.exports = {
    buildForgotPasswordMessages,
    buildForgotPasswordAcknowledgementMessage,
    buildResetPasswordMessages,
    renderForgotPasswordPage,
    sendResetPasswordEmail,
    findUsuariosByEmail,
    findUsuariosWithValidResetToken,
    handleResetPasswordSubmit
};
