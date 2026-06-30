const {
    main,
    columnExists,
    dropColumnIfPresent,
    dropTableIfPresent,
    USUARIOS_TABLE,
    USUARIOS_COLUMNS,
    FOTOS_TABLES
} = require('../../../scripts/rollback_facial_recognition');

describe('scripts/rollback_facial_recognition', () => {
    test('exporta API usável em testes', () => {
        expect(typeof main).toBe('function');
        expect(typeof columnExists).toBe('function');
        expect(typeof dropColumnIfPresent).toBe('function');
        expect(typeof dropTableIfPresent).toBe('function');
        expect(USUARIOS_TABLE).toBe('tb_usuarios');
        expect(USUARIOS_COLUMNS).toEqual(
            expect.arrayContaining([
                'photo_status',
                'photo_pending_path',
                'photo_rejected_reason',
                'photo_reviewed_by',
                'photo_reviewed_at',
                'compreface_subject_id'
            ])
        );
        expect(FOTOS_TABLES).toEqual(
            expect.arrayContaining(['tb_presenca_fotos', 'tb_presenca_foto_rostos'])
        );
    });
});
