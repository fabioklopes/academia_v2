const request = require('supertest');
const argon2 = require('argon2');

const AppActivityLog = require('../../models/AppActivityLog');
const Usuario = require('../../models/Usuario');
const Turma = require('../../models/Turma');
const TurmaAluno = require('../../models/TurmaAluno');
const MetaAula = require('../../models/MetaAula');
const Presenca = require('../../models/Presenca');
const { clearIgnitionCache } = require('../../utils/ignition');

describe('GET /aluno/:id/meta-atual — regressão da variável approvedRows indefinida', () => {
    let app;

    beforeAll(async () => {
        // eslint-disable-next-line global-require
        app = require('../../app');
    });

    beforeEach(() => {
        // jest.config.cjs usa restoreMocks: true; o mock do AppActivityLog precisa ser
        // recriado a cada teste, senão o middleware de log grava de verdade no banco.
        jest.spyOn(AppActivityLog, 'create').mockResolvedValue({});
        jest.spyOn(AppActivityLog, 'findOne').mockResolvedValue(null);

        // O assistente de configuração inicial ("ignition") consulta o banco real (Usuario.findOne
        // e Turma.count) para saber se já existe ADM ativo/turma ativa; forçamos "já configurado"
        // para não depender do estado atual do banco nem redirecionar as chamadas para /ignition.
        clearIgnitionCache();
        jest.spyOn(Usuario, 'findOne').mockResolvedValue({ id: -2, password: '$argon2id$fake' });
        jest.spyOn(Turma, 'count').mockResolvedValue(1);
    });

    async function loginComoAdmin() {
        const senhaPlano = 'adminSenhaTeste123';
        const senhaHash = await argon2.hash(senhaPlano);
        const admFake = {
            id: -1,
            user_code: 'ZZTST',
            first_name: 'Admin',
            last_name: 'Teste',
            email: 'admin.teste.meta-atual@example.com',
            password: senhaHash,
            role: 'ADM',
            user_status: 'A',
            actual_belt: 'black',
            actual_degree: '1',
            save: jest.fn().mockResolvedValue()
        };
        jest.spyOn(Usuario, 'findAll').mockResolvedValue([admFake]);

        const agent = request.agent(app);
        const loginRes = await agent
            .post('/auth/verify')
            .type('form')
            .send({ email: admFake.email, password: senhaPlano });

        expect(loginRes.status).toBeGreaterThanOrEqual(300);
        expect(loginRes.status).toBeLessThan(400);

        Usuario.findAll.mockRestore();
        return agent;
    }

    test('não lança "approvedRows is not defined" quando o aluno tem meta de aula vigente', async () => {
        const agent = await loginComoAdmin();

        jest.spyOn(Usuario, 'findByPk').mockResolvedValue({
            id: 42,
            user_code: 'ABCDE',
            role: 'STD'
        });

        jest.spyOn(TurmaAluno, 'findAll').mockResolvedValue([{ class_code: 'TURMA1' }]);

        const metaAtualPlain = {
            id: 7,
            title: 'Meta Jul/2026',
            total_classes: 12,
            min_classes: 8,
            start_date: '2026-07-01',
            end_date: '2026-07-31',
            turmas: [{ class_code: 'TURMA1' }]
        };
        jest.spyOn(MetaAula, 'findOne')
            .mockResolvedValueOnce({ get: () => metaAtualPlain }) // meta vigente
            .mockResolvedValueOnce(null); // sem meta anterior (carry-over)

        jest.spyOn(Presenca, 'findAll').mockResolvedValue([
            { user_code: 'ABCDE', request_date: '2026-07-07', class_type: 'Gi' },
            { user_code: 'ABCDE', request_date: '2026-07-14', class_type: 'No-Gi' },
            { user_code: 'ABCDE', request_date: '2026-07-21', class_type: 'Gi' }
        ]);

        const res = await agent.get('/aluno/42/meta-atual');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.progress.hasMeta).toBe(true);
        // Antes da correção, o acesso a `approvedRows` (não definida) lançava ReferenceError
        // e a rota respondia 500 com "Erro ao calcular meta atual: approvedRows is not defined".
        expect(res.body.progress.presencasCount).toBe(3);
        expect(res.body.progress.startDate).toBe('2026-07-01');
        expect(res.body.progress.endDate).toBe('2026-07-31');
    });

    test('retorna hasMeta=false sem erro quando não há meta vigente', async () => {
        const agent = await loginComoAdmin();

        jest.spyOn(Usuario, 'findByPk').mockResolvedValue({
            id: 43,
            user_code: 'FGHIJ',
            role: 'STD'
        });

        jest.spyOn(TurmaAluno, 'findAll').mockResolvedValue([{ class_code: 'TURMA2' }]);
        jest.spyOn(MetaAula, 'findOne').mockResolvedValue(null);

        const res = await agent.get('/aluno/43/meta-atual');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.progress.hasMeta).toBe(false);
        expect(res.body.progress.presencasCount).toBe(0);
    });
});
