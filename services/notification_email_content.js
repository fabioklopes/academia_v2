'use strict';

/**
 * Conteúdo dos e-mails de notificação (assunto + corpo HTML/texto).
 *
 * Este módulo é puro: não acessa banco nem SMTP, para poder ser testado
 * isoladamente. A entrega fica em `notification_email.js`.
 *
 * Regras do assunto (anti-spam):
 *  - sempre prefixado com o nome da academia, para o caixa de entrada
 *    reconhecer o remetente legítimo;
 *  - curto e direto, sem "URGENTE", sem exclamações e sem caixa alta;
 *  - tamanho limitado para não ser cortado na prévia da caixa de entrada.
 */

const ACADEMY_NAME = 'CRTN Belém';
const ACADEMY_TAGLINE = 'Jiu-jitsu';
const SUBJECT_PREFIX = `${ACADEMY_NAME} - `;
const MAX_SUBJECT_LENGTH = 110;

/** Palavras que acalmam filtros de spam e explicam o motivo do envio. */
const OPT_OUT_HINT = 'Prefere não receber? Acesse Meu Perfil e desligue "Notificações por e-mail".';

/** Paleta neutra da moldura do e-mail + cor da marca (faixa vermelha). */
const PALETTE = {
    accent: '#B01116',
    accentDark: '#8C0E12',
    ink: '#1F2430',
    muted: '#6B7280',
    border: '#E5E7EB',
    pageBg: '#F4F5F7',
    cardBg: '#FFFFFF',
    softBg: '#F8F9FA'
};

/**
 * Cores por categoria de notificação — mesma linguagem de cores usada no
 * sistema web. Todos os tons saem da paleta oficial IBJJF da academia:
 *
 *  - `primary`  comunicados e divulgações em massa (azul);
 *  - `danger`   recusas: cadastro, presença e solicitações em geral (vermelha);
 *  - `warning`  cancelamentos e prazos de mensagens expirando (laranja);
 *  - `success`  aprovações de cadastro e de presença (verde).
 *
 * Cada tom traz:
 *  - `color`    cor da categoria (bordas e destaques);
 *  - `deep`     versão escura, usada como fundo com texto branco;
 *  - `soft`     fundo claro do selo;
 *  - `softInk`  texto do selo sobre `soft` (contraste acessível);
 *  - `onColor`  texto claro sobre `deep`.
 */
const TONES = {
    primary: {
        color: '#1890B9',
        deep: '#0E5C77',
        soft: '#E6F3F8',
        softInk: '#0E5C77',
        onColor: '#CFEDF6'
    },
    danger: {
        color: '#B01116',
        deep: '#8C0E12',
        soft: '#FBECEC',
        softInk: '#8C0E12',
        onColor: '#F5D6D7'
    },
    warning: {
        color: '#E07E26',
        deep: '#A75815',
        soft: '#FDF0E3',
        softInk: '#A75815',
        onColor: '#FBE3CC'
    },
    success: {
        color: '#007F3D',
        deep: '#00602F',
        soft: '#E7F3EC',
        softInk: '#00602F',
        onColor: '#BFE3CE'
    }
};

/** Tom usado quando o `kind` é desconhecido. */
const DEFAULT_TONE = 'primary';

/** Paleta de um tom, com fallback seguro. */
function resolveTone(tone) {
    return TONES[tone] || TONES[DEFAULT_TONE];
}


/**
 * Como cada tipo de notificação aparece no assunto, no selo e no texto.
 * O assunto é sempre curto e objetivo; o rótulo do selo é mais descritivo.
 */
const NOTIFICATION_PRESENTATION = {
    PRESENCA_APROVADA: {
        subject: 'Presença aprovada',
        label: 'Presença aprovada',
        tone: 'success'
    },
    PRESENCA_NEGADA: {
        subject: 'Presença negada',
        label: 'Presença negada',
        tone: 'danger'
    },
    AVATAR_APROVADO: {
        subject: 'Foto de perfil aprovada',
        label: 'Foto de perfil aprovada',
        tone: 'success'
    },
    AVATAR_NEGADO: {
        subject: 'Foto de perfil não aprovada',
        label: 'Foto de perfil não aprovada',
        tone: 'danger'
    },
    MENSAGEM_EM_MASSA: {
        subject: 'Novo aviso',
        label: 'Comunicado',
        tone: 'primary'
    }
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Escapa texto para interpolação segura em HTML. */
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Normaliza e-mail para comparação/deduplicação. */
function normalizeEmail(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

/** E-mail utilizável para envio (normalizado e com formato válido). */
function sanitizeEmail(value) {
    const email = normalizeEmail(value);
    return EMAIL_PATTERN.test(email) ? email : '';
}

/** Colapsa quebras de linha e espaços extras (assunto e textos de uma linha). */
function toSingleLine(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/** Corta o texto no limite, sem deixar palavra pela metade. */
function truncate(value, maxLength) {
    const text = toSingleLine(value);
    if (text.length <= maxLength) {
        return text;
    }

    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Rótulo do papel do responsável pela ação (Professor ou Administrador). */
function actorRoleLabel(role) {
    if (role === 'ADM') {
        return 'Administrador';
    }
    if (role === 'PRO') {
        return 'Professor';
    }
    if (role === 'STD') {
        return 'Aluno';
    }
    return 'Equipe CRTN Belém';
}

/** Nome de exibição do autor da ação. */
function buildActorLabel(actor) {
    if (!actor) {
        return '';
    }

    const nome = toSingleLine([actor.first_name, actor.last_name].filter(Boolean).join(' '));
    return nome || toSingleLine(actor.user_code);
}

/** Texto que descreve quem executou a ação, usado no corpo do e-mail. */
function buildActorDescription(actor) {
    if (!actor) {
        return `Equipe ${ACADEMY_NAME}`;
    }

    const nome = buildActorLabel(actor);
    const papel = actorRoleLabel(actor.role);
    return nome ? `${papel} ${nome}` : papel;
}

/**
 * Monta o assunto no formato "CRTN Belém - {assunto}".
 * `extra` permite anexar um detalhe curto (ex.: título do aviso) sem perder
 * o padrão e sem estourar o limite de caracteres.
 */
function buildSubject({ kind, fallback, extra } = {}) {
    const presentation = NOTIFICATION_PRESENTATION[kind] || null;
    const base = toSingleLine(presentation ? presentation.subject : '') || toSingleLine(fallback) || 'Notificação';

    const detail = truncate(toSingleLine(extra), 60);
    const composed = detail ? `${base}: ${detail}` : base;
    const room = Math.max(20, MAX_SUBJECT_LENGTH - SUBJECT_PREFIX.length);
    const limited = truncate(composed, room);

    return `${SUBJECT_PREFIX}${limited}`;
}

/** Metadados visuais (rótulo e tom de cor) do tipo de notificação. */
function resolvePresentation(kind) {
    return NOTIFICATION_PRESENTATION[kind] || {
        subject: '',
        label: 'Notificação',
        tone: DEFAULT_TONE
    };
}

/** Resumo curto exibido na prévia da caixa de entrada antes de abrir o e-mail. */
function buildPreheader({ body, actorDescription }) {
    const resumo = truncate(body, 120);
    const autor = toSingleLine(actorDescription);
    return autor ? `${resumo} — ${autor}` : resumo;
}

function renderDetailsTable(details) {
    const rows = (Array.isArray(details) ? details : [])
        .map((item) => {
            const label = toSingleLine(item && item.label);
            const value = toSingleLine(item && item.value);
            if (!label || !value) {
                return '';
            }

            return `
                        <tr>
                            <td style="padding:6px 16px 6px 0; color:${PALETTE.muted}; font-size:14px; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
                            <td style="padding:6px 0; color:${PALETTE.ink}; font-size:14px; font-weight:600;">${escapeHtml(value)}</td>
                        </tr>`;
        })
        .filter(Boolean);

    if (rows.length === 0) {
        return '';
    }

    return `
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; margin-top:18px;">
${rows.join('\n')}
                    </table>`;
}

/**
 * Corpo em HTML. Layout em tabelas com estilos inline — é o que continua
 * bonito em Gmail, Outlook e nas versões mobiles.
 *
 * Cada célula leva também `bgcolor`, atributo que o Outlook desktop usa
 * quando ignora `background-color`.
 */
function renderHtml({
    kind,
    title,
    body,
    details,
    actor,
    actionUrl,
    actionLabel = 'Ver no sistema',
    optOutUrl
} = {}) {
    const presentation = resolvePresentation(kind);
    const tone = resolveTone(presentation.tone);
    const actorLabel = buildActorLabel(actor);
    const actorRole = actorRoleLabel(actor && actor.role);
    const actorDescription = buildActorDescription(actor);
    const preheader = buildPreheader({ body, actorDescription });
    const url = String(actionUrl || '').trim();
    const detailsHtml = renderDetailsTable(details);
    const perfilUrl = String(optOutUrl || '').trim();

    const optOutHtml = perfilUrl
        ? `Prefere não receber? <a href="${escapeHtml(perfilUrl)}" style="color:${tone.deep};">Acesse Meu Perfil e desligue esta opção</a>.`
        : 'Prefere não receber? Acesse Meu Perfil e desligue "Notificações por e-mail".';

    const actorRow = actorLabel
        ? `
                            <tr>
                                <td bgcolor="${PALETTE.softBg}" style="padding:12px 16px; background-color:${PALETTE.softBg}; border-left:3px solid ${tone.color};">
                                    <p style="margin:0; font-size:13px; color:${PALETTE.muted};">Ação realizada por</p>
                                    <p style="margin:2px 0 0; font-size:14px; color:${PALETTE.ink}; font-weight:700;">${escapeHtml(actorLabel)} <span style="font-weight:400; color:${PALETTE.muted};">· ${escapeHtml(actorRole)}</span></p>
                                </td>
                            </tr>`
        : '';

    const actionRow = url
        ? `
                            <tr>
                                <td style="padding:8px 24px 24px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                        <tr>
                                            <td bgcolor="${tone.deep}" align="center" style="border-radius:8px;">
                                                <a href="${escapeHtml(url)}" style="display:inline-block; background-color:${tone.deep}; color:#FFFFFF; text-decoration:none; font-size:15px; font-weight:700; padding:12px 22px; border-radius:8px;">${escapeHtml(actionLabel)}</a>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="margin:14px 0 0; font-size:12px; color:${PALETTE.muted}; word-break:break-all;">Se o botão não funcionar, copie e cole no navegador:<br>${escapeHtml(url)}</p>
                                </td>
                            </tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title || presentation.label)}</title>
</head>
<body style="margin:0; padding:0; background-color:${PALETTE.pageBg}; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:${PALETTE.ink};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PALETTE.pageBg}" style="background-color:${PALETTE.pageBg};">
    <tr>
        <td align="center" style="padding:24px 12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PALETTE.cardBg}" style="max-width:560px; background-color:${PALETTE.cardBg}; border:1px solid ${PALETTE.border}; border-radius:12px; overflow:hidden;">
                <tr>
                    <td bgcolor="${tone.deep}" style="background-color:${tone.deep}; padding:20px 24px;">
                        <p style="margin:0; font-size:18px; font-weight:800; color:#FFFFFF; letter-spacing:0.3px;">${escapeHtml(ACADEMY_NAME)}</p>
                        <p style="margin:2px 0 0; font-size:12px; color:${tone.onColor}; text-transform:uppercase; letter-spacing:1.2px;">${escapeHtml(ACADEMY_TAGLINE)}</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding:24px 24px 8px;">
                        <span style="display:inline-block; background-color:${tone.soft}; color:${tone.softInk}; font-size:12px; font-weight:700; padding:5px 12px; border-radius:999px;">${escapeHtml(presentation.label)}</span>
                        <h1 style="margin:14px 0 0; font-size:20px; line-height:1.3; color:${PALETTE.ink};">${escapeHtml(title || presentation.label)}</h1>
                        <p style="margin:10px 0 0; font-size:15px; line-height:1.6; color:${PALETTE.ink};">${escapeHtml(body)}</p>
${detailsHtml}
                    </td>
                </tr>
${actorRow}
${actionRow}
                <tr>
                    <td bgcolor="${PALETTE.softBg}" style="padding:18px 24px; background-color:${PALETTE.softBg}; border-top:1px solid ${PALETTE.border};">
                        <p style="margin:0; font-size:12px; line-height:1.6; color:${PALETTE.muted};">
                            Você recebe esta mensagem porque possui cadastro na ${escapeHtml(ACADEMY_NAME)} e manteve a opção "Notificações por e-mail" ativa.<br>
                            ${optOutHtml}
                        </p>
                    </td>
                </tr>
            </table>
            <p style="max-width:560px; margin:14px auto 0; font-size:11px; line-height:1.5; color:${PALETTE.muted}; text-align:center;">
                ${escapeHtml(ACADEMY_NAME)} · Notificação automática do sistema
            </p>
        </td>
    </tr>
</table>
</body>
</html>`;
}

/** Corpo em texto puro (fallback e clientes que não renderizam HTML). */
function renderText({
    kind,
    title,
    body,
    details,
    actor,
    actionUrl,
    actionLabel = 'Ver no sistema',
    optOutUrl
} = {}) {
    const presentation = resolvePresentation(kind);
    const actorLabel = buildActorLabel(actor);
    const url = String(actionUrl || '').trim();

    const linhas = [
        `${ACADEMY_NAME} · ${presentation.label}`,
        '',
        toSingleLine(title || presentation.label),
        toSingleLine(body),
        ''
    ];

    for (const item of (Array.isArray(details) ? details : [])) {
        const label = toSingleLine(item && item.label);
        const value = toSingleLine(item && item.value);
        if (label && value) {
            linhas.push(`${label}: ${value}`);
        }
    }

    if (actorLabel) {
        linhas.push('', `Ação realizada por: ${actorLabel} (${actorRoleLabel(actor && actor.role)})`);
    }

    if (url) {
        linhas.push('', `${actionLabel}: ${url}`);
    }

    linhas.push(
        '',
        `Você recebe esta mensagem porque possui cadastro na ${ACADEMY_NAME} e manteve a opção "Notificações por e-mail" ativa.`,
        toSingleLine(optOutUrl)
            ? `${OPT_OUT_HINT} (${toSingleLine(optOutUrl)})`
            : OPT_OUT_HINT
    );

    return linhas.join('\n');
}

/**
 * Pacote pronto para o Nodemailer com subject já prefixado pela academia.
 */
function buildNotificationEmail(input = {}) {
    return {
        subject: buildSubject(input),
        text: renderText(input),
        html: renderHtml(input)
    };
}

module.exports = {
    ACADEMY_NAME,
    SUBJECT_PREFIX,
    MAX_SUBJECT_LENGTH,
    OPT_OUT_HINT,
    PALETTE,
    TONES,
    DEFAULT_TONE,
    resolveTone,
    NOTIFICATION_PRESENTATION,
    buildSubject,
    buildPreheader,
    buildActorLabel,
    buildActorDescription,
    actorRoleLabel,
    escapeHtml,
    normalizeEmail,
    sanitizeEmail,
    resolvePresentation,
    renderHtml,
    renderText,
    buildNotificationEmail
};