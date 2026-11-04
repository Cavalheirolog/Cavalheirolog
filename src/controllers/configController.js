const { dbGet, dbRun, dbAll } = require('../config/database');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONTROLADOR DE CONFIGURAÇÕES DE LAYOUT E STATUS DO SISTEMA
// ============================================================================

async function obterConfiguracoes(req, res) {
    try {
        const row = await dbGet(`SELECT valor_json FROM configuracoes_sistema WHERE chave = 'global'`);
        if (row && row.valor_json) {
            return res.json({ ok: true, config: JSON.parse(row.valor_json) });
        }
        res.json({ ok: true, config: {} });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

async function salvarConfiguracoes(req, res) {
    try {
        const { config } = req.body;
        if (!config) return res.status(400).json({ ok: false, error: 'Configuração vazia.' });

        const valorJson = JSON.stringify(config);
        
        await dbRun(
            `INSERT OR REPLACE INTO configuracoes_sistema (chave, valor_json, atualizado_em) 
             VALUES ('global', ?, datetime('now', 'localtime'))`,
            [valorJson]
        );
        
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

async function statusSistema(req, res) {
    try {
        const statsAnalise = await dbGet(`SELECT COUNT(id) as total FROM analise_transacoes`);
        const statsAuditoria = await dbGet(`SELECT COUNT(id) as total FROM auditoria_transacoes`);
        const statsPrecos = await dbGet(`SELECT COUNT(id) as total FROM precos_negociados`);
        const ultimosLogs = await dbAll(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10`);

        let dbSizeMb = 0;
        try {
            const dbPath = path.join(__dirname, '../../banco_cavalheiro.sqlite');
            if (fs.existsSync(dbPath)) {
                const stats = fs.statSync(dbPath);
                dbSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
            }
        } catch (e) {}

        res.json({
            ok: true,
            dataHoraServidor: new Date().toLocaleString('pt-BR'),
            bancoDados: {
                totalAnaliseLiquida: statsAnalise?.total || 0,
                totalAuditoriaBruta: statsAuditoria?.total || 0,
                totalAcordosPreco: statsPrecos?.total || 0,
                tamanhoMB: dbSizeMb
            },
            ultimosLogs: ultimosLogs || []
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { obterConfiguracoes, salvarConfiguracoes, statusSistema };