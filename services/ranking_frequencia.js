'use strict';

const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const Presenca = require('../models/Presenca');
const { buildPaginationVm } = require('../lib/pure_helpers');

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

/** Comparador de ranking: presenças DESC, faixa DESC, grau DESC, nome alfabético ASC. */
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

    return String(a.full_name).localeCompare(String(b.full_name), 'pt-BR', { sensitivity: 'base' });
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
    presencaPesoPorSolicitacao
} = {}) {
    if (typeof presencaPesoPorSolicitacao !== 'function') {
        throw new Error('presencaPesoPorSolicitacao é obrigatório.');
    }

    const students = await Usuario.findAll({
        where: { role: 'STD', user_status: 'A' },
        attributes: ['user_code', 'first_name', 'last_name', 'photo', 'actual_belt', 'actual_degree'],
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

    const userCodes = students.map((s) => s.user_code);

    const presencaRows = await Presenca.findAll({
        where: {
            user_code: { [Op.in]: userCodes },
            status: 'A'
        },
        attributes: ['user_code', 'request_date', 'class_type']
    });

    const presencesByUser = {};
    for (const row of presencaRows) {
        const plain = row.get({ plain: true });
        if (!presencesByUser[plain.user_code]) {
            presencesByUser[plain.user_code] = [];
        }
        presencesByUser[plain.user_code].push(plain);
    }

    const rankingEntries = students.map((student) => {
        const plain = student.get({ plain: true });
        const studentPresences = presencesByUser[plain.user_code] || [];
        let total = 0;
        for (const p of studentPresences) {
            total += presencaPesoPorSolicitacao(p.request_date, p.class_type);
        }
        const fullName = `${plain.first_name || ''} ${plain.last_name || ''}`.trim() || plain.user_code;

        return {
            user_code: plain.user_code,
            full_name: fullName,
            total,
            photo: plain.photo || '/uploads/users/default.jpg',
            belt_image_path: buildBeltImagePath(plain.actual_belt, plain.actual_degree, beltMap),
            actual_belt: plain.actual_belt,
            actual_degree: plain.actual_degree
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

    return {
        items,
        pagination: paginationVm,
        metaInfo: { hasMeta: false, metaTitle: '' }
    };
}

module.exports = {
    compareRankingEntries,
    assignRankingPositions,
    getRowHighlightClass,
    paginateRankingItems,
    buildFrequenciaRankingPage
};
