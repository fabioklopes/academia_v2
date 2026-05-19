'use strict';

const {
    validateIgnitionPayload,
    MIN_PASSWORD_LENGTH
} = require('../../../utils/ignition');

describe('utils/ignition', () => {
    test('validateIgnitionPayload rejeita campos vazios', () => {
        const result = validateIgnitionPayload({});
        expect(result.ok).toBe(false);
        expect(result.errors.first_name).toBeTruthy();
        expect(result.errors.email).toBeTruthy();
        expect(result.errors.class_name).toBeTruthy();
    });

    test('validateIgnitionPayload aceita dados válidos', () => {
        const result = validateIgnitionPayload({
            first_name: 'Maria',
            last_name: 'Silva',
            email: 'admin@academia.test',
            password: 'senha-segura',
            password_confirm: 'senha-segura',
            class_name: 'Turma Iniciantes'
        });

        expect(result.ok).toBe(true);
        expect(result.values.email).toBe('admin@academia.test');
        expect(result.values.className).toBe('Turma Iniciantes');
    });

    test('validateIgnitionPayload exige senha mínima', () => {
        const result = validateIgnitionPayload({
            first_name: 'Maria',
            last_name: 'Silva',
            email: 'admin@academia.test',
            password: 'curta',
            password_confirm: 'curta',
            class_name: 'Turma Iniciantes'
        });

        expect(result.ok).toBe(false);
        expect(result.errors.password).toContain(String(MIN_PASSWORD_LENGTH));
    });
});
