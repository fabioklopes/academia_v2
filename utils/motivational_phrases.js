const fs = require('fs');
const path = require('path');

const MOTIVATIONAL_PHRASES_PATH = path.join(__dirname, 'frases_motivacionais.txt');

function loadMotivationalPhrases() {
    try {
        return fs.readFileSync(MOTIVATIONAL_PHRASES_PATH, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    } catch (err) {
        console.error('Erro ao carregar frases motivacionais:', err);
        return [];
    }
}

const motivationalPhrases = loadMotivationalPhrases();

function getRandomMotivationalMessage() {
    if (motivationalPhrases.length === 0) {
        return '';
    }

    const randomIndex = Math.floor(Math.random() * motivationalPhrases.length);
    return motivationalPhrases[randomIndex];
}

module.exports = {
    loadMotivationalPhrases,
    getRandomMotivationalMessage,
    motivationalPhrases
};
