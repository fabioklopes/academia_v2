const path = require('path');
const fs = require('fs');

describe('public/js/auto-dismiss.js', () => {
    test('arquivo existe e registra listener DOM', () => {
        const full = path.join(__dirname, '..', '..', '..', 'public', 'js', 'auto-dismiss.js');
        const src = fs.readFileSync(full, 'utf8');
        expect(src).toContain('DOMContentLoaded');
        expect(src).toContain('alert-autodismiss');
    });
});
