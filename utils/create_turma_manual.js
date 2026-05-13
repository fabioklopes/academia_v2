const { sequelize } = require('../models/db');
const Turma = require('../models/Turma');
const Usuario = require('../models/Usuario');
const generateCode = require('./classcode_generator');

async function generateUniqueClassCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateCode(5);
    // class_code é PK, então basta checar existência
    const exists = await Turma.findOne({ where: { class_code: candidate } });
    if (!exists) return candidate;
  }
  throw new Error('Não foi possível gerar class_code único.');
}

async function ensureAdminUser() {
  const existing = await Usuario.findOne({ where: { user_code: 'ADMIN' } });
  if (existing) return existing;

  // Preenche somente campos obrigatórios conforme model atual
  return await Usuario.create({
    user_code: 'ADMIN',
    first_name: 'Admin',
    last_name: 'Sistema',
    email: 'admin@local.test',
    password: 'admin',
    role: 'ADM',
    birth_date: '1990-01-01',
    wagi_size: 'A1P',
    zubon_size: 'A1P',
    obi_size: 'A1',
    user_status: 'A',
    photo: '/uploads/users/default.jpg'
  });
}

async function main() {
  const className = 'CRTN Belém';

  await sequelize.authenticate();

  // Garante tabelas (sem alterar schema)
  // Importante: não usamos sync/alter aqui para evitar mudanças inesperadas.

  const admin = await ensureAdminUser();

  const existingTurma = await Turma.findOne({ where: { class_name: className } });
  if (existingTurma) {
    console.log('Turma já existe:');
    console.log(existingTurma.get({ plain: true }));
    return;
  }

  const classCode = await generateUniqueClassCode();
  const turma = await Turma.create({
    class_name: className,
    class_code: classCode,
    created_by: admin.user_code,
    active: 'Y'
  });

  console.log('Turma criada com sucesso:');
  console.log(turma.get({ plain: true }));
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Falha ao criar turma:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await sequelize.close();
      } catch (_e) {
        // ignore
      }
    });
}

module.exports = { generateUniqueClassCode, ensureAdminUser, main };

