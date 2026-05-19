'use strict';

const AppActivityLog = require('../models/AppActivityLog');
const { APP_ACTIVITY_LOG_MAX, APP_ACTIVITY_LOG_WARN_REMAINING_RATIO } = require('../config/constants');

function createAdminLogLocalsMiddleware() {
    return async (req, res, next) => {
        res.locals.adminLogCleanupWarning = null;

        const usuario = req.session.usuario;
        if (!usuario || usuario.role !== 'ADM') {
            return next();
        }

        try {
            const logCount = await AppActivityLog.count();
            const warnThreshold = Math.ceil(
                APP_ACTIVITY_LOG_MAX * (1 - APP_ACTIVITY_LOG_WARN_REMAINING_RATIO)
            );

            if (logCount >= warnThreshold) {
                res.locals.adminLogCleanupWarning = {
                    logCount,
                    maxRecords: APP_ACTIVITY_LOG_MAX,
                    warnThreshold,
                    cleanupUrl: '/admin/logs/executar-limpeza'
                };
            }
        } catch (err) {
            console.error('Erro ao verificar limite do log de atividades:', err.message);
        }

        return next();
    };
}

module.exports = {
    createAdminLogLocalsMiddleware
};
