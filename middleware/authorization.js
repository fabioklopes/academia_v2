'use strict';

const { hasProfessorAccess } = require('../lib/pure_helpers');
const { getErrorViewModel } = require('./http_errors');

function ensureProfessorRoute(req, res) {
    if (!hasProfessorAccess(req.session.usuario)) {
        const vm = getErrorViewModel(403);
        return res.status(403).render('errors/error', vm);
    }
    return null;
}

function ensureAdminRoute(req, res) {
    if (!req.session.usuario || req.session.usuario.role !== 'ADM') {
        const vm = getErrorViewModel(403);
        return res.status(403).render('errors/error', vm);
    }
    return null;
}

module.exports = {
    ensureProfessorRoute,
    ensureAdminRoute
};
