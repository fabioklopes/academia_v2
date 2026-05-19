const {
    shouldSkipAppActivityLog,
    resolveActivityLogUserCode,
    normalizeAppActivityAction
} = require('../../../middleware/activity_log');

describe('middleware/activity_log', () => {
    test('ignora recursos estáticos e probes do navegador', () => {
        expect(shouldSkipAppActivityLog({ path: '/css/bootstrap.min.css' })).toBe(true);
        expect(shouldSkipAppActivityLog({ path: '/js/auto-dismiss.js' })).toBe(true);
        expect(shouldSkipAppActivityLog({ path: '/favicon.ico' })).toBe(true);
        expect(shouldSkipAppActivityLog({ path: '/.well-known/appspecific/com.chrome.devtools.json' })).toBe(true);
        expect(shouldSkipAppActivityLog({ path: '/robots.txt' })).toBe(true);
    });

    test('não ignora rotas da aplicação', () => {
        expect(shouldSkipAppActivityLog({ path: '/admin/logs' })).toBe(false);
        expect(shouldSkipAppActivityLog({ path: '/dashboard' })).toBe(false);
    });

    test('resolve user_code apenas com sessão autenticada', () => {
        expect(resolveActivityLogUserCode({ session: {} })).toBeNull();
        expect(resolveActivityLogUserCode({
            session: { usuario: { user_code: 'ABC12' } }
        })).toBe('ABC12');
        expect(resolveActivityLogUserCode({
            session: { usuario: { user_code: '  xy9  ' } }
        })).toBe('xy9');
    });

    test('normaliza ação HTTP desconhecida para GET', () => {
        expect(normalizeAppActivityAction('POST')).toBe('POST');
        expect(normalizeAppActivityAction('TRACE')).toBe('GET');
    });
});
