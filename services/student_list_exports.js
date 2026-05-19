'use strict';

/**
 * Exportação de listas de alunos para Excel (XLSX) e PDF.
 */

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { getTodayYmd, resolveLocalUploadFile } = require('../lib/pure_helpers');

/** Define cabeçalhos HTTP para o navegador baixar o arquivo (Excel ou PDF). */
function setDownloadHeaders(res, filename, contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

/** Gera planilha Excel com colunas e linhas informadas e envia para download. */
async function exportStudentsToXlsx(res, filename, rows, columns) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Relatório');

    sheet.columns = columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width || 22
    }));

    rows.forEach((r) => {
        sheet.addRow(r);
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    setDownloadHeaders(res, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
}

/** Gera PDF com tabela de alunos (foto, faixa, status — conforme opções). */
function exportStudentsToPdf(res, filename, title, rows, options = {}) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    setDownloadHeaders(res, filename, 'application/pdf');
    doc.pipe(res);

    const headerTitle = options.headerTitle ? String(options.headerTitle) : String(title || '');
    const headerTitleAlign = options.headerTitleAlign ? String(options.headerTitleAlign) : 'left';
    const headerUppercase = options.headerUppercaseTitle === true;
    const headerLines = Array.isArray(options.headerLines) ? options.headerLines : null;
    const headerLinesAlign = options.headerLinesAlign ? String(options.headerLinesAlign) : headerTitleAlign;

    const safeTitle = headerUppercase ? headerTitle.toUpperCase() : headerTitle;
    doc.fontSize(16).text(safeTitle, { align: headerTitleAlign });
    doc.moveDown(0.25);

    if (headerLines && headerLines.length > 0) {
        doc.fontSize(10).fillColor('#555');
        headerLines.forEach((line) => {
            doc.text(String(line || ''), { align: headerLinesAlign });
        });
        doc.moveDown(0.8);
    } else {
        doc.fontSize(10).fillColor('#555').text(`Gerado em: ${getTodayYmd()}`);
        doc.moveDown(1);
    }

    doc.fillColor('#000');

    const startX = doc.x;
    let y = doc.y;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const uppercaseColumns = options.uppercaseColumns === true;
    const nameNoWrap = options.nameNoWrap === true;

    const colAvatar = options.includeAvatar ? 34 : 0;
    const colStatus = options.includeStatus ? 70 : 0;
    const colBelt = options.includeBelt ? (options.beltColWidth ? Number(options.beltColWidth) : 150) : 0;
    const colDegree = options.includeDegree ? (options.degreeColWidth ? Number(options.degreeColWidth) : 100) : 0;
    const colBeltSize = options.includeBeltSize ? (options.beltSizeColWidth ? Number(options.beltSizeColWidth) : 90) : 0;
    const colTotal = options.includeTotal ? (options.totalColWidth ? Number(options.totalColWidth) : 60) : 0;
    const colName = pageWidth - colAvatar - colStatus - colBelt - colDegree - colBeltSize - colTotal;

    const headerHeight = 20;
    const rowHeight = options.includeAvatar ? 34 : 22;

    function drawHeader() {
        const labelAvatar = uppercaseColumns ? '' : '';
        const labelName = uppercaseColumns ? 'NOME COMPLETO' : 'Nome completo';
        const labelTotal = uppercaseColumns ? 'TOTAL' : 'Total';
        const labelBelt = uppercaseColumns ? 'FAIXA' : 'Faixa';
        const labelDegree = uppercaseColumns ? 'GRAU' : 'Grau';
        const labelBeltSize = uppercaseColumns ? 'TAMANHO' : 'Tamanho';
        const labelStatus = uppercaseColumns ? 'STATUS' : 'Status';

        doc.rect(startX, y, pageWidth, headerHeight).fill('#f2f2f2');
        doc.fillColor('#000').fontSize(10).font('Helvetica-Bold');
        const headerTextY = y + Math.max(0, Math.round((headerHeight - 10) / 2));
        let x = startX;
        if (options.includeAvatar) {
            doc.text(labelAvatar, x + 4, headerTextY, { width: colAvatar - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colAvatar;
        }
        doc.text(labelName, x + 4, headerTextY, { width: colName - 8, align: 'center', lineBreak: false, ellipsis: true });
        x += colName;
        if (options.includeTotal) {
            doc.text(labelTotal, x + 4, headerTextY, { width: colTotal - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colTotal;
        }
        if (options.includeBelt) {
            doc.text(labelBelt, x + 4, headerTextY, { width: colBelt - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colBelt;
        }
        if (options.includeDegree) {
            doc.text(labelDegree, x + 4, headerTextY, { width: colDegree - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colDegree;
        }
        if (options.includeBeltSize) {
            doc.text(labelBeltSize, x + 4, headerTextY, { width: colBeltSize - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colBeltSize;
        }
        if (options.includeStatus) {
            doc.text(labelStatus, x + 4, headerTextY, { width: colStatus - 8, align: 'center', lineBreak: false, ellipsis: true });
        }
        doc.font('Helvetica');
        y += headerHeight;
    }

    function ensureSpaceForRow() {
        const bottomY = doc.page.height - doc.page.margins.bottom;
        if (y + rowHeight > bottomY) {
            doc.addPage();
            y = doc.page.margins.top;
            drawHeader();
        }
    }

    drawHeader();

    doc.fontSize(10);
    rows.forEach((r) => {
        ensureSpaceForRow();
        let x = startX;
        const middleTextY = y + Math.max(0, Math.round((rowHeight - 10) / 2));
        // manter apenas uma linha fina no rodapé
        doc
            .strokeColor('#c0c0c0')
            .lineWidth(1)
            .moveTo(startX, y + rowHeight)
            .lineTo(startX + pageWidth, y + rowHeight)
            .stroke();

        if (options.includeAvatar) {
            const abs = resolveLocalUploadFile(r.photo);
            if (abs) {
                try {
                    doc.image(abs, x + 5, y + 5, { width: 24, height: 24 });
                } catch (_err) {
                    // ignora falha de imagem
                }
            }
            x += colAvatar;
        }

        const nameTopY = y + (options.includeAvatar ? 6 : 6);
        const nameY = (nameNoWrap && !options.includeNameNote) ? middleTextY : nameTopY;
        doc.fillColor('#000').text(String(r.full_name || '-'), x + 4, nameY, {
            width: colName - 8,
            lineBreak: !nameNoWrap,
            ellipsis: true
        });
        if (options.includeNameNote) {
            const note = String(r.belt_summary_label || '').trim();
            if (note) {
                doc.fillColor('#666').fontSize(9).text(note, x + 4, nameTopY + 14, { width: colName - 8 });
                doc.fontSize(10).fillColor('#000');
            }
        }
        x += colName;

        if (options.includeTotal) {
            const totalText = String((r && (r.presencas_count ?? r.total)) ?? '');
            doc.fillColor('#333').text(totalText, x + 4, y + 8, { width: colTotal - 8, align: 'right' });
            x += colTotal;
        }

        if (options.includeBelt) {
            doc.fillColor('#333').text(String(r.belt_label || '-'), x + 4, middleTextY, { width: colBelt - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colBelt;
        }

        if (options.includeDegree) {
            doc.fillColor('#333').text(String(r.degree_label || '-'), x + 4, middleTextY, { width: colDegree - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colDegree;
        }

        if (options.includeBeltSize) {
            doc.fillColor('#333').text(String(r.obi_size || '-'), x + 4, middleTextY, { width: colBeltSize - 8, align: 'center', lineBreak: false, ellipsis: true });
            x += colBeltSize;
        }

        if (options.includeStatus) {
            doc.fillColor('#333').text(r.is_active ? 'Ativo' : 'Inativo', x + 4, y + 8, { width: colStatus - 8, align: 'right' });
        }

        y += rowHeight;
    });

    doc.end();
}

module.exports = {
    setDownloadHeaders,
    exportStudentsToXlsx,
    exportStudentsToPdf
};
