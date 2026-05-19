'use strict';

const Usuario = require('../models/Usuario');

/**
 * Descobre qual código de usuário usar na requisição atual.
 * Se o titular está visualizando um dependente (viewingAs), usa o código do dependente.
 * Caso contrário, usa o código de quem está logado.
 */
async function getEffectiveUserCode(req) {
    if (req.session.viewingAs) {
        const dep = await Usuario.findByPk(req.session.viewingAs.id);
        return dep ? dep.user_code : null;
    }
    return req.session.usuario ? req.session.usuario.user_code : null;
}

/**
 * Padroniza um código de usuário: remove espaços e coloca em maiúsculas.
 * Usado ao buscar presenças e notificações no banco.
 */
function normalizeUserCode(value) {
    const s = String(value || '').trim().toUpperCase();
    return s || null;
}

/**
 * Monta lista de códigos possíveis para achar notificações de um aluno.
 * Inclui formato antigo e novo para não perder registros legados.
 */
function notificacaoRecipientCodes(raw) {
    const n = normalizeUserCode(raw);
    if (!n) {
        return [];
    }
    return [...new Set([n, String(raw || '').trim()].filter(Boolean))];
}

module.exports = {
    getEffectiveUserCode,
    normalizeUserCode,
    notificacaoRecipientCodes
};
