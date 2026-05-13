const path = require('path');
const Handlebars = require('handlebars');

/**
 * Registra helpers Handlebars e o engine de views no Express (mesma ordem e opções do app original).
 * @param {import('express').Application} app
 * @param {{ engine: Function, moment: import('moment') }} deps
 */
function setupExpressViews(app, deps) {
    const { engine, moment } = deps;
    const projectRoot = path.join(__dirname, '..');

    // data no formato DD/MM/YYYY
    Handlebars.registerHelper('formatDate', function (date) {
        if (!date) return '';
        return moment(date).format('DD/MM/YYYY');
    });

    // hora no formato HH:mm:ss
    Handlebars.registerHelper('formatTime', function (timestamp) {
        if (!timestamp) return '';
        return moment(timestamp).format('HH:mm:ss');
    });

    // data hora no formato dd/mm/yyyy HH:mm:ss
    Handlebars.registerHelper('formatTimestamp', function (timestamp) {
        if (!timestamp) return '';
        return moment(timestamp).format('DD/MM/YYYY HH:mm:ss');
    });

    // formatação do telefone para o formato (XX) XXXXX-XXXX
    Handlebars.registerHelper('formatPhone', function (phone) {
        if (!phone) return '';
        const cleaned = ('' + phone).replace(/\D/g, '');
        const match = cleaned.match(/^(\d{2})(\d{5})(\d{4})$/);
        if (match) {
            return `(${match[1]}) ${match[2]}-${match[3]}`;
        }
        return phone;
    });

    // Helper para comparação de igualdade
    Handlebars.registerHelper('eq', function (a, b) {
        return a === b;
    });

    app.engine('handlebars', engine({
        defaultLayout: 'main',
        partialsDir: [path.join(projectRoot, 'views', 'layouts')]
    }));

    app.set('view engine', 'handlebars');

    app.set('views', path.join(projectRoot, 'views'));
}

module.exports = { setupExpressViews };
