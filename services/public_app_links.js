'use strict';

/**
 * Monta a URL base do site para links em e-mails.
 * Usa APP_BASE_URL do .env ou, se não existir, deduz do endereço da requisição.
 */
function getResetPasswordBaseUrl(req) {
    const configuredBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL;
    if (configuredBaseUrl) {
        return configuredBaseUrl.replace(/\/$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
}

/** Link completo para a página de redefinição de senha (com e-mail e token na URL). */
function buildResetPasswordLink(req, email, token) {
    const params = new URLSearchParams({
        email,
        token
    });

    return `${getResetPasswordBaseUrl(req)}/auth/reset-password?${params.toString()}`;
}

/** Link completo para confirmar troca de e-mail no perfil do usuário. */
function buildEmailChangeConfirmLink(req, email, token) {
    const params = new URLSearchParams({
        email,
        token
    });

    return `${getResetPasswordBaseUrl(req)}/meuperfil/confirmar-email?${params.toString()}`;
}

module.exports = {
    getResetPasswordBaseUrl,
    buildResetPasswordLink,
    buildEmailChangeConfirmLink
};
