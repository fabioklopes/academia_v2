/**
 * Atualiza a senha do usuário user_code = ADMIN com hash Argon2.
 *
 * Uso (PowerShell, na raiz do projeto):
 *   $env:ADMIN_PASS = "suaSenhaSegura"
 *   node scripts/set-admin-password.js
 *   Remove-Item Env:ADMIN_PASS
 *
 * Ou:
 *   node scripts/set-admin-password.js suaSenhaSegura
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const argon2 = require('argon2');
const { sequelize } = require('../models/db');
const Usuario = require('../models/Usuario');

async function main() {
  const password =
    process.env.ADMIN_PASS ||
    (process.argv[2] && String(process.argv[2]).trim());

  if (!password) {
    console.error('Informe a senha: variável ADMIN_PASS ou argumento na linha de comando.');
    console.error('Ex.: $env:ADMIN_PASS = "minhasenha"; node scripts/set-admin-password.js');
    process.exit(1);
  }

  await sequelize.authenticate();

  const [count] = await Usuario.update(
    { password: await argon2.hash(password) },
    { where: { user_code: 'ADMIN' } }
  );

  if (count === 0) {
    console.error('Nenhum usuário com user_code ADMIN encontrado.');
    process.exit(1);
  }

  console.log('Senha do ADMIN atualizada com Argon2.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sequelize.close());
