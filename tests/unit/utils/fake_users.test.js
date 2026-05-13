const { randomFrom, randomPhone, randomDegreeForBelt, randomBirthDate } = require('../../../utils/fake_users');

describe('utils/fake_users (exports)', () => {
    test('randomFrom', () => {
        expect(randomFrom([42])).toBe(42);
    });

    test('randomPhone formato 11 dígitos', () => {
        expect(randomPhone()).toMatch(/^\d{11}$/);
    });

    test('randomDegreeForBelt', () => {
        expect(parseInt(randomDegreeForBelt('black'), 10)).toBeLessThanOrEqual(6);
        expect(parseInt(randomDegreeForBelt('white'), 10)).toBeLessThanOrEqual(4);
    });

    test('randomBirthDate ISO date', () => {
        expect(randomBirthDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
