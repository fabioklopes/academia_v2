'use strict';

/**
 * Prepara dados do menu do aluno: sino de avisos, sino de notificações
 * e modal de aniversário que aparece no login.
 */

const { Op } = require('sequelize');
const Notificacao = require('../models/Notificacao');
const { getEffectiveUserCode, notificacaoRecipientCodes } = require('../services/effective_user_code');
const {
    expireProfessorMessagesIfNeeded,
    getStudentMassMessageState,
    buildStudentMassMessageBellViewModel
} = require('../services/professor_mass_messages');

/** Cria middleware que roda antes de cada página do aluno. */
function createStudentNavLocalsMiddleware() {
    return async (req, res, next) => {
        res.locals.birthdayLoginModal = req.session.birthdayLoginModal || null;
        res.locals.studentMassMessageBell = null;
        res.locals.studentNotificationsBell = null;
        res.locals.motivationalMessage = req.session.motivationalMessage || '';

        if (req.session.birthdayLoginModal) {
            delete req.session.birthdayLoginModal;
        }

        try {
            if (req.session.usuario) {
                await expireProfessorMessagesIfNeeded();
            }

            const usuarioSessao = req.session.usuario;
            if (usuarioSessao && usuarioSessao.role === 'STD') {
                const rawCode = await getEffectiveUserCode(req);
                const codes = notificacaoRecipientCodes(rawCode);
                let unreadNotif = 0;
                if (codes.length > 0) {
                    unreadNotif = await Notificacao.count({
                        where: {
                            user_code: { [Op.in]: codes },
                            read_at: null
                        }
                    });
                }

                const massMessageState = await getStudentMassMessageState(usuarioSessao);
                res.locals.studentMassMessageBell = buildStudentMassMessageBellViewModel(massMessageState, unreadNotif);

                res.locals.studentNotificationsBell = {
                    href: '/notificacoes',
                    unreadCount: unreadNotif,
                    hasUnread: unreadNotif > 0
                };
            }
        } catch (err) {
            console.error('Erro ao preparar modal de mensagem em massa:', err.message);
            res.locals.studentMassMessageBell = null;
            const usuarioSessao = req.session.usuario;
            if (usuarioSessao && usuarioSessao.role === 'STD') {
                res.locals.studentNotificationsBell = {
                    href: '/notificacoes',
                    unreadCount: 0,
                    hasUnread: false
                };
            } else {
                res.locals.studentNotificationsBell = null;
            }
        }

        next();
    };
}

module.exports = {
    createStudentNavLocalsMiddleware
};
