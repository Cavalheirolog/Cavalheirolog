require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ============================================================================
// SCRIPT CLI DE IMPORTAÇÃO EM LOTE DE CSVs HISTÓRICOS (TRUCKPAG)
// ============================================================================

const dbPath = path.join(__dirname, '../banco_cavalheiro.sqlite');
const pastaCsv = path.join(__dirname, '../csv_historico');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ Erro ao ligar ao SQLite:", err.message);
        process.exit(1);
    }
});

const parseTruckPagNum = (valStr) => {
    if (!valStr) return 0;
    let str = String(valStr).replace(/"/g, '').replace('R$', '').trim();
    if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }
    return parseFloat(str) || 0;
};

function classificarTipoBomba(estabelecimento, tipoOriginal) {
    const t = String(tipoOriginal || '').toUpperCase().trim();
    const e = String(estabelecimento || '').toUpperCase().trim();
    if (t === 'INTERNO' || t.includes('BOMBA INTERNA') || t.includes('ABASTECIMENTO INTERNO')) return 'Interno';
    if (t === 'EXTERNO' || t.includes('POSTO EXTERNO') || t.includes('REDE CREDENCIADA')) return 'Externo';
    if (e.includes('BOMBA INTERNA') || e.includes('GARAGEM') || e.includes('COMBOIO') || /\bINTERNA\b/.test(e)) {
        return 'Interno';
    }
    return 'Externo';
}

function extrairRedePosto(estabelecimento) {
    const e = String(estabelecimento || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!e) return 'OUTROS';
    if (e.includes('REDE 7') || e.includes('POSTO 7')) return 'REDE 7';
    if (e.includes('MIRIAN') || e.includes('MIRIAM')) return 'REDE MIRIAN';
    if (e.includes('DOM PEDRO') || e.startsWith('DP ')) return 'REDE DOM PEDRO';
    if (e.includes('MARAJO')) return 'REDE MARAJÓ';
    if (e.includes('DECIO')) return 'REDE DÉCIO';
    if (e.includes('ALDO')) return 'REDE ALDO';
    if (e.includes('PLATINAO')) return 'REDE PLATINÃO';
    if (e.includes('SAO GONCALO')) return 'REDE SÃO GONÇALO';
    if (e.includes('BUFFON')) return 'REDE BUFFON';
    if (e.includes('GRAAL')) return 'REDE GRAAL';
    if (e.includes('POSTO 44')) return 'REDE POSTO 44';
    if (e.includes('MONTE CARLO')) return 'REDE MONTE CARLO';
    if (e.includes('D ANGELIS')) return 'REDE D ANGELIS';
    if (e.includes('REFORCO')) return 'REDE REFORÇO';
    if (e.includes('TREVO')) return 'REDE TREVO';
    const matchRede = e.match(/REDE\s+([A-Z0-9\s]{2,20})/);
    if (matchRede) return `REDE ${matchRede[1].split('|')[0].split('-')[0].trim()}`;
    return 'INDEPENDENTE / OUTROS';
}

function classificarSubtipoCombustivel(combustivel) {
    const c = String(combustivel || '').toUpperCase().trim();
    if (c.includes('ARLA')) return 'Arla 32';
    if (c.includes('S500') || c.includes('COMUM')) return 'Diesel S500';
    if (c.includes('ADITIVADO')) return 'Diesel S10 Aditivado';
    return 'Diesel S10';
}

function extrairUfDoNomePosto(estab, ufAtual) {
    const u = String(ufAtual || '').toUpperCase().trim();
    if (u && u !== 'ND' && u.length === 2) return u;
    const m = String(estab || '').match(/\|\s*([A-Z]{2})\s*-/i) || String(estab || '').match(/-\s*([A-Z]{2})\s*-/i);
    if (m) return m[1].toUpperCase();
    const upper = String(estab || '').toUpperCase();
    if (upper.includes('VARZEA GRANDE') || upper.includes('CUIABA') || upper.includes('RONDONOPOLIS') || upper.includes('SINOP') || upper.includes('MATUPA')) return 'MT';
    if (upper.includes('VILHENA') || upper.includes('PORTO VELHO') || upper.includes('CANDEIAS DO JAMARI')) return 'RO';
    if (upper.includes('MIRITITUBA') || upper.includes('ITAITUBA') || upper.includes('BELEM') || upper.includes('SANTANA DO ARAGUAIA')) return 'PA';
    if (upper.includes('ARARAS') || upper.includes('FERNANDOPOLIS') || upper.includes('CUBATAO') || upper.includes('RUBINEIA')) return 'SP';
    if (upper.includes('PARANAGUA')) return 'PR';
    if (upper.includes('BARREIRAS') || upper.includes('SANTO ESTEVAO')) return 'BA';
    if (upper.includes('ARAPORA') || upper.includes('CAETANOPOLIS') || upper.includes('FRUTAL')) return 'MG';
    if (upper.includes('CENTRALINA') || upper.includes('HIDROLANDIA') || upper.includes('GOIANIA')) return 'GO';
    return 'ND';
}

function extrairIdsEstornadosDaMensagem(idTransacaoAtual, mensagem) {
    const idAtualStr = String(idTransacaoAtual || '').trim();
    const msg = String(mensagem || '');
    const ids = new Set();
    const regex = /transa[cç][aã]o\s*(\d{5,15})/gi;
    let match;
    while ((match = regex.exec(msg)) !== null) {
        const idEncontrado = match[1].trim();
        if (idEncontrado && idEncontrado !== idAtualStr) ids.add(idEncontrado);
    }
    return Array.from(ids);
}

function calcularMetricasHodometro(hodAnt, hodAtual, volume, combustivel) {
    const ant = parseTruckPagNum(hodAnt);
    const atu = parseTruckPagNum(hodAtual);
    const vol = parseTruckPagNum(volume);
    const isArla = String(combustivel || '').toUpperCase().includes('ARLA');
    if (isArla || ant <= 0 || atu <= 0 || atu <= ant || vol <= 0) {
        return { hodAnt: ant, hodAtu: atu, kmRodado: 0, kmPorLitro: 0 };
    }
    const diffKm = Number((atu - ant).toFixed(1));
    const media = Number((diffKm / vol).toFixed(2));
    if (diffKm > 3500 || media < 0.8 || media > 7.5) {
        return { hodAnt: ant, hodAtu: atu, kmRodado: 0, kmPorLitro: 0 };
    }
    return { hodAnt: ant, hodAtu: atu, kmRodado: diffKm, kmPorLitro: media };
}

function processarCSVs() {
    const pastasBusca = [pastaCsv, path.join(__dirname, '../')];
    let arqPrecos = [];
    let arqAbast = [];

    pastasBusca.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        const arquivos = fs.readdirSync(dir);
        arquivos.forEach(f => {
            const lower = f.toLowerCase();
            const fullPath = path.join(dir, f);
            if (lower.includes('historico-precos') && lower.endsWith('.csv')) {
                arqPrecos.push(fullPath);
            } else if ((lower.includes('listagem-abastecimentos') || lower.includes('analitico-transacoes')) && lower.endsWith('.csv')) {
                arqAbast.push(fullPath);
            }
        });
    });

    if (arqAbast.length === 0 && arqPrecos.length === 0) {
        console.log("⚠️ Nenhum ficheiro CSV compatível encontrado.");
        process.exit(0);
    }

    let precos = [];
    arqPrecos.forEach(caminhoArq => {
        console.log(`📊 A indexar Tabela de Preços: ${path.basename(caminhoArq)}`);
        const conteudo = fs.readFileSync(caminhoArq, 'latin1');
        const linhas = conteudo.split(/\r?\n/);

        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].trim().split(';');
            if (cols.length < 8) continue;

            const estab = cols[1]?.replace(/"/g, '').trim();
            const dtBr = cols[4]?.replace(/"/g, '').trim();
            const comb = cols[6]?.replace(/"/g, '').trim();
            const pr = parseTruckPagNum(cols[7]);

            if (!estab || !dtBr || pr <= 0) continue;

            const dParts = dtBr.split('/');
            if (dParts.length === 3) {
                const dtIso = `${dParts[2]}-${dParts[1].padStart(2, '0')}-${dParts[0].padStart(2, '0')}`;
                precos.push({ estab, comb, dtIso, pr });
            }
        }
    });

    precos.sort((a, b) => b.dtIso.localeCompare(a.dtIso));
    console.log(`✔️ ${precos.length} preços negociados carregados na memória.`);

    const registrosLidos = [];
    const idsOriginaisEstornados = new Set();

    arqAbast.forEach(caminhoArq => {
        console.log(`🚚 A ler Abastecimentos: ${path.basename(caminhoArq)}`);
        const conteudo = fs.readFileSync(caminhoArq, 'latin1');
        const linhas = conteudo.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (linhas.length < 2) return;

        const cabecalho = linhas[0].toLowerCase();
        const isAnalitico = cabecalho.includes('data de registro') && cabecalho.includes('mensagem');

        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].trim().split(';').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < 20) continue;

            if (isAnalitico) {
                const id = cols[0];
                const dtBr = cols[1];
                const hr = cols[2] || '00:00:00';
                const dtRegBr = cols[3] || dtBr;
                const hrReg = cols[4] || hr;
                const estab = cols[6];
                const coordPosto = cols[7] || '';
                const cnpjP = cols[8] || '';
                const cartao = cols[9] || '';
                const placa = cols[10] || '';
                const coordVeic = cols[11] || '';
                const mot = cols[12] || '';
                const hodAnt = cols[14];
                const hodAtu = cols[15];
                const um = cols[16] || 'km';
                const vol = parseTruckPagNum(cols[17]);
                const comb = cols[18] || 'Diesel S10';
                const val = parseTruckPagNum(cols[20]);
                const equip = cols[21] || '';
                const oper = cols[22] || '';
                const tipoTr = (cols[26] || 'COMPRA').toUpperCase();
                const statusTr = (cols[27] || 'APROVADA').toUpperCase();
                const msg = cols[28] || '';

                if (!id || vol <= 0) continue;
                const p = dtBr.split('/');
                const apenasData = p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : dtBr;
                const dataIso = `${apenasData} ${hr.length === 5 ? hr + ':00' : hr}`;
                const pReg = dtRegBr.split('/');
                const apenasDataReg = pReg.length === 3 ? `${pReg[2]}-${pReg[1].padStart(2, '0')}-${pReg[0].padStart(2, '0')}` : apenasData;
                const dataRegIso = `${apenasDataReg} ${hrReg.length === 5 ? hrReg + ':00' : hrReg}`;

                const idsVinculados = extrairIdsEstornadosDaMensagem(id, msg);
                if (tipoTr.includes('ESTORNO') || statusTr !== 'APROVADA' || idsVinculados.length > 0) {
                    idsOriginaisEstornados.add(id);
                    idsVinculados.forEach(x => idsOriginaisEstornados.add(x));
                }

                const metHod = calcularMetricasHodometro(hodAnt, hodAtu, vol, comb);

                registrosLidos.push({
                    id, dataIso, apenasData, dataRegIso, estab, cid: 'ND', uf: extrairUfDoNomePosto(estab, 'ND'),
                    tipoBomba: classificarTipoBomba(estab, ''),
                    redePosto: extrairRedePosto(estab),
                    placa, mot, vol, val, comb, subtipoComb: classificarSubtipoCombustivel(comb),
                    cnpjP, cartao, equip, oper, coordPosto, coordVeic, um,
                    ...metHod,
                    tipoTransacao: tipoTr.includes('ESTORNO') ? 'ESTORNO' : 'COMPRA',
                    statusTransacao: statusTr,
                    mensagem: msg,
                    idEstornada: idsVinculados[0] || ''
                });
            }
        }
    });

    let qtdAnalise = 0;
    let qtdAuditoria = 0;

    db.serialize(() => {
        db.run(`PRAGMA journal_mode = WAL;`);
        db.run("BEGIN TRANSACTION");

        if (precos.length > 0) {
            const stmtPreco = db.prepare(`INSERT OR REPLACE INTO precos_negociados (escopo, estabelecimento, cnpj_posto, rede_posto, uf, combustivel, data_vigencia, data_fim, preco) VALUES ('POSTO', ?, '', '', '', ?, ?, '2099-12-31', ?)`);
            precos.forEach(p => stmtPreco.run(p.estab, p.comb, p.dtIso, p.pr));
            stmtPreco.finalize();
        }

        const sqlInsert = (tabela) => `INSERT OR REPLACE INTO ${tabela} (
            id, data, estabelecimento, cidade, uf, tipoAbastecimento, placa, motorista,
            volume, valor_total, valor_litro, status_nfe, chave_nfe, cnpj_posto, cnpj_cliente,
            combustivel, preco_tabela, tipo_transacao, status_transacao, mensagem, id_transacao_estornada,
            hodometro_anterior, hodometro_atual, km_rodado, km_por_litro, unidade_medida,
            cartao, equipamento, operador, data_registro, delay_minutos, rede_posto, subtipo_combustivel,
            coord_posto, coord_veiculo
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
            COALESCE((SELECT status_nfe FROM ${tabela} WHERE id = ?), 'Pendente'), 
            COALESCE((SELECT chave_nfe FROM ${tabela} WHERE id = ?), ''), 
            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT cnpj_posto FROM ${tabela} WHERE id = ?), '') END, 
            COALESCE((SELECT cnpj_cliente FROM ${tabela} WHERE id = ?), ''), 
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 0, ?, ?, ?, ?
        )`;

        const stmtAnalise = db.prepare(sqlInsert('analise_transacoes'));
        const stmtAuditoria = db.prepare(sqlInsert('auditoria_transacoes'));

        registrosLidos.forEach(r => {
            const vLitro = r.vol > 0 ? r.val / r.vol : 0;
            let precoCruzado = 0;
            const pEnc = precos.find(p =>
                p.estab.toUpperCase() === r.estab.toUpperCase() &&
                p.comb.toUpperCase() === r.comb.toUpperCase() &&
                p.dtIso <= r.apenasData
            );
            if (pEnc) precoCruzado = pEnc.pr;

            const statusFinal = (r.tipoTransacao === 'COMPRA' && idsOriginaisEstornados.has(r.id)) ? 'ESTORNADA' : r.statusTransacao;

            const params = [
                r.id, r.dataIso, r.estab, r.cid, r.uf, r.tipoBomba, r.placa, r.mot,
                r.vol, r.val, vLitro,
                r.id, r.id,
                r.cnpjP, r.cnpjP, r.id,
                r.id,
                r.comb, precoCruzado, r.tipoTransacao, statusFinal, r.mensagem, r.idEstornada,
                r.hodAnt, r.hodAtu, r.kmRodado, r.kmPorLitro, r.um,
                r.cartao, r.equip, r.oper, r.dataRegIso, r.redePosto, r.subtipoComb,
                r.coordPosto, r.coordVeic
            ];

            stmtAuditoria.run(params);
            qtdAuditoria++;

            if (r.tipoTransacao === 'COMPRA' && statusFinal === 'APROVADA' && !idsOriginaisEstornados.has(r.id)) {
                stmtAnalise.run(params);
                qtdAnalise++;
            }
        });

        stmtAnalise.finalize();
        stmtAuditoria.finalize();

        idsOriginaisEstornados.forEach(idEst => {
            db.run(`DELETE FROM analise_transacoes WHERE id = ?`, [idEst]);
            db.run(`UPDATE auditoria_transacoes SET status_transacao = 'ESTORNADA' WHERE id = ? AND tipo_transacao = 'COMPRA'`, [idEst]);
        });

        db.run("COMMIT", () => {
            console.log(`\n✅ IMPORTAÇÃO E CONCILIAÇÃO CONCLUÍDAS!`);
            console.log(`📊 Análise (Compras Líquidas Válidas): ${qtdAnalise} registos`);
            console.log(`🔍 Auditoria (Histórico Completo): ${qtdAuditoria} registos`);
            console.log(`🗑️ Estornos removidos da Análise: ${idsOriginaisEstornados.size}\n`);
            process.exit(0);
        });
    });
}

processarCSVs();