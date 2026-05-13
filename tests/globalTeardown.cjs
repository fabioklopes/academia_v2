/**
 * Fecha pool MySQL após toda a suíte (evita conexões pendentes e erros pós-teardown).
 */
module.exports = async function globalTeardown() {
    try {
        // eslint-disable-next-line global-require
        const { sequelize } = require('../models/db');
        await sequelize.close();
    } catch (_e) {
        // ignore
    }
};
