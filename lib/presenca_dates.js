'use strict';

/**
 * Funções puras de data/dedupe do módulo de presença — extraídas de app.js
 * para serem reaproveitadas também pelo módulo de reconhecimento facial
 * (aplicar presença em lote precisa da mesma regra de "já existe presença
 * nesse dia" usada na solicitação manual).
 */

const moment = require('moment');
const { civilDateWeekdaySun0FromYmd } = require('./pure_helpers');

/** Calendário das aulas / contagem no fuso de Brasília (sem horário de verão). */
const PRESENCA_BR_UTC_OFFSET_MIN = -180;

function presencaDatePartsFromYmd(dateStr) {
    const p = String(dateStr || '')
        .trim()
        .split('-')
        .map((x) => parseInt(x, 10));
    if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
        return null;
    }
    return { y: p[0], mo: p[1], d: p[2] };
}

/** Intervalo UTC do dia civil YYYY-MM-DD (armazenamento e deduplicação). */
function presencaUtcRangeForYmd(dateStr) {
    const parts = presencaDatePartsFromYmd(dateStr);
    if (!parts) {
        return null;
    }
    const { y, mo, d } = parts;
    return {
        start: new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0)),
        end: new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999)),
        noon: new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0))
    };
}

/** Dia civil Y-M-D a partir do instante gravado (UTC) — meio-dia UTC evita mudar o dia civil. */
function presencaCivilYmdFromDbDate(requestDate) {
    const dt = requestDate instanceof Date ? requestDate : new Date(requestDate);
    if (Number.isNaN(dt.getTime())) {
        return null;
    }
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Y-M-D civil no calendário de Brasília (terça-feira = grade da academia). */
function presencaCivilYmdBrasil(requestDate) {
    const m = moment(requestDate);
    if (!m.isValid()) {
        return null;
    }
    return m.utcOffset(PRESENCA_BR_UTC_OFFSET_MIN).format('YYYY-MM-DD');
}

function presencaMatchesSolicitacaoDay(requestDate, dateStr) {
    const br = presencaCivilYmdBrasil(requestDate);
    const utc = presencaCivilYmdFromDbDate(requestDate);
    return dateStr === br || dateStr === utc;
}

function presencaDuplicateQueryRange(dateStr) {
    const parts = presencaDatePartsFromYmd(dateStr);
    if (!parts) {
        return null;
    }
    const { y, mo, d } = parts;
    const center = moment.utc([y, mo - 1, d, 12, 0, 0]);
    return {
        start: center.clone().subtract(1, 'day').startOf('day').toDate(),
        end: center.clone().add(1, 'day').endOf('day').toDate()
    };
}

/**
 * Peso da presença aprovada por solicitação:
 * - Terça-feira: Integral = 2; Gi ou No-Gi = 1 cada.
 * - Demais dias: 1 por solicitação (Integral ou outro).
 */
function presencaPesoPorSolicitacao(requestDate, classType) {
    const ct = String(classType || '').trim();
    const ymd = presencaCivilYmdBrasil(requestDate);
    if (!ymd) {
        return 1;
    }
    const dow = civilDateWeekdaySun0FromYmd(ymd);
    if (dow === null) {
        return 1;
    }
    const isTuesday = dow === 2;
    if (isTuesday) {
        if (ct === 'Integral') {
            return 2;
        }
        return 1;
    }
    return 1;
}

module.exports = {
    PRESENCA_BR_UTC_OFFSET_MIN,
    presencaDatePartsFromYmd,
    presencaUtcRangeForYmd,
    presencaCivilYmdFromDbDate,
    presencaCivilYmdBrasil,
    presencaMatchesSolicitacaoDay,
    presencaDuplicateQueryRange,
    presencaPesoPorSolicitacao
};
