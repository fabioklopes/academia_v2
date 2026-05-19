'use strict';

const { dedupeUsuarioRedundantIndexes } = require('../../../bootstrap/ensure_schema');

describe('bootstrap/ensure_schema', () => {
    test('dedupeUsuarioRedundantIndexes ignora dialectos não MySQL', async () => {
        const { sequelize } = require('../../../models/db');
        const original = sequelize.getDialect;
        sequelize.getDialect = () => 'postgres';

        await expect(dedupeUsuarioRedundantIndexes()).resolves.toBeUndefined();

        sequelize.getDialect = original;
    });
});
