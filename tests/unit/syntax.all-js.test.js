const { execFileSync } = require('child_process');
const path = require('path');
const { getAllApplicationJsRelativePaths, ROOT } = require('../manifest');

describe('Sintaxe de todos os arquivos .js do projeto', () => {
    const paths = getAllApplicationJsRelativePaths();

    test('manifest não está vazio', () => {
        expect(paths.length).toBeGreaterThan(0);
    });

    test.each(paths)('node --check %s', (rel) => {
        const full = path.join(ROOT, rel);
        execFileSync(process.execPath, ['--check', full], { stdio: 'ignore' });
    });
});
