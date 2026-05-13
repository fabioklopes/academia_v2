const generateCode = require('../../../utils/classcode_generator');

describe('utils/classcode_generator', () => {
    test('tamanho e charset', () => {
        const code = generateCode(5);
        expect(code).toHaveLength(5);
        expect(code).toMatch(/^[A-Z0-9]+$/);
    });
});
