'use strict';

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
