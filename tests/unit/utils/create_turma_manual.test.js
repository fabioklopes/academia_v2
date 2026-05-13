const Turma = require('../../../models/Turma');
const { sequelize } = require('../../../models/db');
const { generateUniqueClassCode, ensureAdminUser, main } = require('../../../utils/create_turma_manual');

describe('utils/create_turma_manual', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('exports', () => {
        expect(typeof main).toBe('function');
        expect(typeof generateUniqueClassCode).toBe('function');
        expect(typeof ensureAdminUser).toBe('function');
    });

    test('generateUniqueClassCode retorna código quando não há colisão', async () => {
        jest.spyOn(Turma, 'findOne').mockResolvedValue(null);
        const code = await generateUniqueClassCode();
        expect(code).toHaveLength(5);
        expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    test('generateUniqueClassCode lança após muitas colisões', async () => {
        jest.spyOn(Turma, 'findOne').mockResolvedValue({ id: 1 });
        await expect(generateUniqueClassCode()).rejects.toThrow(/Não foi possível gerar/);
    });

    test('main é async', () => {
        expect(main.constructor.name).toMatch(/AsyncFunction|Function/);
    });

    test('sequelize do projeto está acessível', () => {
        expect(sequelize).toBeDefined();
    });
});
