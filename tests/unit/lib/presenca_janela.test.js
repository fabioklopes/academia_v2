const {
    normalizarYmd,
    subtrairDias,
    excecaoVigente,
    datasExcepcionaisLiberadas,
    validarDataSolicitacao,
    dataLiberadaParaSolicitacao,
    PRESENCA_SOLICITACAO_JANELA_DIAS,
    PRESENCA_SOLICITACAO_EXCECAO_ATE
} = require('../../../lib/presenca_janela');

const DATAS_EXCEPCIONAIS = ['2026-09-15', '2026-09-17', '2026-09-20', '2026-09-22'];

describe('lib/presenca_janela', () => {
    describe('normalizarYmd', () => {
        test('aceita data válida em YYYY-MM-DD', () => {
            expect(normalizarYmd('2026-09-15')).toBe('2026-09-15');
            expect(normalizarYmd(' 2026-09-15 ')).toBe('2026-09-15');
        });

        test('recusa formatos inválidos e datas inexistentes', () => {
            expect(normalizarYmd('15/09/2026')).toBeNull();
            expect(normalizarYmd('2026-9-5')).toBeNull();
            expect(normalizarYmd('2026-02-31')).toBeNull();
            expect(normalizarYmd('2026-13-01')).toBeNull();
            expect(normalizarYmd(null)).toBeNull();
            expect(normalizarYmd('')).toBeNull();
        });
    });

    describe('subtrairDias', () => {
        test('atravessa mês e ano sem horário de verão', () => {
            expect(subtrairDias('2026-10-03', 7)).toBe('2026-09-26');
            expect(subtrairDias('2026-03-03', 7)).toBe('2026-02-24');
            expect(subtrairDias('2026-01-05', 7)).toBe('2025-12-29');
        });

        test('devolve null para entrada inválida', () => {
            expect(subtrairDias('ontem', 7)).toBeNull();
        });
    });

    describe('datasExcepcionaisLiberadas', () => {
        test('libera as quatro datas enquanto a campanha está vigente', () => {
            expect(datasExcepcionaisLiberadas('2026-10-03')).toEqual(DATAS_EXCEPCIONAIS);
            expect(datasExcepcionaisLiberadas('2026-09-16')).toEqual(['2026-09-15']);
            expect(datasExcepcionaisLiberadas('2026-09-14')).toEqual([]);
        });

        test('encerra no prazo final (inclusive) e expira depois', () => {
            expect(excecaoVigente(PRESENCA_SOLICITACAO_EXCECAO_ATE)).toBe(true);
            expect(datasExcepcionaisLiberadas(PRESENCA_SOLICITACAO_EXCECAO_ATE)).toEqual(DATAS_EXCEPCIONAIS);
            expect(datasExcepcionaisLiberadas('2026-10-07')).toEqual([]);
        });
    });

    describe('validarDataSolicitacao', () => {
        test('mantém a janela normal de 7 dias', () => {
            const hoje = '2026-10-03'; // limite = 26/09/2026
            expect(PRESENCA_SOLICITACAO_JANELA_DIAS).toBe(7);
            expect(validarDataSolicitacao('2026-09-26', hoje)).toBeNull();
            expect(validarDataSolicitacao('2026-10-03', hoje)).toBeNull();
            expect(validarDataSolicitacao('2026-09-25', hoje)).toBe(
                'Anterior ao limite de 7 dias (26/09/2026).'
            );
        });

        test('libera as datas excepcionais antes do encerramento', () => {
            for (const data of DATAS_EXCEPCIONAIS) {
                expect(validarDataSolicitacao(data, '2026-10-03')).toBeNull();
                expect(validarDataSolicitacao(data, '2026-10-06')).toBeNull();
            }
        });

        test('volta ao procedimento normal depois de 06/10/2026', () => {
            for (const data of DATAS_EXCEPCIONAIS) {
                const erro = validarDataSolicitacao(data, '2026-10-07');
                expect(erro).toContain('encerrou em 06/10/2026');
                expect(erro).not.toBeNull();
            }
        });

        test('continua bloqueando datas futuras e inválidas', () => {
            expect(validarDataSolicitacao('2026-10-04', '2026-10-03')).toBe(
                'Não é permitido solicitar para datas futuras.'
            );
            expect(validarDataSolicitacao('2026-09-40', '2026-10-03')).toBe('Data inválida.');
            expect(validarDataSolicitacao('15/09/2026', '2026-10-03')).toBe('Data inválida.');
        });

        test('aceita exceções explícitas em vez das constantes', () => {
            expect(
                validarDataSolicitacao('2026-09-10', '2026-10-03', { excecoes: ['2026-09-10'] })
            ).toBeNull();
            expect(dataLiberadaParaSolicitacao('2026-09-10', '2026-10-03', { excecoes: ['2026-09-10'] })).toBe(true);
        });
    });
});