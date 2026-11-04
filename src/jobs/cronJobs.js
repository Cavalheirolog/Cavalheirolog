const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { sincronizarPeriodoSeguro, cacaNotasPendentes } = require('../services/syncService');
const { getDataBrasil } = require('../utils/helpers');
const { dbPath } = require('../config/database');

// ============================================================================
// AGENDAMENTOS AUTOMÁTICOS (CRON JOBS)
// ============================================================================

function iniciarCronJobs() {
    // A cada 10 minutos: Sincroniza o dia de ontem e hoje
    cron.schedule('*/10 * * * *', async () => {
        const dtOntem = getDataBrasil(-1);
        const dtHoje = getDataBrasil(0);
        await sincronizarPeriodoSeguro(dtOntem, dtHoje, false, 'CronAuditoria10m');
    });

    // Todos os dias às 00:10: Sincronização estendida dos últimos 5 dias
    cron.schedule('10 0 * * *', async () => {
        const dtPassado = getDataBrasil(-5);
        const dtHoje = getDataBrasil(0);
        await sincronizarPeriodoSeguro(dtPassado, dtHoje, true, 'CronFechamentoDiario');
    });

    // A cada 1 hora: Caçador de notas fiscais pendentes
    cron.schedule('0 * * * *', async () => {
        await cacaNotasPendentes();
    });

    // Todos os dias às 03:00 da manhã: Backup diário do SQLite
    cron.schedule('0 3 * * *', () => {
        try {
            const pastaBkp = path.join(__dirname, '../../backups_sqlite');
            if (!fs.existsSync(pastaBkp)) fs.mkdirSync(pastaBkp);
            const destino = path.join(pastaBkp, `banco_cavalheiro_${getDataBrasil(0)}.sqlite`);
            fs.copyFileSync(dbPath, destino);
            console.log(`💾 Backup diário do SQLite gerado com sucesso em: ${destino}`);
        } catch (e) {
            console.error("⚠️ Erro ao gerar backup diário:", e.message);
        }
    });
}

module.exports = {
    iniciarCronJobs
};