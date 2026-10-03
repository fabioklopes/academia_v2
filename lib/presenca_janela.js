/**
 * Janela de solicitação de presenças — funções puras, sem banco nem sessão.
 *
 * Regra normal: só é possível solicitar presença dos últimos N dias.
 * Exceção temporária: as datas de PRESENCA_SOLICITACAO_DATAS_EXCEPCIONAIS ficam
 * liberadas mesmo fora da janela, mas apenas enquanto hoje for anterior ou
 * igual a PRESENCA_SOLICITACAO_EXCECAO_ATE. Depois disso a exceção expira sozinha
 * e o procedimento normal (janela de N dias) volta a valer.
 */

const {
    PRESENCA_SOLICITACAO_JANELA_DIAS,
    PRESENCA_SOLICITACAO_DATAS_EXCEPCIONAIS,
    PRESENCA_SOLICITACAO_EXCECAO_ATE
} = require('../config/constants');
const { formatDateBrFromYmd } = require('./pure_helpers');

const YMD_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normaliza para YYYY-MM-DD quando a data existe no calendário; senão null. */
function normalizarYmd(value) {
    const match = YMD_REGEX.exec(String(value == null ? '' : value).trim());
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    // Meio-dia UTC evita qualquer interferência de horário de verão na validação.
    const asDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    if (
        asDate.getUTCFullYear() !== year ||
        asDate.getUTCMonth() + 1 !== month ||
        asDate.getUTCDate() !== day
    ) {
        return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Subtrai dias de uma data civil YYYY-MM-DD (aritmética UTC). */
function subtrairDias(ymd, dias) {
    const normalizada = normalizarYmd(ymd);
    const quantidade = Number(dias);
    if (!normalizada || !Number.isFinite(quantidade)) {
        return null;
    }
    const [year, month, day] = normalizada.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day - quantidade, 12, 0, 0, 0))
        .toISOString()
        .slice(0, 10);
}

/** A exceção de datas ainda está vigente na data de referência informada? */
function excecaoVigente(todayYmd) {
    const hoje = normalizarYmd(todayYmd);
    const validade = normalizarYmd(PRESENCA_SOLICITACAO_EXCECAO_ATE);
    if (!hoje || !validade) {
        return false;
    }
    return hoje <= validade;
}

/**
 * Datas excepcionais liberadas na data de referência (já vencidas ou não).
 * Lista vazia quando a campanha acabou — aí vale apenas a janela normal.
 */
function datasExcepcionaisLiberadas(todayYmd) {
    if (!excecaoVigente(todayYmd)) {
        return [];
    }
    const hoje = normalizarYmd(todayYmd);
    return PRESENCA_SOLICITACAO_DATAS_EXCEPCIONAIS.map(normalizarYmd)
        .filter((ymd) => !!ymd && ymd <= hoje)
        .sort();
}

/**
 * Valida uma data para solicitação de presença.
 * Retorna null quando liberada ou a mensagem de erro para o aluno.
 *
 * @param {string} dateYmd Data solicitada em YYYY-MM-DD.
 * @param {string} todayYmd Data de referência (hoje) em YYYY-MM-DD.
 * @param {{janelaDias?: number, excecoes?: string[]}} [opcoes]
 */
function validarDataSolicitacao(dateYmd, todayYmd, opcoes = {}) {
    const janelaDias = Number.isFinite(Number(opcoes.janelaDias))
        ? Number(opcoes.janelaDias)
        : PRESENCA_SOLICITACAO_JANELA_DIAS;
    const excecoes = Array.isArray(opcoes.excecoes)
        ? opcoes.excecoes.map(normalizarYmd).filter(Boolean)
        : datasExcepcionaisLiberadas(todayYmd);

    const data = normalizarYmd(dateYmd);
    if (!data) {
        return 'Data inválida.';
    }

    const hoje = normalizarYmd(todayYmd);
    if (!hoje) {
        return 'Data de referência inválida.';
    }

    if (data > hoje) {
        return 'Não é permitido solicitar para datas futuras.';
    }

    if (excecoes.includes(data)) {
        return null;
    }

    // Data da exceção que já passou do encerramento da campanha.
    if (
        PRESENCA_SOLICITACAO_DATAS_EXCEPCIONAIS.includes(data) &&
        !excecaoVigente(hoje) &&
        !excecoes.includes(data)
    ) {
        return `O período de solicitação para ${formatDateBrFromYmd(data)} encerrou em ${formatDateBrFromYmd(
            PRESENCA_SOLICITACAO_EXCECAO_ATE
        )}.`;
    }

    const limite = subtrairDias(hoje, janelaDias);
    if (limite && data < limite) {
        return `Anterior ao limite de ${janelaDias} dias (${formatDateBrFromYmd(limite)}).`;
    }

    return null;
}

/** A data está dentro da janela normal ou é uma exceção vigente? */
function dataLiberadaParaSolicitacao(dateYmd, todayYmd, opcoes = {}) {
    return validarDataSolicitacao(dateYmd, todayYmd, opcoes) === null;
}

module.exports = {
    normalizarYmd,
    subtrairDias,
    excecaoVigente,
    datasExcepcionaisLiberadas,
    validarDataSolicitacao,
    dataLiberadaParaSolicitacao,
    PRESENCA_SOLICITACAO_JANELA_DIAS,
    PRESENCA_SOLICITACAO_EXCECAO_ATE
};