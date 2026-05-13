// Rotas isentas de verificação de login
function isPublicRoute(pathname) {
    const publicRoutes = new Set([
        '/auth/login',
        '/auth/verify',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/reset-password',
        '/aluno/novo',
        '/aluno/cadastrar',
        '/aluno/verificar-titular'
    ]);

    return publicRoutes.has(pathname) || pathname.startsWith('/uploads/');
}

// Redirecionamento para o login caso não esteja autenticado
function requireAuth(req, res, next) {
    if (isPublicRoute(req.path)) {
        return next();
    }

    if (req.session.usuario) {
        return next();
    }

    const redirectPath = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/auth/login?redirect=${redirectPath}`);
}

module.exports = { isPublicRoute, requireAuth };
