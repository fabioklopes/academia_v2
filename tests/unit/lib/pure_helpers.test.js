const path = require('path');
const fs = require('fs');
const {
    hasProfessorAccess,
    buildPaginationVm,
    formatDateBrFromYmd,
    getTodayYmd,
    toDateStartOfDay,
    toDateEndOfDay,
    normalizeNameSortKey,
    buildYmdFromParts,
    getBaseBeltColor,
    getBeltGroupOrderDesc,
    getBeltBadgeClass,
    resolveLocalUploadFile,
    getDefaultRedirectByRole,
    getRoleLabel,
    normalizeClassName,
    tokenizeClassName,
    areClassNamesTooSimilar,
    formatDateTimeForInput,
    formatDateTimePtBr,
    formatDateTimePtBrWithAs,
    parseDateTimeInput,
    normalizeEmail,
    normalizePersonName,
    formatLastNameWithConnectives,
    formatPhoneDigitsToBr,
    roleLabelPtBr,
    userStatusLabelPtBr
} = require('../../../lib/pure_helpers');

describe('lib/pure_helpers', () => {
    test('hasProfessorAccess', () => {
        expect(hasProfessorAccess(null)).toBe(false);
        expect(hasProfessorAccess({ role: 'STD' })).toBe(false);
        expect(hasProfessorAccess({ role: 'PRO' })).toBe(true);
        expect(hasProfessorAccess({ role: 'ADM' })).toBe(true);
    });

    test('buildPaginationVm', () => {
        const vm = buildPaginationVm(2, 25, 10, 5);
        expect(vm.currentPage).toBe(2);
        expect(vm.totalPages).toBe(3);
        expect(vm.pageNumbers.length).toBeGreaterThan(0);
    });

    test('datas YMD', () => {
        expect(formatDateBrFromYmd('2024-03-05')).toBe('05/03/2024');
        expect(formatDateBrFromYmd('bad')).toBe('-');
        expect(getTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const start = toDateStartOfDay('2024-06-15');
        const end = toDateEndOfDay('2024-06-15');
        expect(start.getHours()).toBe(0);
        expect(end.getHours()).toBe(23);
        expect(buildYmdFromParts({ year: 2020, month: 1, day: 2 })).toBe('2020-01-02');
        expect(buildYmdFromParts({ year: NaN, month: 1, day: 1 })).toBe('');
    });

    test('normalizeNameSortKey', () => {
        expect(normalizeNameSortKey(' José Álvaro ')).toBe('jose alvaro');
    });

    test('faixas', () => {
        expect(getBaseBeltColor('yellow_black')).toBe('yellow');
        expect(getBeltGroupOrderDesc('black')).toBe(9);
        expect(getBeltBadgeClass('blue')).toBe('belt-badge-blue');
    });

    test('resolveLocalUploadFile', () => {
        expect(resolveLocalUploadFile('/img/x.png')).toBeNull();
        const root = path.join(__dirname, '..', '..', '..');
        const uploadsRel = path.join('uploads', 'users');
        const dir = path.join(root, uploadsRel);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const marker = path.join(dir, 'jest_pure_helpers_marker.txt');
        fs.writeFileSync(marker, 'ok');
        const abs = resolveLocalUploadFile('/uploads/users/jest_pure_helpers_marker.txt');
        expect(abs).toBeTruthy();
        expect(fs.existsSync(abs)).toBe(true);
        fs.unlinkSync(marker);
    });

    test('papéis e redirects', () => {
        expect(getDefaultRedirectByRole('ADM')).toBe('/dashboard');
        expect(getRoleLabel('ADM')).toBe('Administrador');
        expect(roleLabelPtBr('STD')).toBe('Aluno');
        expect(userStatusLabelPtBr('P')).toBe('Pendente');
    });

    test('nomes de turma', () => {
        expect(areClassNamesTooSimilar('Turma A', 'Turma A')).toBe(true);
        expect(normalizeClassName('  Foo–Bar  ')).toContain('foo');
        expect(tokenizeClassName('de karate').length).toBeGreaterThanOrEqual(0);
    });

    test('datetime helpers', () => {
        expect(formatDateTimeForInput(null)).toBe('');
        const d = new Date('2020-05-10T14:30:00');
        expect(formatDateTimePtBr(d)).toContain('05');
        expect(formatDateTimePtBrWithAs(d)).toContain('às');
        expect(parseDateTimeInput('')).toBeNull();
        expect(parseDateTimeInput('2021-01-01T10:00')).toBeInstanceOf(Date);
    });

    test('normalização de pessoa e e-mail', () => {
        expect(normalizeEmail('  Test@MAIL.com ')).toBe('test@mail.com');
        expect(normalizePersonName('maria da silva')).toBe('Maria Da Silva');
        expect(formatLastNameWithConnectives('Silva DE Souza').toLowerCase()).toContain('silva');
    });

    test('telefone BR', () => {
        expect(formatPhoneDigitsToBr('11999887766')).toBe('(11) 99988-7766');
        expect(formatPhoneDigitsToBr('')).toBe('—');
    });
});
