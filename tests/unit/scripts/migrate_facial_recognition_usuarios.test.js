const { main, columnExists, addColumnIfMissing, TABLE } = require('../../../scripts/migrate_facial_recognition_usuarios');

describe('scripts/migrate_facial_recognition_usuarios', () => {
    test('exporta API usável em testes', () => {
        expect(typeof main).toBe('function');
        expect(typeof columnExists).toBe('function');
        expect(typeof addColumnIfMissing).toBe('function');
        expect(TABLE).toBe('tb_usuarios');
    });
});
