const db = require('./db');

const ACTION_VALUES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UPDATE'];
const STATUS_VALUES = ['SUCESSO', 'FALHA'];

const AppActivityLog = db.sequelize.define(
    'AppActivityLog',
    {
        id: {
            type: db.Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        user_code: {
            type: db.Sequelize.STRING(5),
            allowNull: true
        },
        action: {
            type: db.Sequelize.ENUM(...ACTION_VALUES),
            allowNull: false
        },
        endpoint: {
            type: db.Sequelize.STRING(512),
            allowNull: false
        },
        status: {
            type: db.Sequelize.ENUM(...STATUS_VALUES),
            allowNull: false
        }
    },
    {
        tableName: 'tb_app_activity_logs',
        timestamps: true,
        updatedAt: false,
        underscored: true
    }
);

module.exports = AppActivityLog;
module.exports.ACTION_VALUES = ACTION_VALUES;
module.exports.STATUS_VALUES = STATUS_VALUES;
