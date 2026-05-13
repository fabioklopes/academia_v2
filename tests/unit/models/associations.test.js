describe('models/associations', () => {
    test('carrega sem erro após modelos', () => {
        expect(() => {
            require('../../../models/Usuario');
            require('../../../models/Turma');
            require('../../../models/MetaAula');
            require('../../../models/MetaAulaTurma');
            require('../../../models/Notificacao');
            require('../../../models/associations');
        }).not.toThrow();
    });
});
