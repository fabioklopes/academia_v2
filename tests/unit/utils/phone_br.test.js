const { validateBrazilMobilePhone } = require('../../../utils/phone_br');

describe('utils/phone_br', () => {
    test('válido', () => {
        const r = validateBrazilMobilePhone('11999887766');
        expect(r.ok).toBe(true);
        expect(r.phone).toBe('11999887766');
    });

    test('inválidos', () => {
        expect(validateBrazilMobilePhone('').ok).toBe(false);
        expect(validateBrazilMobilePhone('abc').ok).toBe(false);
        expect(validateBrazilMobilePhone('123').ok).toBe(false);
    });
});
