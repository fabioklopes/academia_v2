'use strict';

/**
 * Encerra a sessão automaticamente quando o usuário fica parado por muito tempo.
 * O tempo padrão é 10 minutos (configurável em SESSION_IDLE_TIMEOUT_MS).
 */

const { SESSION_IDLE_TIMEOUT_MS } = require('../config/constants');
const { isPublicRoute } = require('./require_auth');

const SESSION_COOKIE_NAME = 'oss.sid';
const IDLE_EXPIRED_MESSAGE = 'Sua sessão expirou por inatividade. Faça login novamente.';

/** Cria o middleware que verifica inatividade a cada requisição. */
function createSessionIdleTimeoutMiddleware() {
    return function sessionIdleTimeout(req, res, next) {
        if (isPublicRoute(req.path) || !req.session || !req.session.usuario) {
            return next();
        }

        const now = Date.now();
        const lastActivity = typeof req.session.lastActivity === 'number'
            ? req.session.lastActivity
            : now;

        if (now - lastActivity > SESSION_IDLE_TIMEOUT_MS) {
            return req.session.destroy(function onIdleSessionDestroyed(destroyErr) {
                if (destroyErr) {
                    console.error('Erro ao encerrar sessão por inatividade:', destroyErr.message);
                }
                res.clearCookie(SESSION_COOKIE_NAME);
                const erro = encodeURIComponent(IDLE_EXPIRED_MESSAGE);
                return res.redirect(`/auth/login?erro=${erro}`);
            });
        }

        req.session.lastActivity = now;
        if (typeof req.session.touch === 'function') {
            req.session.touch();
        }

        return next();
    };
}

module.exports = {
    createSessionIdleTimeoutMiddleware,
    IDLE_EXPIRED_MESSAGE,
    SESSION_COOKIE_NAME
};
