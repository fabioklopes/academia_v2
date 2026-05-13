const { sequelize } = require('./models/db');
const Usuario = require('./models/Usuario');
const Turma = require('./models/Turma');
const TurmaAluno = require('./models/TurmaAluno');
const MetaAula = require('./models/MetaAula');
const MetaAulaTurma = require('./models/MetaAulaTurma');
require('./models/associations');
const { Op } = require('sequelize');

async function runDebugMetasAssoc() {
	try {
		await sequelize.authenticate();
		const aluno = await Usuario.findOne({ where: { role: 'STD' } });
		console.log('Aluno:', aluno ? aluno.user_code : 'nenhum');
		if (!aluno) return;
		const turmas = await TurmaAluno.findAll({ where: { user_code: aluno.user_code, active: 'Y' }, attributes: ['class_code'] });
		console.log('Turmas:', turmas.map(t => t.class_code));
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const metasResult = await MetaAula.findAndCountAll({
			where: {
				status: 'A',
				end_date: { [Op.gte]: today }
			},
			include: [
				{
					model: Turma,
					as: 'turmas',
					through: { attributes: [] },
					where: { class_code: { [Op.in]: turmas.map(t => t.class_code) } }
				},
				{
					model: Usuario,
					as: 'criador',
					attributes: ['first_name', 'last_name']
				}
			],
			order: [['start_date', 'ASC']],
			limit: 10,
			offset: 0,
			distinct: true,
			raw: false
		});
		console.log('Count:', metasResult.count);
		console.log('Rows:', metasResult.rows.length);
		if (metasResult.rows.length > 0) {
			console.log('First row', metasResult.rows[0].get({ plain: true }));
		}
	} catch (err) {
		console.error('Erro:', err);
	} finally {
		await sequelize.close();
	}
}

if (require.main === module) {
	runDebugMetasAssoc();
}

module.exports = { runDebugMetasAssoc };