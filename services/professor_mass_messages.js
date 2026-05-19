'use strict';

/**
 * Serviço de mensagens em massa do professor para turmas.
 * Cuida de: listar turmas, expirar avisos, marcar leitura e montar dados para a tela.
 */

const { Op } = require('sequelize');
const Turma = require('../models/Turma');
const TurmaAluno = require('../models/TurmaAluno');
const MensagemProfessor = require('../models/MensagemProfessor');
const MensagemProfessorOcultacao = require('../models/MensagemProfessorOcultacao');
const MensagemProfessorLeitura = require('../models/MensagemProfessorLeitura');
const {
    formatDateTimeForInput,
    formatDateTimePtBr,
    formatDateTimePtBrWithAs
} = require('../lib/pure_helpers');

/** Busca turmas ativas em que o aluno está matriculado. */
async function getActiveTurmasForUser(userCode) {
    if (!userCode) {
        return [];
    }

    const vinculos = await TurmaAluno.findAll({
        where: {
            user_code: userCode,
            active: 'Y'
        },
        attributes: ['class_code']
    });

    const classCodes = [...new Set(vinculos.map((item) => item.class_code).filter(Boolean))];
    if (classCodes.length === 0) {
        return [];
    }

    const turmas = await Turma.findAll({
        where: {
            active: 'Y',
            class_code: { [Op.in]: classCodes }
        },
        attributes: ['class_code', 'class_name'],
        order: [['class_name', 'ASC']]
    });

    return turmas.map((turma) => turma.get({ plain: true }));
}

async function getStudentMassMessageAudience(usuarioSessao) {
    if (!usuarioSessao || usuarioSessao.role !== 'STD' || !usuarioSessao.user_code) {
        return {
            turmasAluno: [],
            turmaByCode: {},
            classCodes: []
        };
    }

    const turmasAluno = await getActiveTurmasForUser(usuarioSessao.user_code);
    const classCodes = [...new Set(turmasAluno.map((turma) => turma.class_code).filter(Boolean))];
    const turmaByCode = turmasAluno.reduce((acc, turma) => {
        acc[turma.class_code] = turma.class_name;
        return acc;
    }, {});

    return {
        turmasAluno,
        turmaByCode,
        classCodes
    };
}

/** Marca como expiradas as mensagens que passaram da data de validade. */
async function expireProfessorMessagesIfNeeded() {
    await MensagemProfessor.update(
        { status: 'E' },
        {
            where: {
                status: 'A',
                expires_at: {
                    [Op.not]: null,
                    [Op.lte]: new Date()
                }
            }
        }
    );
}

async function getTurmasDisponiveisParaMensagem(usuarioSessao) {
    if (!usuarioSessao) {
        return [];
    }

    const where = { active: 'Y' };
    if (usuarioSessao.role !== 'ADM') {
        where.created_by = usuarioSessao.user_code;
    }

    const turmas = await Turma.findAll({
        where,
        attributes: ['class_code', 'class_name'],
        order: [['class_name', 'ASC']]
    });

    return turmas.map((turma) => turma.get({ plain: true }));
}

function buildMassMessageDeliveryKey(mensagem) {
    const plain = typeof mensagem.get === 'function'
        ? mensagem.get({ plain: true })
        : mensagem;

    const createdAt = plain.createdAt ? new Date(plain.createdAt).toISOString() : '';
    const updatedAt = plain.updatedAt ? new Date(plain.updatedAt).toISOString() : '';
    const expiresAt = plain.expires_at ? new Date(plain.expires_at).toISOString() : '';

    return [
        plain.id,
        plain.class,
        plain.title,
        plain.content,
        plain.status,
        expiresAt,
        createdAt,
        updatedAt
    ].join('|');
}

/** Prepara dados de uma mensagem para exibir na tela (status, datas, nome da turma). */
function toMassMessageViewModel(mensagem, turmaByCode = {}) {
    const plain = typeof mensagem.get === 'function'
        ? mensagem.get({ plain: true })
        : mensagem;

    const className = turmaByCode[plain.class] || plain.class;
    const now = new Date();
    const hasExpireAt = !!plain.expires_at;
    const expiresAtDate = hasExpireAt ? new Date(plain.expires_at) : null;
    const hasValidExpireAt = expiresAtDate && !Number.isNaN(expiresAtDate.getTime());
    const msUntilExpire = hasValidExpireAt ? (expiresAtDate.getTime() - now.getTime()) : null;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    let statusLabel = 'Ativo';
    let statusBadge = 'primary';

    if (plain.status === 'E' || (hasValidExpireAt && msUntilExpire <= 0)) {
        statusLabel = 'Expirado';
        statusBadge = 'secondary';
    } else if (hasValidExpireAt && msUntilExpire <= twentyFourHoursMs) {
        statusLabel = 'Expira em breve';
        statusBadge = 'warning';
    }

    return {
        id: plain.id,
        title: plain.title,
        content: plain.content,
        class_code: plain.class,
        class_name: className,
        class_display: `${className} (${plain.class})`,
        status: plain.status,
        statusLabel,
        statusBadge,
        expiresAtLabel: formatDateTimePtBr(plain.expires_at),
        expiresAtValue: plain.expires_at,
        createdAtLabel: formatDateTimePtBr(plain.createdAt),
        createdAtValue: plain.createdAt,
        expiresAtInputValue: formatDateTimeForInput(plain.expires_at),
        deliveryKey: buildMassMessageDeliveryKey(plain)
    };
}

/** Monta contadores do sino de avisos no menu do aluno (mensagens + notificações). */
function buildStudentMassMessageBellViewModel(state, notificationUnread = 0) {
    const massUnread = Number(state.unreadCount) || 0;
    const notifUnread = Math.max(0, Number(notificationUnread) || 0);
    const navbarUnread = massUnread + notifUnread;
    return {
        href: '/mensagens/mestre',
        unreadCount: massUnread,
        totalCount: state.totalCount,
        hasUnread: massUnread > 0,
        navbarHref: notifUnread > 0 ? '/notificacoes' : '/mensagens/mestre',
        navbarUnreadCount: navbarUnread,
        navbarHasUnread: navbarUnread > 0,
        notificationUnreadCount: notifUnread
    };
}

/** Estado completo da Central de Avisos: lista, não lidas, turmas do aluno. */
async function getStudentMassMessageState(usuarioSessao) {
    const emptyState = {
        messages: [],
        unreadMessages: [],
        unreadCount: 0,
        totalCount: 0,
        turmaByCode: {},
        classCodes: []
    };

    if (!usuarioSessao || usuarioSessao.role !== 'STD') {
        return emptyState;
    }

    const audience = await getStudentMassMessageAudience(usuarioSessao);
    if (audience.classCodes.length === 0) {
        return {
            ...emptyState,
            turmaByCode: audience.turmaByCode,
            classCodes: audience.classCodes
        };
    }

    const [ocultacoes, leituras] = await Promise.all([
        MensagemProfessorOcultacao.findAll({
            where: { user_code: usuarioSessao.user_code },
            attributes: ['message_id']
        }),
        MensagemProfessorLeitura.findAll({
            where: { user_code: usuarioSessao.user_code },
            attributes: ['message_id', 'viewed_at']
        })
    ]);

    const hiddenIds = ocultacoes
        .map((item) => Number(item.message_id))
        .filter((id) => Number.isInteger(id) && id > 0);

    const readByMessageId = new Map(
        leituras
            .map((item) => {
                const id = Number(item.message_id);
                if (!Number.isInteger(id) || id <= 0) {
                    return null;
                }

                // Alguns registros antigos podem ter `viewed_at` nulo.
                // A existência do registro indica que a mensagem foi marcada como lida.
                return [id, item.viewed_at || true];
            })
            .filter(Boolean)
    );

    const where = {
        status: { [Op.in]: ['A', 'E'] },
        class: { [Op.in]: audience.classCodes }
    };

    if (hiddenIds.length > 0) {
        where.id = { [Op.notIn]: hiddenIds };
    }

    const mensagens = await MensagemProfessor.findAll({
        where,
        order: [['createdAt', 'DESC']]
    });

    const messages = mensagens.map((mensagem) => {
        const vm = toMassMessageViewModel(mensagem, audience.turmaByCode);
        const messageId = Number(vm.id);
        const readMarker = readByMessageId.get(messageId) || null;
        const isRead = readByMessageId.has(messageId);
        const readAt = readMarker && readMarker !== true ? readMarker : null;
        const isExpired = vm.statusLabel === 'Expirado';

        return {
            ...vm,
            isExpired,
            isRead,
            readAtLabel: readAt ? formatDateTimePtBrWithAs(readAt) : '',
            readStateLabel: readAt ? 'Lida' : 'Nova',
            readStateBadge: readAt ? 'secondary' : 'danger'
        };
    });

    const unreadMessages = messages.filter((message) => !message.isRead && !message.isExpired);

    return {
        messages,
        unreadMessages,
        unreadCount: unreadMessages.length,
        totalCount: messages.length,
        turmaByCode: audience.turmaByCode,
        classCodes: audience.classCodes
    };
}

async function findVisibleMassMessageForStudent(usuarioSessao, messageId) {
    const audience = await getStudentMassMessageAudience(usuarioSessao);
    if (audience.classCodes.length === 0) {
        return null;
    }

    return MensagemProfessor.findOne({
        where:
            {
                id: messageId,
                status: { [Op.in]: ['A', 'E'] },
                class: { [Op.in]: audience.classCodes }
            }
    });
}

/** Registra que o aluno leu uma mensagem e devolve contagem atualizada de não lidas. */
async function markMassMessageAsRead(usuarioSessao, messageId) {
    const mensagem = await findVisibleMassMessageForStudent(usuarioSessao, messageId);
    if (!mensagem) {
        throw new Error('Mensagem não encontrada.');
    }

    const [leitura] = await MensagemProfessorLeitura.findOrCreate({
        where: {
            message_id: messageId,
            user_code: usuarioSessao.user_code
        },
        defaults: {
            viewed_at: new Date()
        }
    });

    const state = await getStudentMassMessageState(usuarioSessao);

    return {
        unreadCount: state.unreadCount,
        readAtLabel: formatDateTimePtBrWithAs(leitura.viewed_at)
    };
}

module.exports = {
    getActiveTurmasForUser,
    expireProfessorMessagesIfNeeded,
    getTurmasDisponiveisParaMensagem,
    toMassMessageViewModel,
    buildStudentMassMessageBellViewModel,
    getStudentMassMessageState,
    findVisibleMassMessageForStudent,
    markMassMessageAsRead
};
