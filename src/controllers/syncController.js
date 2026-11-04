const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '../../banco_cavalheiro.sqlite');

// ==========================================
// CONFIGURAÇÕES DA API TRUCKPAG
// ==========================================
const API_BASE_URL = 'https://api.hml.truckpag.com.br'; // URL de Homologação
const API_TOKEN = process.env.TRUCKPAG_TOKEN || 'COLE_SEU_TOKEN_AQUI'; // Substitua pelo Token real depois

const headersPadrao = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_TOKEN}`
};

// ==========================================
// 1. SINCRONIZAR FROTA (VEÍCULOS E TANQUES)
// ==========================================
exports.sincronizarVeiculos = async (req, res) => {
    try {
        // Exemplo de Endpoint (ajustar conforme a documentação exata da TruckPag)
        const response = await fetch(`${API_BASE_URL}/api/integrador/veiculos`, { headers: headersPadrao });
        
        if (!response.ok) {
            return res.status(response.status).json({ error: "Falha ao conectar à API da TruckPag (Veículos)." });
        }

        const dados = await response.json();
        const veiculos = dados.data || [];

        const db = new sqlite3.Database(dbPath);
        let inseridos = 0;

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT OR IGNORE INTO frota_parametros (placa, modelo_veiculo, capacidade_tanque, meta_km_l)
                VALUES (?, ?, ?, ?)
            `);
            
            veiculos.forEach(v => {
                // Se a API não fornecer a meta_km_l ou tanque, assumimos os padrões da CavalheiroLog (2.65 Km/L e 1000L)
                const tanque = v.capacidadeTanque || 1000;
                const metaKml = v.metaConsumo || 2.65;
                stmt.run([v.placa, v.modelo || 'NÃO INFORMADO', tanque, metaKml]);
                inseridos++;
            });
            stmt.finalize();
        });

        db.close();
        res.json({ ok: true, inseridos, message: `${inseridos} veículos sincronizados com sucesso!` });

    } catch (error) {
        console.error("Erro no Sync de Veículos:", error);
        res.status(500).json({ error: "Erro interno ao sincronizar veículos." });
    }
};

// ==========================================
// 2. SINCRONIZAR ABASTECIMENTOS E NFe (XML)
// ==========================================
exports.sincronizarAbastecimentosApi = async (req, res) => {
    const { dtIni, dtFim } = req.body; // Formato esperado: YYYY-MM-DD

    if (!dtIni || !dtFim) {
        return res.status(400).json({ error: "Data inicial e final são obrigatórias." });
    }

    try {
        // Exemplo de Endpoint (ajustar os parâmetros conforme a doc da TruckPag)
        const url = `${API_BASE_URL}/api/integrador/abastecimentos?dataInicial=${dtIni}&dataFinal=${dtFim}`;
        const response = await fetch(url, { headers: headersPadrao });

        if (!response.ok) {
            return res.status(response.status).json({ error: "Falha ao conectar à API da TruckPag (Abastecimentos)." });
        }

        const dados = await response.json();
        const transacoes = dados.data || [];

        const db = new sqlite3.Database(dbPath);
        let atualizados = 0;

        db.serialize(() => {
            // Vamos inserir na tabela de auditoria bruta
            const stmt = db.prepare(`
                INSERT OR IGNORE INTO auditoria_transacoes 
                (id, data, estabelecimento, rede_posto, uf, cidade, placa, motorista, volume, valor_total, valor_litro, 
                 combustivel, chave_nfe, status_nfe, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            transacoes.forEach(t => {
                const idTransacao = t.id || t.transacaoId;
                const dataStr = t.dataTransacao || t.data;
                const chaveNfe = t.chaveNfe || t.NFe || '';
                const statusNfe = chaveNfe.length === 44 ? 'Vinculada' : 'Pendente';
                
                // Guardamos o JSON completo nativo da TruckPag na coluna payload_json para o nosso Módulo de Preços ler
                const payloadStr = JSON.stringify(t);

                stmt.run([
                    idTransacao, dataStr, t.nomePosto, t.redePosto || '', t.ufPosto, t.cidadePosto, 
                    t.placa, t.motorista, t.litragem, t.valorTotal, (t.valorTotal / t.litragem),
                    t.combustivel, chaveNfe, statusNfe, payloadStr
                ]);
                atualizados++;
            });
            stmt.finalize();
        });

        db.close();
        res.json({ ok: true, atualizados, message: `Sincronização concluída: ${atualizados} transações importadas via API.` });

    } catch (error) {
        console.error("Erro no Sync de Abastecimentos:", error);
        res.status(500).json({ error: "Erro interno ao buscar transações na API." });
    }
};