const fs = require('fs');
const { dbRun, dbGet, dbAll, dbPath } = require('../config/database');
const { CONFIG_PADRAO_SISTEMA } = require('../config/constants');
const { getDataHoraBrasilStr, hashSHA256, parseTruckPagNum } = require('../utils/helpers');

// ============================================================================
// CONTROLLER DE SISTEMA, CONFIGURAÇÕES, UTILIZADORES E FROTA
// ============================================================================

async function getConfiguracoes(req, res) {
    try {
        const chave = req.query.utilizador ? `user_${req.query.utilizador}` : (req.query.usuario ? `user_${req.query.usuario}` : 'global');
        let row = await dbGet(`SELECT valor_json, atualizado_em FROM configuracoes_sistema WHERE chave = ?`, [chave]);
        if (!row && chave !== 'global') {
            row = await dbGet(`SELECT valor_json, atualizado_em FROM configuracoes_sistema WHERE chave = 'global'`);
        }
        const config = row ? { ...CONFIG_PADRAO_SISTEMA, ...JSON.parse(row.valor_json) } : CONFIG_PADRAO_SISTEMA;
        res.json({ ok: true, config, atualizado_em: row?.atualizado_em || null });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

async function postConfiguracoes(req, res) {
    try {
        const chave = req.body.utilizador ? `user_${req.body.utilizador}` : (req.body.usuario ? `user_${req.body.usuario}` : 'global');
        const rowAtual = await dbGet(`SELECT valor_json FROM configuracoes_sistema WHERE chave = ?`, [chave]);
        const base = rowAtual ? JSON.parse(rowAtual.valor_json) : CONFIG_PADRAO_SISTEMA;
        const novaConfig = { ...CONFIG_PADRAO_SISTEMA, ...base, ...(req.body.config || req.body) };
        delete novaConfig.utilizador;
        delete novaConfig.usuario;

        await dbRun(
            `INSERT OR REPLACE INTO configuracoes_sistema (chave, valor_json, atualizado_em) VALUES (?, ?, ?)`,
            [chave, JSON.stringify(novaConfig), getDataHoraBrasilStr()]
        );
        await dbRun(
            `INSERT OR REPLACE INTO configuracoes_sistema (chave, valor_json, atualizado_em) VALUES ('global', ?, ?)`,
            [JSON.stringify(novaConfig), getDataHoraBrasilStr()]
        );
        res.json({ ok: true, config: novaConfig });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

async function getUsuarios(req, res) {
    try {
        const rows = await dbAll(`SELECT username, is_admin, perms_json, layout_json, criado_em FROM usuarios_sistema ORDER BY username ASC`);
        res.json({
            utilizadores: rows.map(r => ({
                username: r.username,
                isAdmin: Boolean(r.is_admin),
                perms: JSON.parse(r.perms_json || '{}'),
                criadoEm: r.criado_em
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function postLogin(req, res) {
    try {
        const username = String(req.body.username || '').toLowerCase().trim();
        const password = String(req.body.password || '');
        const hash = req.body.passwordHash || hashSHA256(password);

        const row = await dbGet(`SELECT * FROM usuarios_sistema WHERE username = ?`, [username]);
        if (!row || row.password_hash !== hash) {
            return res.status(401).json({ ok: false, error: 'Utilizador ou senha inválidos.' });
        }
        res.json({
            ok: true,
            username: row.username,
            isAdmin: Boolean(row.is_admin),
            perms: JSON.parse(row.perms_json || '{}'),
            layout: JSON.parse(row.layout_json || '{}')
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

async function postUsuario(req, res) {
    try {
        const username = String(req.body.username || '').toLowerCase().trim();
        const password = String(req.body.password || '');
        const hash = req.body.passwordHash || hashSHA256(password);
        const perms = req.body.perms || { overview: true, temporal: true, abc: true, frota: true, precos: true, heatmap: true, integration: true };

        if (!username) return res.status(400).json({ ok: false, error: 'Informe o nome de utilizador.' });

        await dbRun(
            `INSERT OR REPLACE INTO usuarios_sistema (username, password_hash, is_admin, perms_json, layout_json, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
            [username, hash, username === 'pedro.cavalheirolog' ? 1 : 0, JSON.stringify(perms), JSON.stringify(CONFIG_PADRAO_SISTEMA), getDataHoraBrasilStr()]
        );
        res.json({ ok: true, username });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

async function getFrotaParametros(req, res) {
    try {
        const parametros = await dbAll(`SELECT * FROM frota_parametros ORDER BY placa ASC`);
        res.json({ parametros });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function postFrotaParametro(req, res) {
    try {
        const { placa, modelo_veiculo, capacidade_tanque, meta_km_l, intervalo_preventiva_km, ultimo_hodometro_preventiva, observacao } = req.body;
        if (!placa) return res.status(400).json({ ok: false, error: "Informe a placa" });

        await dbRun(
            `INSERT OR REPLACE INTO frota_parametros (placa, modelo_veiculo, capacidade_tanque, meta_km_l, intervalo_preventiva_km, ultimo_hodometro_preventiva, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                String(placa).toUpperCase().trim(),
                modelo_veiculo || '',
                parseTruckPagNum(capacidade_tanque) || 1000,
                parseTruckPagNum(meta_km_l) || 2.65,
                parseTruckPagNum(intervalo_preventiva_km) || 25000,
                parseTruckPagNum(ultimo_hodometro_preventiva) || 0,
                observacao || ''
            ]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

async function getStatusSistema(req, res) {
    try {
        const qtdAnalise = await dbGet(`SELECT COUNT(id) as total, MIN(SUBSTR(data,1,10)) as minData, MAX(SUBSTR(data,1,10)) as maxData FROM analise_transacoes`);
        const qtdAuditoria = await dbGet(`SELECT COUNT(id) as total FROM auditoria_transacoes`);
        const qtdPrecos = await dbGet(`SELECT COUNT(id) as total FROM precos_negociados`);
        const ultimosLogs = await dbAll(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 15`);
        const tamanhoSqliteBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

        res.json({
            online: true,
            dataHoraServidor: getDataHoraBrasilStr(),
            bancoDados: {
                tamanhoMB: Number((tamanhoSqliteBytes / (1024 * 1024)).toFixed(2)),
                totalAnaliseLiquida: qtdAnalise?.total || 0,
                totalAuditoriaBruta: qtdAuditoria?.total || 0,
                totalAcordosPreco: qtdPrecos?.total || 0,
                periodoCoberto: { de: qtdAnalise?.minData || null, ate: qtdAnalise?.maxData || null }
            },
            ultimosLogs
        });
    } catch (err) {
        res.status(500).json({ online: false, error: err.message });
    }
}

module.exports = {
    getConfiguracoes,
    postConfiguracoes,
    getUsuarios,
    postLogin,
    postUsuario,
    getFrotaParametros,
    postFrotaParametro,
    getStatusSistema
};