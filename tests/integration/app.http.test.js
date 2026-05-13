const request = require('supertest');
const AppActivityLog = require('../../models/AppActivityLog');

describe('app.js (Express) — rotas públicas básicas', () => {
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

    test('GET /auth/login retorna HTML', async () => {
        const res = await request(app).get('/auth/login');
        expect(res.status).toBe(200);
        expect(res.text.toLowerCase()).toContain('html');
    });

    test('POST /auth/verify sem credenciais redireciona', async () => {
        const res = await request(app).post('/auth/verify').type('form').send({});
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });
});
