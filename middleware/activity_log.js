const AppActivityLog = require('../models/AppActivityLog');
const { APP_ACTIVITY_LOG_ACTIONS } = require('../config/constants');

function shouldSkipAppActivityLog(req) {
    const p = req.path || '';
    if (p.startsWith('/uploads') || p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/img')) {
        return true;
    }
    if (p.startsWith('/.well-known/')) {
        return true;
    }
    if (p === '/favicon.ico' || p === '/robots.txt' || p === '/sitemap.xml') {
        return true;
    }
    const lower = p.toLowerCase();
    if (/\.(css|js|ico|map|woff2?|ttf|eot|svg|png|jpe?g|gif|webp)$/i.test(lower)) {
        return true;
    }
    return false;
}

function normalizeAppActivityAction(method) {
    const m = String(method || 'GET').toUpperCase();
    if (APP_ACTIVITY_LOG_ACTIONS.has(m)) {
        return m;
    }
    return 'GET';
}

function resolveActivityLogUserCode(req) {
    if (!req.session || !req.session.usuario || !req.session.usuario.user_code) {
        return null;
    }
    return String(req.session.usuario.user_code).trim().substring(0, 5) || null;
}

function createActivityLogMiddleware() {
    return (req, res, next) => {
        if (shouldSkipAppActivityLog(req)) {
            return next();
        }
        const m = String(req.method || '').toUpperCase();
        if (m === 'OPTIONS' || m === 'HEAD') {
            return next();
        }

        res.on('finish', () => {
            const userCode = resolveActivityLogUserCode(req);
            if (!userCode) {
                return;
            }

            const statusCode = Number(res.statusCode) || 500;
            const status = statusCode >= 400 ? 'FALHA' : 'SUCESSO';
            let endpoint = String(req.originalUrl || req.url || '/').split('?')[0];
            if (endpoint.length > 500) {
                endpoint = endpoint.slice(0, 500);
            }
            const action = normalizeAppActivityAction(req.method);
            void AppActivityLog.create({
                user_code: userCode,
                action,
                endpoint,
                status
            }).catch((err) => {
                console.error('Erro ao registrar log de atividade:', err.message);
            });
        });

        next();
    };
}

module.exports = {
    createActivityLogMiddleware,
    shouldSkipAppActivityLog,
    resolveActivityLogUserCode,
    normalizeAppActivityAction
};
