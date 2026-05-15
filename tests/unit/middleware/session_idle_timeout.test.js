'use strict';

jest.mock('../../../config/constants', () => ({
    SESSION_IDLE_TIMEOUT_MS: 10 * 60 * 1000
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const {
    createSessionIdleTimeoutMiddleware,
    IDLE_EXPIRED_MESSAGE
} = require('../../../middleware/session_idle_timeout');

function buildTestApp() {
    const app = express();
    app.use(session({
        name: 'oss.sid',
        secret: 'test_session_secret',
        resave: false,
        saveUninitialized: false
    }));

    app.post('/test/login', (req, res) => {
        req.session.usuario = {
            id: 1,
            user_code: 'TST01',
            role: 'STD'
        };
        const idleOffsetMs = Number(req.query.idleOffsetMs || 0);
        req.session.lastActivity = Date.now() - idleOffsetMs;
        res.sendStatus(204);
    });

    app.use(createSessionIdleTimeoutMiddleware());

    app.get('/protected', (req, res) => {
        if (!req.session.usuario) {
            return res.status(401).send('unauth');
        }
        res.send('ok');
    });

    return app;
}

describe('middleware/session_idle_timeout', () => {
    test('redireciona ao login quando inativo por mais de 10 minutos', async () => {
        const app = buildTestApp();
        const agent = request.agent(app);
        const elevenMinutesMs = 11 * 60 * 1000;

        await agent.post(`/test/login?idleOffsetMs=${elevenMinutesMs}`);

        const res = await agent.get('/protected');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('/auth/login?erro=');
        expect(decodeURIComponent(res.headers.location)).toContain(IDLE_EXPIRED_MESSAGE);
    });

    test('mantém sessão ativa quando houve atividade recente', async () => {
        const app = buildTestApp();
        const agent = request.agent(app);
        const fiveMinutesMs = 5 * 60 * 1000;

        await agent.post(`/test/login?idleOffsetMs=${fiveMinutesMs}`);

        const res = await agent.get('/protected');

        expect(res.status).toBe(200);
        expect(res.text).toBe('ok');
    });

    test('renova lastActivity em requisição autenticada recente', async () => {
        const app = buildTestApp();
        const agent = request.agent(app);
        const nineMinutesMs = 9 * 60 * 1000;

        await agent.post(`/test/login?idleOffsetMs=${nineMinutesMs}`);
        await agent.get('/protected');

        const res = await agent.get('/protected');

        expect(res.status).toBe(200);
        expect(res.text).toBe('ok');
    });
});
