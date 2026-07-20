const path = require('path');
const fs = require('fs');
const request = require('supertest');
const sharp = require('sharp');
const argon2 = require('argon2');

const AppActivityLog = require('../../models/AppActivityLog');
const Usuario = require('../../models/Usuario');
const Turma = require('../../models/Turma');
const TurmaAluno = require('../../models/TurmaAluno');
const { uploadsDir } = require('../../config/multer_user_photo');

describe('Foto de cadastro de aluno — não regressão do default.jpg e nomenclatura por user_code', () => {
    let app;
    let jpegBuffer;
    const arquivosCriados = [];

    beforeAll(async () => {
        // eslint-disable-next-line global-require
        app = require('../../app');

        jpegBuffer = await sharp({
            create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } }
        }).jpeg().toBuffer();
    });

    beforeEach(() => {
        // jest.config.cjs usa restoreMocks: true, que desfaz spies criados em beforeAll antes de
        // cada teste — por isso o mock do AppActivityLog precisa ser recriado aqui, senão o
        // middleware de log de atividade grava de verdade no banco (já aconteceu, ver histórico do PR).
        jest.spyOn(AppActivityLog, 'create').mockResolvedValue({});
        jest.spyOn(AppActivityLog, 'findOne').mockResolvedValue(null);
    });

    afterAll(async () => {
        jest.restoreAllMocks();
        await Promise.all(arquivosCriados.map(async (fileName) => {
            const filePath = path.join(uploadsDir, fileName);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 150));
    });

    test('POST /aluno/cadastrar grava a foto enviada já no create (nunca default.jpg)', async () => {
        jest.spyOn(Turma, 'findOne').mockResolvedValue({ class_code: 'ABCDE', active: 'Y' });

        let payloadCriado = null;
        const salvarMock = jest.fn().mockResolvedValue();
        jest.spyOn(Usuario, 'create').mockImplementation(async (payload) => {
            payloadCriado = payload;
            return { ...payload, id: 999, save: salvarMock };
        });
        jest.spyOn(TurmaAluno, 'findOrCreate').mockResolvedValue([{}, true]);

        const res = await request(app)
            .post('/aluno/cadastrar')
            .field('first_name', 'Maria')
            .field('last_name', 'Silva')
            .field('email', 'maria.teste.cadastro@example.com')
            .field('phone', '91991234567')
            .field('birth_date', '2000-01-01')
            .field('actual_belt', 'white')
            .field('actual_degree', '0')
            .field('wagi_size', 'A1')
            .field('zubon_size', 'A1')
            .field('obi_size', 'A1')
            .field('class_code', 'abcde')
            .field('password1', 'senhaSegura123')
            .field('password2', 'senhaSegura123')
            .attach('photo', jpegBuffer, 'foto.jpg');

        expect(res.status).toBe(302);
        expect(payloadCriado).not.toBeNull();
        // A foto precisa já vir preenchida no próprio create — nunca deve sobrar no default.jpg do model.
        expect(payloadCriado.photo).toMatch(/^\/uploads\/users\/temp_/);
        expect(payloadCriado.photo).not.toBe('/uploads/users/default.jpg');
        // Não deve existir mais uma segunda gravação separada só para setar a foto.
        expect(salvarMock).not.toHaveBeenCalled();

        const nomeArquivoSalvo = payloadCriado.photo.replace('/uploads/users/', '');
        arquivosCriados.push(nomeArquivoSalvo);
        expect(fs.existsSync(path.join(uploadsDir, nomeArquivoSalvo))).toBe(true);
    });

    test('Aprovação promove a foto pendente para "<user_code em minúsculo>.jpg"', async () => {
        const senhaPlano = 'adminSenhaTeste123';
        const senhaHash = await argon2.hash(senhaPlano);
        const admFake = {
            id: -1,
            user_code: 'ZZTST',
            first_name: 'Admin',
            last_name: 'Teste',
            email: 'admin.teste.aprovacao@example.com',
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

        const tempFileName = `temp_teste_aprovacao_${Date.now()}.jpg`;
        await fs.promises.writeFile(path.join(uploadsDir, tempFileName), jpegBuffer);
        arquivosCriados.push(tempFileName);

        const usuarioPendente = {
            id: 42,
            user_code: 'Z5LAX',
            user_status: 'P',
            photo: `/uploads/users/${tempFileName}`,
            save: jest.fn().mockResolvedValue()
        };
        jest.spyOn(Usuario, 'findByPk').mockResolvedValue(usuarioPendente);

        const res = await agent.get('/aluno/status/42');

        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        expect(usuarioPendente.user_status).toBe('A');
        expect(usuarioPendente.photo).toBe('/uploads/users/z5lax.jpg');

        arquivosCriados.push('z5lax.jpg');
        expect(fs.existsSync(path.join(uploadsDir, 'z5lax.jpg'))).toBe(true);
        expect(fs.existsSync(path.join(uploadsDir, tempFileName))).toBe(false);

        Usuario.findByPk.mockRestore();
    });
});
