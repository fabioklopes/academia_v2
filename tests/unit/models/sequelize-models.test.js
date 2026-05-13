require('../../../models/db');
const models = [
    require('../../../models/Usuario'),
    require('../../../models/Presenca'),
    require('../../../models/Turma'),
    require('../../../models/TurmaAluno'),
    require('../../../models/MensagemProfessor'),
    require('../../../models/MensagemProfessorOcultacao'),
    require('../../../models/MensagemProfessorLeitura'),
    require('../../../models/MetaAula'),
    require('../../../models/MetaAulaTurma'),
    require('../../../models/AppActivityLog'),
    require('../../../models/Notificacao')
];
require('../../../models/associations');

describe('models Sequelize — importação e nomes de tabela', () => {
    test.each(models.map((Model, i) => [Model.name || `Model${i}`, Model]))(
        '%s expõe getTableName tb_*',
        (_name, Model) => {
            expect(typeof Model.findOne).toBe('function');
            const tn = Model.getTableName();
            expect(typeof tn).toBe('string');
            expect(tn.startsWith('tb_')).toBe(true);
        }
    );
});

describe('models/AppActivityLog enums exportados', () => {
    test('ACTION_VALUES e STATUS_VALUES', () => {
        const Model = require('../../../models/AppActivityLog');
        expect(Model.ACTION_VALUES).toContain('GET');
        expect(Model.STATUS_VALUES).toContain('SUCESSO');
    });
});
