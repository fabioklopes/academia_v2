/**
 * Monta textos e telas de erro HTTP (400–599).
 * Em produção, nunca expõe stack traces, caminhos de arquivo ou mensagens de runtime.
 */

const TECHNICAL_MESSAGE_PATTERNS = [
    /node_modules/i,
    /\b(?:at\s+)?[\w.]+\.(?:js|ts|mjs|cjs)(?::\d+)?(?::\d+)?/i,
    /\n\s*at\s+/,
    /sequelize/i,
    /\bError:\s/,
    /\b(?:ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND)\b/,
    /\bER_[A-Z_]+\b/,
    /SyntaxError/i,
    /TypeError/i,
    /ReferenceError/i,
    /Cannot find module/i,
    /Unexpected token/i
];

/** Mensagens específicas para códigos HTTP comuns (demais 400–599 usam fallback por faixa). */
const HTTP_STATUS_OVERRIDES = {
    400: {
        title: 'Requisição inválida',
        message: 'Os dados enviados não puderam ser processados. Verifique as informações e tente novamente.',
        iconClass: 'fa-circle-exclamation'
    },
    401: {
        title: 'Não autenticado',
        message: 'É necessário fazer login para acessar este recurso.',
        iconClass: 'fa-user-lock'
    },
    402: {
        title: 'Pagamento necessário',
        message: 'Esta ação exige confirmação de pagamento antes de continuar.',
        iconClass: 'fa-credit-card'
    },
    403: {
        title: 'Acesso negado',
        message: 'Você não tem permissão para acessar este recurso.',
        iconClass: 'fa-circle-xmark'
    },
    404: {
        title: 'Página não encontrada',
        message: 'A página solicitada não existe ou foi movida.',
        iconClass: 'fa-triangle-exclamation'
    },
    405: {
        title: 'Método não permitido',
        message: 'Esta operação não é permitida para o endereço acessado.',
        iconClass: 'fa-ban'
    },
    406: {
        title: 'Formato não aceito',
        message: 'O servidor não pode atender ao formato solicitado.',
        iconClass: 'fa-file-circle-xmark'
    },
    408: {
        title: 'Tempo esgotado',
        message: 'A solicitação demorou demais. Tente novamente.',
        iconClass: 'fa-hourglass-half'
    },
    409: {
        title: 'Conflito',
        message: 'A operação entrou em conflito com o estado atual dos dados.',
        iconClass: 'fa-arrows-turn-to-dots'
    },
    410: {
        title: 'Recurso removido',
        message: 'Este recurso não está mais disponível.',
        iconClass: 'fa-box-archive'
    },
    413: {
        title: 'Arquivo muito grande',
        message: 'O envio excede o tamanho máximo permitido.',
        iconClass: 'fa-weight-hanging'
    },
    414: {
        title: 'Endereço muito longo',
        message: 'O endereço acessado é longo demais.',
        iconClass: 'fa-link-slash'
    },
    415: {
        title: 'Tipo não suportado',
        message: 'O tipo de arquivo ou conteúdo enviado não é suportado.',
        iconClass: 'fa-file-excel'
    },
    422: {
        title: 'Dados inválidos',
        message: 'Alguns campos precisam ser corrigidos antes de continuar.',
        iconClass: 'fa-list-check'
    },
    423: {
        title: 'Recurso bloqueado',
        message: 'Este recurso está temporariamente bloqueado.',
        iconClass: 'fa-lock'
    },
    429: {
        title: 'Muitas solicitações',
        message: 'Você fez muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.',
        iconClass: 'fa-gauge-high'
    },
    431: {
        title: 'Cabeçalhos inválidos',
        message: 'A solicitação contém informações de cabeçalho inválidas ou excessivas.',
        iconClass: 'fa-heading'
    },
    451: {
        title: 'Indisponível por restrição legal',
        message: 'Este conteúdo não pode ser exibido por restrições legais.',
        iconClass: 'fa-scale-balanced'
    },
    500: {
        title: 'Erro interno',
        message: 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.',
        iconClass: 'fa-bug'
    },
    501: {
        title: 'Não implementado',
        message: 'Essa funcionalidade ainda não está disponível.',
        iconClass: 'fa-screwdriver-wrench'
    },
    502: {
        title: 'Falha no gateway',
        message: 'O servidor recebeu uma resposta inválida de um serviço externo.',
        iconClass: 'fa-plug-circle-xmark'
    },
    503: {
        title: 'Serviço indisponível',
        message: 'O serviço está temporariamente indisponível. Tente novamente em instantes.',
        iconClass: 'fa-power-off'
    },
    504: {
        title: 'Tempo esgotado no gateway',
        message: 'O servidor não respondeu a tempo. Tente novamente.',
        iconClass: 'fa-hourglass-end'
    },
    505: {
        title: 'Versão HTTP não suportada',
        message: 'A versão do protocolo HTTP usada não é suportada.',
        iconClass: 'fa-code'
    },
    507: {
        title: 'Armazenamento insuficiente',
        message: 'O servidor não tem espaço suficiente para concluir a operação.',
        iconClass: 'fa-database'
    },
    508: {
        title: 'Loop detectado',
        message: 'Foi detectado um loop na solicitação.',
        iconClass: 'fa-rotate'
    },
    511: {
        title: 'Autenticação de rede necessária',
        message: 'É necessário autenticar-se na rede para continuar.',
        iconClass: 'fa-wifi'
    }
};

const CLIENT_FALLBACK = {
    title: 'Não foi possível concluir',
    message: 'Não foi possível processar sua solicitação. Verifique os dados e tente novamente.',
    iconClass: 'fa-circle-exclamation'
};

const SERVER_FALLBACK = {
    title: 'Erro interno',
    message: 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.',
    iconClass: 'fa-bug'
};

const ERROR_PAYLOAD_KEYS = ['error', 'mensagem', 'message', 'erro', 'detail', 'details'];

function buildHttpStatusMap() {
    const map = Object.create(null);

    for (let code = 400; code <= 599; code += 1) {
        if (HTTP_STATUS_OVERRIDES[code]) {
            map[code] = HTTP_STATUS_OVERRIDES[code];
            continue;
        }

        if (code < 500) {
            map[code] = {
                ...CLIENT_FALLBACK,
                title: `Erro na solicitação (${code})`
            };
        } else {
            map[code] = {
                ...SERVER_FALLBACK,
                title: `Erro no servidor (${code})`
            };
        }
    }

    return map;
}

const HTTP_STATUS_MAP = buildHttpStatusMap();

/** Indica se o texto parece erro técnico (stack, Sequelize, caminhos, etc.). */
function isTechnicalErrorMessage(value) {
    if (value == null) {
        return false;
    }

    const text = String(value).trim();
    if (!text) {
        return false;
    }

    if (text.length > 280) {
        return true;
    }

    return TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Normaliza código HTTP para faixa 400–599 (senão 500). */
function normalizeHttpStatusCode(statusCode) {
    const code = Number(statusCode);
    if (Number.isInteger(code) && code >= 400 && code <= 599) {
        return code;
    }
    return 500;
}

/** Retorna título, mensagem e ícone para cada código de erro HTTP. */
function getErrorViewModel(statusCode) {
    const normalizedStatusCode = normalizeHttpStatusCode(statusCode);

    if (normalizedStatusCode === 443) {
        return {
            statusCode: 443,
            title: 'Acesso negado',
            message: 'Acesso bloqueado.',
            iconClass: 'fa-ban'
        };
    }

    const entry = HTTP_STATUS_MAP[normalizedStatusCode] || HTTP_STATUS_MAP[500];

    return {
        statusCode: normalizedStatusCode,
        title: entry.title,
        message: entry.message,
        iconClass: entry.iconClass
    };
}

/** Mensagem segura para exibir ao usuário (HTML ou JSON). */
function getPublicErrorMessage(statusCode, rawMessage, isProduction) {
    const vm = getErrorViewModel(statusCode);

    if (!isProduction && rawMessage && !isTechnicalErrorMessage(rawMessage)) {
        return String(rawMessage);
    }

    if (!isProduction && rawMessage) {
        return vm.message;
    }

    if (isProduction && rawMessage && !isTechnicalErrorMessage(rawMessage) && normalizeHttpStatusCode(statusCode) < 500) {
        return String(rawMessage);
    }

    return vm.message;
}

/** Sanitiza corpo JSON antes de enviar ao cliente em produção. */
function sanitizeErrorPayload(body, statusCode, isProduction) {
    if (!isProduction || body == null || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }

    const rawCode = Number(statusCode);
    const isErrorResponse = Number.isInteger(rawCode) && rawCode >= 400;
    const vm = getErrorViewModel(isErrorResponse ? rawCode : 500);
    const clone = { ...body };
    let changed = false;

    for (const key of ERROR_PAYLOAD_KEYS) {
        if (!(key in clone)) {
            continue;
        }

        const value = clone[key];
        if (value == null || typeof value === 'object') {
            continue;
        }

        const shouldReplace = (isErrorResponse && rawCode >= 500)
            || isTechnicalErrorMessage(value)
            || (typeof value === 'string' && /erro\s+(ao|interno|inesperado)/i.test(value) && isTechnicalErrorMessage(value.replace(/^[^:]*:\s*/i, '')));

        if (shouldReplace) {
            clone[key] = vm.message;
            changed = true;
        }
    }

    if ('ok' in clone && clone.ok === false && changed) {
        clone.ok = false;
    }

    return clone;
}

/** Sanitiza campos de mensagem em qualquer view (flash alerts, etc.). */
function sanitizeRenderLocals(locals, isProduction) {
    if (!isProduction || !locals || typeof locals !== 'object') {
        return locals;
    }

    const clone = { ...locals };
    const keys = ['mensagem', 'mensagemGeral', 'erro', 'error', 'message'];

    for (const key of keys) {
        if (!(key in clone) || clone[key] == null) {
            continue;
        }

        const value = String(clone[key]);
        if (isTechnicalErrorMessage(value) || /:\s*(?:Error|Sequelize|TypeError)/i.test(value)) {
            clone[key] = GENERIC_REDIRECT_MESSAGE;
        }
    }

    return clone;
}

/** Sanitiza locals da view de erro HTML. */
function sanitizeErrorViewLocals(locals, isProduction) {
    if (!isProduction || !locals || typeof locals !== 'object') {
        return locals;
    }

    const code = normalizeHttpStatusCode(locals.statusCode);
    const vm = getErrorViewModel(code);

    if (code >= 500 || isTechnicalErrorMessage(locals.message)) {
        return { ...locals, ...vm };
    }

    return locals;
}

const GENERIC_REDIRECT_MESSAGE = 'Não foi possível concluir a operação. Tente novamente.';

/** Remove mensagens técnicas de query string em redirects. */
function sanitizeRedirectUrl(url, isProduction) {
    if (!isProduction || typeof url !== 'string') {
        return url;
    }

    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
        return url;
    }

    const path = url.slice(0, queryIndex);
    const search = url.slice(queryIndex + 1);
    const params = new URLSearchParams(search);
    let changed = false;

    for (const key of ['mensagem', 'erro', 'error', 'message']) {
        if (!params.has(key)) {
            continue;
        }

        const raw = params.get(key) || '';
        let decoded = raw;

        try {
            decoded = decodeURIComponent(raw);
        } catch (_err) {
            decoded = raw;
        }

        if (isTechnicalErrorMessage(decoded)) {
            params.set(key, GENERIC_REDIRECT_MESSAGE);
            changed = true;
        }
    }

    if (!changed) {
        return url;
    }

    const nextSearch = params.toString();
    return nextSearch ? `${path}?${nextSearch}` : path;
}

/** Envia a página de erro HTML para o navegador. */
function renderErrorPage(res, statusCode) {
    const vm = getErrorViewModel(statusCode);
    return res.status(vm.statusCode).render('errors/error', vm);
}

/** Payload JSON padronizado para erros. */
function buildJsonErrorBody(statusCode, isProduction, rawMessage) {
    const code = normalizeHttpStatusCode(statusCode);
    const vm = getErrorViewModel(code);

    return {
        ok: false,
        error: vm.title,
        message: getPublicErrorMessage(code, rawMessage, isProduction),
        statusCode: code
    };
}

/** Middleware: em produção, intercepta res.json/render/redirect para não vazar detalhes técnicos. */
function createClientErrorGuardMiddleware(options) {
    const { isProduction } = options;

    if (!isProduction) {
        return function clientErrorGuardPassthrough(_req, _res, next) {
            return next();
        };
    }

    return function clientErrorGuard(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = function guardedJson(body) {
            const statusCode = res.statusCode || 200;
            return originalJson(sanitizeErrorPayload(body, statusCode, true));
        };

        const originalRender = res.render.bind(res);
        res.render = function guardedRender(view, locals, callback) {
            let safeLocals = sanitizeRenderLocals(locals, true);

            if (view === 'errors/error') {
                safeLocals = sanitizeErrorViewLocals(safeLocals, true);
            }

            return originalRender(view, safeLocals, callback);
        };

        const originalRedirect = res.redirect.bind(res);
        res.redirect = function guardedRedirect(url) {
            if (typeof url === 'string') {
                return originalRedirect(sanitizeRedirectUrl(url, true));
            }

            return originalRedirect(url);
        };

        return next();
    };
}

/** Middleware para URLs que não existem (404). */
function createNotFoundMiddleware(options = {}) {
    const isProduction = Boolean(options.isProduction);

    return function notFoundHandler(req, res) {
        if (res.headersSent) {
            return;
        }

        if (req.accepts(['html', 'json']) === 'json') {
            return res.status(404).json(buildJsonErrorBody(404, isProduction));
        }

        return renderErrorPage(res, 404);
    };
}

/** Middleware global de erros — captura exceções e mostra página amigável. */
function createErrorMiddleware(options) {
    const { isProduction } = options;

    return function errorHandler(err, req, res, _next) {
        const statusCode = normalizeHttpStatusCode(err && (err.statusCode || err.status));

        if (!res.headersSent) {
            console.error('[HTTP Error]', statusCode, req.method, req.originalUrl, err && err.stack ? err.stack : err);
        }

        if (res.headersSent) {
            return;
        }

        if (req.accepts(['html', 'json']) === 'json') {
            return res.status(statusCode).json(
                buildJsonErrorBody(statusCode, isProduction, err && err.message)
            );
        }

        const vm = getErrorViewModel(statusCode);

        if (!isProduction && err && err.message && !isTechnicalErrorMessage(err.message)) {
            vm.message = err.message;
        }

        return res.status(vm.statusCode).render('errors/error', vm);
    };
}

module.exports = {
    HTTP_STATUS_MAP,
    getErrorViewModel,
    getPublicErrorMessage,
    isTechnicalErrorMessage,
    sanitizeErrorPayload,
    sanitizeErrorViewLocals,
    sanitizeRenderLocals,
    sanitizeRedirectUrl,
    buildJsonErrorBody,
    renderErrorPage,
    createClientErrorGuardMiddleware,
    createNotFoundMiddleware,
    createErrorMiddleware
};
