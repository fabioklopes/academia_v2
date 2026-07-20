const path = require('path');
const fs = require('fs');

describe('views/presenca.handlebars — alerta dinâmico de aprovação/reprovação', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'views', 'presenca.handlebars'),
        'utf8'
    );

    test('não usa mais o seletor de âncora inexistente (h1.mb-4)', () => {
        // A página só possui <h1 class="mb-0">; o seletor antigo nunca casava
        // e fazia o alerta cair no fallback document.body.prepend(), aparecendo
        // antes da navbar.
        expect(src).not.toContain("querySelector('h1.mb-4')");
    });

    test('alerta criado via showAlert() agenda sua própria remoção', () => {
        // auto-dismiss.js só varre elementos presentes no DOMContentLoaded,
        // então o alerta injetado após o fetch (AJAX) precisa reimplementar
        // o próprio temporizador, senão fica preso na tela indefinidamente
        // em caso de erro (quando não há reload de página).
        const showAlertMatch = src.match(/function showAlert\(msg, tipo\) \{[\s\S]*?\n\s{8}\}/);
        expect(showAlertMatch).toBeTruthy();

        const body = showAlertMatch[0];
        expect(body).toContain('setInterval');
        expect(body).toContain('alertEl.remove()');
        expect(body).toContain('clearInterval');
    });
});
