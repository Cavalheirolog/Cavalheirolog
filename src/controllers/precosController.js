const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '../../banco_cavalheiro.sqlite');

exports.listarPrecosNegociados = (req, res) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.all(`SELECT * FROM precos_negociados ORDER BY data_vigencia DESC, estabelecimento ASC`, [], (err, rows) => {
        db.close();
        if (err) return res.status(500).json({ error: "Erro ao listar preços negociados." });
        res.json({ ok: true, precos: rows });
    });
};

exports.salvarPrecoNegociado = (req, res) => {
    const precos = req.body.precos || [req.body];
    const db = new sqlite3.Database(dbPath);
    
    let inseridos = 0;
    db.serialize(() => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO precos_negociados 
            (escopo, estabelecimento, rede_posto, uf, combustivel, data_vigencia, data_fim, preco_bomba, preco)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        precos.forEach(p => {
            const escopo = p.escopo || 'POSTO';
            const bomba = parseFloat(p.preco_bomba) > 0 ? parseFloat(p.preco_bomba) : parseFloat(p.preco);
            stmt.run([
                escopo, p.estabelecimento, p.rede_posto || '', p.uf || '', 
                p.combustivel, p.data_vigencia, p.data_fim || '2099-12-31', bomba, p.preco
            ]);
            inseridos++;
        });
        stmt.finalize();
    });
    
    db.close();
    res.json({ ok: true, inseridos, message: "Acordos salvos e consolidados com sucesso!" });
};

exports.excluirPrecoNegociado = (req, res) => {
    const id = req.params.id;
    const db = new sqlite3.Database(dbPath);
    db.run(`DELETE FROM precos_negociados WHERE id = ?`, [id], function(err) {
        db.close();
        if (err) return res.status(500).json({ error: "Erro ao excluir acordo." });
        res.json({ ok: true, message: "Acordo removido." });
    });
};

exports.conciliarPrecosLote = (req, res) => {
    const itens = req.body.itens || [];
    if (itens.length === 0) return res.json({ ok: true, message: "Nenhum preço para conciliar." });

    const db = new sqlite3.Database(dbPath);
    let atualizados = 0;
    
    db.serialize(() => {
        const stmt = db.prepare(`
            UPDATE analise_transacoes 
            SET preco_bomba_referencia = ?, preco_tabela = ? 
            WHERE id = ?
        `);
        itens.forEach(item => {
            if (item.pBomba > 0 || item.pNegoc > 0) {
                stmt.run([item.pBomba, item.pNegoc, item.id]);
                atualizados++;
            }
        });
        stmt.finalize();
    });
    
    db.close();
    res.json({ ok: true, atualizados });
};

exports.relatorioImpactoPrecos = (req, res) => {
    // A matriz financeira completa é exportada via Frontend (CSV)
    res.json({ ok: true });
};