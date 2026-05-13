/**
 * Lista canônica de módulos .js da aplicação (raiz do projeto) para garantir cobertura de testes.
 * Exclui apenas node_modules e artefatos de cópia de pasta.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function shouldSkipDir(name) {
    return (
        name === 'node_modules'
        || name === 'coverage'
        || name === '.git'
        || name.toLowerCase().includes('copia')
        || name.toLowerCase().includes('cópia')
    );
}

function collectJsFiles(dir, acc, relBase = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
            if (shouldSkipDir(ent.name)) continue;
            collectJsFiles(path.join(dir, ent.name), acc, rel);
        } else if (ent.isFile() && ent.name.endsWith('.js')) {
            acc.push(rel.replace(/\\/g, '/'));
        }
    }
}

function getAllApplicationJsRelativePaths() {
    const acc = [];
    collectJsFiles(ROOT, acc);
    return acc.sort();
}

module.exports = {
    ROOT,
    getAllApplicationJsRelativePaths
};
