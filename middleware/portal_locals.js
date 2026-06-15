/**
 * Preenche variáveis usadas em todas as telas: quem está logado,
 * qual portal mostrar (aluno, professor ou admin) e qual menu lateral usar.
 */
function portalLocalsMiddleware(req, res, next) {
    res.locals.usuarioLogado = req.session.usuario || null;
    res.locals.viewingAs = req.session.viewingAs || null;

    const role = req.session.usuario ? req.session.usuario.role : null;
    res.locals.isRoleSTD = role === 'STD';
    res.locals.isRolePRO = role === 'PRO';
    res.locals.isRoleADM = role === 'ADM';

    if (role === 'ADM') {
        res.locals.portalMenuTitulo = 'PORTAL DO ADMINISTRADOR';
    } else if (role === 'PRO') {
        res.locals.portalMenuTitulo = 'PORTAL DO PROFESSOR';
    } else {
        res.locals.portalMenuTitulo = 'PORTAL DO ALUNO';
    }

    res.locals.useProfessorMenu = role === 'PRO' || role === 'ADM';

    const currentAccount = req.session.viewingAs || req.session.usuario || null;
    if (currentAccount && currentAccount.actual_belt && currentAccount.actual_degree != null) {
        res.locals.currentUserBeltImagePath = `/img/belts/${currentAccount.actual_belt}_${currentAccount.actual_degree}.png`;
    } else {
        res.locals.currentUserBeltImagePath = null;
    }

    next();
}

module.exports = portalLocalsMiddleware;
