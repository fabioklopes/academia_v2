'use strict';

/**
 * Envio por e-mail das notificações do sistema.
 *
 * Regra: toda notificação criada (para ADM, PRO ou STD) também é enviada
 * por e-mail para o destinatário. Avisos em massa (MensagemProfessor)
 * vão para todos os usuários ativos de ADM, PRO e STD.
 *
 * O envio nunca derruba a ação que originou a notificação: qualquer falha
 * é registrada no log e a requisição segue o fluxo normal.
 */

const nodemailer = require('nodemailer');
const { Op } = require('sequelize');

const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const MensagemProfessor = require('../models/MensagemProfessor');
const { getPasswordResetTransportConfig } = require('./mail_transport');
const { getResetPasswordBaseUrl } = require('./public_app_links');
const {
    ACADEMY_NAME,
    buildNotificationEmail,
    sanitizeEmail
} = require('./notification_email_content');

/** Destinos dentro do sistema para cada tipo de aviso. */
const NOTIFICATION_PATHS = {
    PRESENCA_APROVADA: '/notificacoes',
    PRESENCA_NEGADA: '/notificacoes',
    AVATAR_APROVADO: '/notificacoes',
    AVATAR_NEGADO: '/notificacoes',
    MENSAGEM_EM_MASSA: '/mensagens/mestre'
};

/** Quantos e-mails em massa são enviados simultaneamente. */
const BROADCAST_CONCURRENCY = 5;

const TRANSPORT_OPTIONS = {
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000
};

function toPlain(row) {
    if (!row) {
        return null;
    }
    return typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

function getFromAddress(transportConfig) {
    return process.env.SMTP_FROM
        || process.env.EMAIL_FROM
        || (transportConfig && transportConfig.auth && transportConfig.auth.user)
        || undefined;
}

/**
 * URL base da aplicação, tolerante a `req` ausente (uso em jobs/testes).
 * Devolve string vazia quando não há APP_BASE_URL nem requisição — nesse caso
 * o e-mail é enviado sem botão de atalho.
 */
function buildBaseUrl(req) {
    const configured = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL;
    if (configured) {
        return configured.replace(/\/+$/, '');
    }

    if (typeof req === 'object' && req && typeof req.get === 'function') {
        return getResetPasswordBaseUrl(req);
    }

    return '';
}

/** Link absoluto para a tela de preferências (usado no List-Unsubscribe). */
function buildProfileUrl(req) {
    const base = buildBaseUrl(req);
    return base ? `${base}/meuperfil` : '';
}

/** Monta o transporte do Nodemailer ou devolve null quando não há SMTP configurado. */
function createTransport() {
    const transportConfig = getPasswordResetTransportConfig();
    if (!transportConfig) {
        return null;
    }

    return {
        transporter: nodemailer.createTransport({ ...transportConfig, ...TRANSPORT_OPTIONS }),
        from: getFromAddress(transportConfig)
    };
}

/**
 * E-mails ativos para quem deixou a opção "Notificações por e-mail" ligada.
 * Como titular e dependentes compartilham o mesmo endereço, o resultado é
 * deduplicado por e-mail e vale a primeira ocorrência de cada endereço.
 */
async function findOptedInEmails() {
    const usuarios = await Usuario.findAll({
        where: {
            user_status: 'A',
            notification_email_enabled: true
        },
        attributes: ['email', 'first_name', 'last_name', 'role'],
        order: [['id', 'ASC']]
    });

    const byEmail = new Map();
    for (const usuario of usuarios) {
        const email = sanitizeEmail(usuario.email);
        if (!email || byEmail.has(email)) {
            continue;
        }

        byEmail.set(email, {
            email,
            first_name: usuario.first_name,
            last_name: usuario.last_name,
            role: usuario.role
        });
    }

    return [...byEmail.values()];
}

/**
 * Dispara o e-mail de uma notificação individual (tb_notificacoes).
 *
 * @param {object} notificacao Notificação já criada (instância ou objeto simples).
 * @param {object} opcoes
 * @param {object} opcoes.actor Quem executou a ação (Professor/Administrador).
 * @param {object} opcoes.req Requisição Express, usada para montar o link absoluto.
 * @param {Array}  opcoes.details Linhas de detalhe exibidas no corpo ("Data", "Aula"...).
 */
async function dispatchNotificationEmail(notificacao, { actor, req, details } = {}) {
    const plain = toPlain(notificacao);
    if (!plain) {
        return { status: 'skipped', reason: 'notificacao-vazia' };
    }

    if (plain.email_sent_at) {
        return { status: 'skipped', reason: 'ja-enviado' };
    }

    const transport = createTransport();
    if (!transport) {
        return { status: 'skipped', reason: 'smtp-nao-configurado' };
    }

    const destinatario = await Usuario.findOne({
        where: { user_code: plain.user_code },
        attributes: ['user_code', 'first_name', 'last_name', 'email', 'role', 'notification_email_enabled']
    });

    if (!destinatario) {
        return { status: 'skipped', reason: 'destinatario-nao-encontrado' };
    }

    if (destinatario.notification_email_enabled === false) {
        return { status: 'skipped', reason: 'opt-out' };
    }

    const email = sanitizeEmail(destinatario.email);
    if (!email) {
        return { status: 'skipped', reason: 'email-invalido' };
    }

    const perfilUrl = buildProfileUrl(req);
    const conteudo = buildNotificationEmail({
        kind: plain.kind,
        title: plain.title,
        body: plain.body,
        details,
        actor,
        actionUrl: `${buildBaseUrl(req)}${NOTIFICATION_PATHS[plain.kind] || '/notificacoes'}`,
        actionLabel: 'Abrir minhas notificações',
        optOutUrl: perfilUrl
    });

    await transport.transporter.sendMail({
        from: transport.from,
        to: email,
        subject: conteudo.subject,
        text: conteudo.text,
        html: conteudo.html,
        // Sinaliza ao caixa de entrada que o envio é esperado e oferece
        // um caminho imediato para desligar, o que derruba a chance de spam.
        headers: {
            'X-Auto-Response-Suppress': 'AutoReply',
            'List-Unsubscribe': perfilUrl ? `<${perfilUrl}>` : undefined,
            'List-Unsubscribe-Post': perfilUrl ? 'List-Unsubscribe=One-Click' : undefined
        }
    });

    await Notificacao.update(
        { email_sent_at: new Date() },
        { where: { id: plain.id } }
    );

    return { status: 'sent', email, subject: conteudo.subject };
}

/**
 * Dispara um aviso em massa (MensagemProfessor) para todos os usuários ativos
 * de ADM, PRO e STD que deixaram a opção de e-mail ligada.
 *
 * Os e-mails vão um a um para não expor a lista de destinatários.
 */
async function dispatchMassMessageEmail({ title, content, actor, req, details, messageIds } = {}) {
    const transporte = createTransport();
    if (!transporte) {
        return { status: 'skipped', reason: 'smtp-nao-configurado', sentCount: 0 };
    }

    const destinatarios = await findOptedInEmails();
    if (destinatarios.length === 0) {
        return { status: 'skipped', reason: 'sem-destinatarios', sentCount: 0 };
    }

    const perfilUrl = buildProfileUrl(req);
    const conteudo = buildNotificationEmail({
        kind: 'MENSAGEM_EM_MASSA',
        title,
        body: content,
        // O título do aviso entra no assunto: ajuda a identificar a mensagem
        // já na prévia da caixa de entrada.
        extra: title,
        details,
        actor,
        actionUrl: `${buildBaseUrl(req)}${NOTIFICATION_PATHS.MENSAGEM_EM_MASSA}`,
        actionLabel: 'Ler o aviso',
        optOutUrl: perfilUrl
    });

    const resultados = await runWithConcurrency(destinatarios, BROADCAST_CONCURRENCY, async (destinatario) => {
        try {
            await transporte.transporter.sendMail({
                from: transporte.from,
                to: destinatario.email,
                subject: conteudo.subject,
                text: conteudo.text,
                html: conteudo.html,
                headers: {
                    'X-Auto-Response-Suppress': 'AutoReply',
                    'List-Unsubscribe': perfilUrl ? `<${perfilUrl}>` : undefined,
                    'List-Unsubscribe-Post': perfilUrl ? 'List-Unsubscribe=One-Click' : undefined
                }
            });
            return true;
        } catch (err) {
            console.error(`[notificacoes-email] Falha ao enviar aviso em massa para ${destinatario.email}:`, err.message);
            return false;
        }
    });

    const sentCount = resultados.filter(Boolean).length;

    if (sentCount > 0) {
        const ids = (Array.isArray(messageIds) ? messageIds : [])
            .map((id) => parseInt(id, 10))
            .filter((id) => Number.isInteger(id) && id > 0);

        // Sem ids não marca nada: um `update` sem filtro alteraria a tabela inteira.
        if (ids.length > 0) {
            await MensagemProfessor.update(
                { email_sent_at: new Date() },
                { where: { id: { [Op.in]: ids } } }
            );
        }
    }

    return {
        status: sentCount > 0 ? 'sent' : 'failed',
        sentCount,
        totalCount: destinatarios.length,
        subject: conteudo.subject
    };
}

/** Executa `task` para cada item com no máximo `limit` tarefas em paralelo. */
async function runWithConcurrency(items, limit, task) {
    const fila = [...items];
    const total = fila.length;
    if (total === 0) {
        return [];
    }

    const resultados = new Array(total);
    let cursor = 0;

    const consumidores = Array.from({ length: Math.min(Math.max(1, limit), total) }, async () => {
        while (cursor < total) {
            const indice = cursor;
            cursor += 1;
            resultados[indice] = await task(fila[indice]);
        }
    });

    await Promise.all(consumidores);
    return resultados;
}

/**
 * Envolve o envio em try/catch para o fluxo que originou a notificação
 * nunca quebrar por causa do SMTP.
 */
async function safeDispatchNotificationEmail(notificacao, opcoes) {
    try {
        return await dispatchNotificationEmail(notificacao, opcoes);
    } catch (err) {
        console.error('[notificacoes-email] Erro ao enviar notificação por e-mail:', err.message);
        return { status: 'failed', reason: err.message };
    }
}

/**
 * Versão "não bloqueante" do aviso em massa: devolve imediatamente e
 * registra o resultado no log. Usada nas rotas que respondem ao professor.
 */
function safeDispatchMassMessageEmail(dados) {
    return dispatchMassMessageEmail(dados)
        .then((resultado) => {
            if (resultado.status === 'sent') {
                console.log(`[notificacoes-email] Aviso "${dados && dados.title}" enviado para ${resultado.sentCount} de ${resultado.totalCount} destinatários.`);
            } else {
                console.log(`[notificacoes-email] Aviso em massa não enviado (${resultado.reason || resultado.status}).`);
            }
            return resultado;
        })
        .catch((err) => {
            console.error('[notificacoes-email] Erro no aviso em massa:', err.message);
            return { status: 'failed', reason: err.message };
        });
}

module.exports = {
    ACADEMY_NAME,
    NOTIFICATION_PATHS,
    BROADCAST_CONCURRENCY,
    findOptedInEmails,
    dispatchNotificationEmail,
    dispatchMassMessageEmail,
    safeDispatchNotificationEmail,
    safeDispatchMassMessageEmail,
    runWithConcurrency
};