const generateCode = require('../../../utils/usercode_generator');

describe('utils/usercode_generator', () => {
    test('tamanho e charset', () => {
        const code = generateCode(5);
        expect(code).toHaveLength(5);
        expect(code).toMatch(/^[A-Z0-9]+$/);
        expect(code).not.toMatch(/[IO0]/);
    });
});
