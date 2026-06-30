'use strict';

/**
 * Regras puras do módulo de reconhecimento facial: dia da semana,
 * tipo de aula, rótulo de sequência (1ª/2ª aula de terça), nome de
 * arquivo padronizado, hash de dedupe e decisão de match por limiar
 * de similaridade. Nenhuma função aqui acessa banco, disco ou rede.
 */

const crypto = require('crypto');
const { civilDateWeekdaySun0FromYmd } = require('../lib/pure_helpers');
const { getConfig } = require('../config/compreface_config');

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];

/** Aceita "AAAA-MM-DD" ou "DD/MM/AAAA" e devolve sempre "AAAA-MM-DD", ou null se inválida. */
function parseReferenceDate(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : raw;
    }

    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
        const dd = parseInt(brMatch[1], 10);
        const mm = parseInt(brMatch[2], 10);
        const yyyy = parseInt(brMatch[3], 10);
        const d = new Date(yyyy, mm - 1, dd);
        if (Number.isNaN(d.getTime()) || d.getFullYear() !== yyyy || (d.getMonth() + 1) !== mm || d.getDate() !== dd) {
            return null;
        }
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    return null;
}

function getWeekdayLabel(ymd) {
    const dow = civilDateWeekdaySun0FromYmd(ymd);
    if (dow === null || dow === undefined) {
        return null;
    }
    return WEEKDAY_LABELS[dow];
}

function isTuesday(ymd) {
    return civilDateWeekdaySun0FromYmd(ymd) === 2;
}

/** Só terça-feira permite escolher Gi/No-Gi explicitamente; os demais dias são sempre Integral. */
function resolveClassType(ymd, requestedClassType) {
    if (!isTuesday(ymd)) {
        return 'Integral';
    }
    if (!['Gi', 'No-Gi'].includes(requestedClassType)) {
        throw new Error('Para terça-feira, informe o tipo de aula: Gi ou No-Gi.');
    }
    return requestedClassType;
}

/** 1ª aula de terça = Gi, 2ª aula = No-Gi (requisito 14). Demais dias não têm sequência. */
function resolveSequenceLabel(ymd, classType) {
    if (!isTuesday(ymd)) {
        return null;
    }
    if (classType === 'Gi') {
        return '1a-Aula';
    }
    if (classType === 'No-Gi') {
        return '2a-Aula';
    }
    return null;
}

function computeFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Decide se um rosto detectado é considerado reconhecido, conforme o limiar de similaridade configurado. */
function decideFaceMatch(subjects) {
    const { similarityThreshold } = getConfig();
    const best = Array.isArray(subjects) && subjects.length > 0 ? subjects[0] : null;

    if (best && typeof best.similarity === 'number' && best.similarity >= similarityThreshold) {
        return {
            status: 'RECOGNIZED',
            matchedUserCode: best.subject,
            similarity: best.similarity,
            matchSource: 'AUTO'
        };
    }

    return {
        status: 'UNRECOGNIZED',
        matchedUserCode: null,
        similarity: best ? best.similarity : null,
        matchSource: 'NONE'
    };
}

function slugifyName(name) {
    const slug = String(name || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'professor';
}

/** Nome de arquivo final, padronizado, para a foto de turma aplicada com sucesso (requisitos 10/14). */
function buildFinalFileName({ ymd, weekdayLabel, sequenceLabel, professorName }) {
    const parts = [ymd, weekdayLabel];
    if (sequenceLabel) {
        parts.push(sequenceLabel);
    }
    parts.push(`${slugifyName(professorName)}_upload`);
    return `${parts.join('-')}.jpg`;
}

module.exports = {
    WEEKDAY_LABELS,
    parseReferenceDate,
    getWeekdayLabel,
    isTuesday,
    resolveClassType,
    resolveSequenceLabel,
    computeFileHash,
    decideFaceMatch,
    buildFinalFileName,
    slugifyName
};
