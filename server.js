require('dotenv').config();
const app = require('./src/app');
const { dbRun, dbAll, dbGet, db } = require('./src/config/database');
const { iniciarCronJobs } = require('./src/jobs/cronJobs');
const { conciliarCSVsLocaisAutomaticamente, sanearBaseExistente } = require('./src/services/csvService');
const { aplicarPrecosNegociadosNoBanco } = require('./src/services/priceService');
const { CONFIG_PADRAO_SISTEMA } = require('./src/config/constants');
const { hashSHA256, getDataHoraBrasilStr } = require('./src/utils/helpers');

// ============================================================================
// INICIALIZAÇÃO DA BASE DE DADOS, MIGRATIONS E TABELAS
// ============================================================================
async function inicializarBanco() {
    await dbRun(`PRAGMA journal_mode = WAL;`);
    await dbRun(`PRAGMA synchronous = NORMAL;`);
    await dbRun(`PRAGMA busy_timeout = 15000;`);

    const schemaTransacoes = `(
        id TEXT PRIMARY KEY,
        data TEXT,
        estabelecimento TEXT,
        cidade TEXT,
        uf TEXT,
        tipoAbastecimento TEXT,
        placa TEXT,
        motorista TEXT,
        volume REAL,
        valor_total REAL,
        valor_litro REAL,
        status_nfe TEXT,
        chave_nfe TEXT,
        cnpj_posto TEXT,
        cnpj_cliente TEXT,
        combustivel TEXT,
        preco_tabela REAL DEFAULT 0,
        preco_bomba_referencia REAL DEFAULT 0,
        tipo_transacao TEXT DEFAULT 'COMPRA',
        status_transacao TEXT DEFAULT 'APROVADA',
        servico TEXT DEFAULT 'ABASTECIMENTO',
        mensagem TEXT DEFAULT '',
        id_transacao_estornada TEXT DEFAULT '',
        hodometro_anterior REAL DEFAULT 0,
        hodometro_atual REAL DEFAULT 0,
        km_rodado REAL DEFAULT 0,
        km_por_litro REAL DEFAULT 0,
        unidade_medida TEXT DEFAULT 'km',
        cartao TEXT DEFAULT '',
        equipamento TEXT DEFAULT '',
        operador TEXT DEFAULT '',
        data_registro TEXT DEFAULT '',
        delay_minutos INTEGER DEFAULT 0,
        rede_posto TEXT DEFAULT '',
        subtipo_combustivel TEXT DEFAULT '',
        coord_posto TEXT DEFAULT '',
        coord_veiculo TEXT DEFAULT '',
        modelo_nfe TEXT DEFAULT '',
        numero_nfe TEXT DEFAULT '',
        chave_valida INTEGER DEFAULT 0,
        payload_json TEXT DEFAULT ''
    )`;

    await dbRun(`CREATE TABLE IF NOT EXISTS analise_transacoes ${schemaTransacoes}`);
    await dbRun(`CREATE TABLE IF NOT EXISTS auditoria_transacoes ${schemaTransacoes}`);

    const novasColunas = [
        { nome: 'preco_bomba_referencia', def: "REAL DEFAULT 0" },
        { nome: 'tipo_transacao', def: "TEXT DEFAULT 'COMPRA'" },
        { nome: 'status_transacao', def: "TEXT DEFAULT 'APROVADA'" },
        { nome: 'servico', def: "TEXT DEFAULT 'ABASTECIMENTO'" },
        { nome: 'mensagem', def: "TEXT DEFAULT ''" },
        { nome: 'id_transacao_estornada', def: "TEXT DEFAULT ''" },
        { nome: 'hodometro_anterior', def: "REAL DEFAULT 0" },
        { nome: 'hodometro_atual', def: "REAL DEFAULT 0" },
        { nome: 'km_rodado', def: "REAL DEFAULT 0" },
        { nome: 'km_por_litro', def: "REAL DEFAULT 0" },
        { nome: 'unidade_medida', def: "TEXT DEFAULT 'km'" },
        { nome: 'cartao', def: "TEXT DEFAULT ''" },
        { nome: 'equipamento', def: "TEXT DEFAULT ''" },
        { nome: 'operador', def: "TEXT DEFAULT ''" },
        { nome: 'data_registro', def: "TEXT DEFAULT ''" },
        { nome: 'delay_minutos', def: "INTEGER DEFAULT 0" },
        { nome: 'rede_posto', def: "TEXT DEFAULT ''" },
        { nome: 'subtipo_combustivel', def: "TEXT DEFAULT ''" },
        { nome: 'coord_posto', def: "TEXT DEFAULT ''" },
        { nome: 'coord_veiculo', def: "TEXT DEFAULT ''" },
        { nome: 'modelo_nfe', def: "TEXT DEFAULT ''" },
        { nome: 'numero_nfe', def: "TEXT DEFAULT ''" },
        { nome: 'chave_valida', def: "INTEGER DEFAULT 0" },
        { nome: 'payload_json', def: "TEXT DEFAULT ''" }
    ];

    for (const tabela of ['analise_transacoes', 'auditoria_transacoes']) {
        const info = await dbAll(`PRAGMA table_info(${tabela})`);
        const existentes = new Set(info.map(c => c.name));
        for (const col of novasColunas) {
            if (!existentes.has(col.nome)) {
                await dbRun(`ALTER TABLE ${tabela} ADD COLUMN ${col.nome} ${col.def}`).catch(() => {});
            }
        }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS precos_negociados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        escopo TEXT DEFAULT 'POSTO',
        estabelecimento TEXT,
        cnpj_posto TEXT DEFAULT '',
        rede_posto TEXT DEFAULT '',
        uf TEXT DEFAULT '',
        combustivel TEXT,
        data_vigencia TEXT,
        data_fim TEXT DEFAULT '2099-12-31',
        preco_bomba REAL DEFAULT 0,
        preco REAL,
        observacao TEXT DEFAULT '',
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(escopo, estabelecimento, combustivel, data_vigencia)
    )`);

    const infoPrecos = await dbAll(`PRAGMA table_info(precos_negociados)`);
    const colsPreco = new Set(infoPrecos.map(c => c.name));
    if (!colsPreco.has('escopo')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN escopo TEXT DEFAULT 'POSTO'`).catch(() => {});
    if (!colsPreco.has('cnpj_posto')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN cnpj_posto TEXT DEFAULT ''`).catch(() => {});
    if (!colsPreco.has('rede_posto')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN rede_posto TEXT DEFAULT ''`).catch(() => {});
    if (!colsPreco.has('uf')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN uf TEXT DEFAULT ''`).catch(() => {});
    if (!colsPreco.has('data_fim')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN data_fim TEXT DEFAULT '2099-12-31'`).catch(() => {});
    if (!colsPreco.has('preco_bomba')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN preco_bomba REAL DEFAULT 0`).catch(() => {});
    if (!colsPreco.has('observacao')) await dbRun(`ALTER TABLE precos_negociados ADD COLUMN observacao TEXT DEFAULT ''`).catch(() => {});

    await dbRun(`CREATE TABLE IF NOT EXISTS configuracoes_sistema (
        chave TEXT PRIMARY KEY,
        valor_json TEXT,
        atualizado_em TEXT
    )`);

    const cfgExistente = await dbGet(`SELECT valor_json FROM configuracoes_sistema WHERE chave = 'global'`);
    if (!cfgExistente) {
        await dbRun(
            `INSERT INTO configuracoes_sistema (chave, valor_json, atualizado_em) VALUES ('global', ?, ?)`,
            [JSON.stringify(CONFIG_PADRAO_SISTEMA), getDataHoraBrasilStr()]
        );
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS usuarios_sistema (
        username TEXT PRIMARY KEY,
        password_hash TEXT,
        is_admin INTEGER DEFAULT 0,
        perms_json TEXT,
        layout_json TEXT DEFAULT '{}',
        criado_em TEXT
    )`);

    const masterExistente = await dbGet(`SELECT username FROM usuarios_sistema WHERE username = 'pedro.cavalheirolog'`);
    if (!masterExistente) {
        const defaultPerms = { overview: true, temporal: true, abc: true, frota: true, precos: true, heatmap: true, integration: true };
        await dbRun(
            `INSERT INTO usuarios_sistema (username, password_hash, is_admin, perms_json, layout_json, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
            ['pedro.cavalheirolog', hashSHA256('Log2026@'), 1, JSON.stringify(defaultPerms), JSON.stringify(CONFIG_PADRAO_SISTEMA), getDataHoraBrasilStr()]
        );
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS frota_parametros (
        placa TEXT PRIMARY KEY,
        modelo_veiculo TEXT DEFAULT '',
        capacidade_tanque REAL DEFAULT 1000,
        meta_km_l REAL DEFAULT 2.65,
        intervalo_preventiva_km REAL DEFAULT 25000,
        ultimo_hodometro_preventiva REAL DEFAULT 0,
        observacao TEXT DEFAULT ''
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_hora TEXT,
        origem TEXT,
        periodo TEXT,
        inseridos_analise INTEGER DEFAULT 0,
        inseridos_auditoria INTEGER DEFAULT 0,
        estornos_filtrados INTEGER DEFAULT 0,
        status TEXT,
        detalhe TEXT
    )`);

    await dbRun(`CREATE INDEX IF NOT EXISTS idx_analise_data ON analise_transacoes(SUBSTR(data, 1, 10));`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_analise_placa ON analise_transacoes(placa);`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_analise_rede ON analise_transacoes(rede_posto);`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria_transacoes(SUBSTR(data, 1, 10));`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_auditoria_nfe ON auditoria_transacoes(status_nfe);`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_auditoria_tipo ON auditoria_transacoes(tipo_transacao, status_transacao);`);

    await conciliarCSVsLocaisAutomaticamente();
    await sanearBaseExistente();
    await aplicarPrecosNegociadosNoBanco();
}

const PORT = process.env.PORT || 3000;
inicializarBanco().then(() => {
    iniciarCronJobs();
    app.listen(PORT, () => {
        console.log(`\n======================================================================`);
        console.log(`🚀 CAVALHEIRO LOGISTICS API v4.0 MODULAR (PORTA ${PORT})`);
        console.log(`✅ CONCILIAÇÃO TRIPLA & ARQUITETURA MODULAR LOCAL`);
        console.log(`======================================================================\n`);
    });
});

process.on('SIGINT', () => {
    db.close(() => process.exit(0));
});