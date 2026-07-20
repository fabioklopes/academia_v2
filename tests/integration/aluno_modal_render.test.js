const request = require('supertest');
const argon2 = require('argon2');

const AppActivityLog = require('../../models/AppActivityLog');
const Usuario = require('../../models/Usuario');
const Turma = require('../../models/Turma');

describe('GET /aluno — renderização da página e do modal de aprovação de cadastro', () => {
    let app;

    beforeAll(async () => {
        // eslint-disable-next-line global-require
        app = require('../../app');
    });

    beforeEach(() => {
        jest.spyOn(AppActivityLog, 'create').mockResolvedValue({});
        jest.spyOn(AppActivityLog, 'findOne').mockResolvedValue(null);
        jest.spyOn(Usuario, 'findOne').mockResolvedValue({ id: -2, password: '$argon2id$fake' });
        jest.spyOn(Turma, 'count').mockResolvedValue(1);
    });

    test('página /aluno renderiza sem marcadores de conflito de merge e com o botão "Recusar cadastro"', async () => {
        const senhaPlano = 'professorSenhaTeste123';
        const senhaHash = await argon2.hash(senhaPlano);
        const professorFake = {
            id: -3,
            user_code: 'PPTST',
            first_name: 'Professor',
            last_name: 'Teste',
            email: 'professor.teste.modal@example.com',
            password: senhaHash,
            role: 'PRO',
            user_status: 'A',
            actual_belt: 'black',
            actual_degree: '1',
            save: jest.fn().mockResolvedValue()
        };

        jest.spyOn(Usuario, 'findAll').mockResolvedValueOnce([professorFake]);

        const agent = request.agent(app);
        const loginRes = await agent
            .post('/auth/verify')
            .type('form')
            .send({ email: professorFake.email, password: senhaPlano });

        expect(loginRes.status).toBeGreaterThanOrEqual(300);
        expect(loginRes.status).toBeLessThan(400);

        const alunoPendente = {
            get: () => ({
                id: 55,
                first_name: 'Novo',
                last_name: 'Aluno',
                email: 'novo.aluno@example.com',
                role: 'STD',
                user_status: 'P',
                phone: '91991234567',
                birth_date: '2005-05-05',
                actual_belt: 'white',
                actual_degree: '0',
                wagi_size: 'A1',
                zubon_size: 'A1',
                obi_size: 'A1',
                photo: '/uploads/users/temp_regressao_teste.jpg',
                responsavel: null
            })
        };

        // Além da listagem da própria página /aluno, o header roda em toda requisição
        // uma consulta separada por "dependentes" (where.responsible_id) via Usuario.findAll —
        // usamos o formato do where para responder cada uma corretamente.
        jest.spyOn(Usuario, 'findAll').mockImplementation(async (options) => {
            const where = options && options.where;
            if (where && Object.prototype.hasOwnProperty.call(where, 'responsible_id')) {
                return [];
            }
            return [alunoPendente];
        });

        const res = await agent.get('/aluno');

        expect(res.status).toBe(200);
        expect(res.text).not.toMatch(/<{7}|={7}|>{7}/);
        // Botão "Recusar cadastro" precisa existir no HTML (fica oculto via classe
        // d-none até o modal ser aberto com um aluno pendente selecionado).
        expect(res.text).toContain('id="btnAlunoRecusar"');
        expect(res.text).toContain('Recusar cadastro');
        // A imagem real de cadastro deve ser referenciada via data-photo, não o default.jpg fixo.
        expect(res.text).toContain('data-photo="/uploads/users/temp_regressao_teste.jpg"');
    });
});
