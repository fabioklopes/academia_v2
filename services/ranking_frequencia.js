'use strict';

const moment = require('moment');
const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const Presenca = require('../models/Presenca');
const Turma = require('../models/Turma');
const TurmaAluno = require('../models/TurmaAluno');
const MetaAula = require('../models/MetaAula');
const { buildPaginationVm } = require('../lib/pure_helpers');

function normalizeDateOnlyToStart(dateOnlyIso) {
    return new Date(`${dateOnlyIso}T00:00:00`);
}

function normalizeDateOnlyToEnd(dateOnlyIso) {
    return new Date(`${dateOnlyIso}T23:59:59.999`);
}

function parseDegreeValue(actualDegree) {
    const parsed = parseInt(actualDegree, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getBeltOrder(beltValue, beltMap) {
    const normalized = String(beltValue || '').trim();
    return beltMap[normalized]?.order || 0;
}

function buildBeltImagePath(actualBelt, actualDegree, beltMap) {
    const beltValue = String(actualBelt || '').trim();
    const degree = parseDegreeValue(actualDegree);
    if (!beltValue || !beltMap[beltValue]) {
        return '/img/belts/white_0.png';
    }
    return `/img/belts/${beltValue}_${degree}.png`;
}

/** Comparador de ranking: presenças DESC, faixa DESC, grau DESC, cadastro ASC, user_code ASC. */
function compareRankingEntries(a, b, beltMap) {
    if (b.total !== a.total) {
        return b.total - a.total;
    }

    const beltOrderA = getBeltOrder(a.actual_belt, beltMap);
    const beltOrderB = getBeltOrder(b.actual_belt, beltMap);
    if (beltOrderB !== beltOrderA) {
        return beltOrderB - beltOrderA;
    }

    const degA = parseDegreeValue(a.actual_degree);
    const degB = parseDegreeValue(b.actual_degree);
    if (degB !== degA) {
        return degB - degA;
    }

    const createdA = new Date(a.createdAt).getTime();
    const createdB = new Date(b.createdAt).getTime();
    if (createdA !== createdB) {
        return createdA - createdB;
    }

    return String(a.user_code).localeCompare(String(b.user_code));
}

function getRowHighlightClass(position) {
    if (position === 1) {
        return 'bg-success';
    }
    if (position === 2) {
        return 'bg-primary';
    }
    if (position === 3) {
        return 'bg-warning text-dark';
    }
    if (position === 4 || position === 5) {
        return 'bg-info';
    }
    return '';
}

function resolveStudentMeta(classCodes, metasPlain, referenceDate = new Date()) {
    if (!Array.isArray(classCodes) || classCodes.length === 0) {
        return null;
    }

    const classSet = new Set(classCodes);
    const todayIso = moment(referenceDate).startOf('day').format('YYYY-MM-DD');

    for (const meta of metasPlain) {
        const metaTurmas = (meta.turmas || []).map((turma) => turma.class_code).filter(Boolean);
        if (metaTurmas.some((classCode) => classSet.has(classCode))) {
            const metaClassCodes = [...new Set(metaTurmas)];
            const effectiveEndIso = moment.min(
                moment(todayIso, 'YYYY-MM-DD'),
                moment(meta.end_date, 'YYYY-MM-DD')
            ).format('YYYY-MM-DD');

            return {
                metaId: meta.id,
                metaTitle: meta.title || '',
                metaClassCodes,
                startAt: normalizeDateOnlyToStart(meta.start_date),
                endAt: normalizeDateOnlyToEnd(effectiveEndIso)
            };
        }
    }

    return null;
}

function countApprovedPresencesForStudent(presences, metaCtx, presencaPesoPorSolicitacao) {
    if (!metaCtx) {
        return 0;
    }

    const classSet = new Set(metaCtx.metaClassCodes);
    let total = 0;

    for (const row of presences) {
        if (!classSet.has(row.class_code)) {
            continue;
        }

        const requestDate = new Date(row.request_date);
        if (requestDate < metaCtx.startAt || requestDate > metaCtx.endAt) {
            continue;
        }

        total += presencaPesoPorSolicitacao(row.request_date, row.class_type);
    }

    return total;
}

function assignRankingPositions(sortedEntries) {
    return sortedEntries.map((entry, index) => ({
        ...entry,
        position: index + 1,
        rowClass: getRowHighlightClass(index + 1)
    }));
}

function paginateRankingItems(rankedItems, currentPage, itemsPerPage) {
    const offset = (currentPage - 1) * itemsPerPage;
    return rankedItems.slice(offset, offset + itemsPerPage);
}

async function buildFrequenciaRankingPage({
    currentPage = 1,
    itemsPerPage = 10,
    pagesPerBlock = 8,
    beltMap,
    presencaPesoPorSolicitacao,
    referenceDate = new Date()
} = {}) {
    if (typeof presencaPesoPorSolicitacao !== 'function') {
        throw new Error('presencaPesoPorSolicitacao é obrigatório.');
    }

    const todayIso = moment(referenceDate).startOf('day').format('YYYY-MM-DD');

    const students = await Usuario.findAll({
        where: { role: 'STD', user_status: 'A' },
        attributes: ['user_code', 'first_name', 'last_name', 'photo', 'actual_belt', 'actual_degree', 'createdAt'],
        order: [['user_code', 'ASC']]
    });

    if (students.length === 0) {
        const paginationVm = buildPaginationVm(currentPage, 0, itemsPerPage, pagesPerBlock);
        return {
            items: [],
            pagination: paginationVm,
            metaInfo: { hasMeta: false, metaTitle: '' }
        };
    }

    const userCodes = students.map((student) => student.user_code);

    const enrollments = await TurmaAluno.findAll({
        where: { user_code: { [Op.in]: userCodes }, active: 'Y' },
        attributes: ['user_code', 'class_code']
    });

    const enrollmentsByUser = enrollments.reduce((acc, row) => {
        const plain = row.get({ plain: true });
        if (!acc[plain.user_code]) {
            acc[plain.user_code] = [];
        }
        acc[plain.user_code].push(plain.class_code);
        return acc;
    }, {});

    const metasAtivas = await MetaAula.findAll({
        where: {
            status: 'A',
            start_date: { [Op.lte]: todayIso },
            end_date: { [Op.gte]: todayIso }
        },
        include: [
            {
                model: Turma,
                as: 'turmas',
                through: { attributes: [] },
                attributes: ['class_code']
            }
        ],
        order: [['start_date', 'DESC'], ['id', 'DESC']]
    });

    const metasPlain = metasAtivas.map((meta) => meta.get({ plain: true }));

    const studentMetaCtxByUser = {};
    let globalStartAt = null;
    let globalEndAt = null;
    let anyHasMeta = false;
    const metaTitles = new Set();

    for (const student of students) {
        const plain = student.get({ plain: true });
        const classCodes = [...new Set(enrollmentsByUser[plain.user_code] || [])];
        const metaCtx = resolveStudentMeta(classCodes, metasPlain, referenceDate);
        studentMetaCtxByUser[plain.user_code] = metaCtx;

        if (metaCtx) {
            anyHasMeta = true;
            if (metaCtx.metaTitle) {
                metaTitles.add(metaCtx.metaTitle);
            }
            if (!globalStartAt || metaCtx.startAt < globalStartAt) {
                globalStartAt = metaCtx.startAt;
            }
            if (!globalEndAt || metaCtx.endAt > globalEndAt) {
                globalEndAt = metaCtx.endAt;
            }
        }
    }

    const presencesByUser = {};
    if (anyHasMeta && globalStartAt && globalEndAt) {
        const presencaRows = await Presenca.findAll({
            where: {
                user_code: { [Op.in]: userCodes },
                status: 'A',
                request_date: { [Op.between]: [globalStartAt, globalEndAt] }
            },
            attributes: ['user_code', 'request_date', 'class_type', 'class_code']
        });

        for (const row of presencaRows) {
            const plain = row.get({ plain: true });
            if (!presencesByUser[plain.user_code]) {
                presencesByUser[plain.user_code] = [];
            }
            presencesByUser[plain.user_code].push(plain);
        }
    }

    const rankingEntries = students.map((student) => {
        const plain = student.get({ plain: true });
        const metaCtx = studentMetaCtxByUser[plain.user_code] || null;
        const studentPresences = presencesByUser[plain.user_code] || [];
        const total = countApprovedPresencesForStudent(studentPresences, metaCtx, presencaPesoPorSolicitacao);
        const fullName = `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code;

        return {
            user_code: plain.user_code,
            full_name: fullName,
            total,
            photo: plain.photo || '/uploads/users/default.jpg',
            belt_image_path: buildBeltImagePath(plain.actual_belt, plain.actual_degree, beltMap),
            actual_belt: plain.actual_belt,
            actual_degree: plain.actual_degree,
            createdAt: plain.createdAt
        };
    });

    rankingEntries.sort((a, b) => compareRankingEntries(a, b, beltMap));

    const rankedWithPositions = assignRankingPositions(rankingEntries);
    const paginationVm = buildPaginationVm(currentPage, rankedWithPositions.length, itemsPerPage, pagesPerBlock);
    const pageItems = paginateRankingItems(rankedWithPositions, paginationVm.currentPage, itemsPerPage);

    const items = pageItems.map((entry) => ({
        position: entry.position,
        user_code: entry.user_code,
        full_name: entry.full_name,
        total: entry.total,
        photo: entry.photo,
        belt_image_path: entry.belt_image_path,
        rowClass: entry.rowClass
    }));

    let metaTitle = '';
    if (metaTitles.size === 1) {
        metaTitle = [...metaTitles][0];
    } else if (metaTitles.size > 1) {
        metaTitle = 'Metas vigentes por turma';
    }

    return {
        items,
        pagination: paginationVm,
        metaInfo: {
            hasMeta: anyHasMeta,
            metaTitle
        }
    };
}

module.exports = {
    compareRankingEntries,
    assignRankingPositions,
    getRowHighlightClass,
    paginateRankingItems,
    buildFrequenciaRankingPage
};
