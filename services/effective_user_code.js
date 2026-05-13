'use strict';

const Usuario = require('../models/Usuario');

// Retorna o user_code efetivo (viewingAs ou logado)
async function getEffectiveUserCode(req) {
    if (req.session.viewingAs) {
        const dep = await Usuario.findByPk(req.session.viewingAs.id);
        return dep ? dep.user_code : null;
    }
    return req.session.usuario ? req.session.usuario.user_code : null;
}

/** Alinha `user_code` à forma usada no banco (trim + maiúsculas) para presença/notificações. */
function normalizeUserCode(value) {
    const s = String(value || '').trim().toUpperCase();
    return s || null;
}

/** Códigos possíveis do aluno na tabela de notificações (compatível com registros antigos). */
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
