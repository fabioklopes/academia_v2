const { sequelize, Sequelize } = require('../../../models/db');

describe('models/db', () => {
    test('exporta sequelize e Sequelize', () => {
        expect(sequelize).toBeDefined();
        expect(Sequelize).toBeDefined();
        expect(typeof sequelize.authenticate).toBe('function');
    });
});
