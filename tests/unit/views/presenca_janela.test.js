const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

describe('views/presenca.handlebars — janela de solicitação', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'views', 'presenca.handlebars'), 'utf8');
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, 'app.js'), 'utf8');

    test('calendário recebe a janela e as exceções do servidor', () => {
        expect(src).toContain('const JANELA_DIAS = {{presencaJanelaDias}};');
        expect(src).toContain('const DATAS_EXCEPCIONAIS = {{{presencaExcecoesJSON}}};');
        expect(src).toContain('d.setDate(d.getDate() - JANELA_DIAS)');
    });

    test('nenhum lado mantém a janela de 7 dias fixa', () => {
        expect(src).not.toMatch(/d\.setDate\(d\.getDate\(\) - 7\)/);
        expect(appSource).not.toMatch(/\.subtract\(7, 'days'\)/);
        expect(appSource).not.toContain('Anterior ao limite de 7 dias');
    });

    test('servidor entrega as regras da janela para a view', () => {
        expect(appSource).toContain('presencaJanelaDias: PRESENCA_SOLICITACAO_JANELA_DIAS');
        expect(appSource).toContain('presencaExcecoesJSON: JSON.stringify(datasExcepcionaisLiberadas(todayBrYmd))');
        expect(appSource).toContain('validarDataSolicitacao(dateStr, todayBrYmd)');
    });
});