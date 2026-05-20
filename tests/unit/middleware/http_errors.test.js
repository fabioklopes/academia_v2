'use strict';

const express = require('express');
const request = require('supertest');
const {
    getErrorViewModel,
    isTechnicalErrorMessage,
    sanitizeErrorPayload,
    sanitizeRedirectUrl,
    createClientErrorGuardMiddleware,
    createNotFoundMiddleware,
    createErrorMiddleware
} = require('../../../middleware/http_errors');

describe('middleware/http_errors', () => {
    test('getErrorViewModel cobre 400 até 599', () => {
        for (let code = 400; code <= 599; code += 1) {
            const vm = getErrorViewModel(code);
            expect(vm.statusCode).toBe(code);
            expect(vm.title).toBeTruthy();
            expect(vm.message).toBeTruthy();
            expect(vm.iconClass).toMatch(/^fa-/);
        }
    });

    test('códigos conhecidos têm mensagens específicas', () => {
        expect(getErrorViewModel(404).title).toBe('Página não encontrada');
        expect(getErrorViewModel(403).title).toBe('Acesso negado');
        expect(getErrorViewModel(500).title).toBe('Erro interno');
    });

    test('isTechnicalErrorMessage detecta stack e Sequelize', () => {
        expect(isTechnicalErrorMessage('at Object.<anonymous> (/app/app.js:10:5)')).toBe(true);
        expect(isTechnicalErrorMessage('SequelizeConnectionError: connect ECONNREFUSED')).toBe(true);
        expect(isTechnicalErrorMessage('Senha incorreta.')).toBe(false);
    });

    test('sanitizeErrorPayload em produção oculta erro 500', () => {
        const body = { ok: false, mensagem: 'SequelizeDatabaseError: table x' };
        const sanitized = sanitizeErrorPayload(body, 500, true);
        expect(sanitized.mensagem).toBe(getErrorViewModel(500).message);
    });

    test('sanitizeRedirectUrl substitui query técnica', () => {
        const url = '/auth/login?erro=' + encodeURIComponent('Erro: Sequelize timeout at node_modules/foo');
        const safe = sanitizeRedirectUrl(url, true);
        expect(safe).toContain('erro=');
        expect(safe).not.toContain('node_modules');
        expect(safe).not.toContain('Sequelize');
    });

    describe('middlewares HTTP', () => {
        function buildApp({ isProduction }) {
            const app = express();
            app.use(createClientErrorGuardMiddleware({ isProduction }));

            app.get('/json-leak', (_req, res) => {
                res.status(500).json({ ok: false, mensagem: 'Error: secret at /srv/app.js:99' });
            });

            app.get('/boom', (_req, res, next) => {
                const err = new Error('Detalhe interno do banco');
                err.statusCode = 500;
                next(err);
            });

            app.use(createNotFoundMiddleware({ isProduction }));
            app.use(createErrorMiddleware({ isProduction }));
            return app;
        }

        test('guard em produção sanitiza res.json', async () => {
            const app = buildApp({ isProduction: true });
            const res = await request(app).get('/json-leak');
            expect(res.status).toBe(500);
            expect(res.body.mensagem).toBe(getErrorViewModel(500).message);
            expect(res.body.mensagem).not.toContain('app.js');
        });

        test('error middleware em produção não vaza mensagem da exceção', async () => {
            const app = buildApp({ isProduction: true });
            const res = await request(app).get('/boom').set('Accept', 'application/json');
            expect(res.status).toBe(500);
            expect(res.body.message).toBe(getErrorViewModel(500).message);
            expect(res.body.message).not.toContain('banco');
        });

        test('404 JSON em produção retorna mensagem amigável', async () => {
            const app = buildApp({ isProduction: true });
            const res = await request(app).get('/rota-inexistente').set('Accept', 'application/json');
            expect(res.status).toBe(404);
            expect(res.body.message).toBe(getErrorViewModel(404).message);
        });
    });
});
