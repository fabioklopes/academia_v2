jest.mock('../../../config/compreface_config', () => ({
    getConfig: () => ({ similarityThreshold: 0.9 })
}));

const {
    parseReferenceDate,
    getWeekdayLabel,
    isTuesday,
    resolveClassType,
    resolveSequenceLabel,
    computeFileHash,
    decideFaceMatch,
    buildFinalFileName,
    slugifyName
} = require('../../../services/facial_recognition');

describe('services/facial_recognition', () => {
    describe('parseReferenceDate', () => {
        test('aceita formato ISO', () => {
            expect(parseReferenceDate('2026-06-30')).toBe('2026-06-30');
        });

        test('aceita formato BR e converte para ISO', () => {
            expect(parseReferenceDate('30/06/2026')).toBe('2026-06-30');
        });

        test('rejeita data BR inválida (ex.: 31/02)', () => {
            expect(parseReferenceDate('31/02/2026')).toBeNull();
        });

        test('rejeita string vazia ou formato desconhecido', () => {
            expect(parseReferenceDate('')).toBeNull();
            expect(parseReferenceDate('lixo')).toBeNull();
        });
    });

    describe('getWeekdayLabel / isTuesday', () => {
        test('2026-06-30 é terça-feira', () => {
            expect(isTuesday('2026-06-30')).toBe(true);
            expect(getWeekdayLabel('2026-06-30')).toBe('terca-feira');
        });

        test('2026-06-28 é domingo', () => {
            expect(isTuesday('2026-06-28')).toBe(false);
            expect(getWeekdayLabel('2026-06-28')).toBe('domingo');
        });
    });

    describe('resolveClassType', () => {
        test('força Integral fora de terça-feira', () => {
            expect(resolveClassType('2026-06-28', 'Gi')).toBe('Integral');
        });

        test('exige Gi/No-Gi explícito na terça-feira', () => {
            expect(() => resolveClassType('2026-06-30', '')).toThrow(
                'Para terça-feira, informe o tipo de aula: Gi ou No-Gi.'
            );
        });

        test('aceita Gi/No-Gi na terça-feira', () => {
            expect(resolveClassType('2026-06-30', 'Gi')).toBe('Gi');
            expect(resolveClassType('2026-06-30', 'No-Gi')).toBe('No-Gi');
        });
    });

    describe('resolveSequenceLabel', () => {
        test('Gi na terça vira 1a-Aula, No-Gi vira 2a-Aula', () => {
            expect(resolveSequenceLabel('2026-06-30', 'Gi')).toBe('1a-Aula');
            expect(resolveSequenceLabel('2026-06-30', 'No-Gi')).toBe('2a-Aula');
        });

        test('fora de terça-feira não há sequência', () => {
            expect(resolveSequenceLabel('2026-06-28', 'Integral')).toBeNull();
        });
    });

    describe('computeFileHash', () => {
        test('é determinístico para o mesmo conteúdo', () => {
            const a = computeFileHash(Buffer.from('abc'));
            const b = computeFileHash(Buffer.from('abc'));
            expect(a).toBe(b);
            expect(a).toHaveLength(64);
        });

        test('muda quando o conteúdo muda', () => {
            const a = computeFileHash(Buffer.from('abc'));
            const b = computeFileHash(Buffer.from('abd'));
            expect(a).not.toBe(b);
        });
    });

    describe('decideFaceMatch', () => {
        test('reconhece quando a similaridade atinge o limiar', () => {
            const result = decideFaceMatch([{ subject: 'AB123', similarity: 0.95 }]);
            expect(result).toEqual({
                status: 'RECOGNIZED',
                matchedUserCode: 'AB123',
                similarity: 0.95,
                matchSource: 'AUTO'
            });
        });

        test('não reconhece quando a similaridade fica abaixo do limiar', () => {
            const result = decideFaceMatch([{ subject: 'AB123', similarity: 0.5 }]);
            expect(result.status).toBe('UNRECOGNIZED');
            expect(result.matchedUserCode).toBeNull();
        });

        test('lida com lista vazia/ausente de subjects', () => {
            expect(decideFaceMatch([]).status).toBe('UNRECOGNIZED');
            expect(decideFaceMatch(undefined).status).toBe('UNRECOGNIZED');
        });
    });

    describe('slugifyName / buildFinalFileName', () => {
        test('remove acentos e espaços', () => {
            expect(slugifyName('José Eduardo')).toBe('jose-eduardo');
        });

        test('usa "professor" como fallback para nome vazio', () => {
            expect(slugifyName('')).toBe('professor');
        });

        test('monta nome de arquivo padronizado com sequência', () => {
            const name = buildFinalFileName({
                ymd: '2026-06-30',
                weekdayLabel: 'terca-feira',
                sequenceLabel: '1a-Aula',
                professorName: 'João Silva'
            });
            expect(name).toBe('2026-06-30-terca-feira-1a-Aula-joao-silva_upload.jpg');
        });

        test('monta nome de arquivo padronizado sem sequência', () => {
            const name = buildFinalFileName({
                ymd: '2026-06-28',
                weekdayLabel: 'domingo',
                sequenceLabel: null,
                professorName: 'João Silva'
            });
            expect(name).toBe('2026-06-28-domingo-joao-silva_upload.jpg');
        });
    });
});
