/**
 * Registra no banco cada ação HTTP feita por usuário logado.
 * Ignora arquivos estáticos (CSS, JS, imagens) para não poluir o log.
 */

const AppActivityLog = require('../models/AppActivityLog');
const { APP_ACTIVITY_LOG_ACTIONS } = require('../config/constants');

/** Caminhos que não precisam ser gravados no log (fotos, CSS, favicon, etc.). */
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

/** Padroniza o método HTTP para gravar no log (GET, POST, etc.). */
function normalizeAppActivityAction(method) {
    const m = String(method || 'GET').toUpperCase();
    if (APP_ACTIVITY_LOG_ACTIONS.has(m)) {
        return m;
    }
    return 'GET';
}

/** Pega o código do usuário logado para associar ao registro do log. */
function resolveActivityLogUserCode(req) {
    if (!req.session || !req.session.usuario || !req.session.usuario.user_code) {
        return null;
    }
    return String(req.session.usuario.user_code).trim().substring(0, 5) || null;
}

/** Cria middleware que grava o log após a resposta ser enviada ao navegador. */
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
