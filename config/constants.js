/**
 * Valores fixos usados em todo o sistema.
 * Centralizar aqui facilita mudar prazos e limites num só lugar.
 */

/** Métodos HTTP que entram no log de atividades do administrador. */
const APP_ACTIVITY_LOG_ACTIONS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UPDATE']);

/** Quantidade máxima de registros no log antes de pedir limpeza. */
const APP_ACTIVITY_LOG_MAX = 5000;

/** Quando o log atinge 95% do limite, o admin recebe aviso na tela. */
const APP_ACTIVITY_LOG_WARN_REMAINING_RATIO = 0.05;

/** Link de redefinição de senha vale por 10 minutos. */
const RESET_TOKEN_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

/** Link de confirmação de troca de e-mail vale por 48 horas. */
const EMAIL_CHANGE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/** Sessão expira após 10 minutos sem nenhuma ação do usuário. */
const SESSION_IDLE_TIMEOUT_MINUTES = 10;
const SESSION_IDLE_TIMEOUT_MS = (() => {
    const fromEnv = Number(process.env.SESSION_IDLE_TIMEOUT_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
        return fromEnv;
    }
    return SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
})();

module.exports = {
    APP_ACTIVITY_LOG_ACTIONS,
    APP_ACTIVITY_LOG_MAX,
    APP_ACTIVITY_LOG_WARN_REMAINING_RATIO,
    RESET_TOKEN_TTL_MINUTES,
    RESET_TOKEN_TTL_MS,
    EMAIL_CHANGE_TOKEN_TTL_MS,
    SESSION_IDLE_TIMEOUT_MINUTES,
    SESSION_IDLE_TIMEOUT_MS
};
