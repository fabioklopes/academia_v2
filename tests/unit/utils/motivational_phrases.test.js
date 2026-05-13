const {
    getRandomMotivationalMessage,
    loadMotivationalPhrases,
    motivationalPhrases
} = require('../../../utils/motivational_phrases');

describe('utils/motivational_phrases', () => {
    test('carrega lista e retorna string', () => {
        const list = loadMotivationalPhrases();
        expect(Array.isArray(list)).toBe(true);
        expect(Array.isArray(motivationalPhrases)).toBe(true);
        const msg = getRandomMotivationalMessage();
        expect(typeof msg).toBe('string');
    });
});
