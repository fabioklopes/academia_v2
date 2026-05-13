'use strict';

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

module.exports = {
    getPasswordResetTransportConfig
};
