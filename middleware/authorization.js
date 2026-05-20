'use strict';

/**
 * Bloqueia acesso a rotas que exigem perfil de professor ou administrador.
 * Retorna página 403 se o usuário não tiver permissão.
 */

const { hasProfessorAccess } = require('../lib/pure_helpers');
const { getErrorViewModel } = require('./http_errors');

/** Verifica se quem está logado é professor ou admin. Se não for, mostra erro 403. */
function ensureProfessorRoute(req, res) {
    if (!hasProfessorAccess(req.session.usuario)) {
        const vm = getErrorViewModel(403);
        return res.status(403).render('errors/error', vm);
    }
    return null;
}

/** Verifica se quem está logado é administrador. Se não for, mostra erro 403. */
function ensureAdminRoute(req, res) {
    if (!req.session.usuario || req.session.usuario.role !== 'ADM') {
        const vm = getErrorViewModel(403);
        return res.status(403).render('errors/error', vm);
    }
    return null;
}

/** Rankings internos: aluno, professor ou administrador. */
function ensureRankingRoute(req, res) {
    const role = req.session.usuario?.role;
    if (!['STD', 'PRO', 'ADM'].includes(role)) {
        const vm = getErrorViewModel(403);
        return res.status(403).render('errors/error', vm);
    }
    return null;
}

module.exports = {
    ensureProfessorRoute,
    ensureAdminRoute,
    ensureRankingRoute
};
