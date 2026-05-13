function getErrorViewModel(statusCode) {
    const normalizedStatusCode = Number(statusCode) || 500;
    const map = {
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
        429: {
            title: 'Muitas solicitações',
            message: 'Você fez muitas solicitações em pouco tempo. Tente novamente em instantes.',
            iconClass: 'fa-gauge-high'
        },
        500: {
            title: 'Erro interno',
            message: 'Ocorreu um erro inesperado no servidor.',
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
            title: 'Tempo esgotado',
            message: 'O servidor não respondeu a tempo. Tente novamente.',
            iconClass: 'fa-hourglass-end'
        }
    };

    if (normalizedStatusCode === 443) {
        return { statusCode: 443, title: 'Acesso negado', message: 'Acesso bloqueado.', iconClass: 'fa-ban' };
    }

    const fallback = map[500];
    const viewModel = map[normalizedStatusCode] || {
        statusCode: normalizedStatusCode,
        title: fallback.title,
        message: fallback.message,
        iconClass: fallback.iconClass
    };

    return { statusCode: normalizedStatusCode, ...viewModel };
}

function renderErrorPage(res, statusCode) {
    const vm = getErrorViewModel(statusCode);
    return res.status(vm.statusCode).render('errors/error', vm);
}

function createNotFoundMiddleware() {
    return (req, res) => {
        if (res.headersSent) {
            return;
        }

        if (req.accepts(['html', 'json']) === 'json') {
            return res.status(404).json({ ok: false, error: 'Not Found' });
        }

        return renderErrorPage(res, 404);
    };
}

function createErrorMiddleware(options) {
    const { isProduction } = options;
    return (err, req, res, _next) => {
        const statusCode = Number(err && (err.statusCode || err.status)) || 500;
        const message = isProduction ? undefined : (err && err.message ? err.message : undefined);

        if (res.headersSent) {
            return;
        }

        if (req.accepts(['html', 'json']) === 'json') {
            return res.status(statusCode).json({
                ok: false,
                error: statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
                message
            });
        }

        const vm = getErrorViewModel(statusCode);
        if (!isProduction && message) {
            vm.message = message;
        }

        return res.status(vm.statusCode).render('errors/error', vm);
    };
}

module.exports = {
    getErrorViewModel,
    renderErrorPage,
    createNotFoundMiddleware,
    createErrorMiddleware
};
