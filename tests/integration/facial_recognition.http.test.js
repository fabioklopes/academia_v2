const request = require('supertest');
const AppActivityLog = require('../../models/AppActivityLog');

describe('módulo de reconhecimento facial — autorização das rotas', () => {
    let app;

    beforeAll(() => {
        jest.spyOn(AppActivityLog, 'create').mockResolvedValue({});
        // eslint-disable-next-line global-require
        app = require('../../app');
    });

    afterAll(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        jest.restoreAllMocks();
    });

    test('GET /professor/fotos-pendentes sem sessão redireciona para login', async () => {
        const res = await request(app).get('/professor/fotos-pendentes');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('GET /admin/fotos-rollout sem sessão redireciona para login', async () => {
        const res = await request(app).get('/admin/fotos-rollout');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('POST /meuperfil/foto sem sessão não processa upload (redireciona para login)', async () => {
        const res = await request(app).post('/meuperfil/foto');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('GET /reconhecimento-facial/999999/imagem sem sessão redireciona para login', async () => {
        const res = await request(app).get('/reconhecimento-facial/999999/imagem');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('POST /reconhecimento-facial/999999/identificar sem sessão redireciona para login', async () => {
        const res = await request(app).post('/reconhecimento-facial/999999/identificar').send({ rostoId: 1, userCode: 'AB123' });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('POST /reconhecimento-facial/999999/aplicar sem sessão redireciona para login', async () => {
        const res = await request(app).post('/reconhecimento-facial/999999/aplicar');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });

    test('POST /reconhecimento-facial/999999/cancelar sem sessão redireciona para login', async () => {
        const res = await request(app).post('/reconhecimento-facial/999999/cancelar');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });
});
