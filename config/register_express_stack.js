'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const { setupExpressViews } = require('./views_handlebars');

const projectRoot = path.join(__dirname, '..');

/**
 * Registra trust proxy, helmet, parsers, estáticos, sessão e views Handlebars.
 * Mantém o mesmo comportamento que antes vivia inline em app.js.
 */
function registerExpressStack(app, { engine, moment, isProduction, sessionSecret }) {
    if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
        app.set('trust proxy', 1);
    }

    app.use(helmet({
        contentSecurityPolicy: false
    }));

    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.use('/uploads', express.static(path.join(projectRoot, 'uploads')));
    app.use(express.static('public'));
    app.use(session({
        name: 'oss.sid',
        secret: sessionSecret || 'oss_session_secret_dev',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            maxAge: 1000 * 60 * 60 * 8
        }
    }));

    setupExpressViews(app, { engine, moment });
}

module.exports = { registerExpressStack };
