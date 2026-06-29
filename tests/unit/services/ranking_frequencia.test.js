const {
    compareRankingEntries,
    assignRankingPositions,
    getRowHighlightClass,
    paginateRankingItems
} = require('../../../services/ranking_frequencia');

const beltMap = {
    white: { order: 1 },
    blue: { order: 14 },
    black: { order: 17 }
};

function makeEntry(overrides = {}) {
    return {
        user_code: 'AAA11',
        full_name: 'Nome Padrão',
        total: 0,
        actual_belt: 'white',
        actual_degree: '0',
        ...overrides
    };
}

describe('compareRankingEntries', () => {
    test('prioriza maior quantidade de presenças', () => {
        const a = makeEntry({ user_code: 'AAA11', total: 10 });
        const b = makeEntry({ user_code: 'BBB22', total: 5 });
        expect(compareRankingEntries(a, b, beltMap)).toBeLessThan(0);
        expect(compareRankingEntries(b, a, beltMap)).toBeGreaterThan(0);
    });

    test('desempata por faixa maior', () => {
        const a = makeEntry({ user_code: 'AAA11', total: 8, actual_belt: 'black' });
        const b = makeEntry({ user_code: 'BBB22', total: 8, actual_belt: 'blue' });
        expect(compareRankingEntries(a, b, beltMap)).toBeLessThan(0);
    });

    test('desempata por quantidade de graus', () => {
        const a = makeEntry({ user_code: 'AAA11', total: 8, actual_belt: 'blue', actual_degree: '3' });
        const b = makeEntry({ user_code: 'BBB22', total: 8, actual_belt: 'blue', actual_degree: '1' });
        expect(compareRankingEntries(a, b, beltMap)).toBeLessThan(0);
    });

    test('desempata por ordem alfabética do nome', () => {
        const a = makeEntry({ total: 8, actual_belt: 'blue', actual_degree: '2', full_name: 'Ana Silva' });
        const b = makeEntry({ user_code: 'BBB22', total: 8, actual_belt: 'blue', actual_degree: '2', full_name: 'Bruno Costa' });
        expect(compareRankingEntries(a, b, beltMap)).toBeLessThan(0);
        expect(compareRankingEntries(b, a, beltMap)).toBeGreaterThan(0);
    });
});

describe('assignRankingPositions', () => {
    test('atribui posições únicas sequenciais', () => {
        const entries = [
            makeEntry({ user_code: 'AAA11', total: 10 }),
            makeEntry({ user_code: 'BBB22', total: 8 }),
            makeEntry({ user_code: 'CCC33', total: 4 })
        ];

        const ranked = assignRankingPositions(entries);
        expect(ranked.map((item) => item.position)).toEqual([1, 2, 3]);
    });
});

describe('getRowHighlightClass', () => {
    test('aplica classes do top 5', () => {
        expect(getRowHighlightClass(1)).toBe('bg-success');
        expect(getRowHighlightClass(2)).toBe('bg-primary');
        expect(getRowHighlightClass(3)).toBe('bg-warning text-dark');
        expect(getRowHighlightClass(4)).toBe('bg-info');
        expect(getRowHighlightClass(5)).toBe('bg-info');
        expect(getRowHighlightClass(6)).toBe('');
    });
});

describe('paginateRankingItems', () => {
    test('mantém posições globais entre páginas', () => {
        const ranked = assignRankingPositions([
            makeEntry({ user_code: 'AAA11', total: 10 }),
            makeEntry({ user_code: 'BBB22', total: 9 }),
            makeEntry({ user_code: 'CCC33', total: 8 }),
            makeEntry({ user_code: 'DDD44', total: 7 }),
            makeEntry({ user_code: 'EEE55', total: 6 }),
            makeEntry({ user_code: 'FFF66', total: 5 }),
            makeEntry({ user_code: 'GGG77', total: 4 }),
            makeEntry({ user_code: 'HHH88', total: 3 }),
            makeEntry({ user_code: 'III99', total: 2 }),
            makeEntry({ user_code: 'JJJ00', total: 1 }),
            makeEntry({ user_code: 'KKK01', total: 0 })
        ]);

        const page1 = paginateRankingItems(ranked, 1, 10);
        const page2 = paginateRankingItems(ranked, 2, 10);

        expect(page1).toHaveLength(10);
        expect(page1[0].position).toBe(1);
        expect(page1[9].position).toBe(10);
        expect(page2).toHaveLength(1);
        expect(page2[0].position).toBe(11);
    });
});
