const Usuario = require('../models/Usuario');

/**
 * Carrega os filhos/dependentes do titular logado para exibir no menu
 * a opção de trocar de conta.
 */
async function dependentsMenuMiddleware(req, res, next) {
    const usuario = req.session.usuario;
    if (usuario && !req.session.viewingAs) {
        try {
            const dependentes = await Usuario.findAll({
                where: { responsible_id: usuario.id, user_status: 'A' },
                attributes: ['id', 'first_name', 'last_name'],
                order: [['first_name', 'ASC']]
            });
            res.locals.dependentes = dependentes.length > 0
                ? dependentes.map(d => d.get({ plain: true }))
                : null;
        } catch (_err) {
            res.locals.dependentes = null;
        }
    } else {
        res.locals.dependentes = null;
    }
    next();
}

module.exports = dependentsMenuMiddleware;
