/**
 * Verifica se o usuário precisa estar logado para acessar a página.
 * Rotas públicas (login, cadastro, fotos) passam direto; demais redirecionam ao login.
 */

/** Lista de caminhos que qualquer pessoa pode acessar sem estar logada. */
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

/**
 * Middleware principal de autenticação.
 * Se não houver usuário na sessão, manda para a tela de login
 * guardando a URL original para redirecionar depois.
 */
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
