const { main, tableExists, createTableIfMissing } = require('../../../scripts/migrate_facial_recognition_fotos');

describe('scripts/migrate_facial_recognition_fotos', () => {
    test('exporta API usável em testes', () => {
        expect(typeof main).toBe('function');
        expect(typeof tableExists).toBe('function');
        expect(typeof createTableIfMissing).toBe('function');
    });
});
