const {
    APP_ACTIVITY_LOG_ACTIONS,
    APP_ACTIVITY_LOG_MAX,
    APP_ACTIVITY_LOG_WARN_REMAINING_RATIO,
    RESET_TOKEN_TTL_MINUTES,
    RESET_TOKEN_TTL_MS,
    EMAIL_CHANGE_TOKEN_TTL_MS,
    SESSION_IDLE_TIMEOUT_MINUTES,
    SESSION_IDLE_TIMEOUT_MS
} = require('../../../config/constants');

describe('config/constants', () => {
    test('valores de reset e log de atividade', () => {
        expect(RESET_TOKEN_TTL_MINUTES).toBe(10);
        expect(RESET_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
        expect(EMAIL_CHANGE_TOKEN_TTL_MS).toBe(48 * 60 * 60 * 1000);
        expect(APP_ACTIVITY_LOG_MAX).toBe(5000);
        expect(APP_ACTIVITY_LOG_WARN_REMAINING_RATIO).toBe(0.05);
        expect(Math.ceil(APP_ACTIVITY_LOG_MAX * (1 - APP_ACTIVITY_LOG_WARN_REMAINING_RATIO))).toBe(4750);
        expect(APP_ACTIVITY_LOG_ACTIONS.has('GET')).toBe(true);
        expect(APP_ACTIVITY_LOG_ACTIONS.has('POST')).toBe(true);
        expect(APP_ACTIVITY_LOG_ACTIONS.has('PATCH')).toBe(true);
    });

    test('timeout de inatividade da sessão', () => {
        expect(SESSION_IDLE_TIMEOUT_MINUTES).toBe(10);
        expect(SESSION_IDLE_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });
});
