const { main, columnExists, addColumnIfMissing, TABLE } = require('../../../scripts/migrate_tb_usuarios_meuperfil');

describe('scripts/migrate_tb_usuarios_meuperfil', () => {
    test('exporta API usável em testes', () => {
        expect(typeof main).toBe('function');
        expect(typeof columnExists).toBe('function');
        expect(typeof addColumnIfMissing).toBe('function');
        expect(TABLE).toBe('tb_usuarios');
    });
});
