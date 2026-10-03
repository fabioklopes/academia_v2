'use strict';

/**
 * Monta a configuração do Nodemailer a partir das variáveis de ambiente.
 * Retorna null se SMTP não estiver configurado (útil em desenvolvimento local).
 */
function getPasswordResetTransportConfig() {
    const service = process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE;
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const portValue = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const passRaw = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
    // Senhas de app do Google são exibidas agrupadas ("abcd efgh ijkl mnop") e
    // rejeitadas pelo SMTP se forem enviadas com espaços.
    const pass = typeof passRaw === 'string' ? passRaw.replace(/\s+/g, '') : passRaw;

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

module.exports = {
    getPasswordResetTransportConfig
};
