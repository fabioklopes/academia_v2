const {
    PRESENCA_BR_UTC_OFFSET_MIN,
    presencaUtcRangeForYmd,
    presencaCivilYmdBrasil,
    presencaMatchesSolicitacaoDay,
    presencaDuplicateQueryRange,
    presencaPesoPorSolicitacao
} = require('../../../lib/presenca_dates');

describe('lib/presenca_dates', () => {
    test('PRESENCA_BR_UTC_OFFSET_MIN é -180 (UTC-3, sem horário de verão)', () => {
        expect(PRESENCA_BR_UTC_OFFSET_MIN).toBe(-180);
    });

    test('presencaUtcRangeForYmd monta início/fim/meio-dia em UTC', () => {
        const range = presencaUtcRangeForYmd('2026-06-30');
        expect(range.noon.toISOString()).toBe('2026-06-30T12:00:00.000Z');
        expect(range.start.toISOString()).toBe('2026-06-30T00:00:00.000Z');
        expect(range.end.toISOString()).toBe('2026-06-30T23:59:59.999Z');
    });

    test('presencaUtcRangeForYmd retorna null para data inválida', () => {
        expect(presencaUtcRangeForYmd('lixo')).toBeNull();
    });

    test('presencaMatchesSolicitacaoDay casa o meio-dia UTC com o mesmo dia civil', () => {
        const noon = presencaUtcRangeForYmd('2026-06-30').noon;
        expect(presencaMatchesSolicitacaoDay(noon, '2026-06-30')).toBe(true);
        expect(presencaMatchesSolicitacaoDay(noon, '2026-07-01')).toBe(false);
    });

    test('presencaDuplicateQueryRange cobre ±1 dia ao redor da data', () => {
        const range = presencaDuplicateQueryRange('2026-06-30');
        expect(range.start.toISOString().slice(0, 10)).toBe('2026-06-29');
        expect(range.end.toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    test('presencaPesoPorSolicitacao: terça Integral pesa 2, Gi/No-Gi pesam 1', () => {
        const noonTuesday = presencaUtcRangeForYmd('2026-06-30').noon;
        expect(presencaPesoPorSolicitacao(noonTuesday, 'Integral')).toBe(2);
        expect(presencaPesoPorSolicitacao(noonTuesday, 'Gi')).toBe(1);
        expect(presencaPesoPorSolicitacao(noonTuesday, 'No-Gi')).toBe(1);
    });

    test('presencaPesoPorSolicitacao: outros dias sempre pesam 1', () => {
        const noonSunday = presencaUtcRangeForYmd('2026-06-28').noon;
        expect(presencaPesoPorSolicitacao(noonSunday, 'Integral')).toBe(1);
    });

    test('presencaCivilYmdBrasil converte meio-dia UTC para o dia civil de Brasília', () => {
        const noon = presencaUtcRangeForYmd('2026-06-30').noon;
        expect(presencaCivilYmdBrasil(noon)).toBe('2026-06-30');
    });
});
