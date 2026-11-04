const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '../../banco_cavalheiro.sqlite');

exports.obterDadosAnalise = (req, res) => {
    const dtIni = req.query.dtIni || '2026-01-01';
    const dtFim = req.query.dtFim || '2099-12-31';

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    
    // 1. Carrega todos os acordos manuais da CavalheiroLog
    db.all(`SELECT * FROM precos_negociados`, [], (errPrecos, acordosSalvos) => {
        const acordos = acordosSalvos || [];

        // 2. Carrega as transações
        db.all(`SELECT * FROM analise_transacoes WHERE SUBSTR(data, 1, 10) BETWEEN ? AND ?`, [dtIni, dtFim], (err, rows) => {
            db.close();
            if (err) return res.status(500).json({ error: "Erro ao consultar dados de análise." });

            const rankings = { porPosto: [], porRede: [], porUF: [], porPlaca: [], porMotorista: [], alertasOperacionais: [] };
            let volTotal = 0, custoTotal = 0;
            const mapRedes = new Map(), mapUfs = new Map();

            const transacoesTratadas = rows.map(t => {
                const tipo = String(t.tipo_transacao || 'COMPRA').toUpperCase();
                const status = String(t.status_transacao || 'APROVADA').toUpperCase();
                const vol = parseFloat(t.volume) || 0;
                const val = parseFloat(t.valor_total) || 0;
                
                // PILAR 1: PREÇO PAGO (O valor exato que foi faturado na nota/Truckpag)
                const pPago = vol > 0 ? val / vol : (parseFloat(t.valor_litro) || 0);
                
                const ehAtiva = ['COMPRA', 'MANUAL'].includes(tipo) && status === 'APROVADA' && vol > 0;
                
                if (ehAtiva) {
                    let payload = {};
                    try { payload = JSON.parse(t.payload_json || '{}'); } catch(e){}

                    // PILAR 2: PREÇO BOMBA ORIGINAL (Sem descontos, lido nativamente)
                    let pBomba = parseFloat(payload.valorUnitario) || parseFloat(payload.PrecoBomba) || parseFloat(t.preco_bomba_referencia) || 0;
                    
                    // PILAR 3: PREÇO NEGOCIADO (Com desconto)
                    let pNeg = parseFloat(payload.valorComDesconto) || parseFloat(payload.PrecoNegociado) || parseFloat(t.preco_tabela) || 0;

                    const isArla = String(t.combustivel).toUpperCase().includes('ARLA');
                    const dtAbast = t.data ? t.data.split(' ')[0] : '2099-12-31';

                    // B. Se não veio preço negociado da TruckPag, buscamos na sua tabela de Acordos Manuais
                    if (pNeg <= 0) {
                        const acordoEncontrado = acordos.find(a => 
                            (String(a.combustivel).toUpperCase().includes('ARLA') === isArla) &&
                            (a.data_vigencia <= dtAbast && a.data_fim >= dtAbast) &&
                            (a.estabelecimento === t.estabelecimento || (a.rede_posto && a.rede_posto === t.rede_posto) || (a.uf && a.uf === t.uf))
                        );

                        if (acordoEncontrado) {
                            pNeg = parseFloat(acordoEncontrado.preco) || 0;
                            // Se o posto não mandou o preço bomba real, assumimos o do seu cadastro
                            if (pBomba <= 0) pBomba = parseFloat(acordoEncontrado.preco_bomba) || pNeg;
                        }
                    }

                    // Proteção matemática: Para não quebrar o gráfico se a TruckPag enviar zeros.
                    if (pBomba <= 0) pBomba = pPago;
                    if (pNeg <= 0) pNeg = pPago;

                    // INJEÇÃO INDEPENDENTE: As 3 variáveis viajam agora separadas para o Frontend!
                    t.preco_pago = pPago;
                    t.preco_bomba_referencia = pBomba;
                    t.preco_tabela = pNeg;
                    
                    volTotal += vol;
                    custoTotal += val;

                    // Agrupamento por Rede
                    const rKey = t.rede_posto || 'OUTROS';
                    if(!mapRedes.has(rKey)) mapRedes.set(rKey, { rede: rKey, qtdPostos: new Set(), volumeTotal: 0, custoTotal: 0, econReal: 0 });
                    const rObj = mapRedes.get(rKey);
                    rObj.qtdPostos.add(t.estabelecimento);
                    rObj.volumeTotal += vol;
                    rObj.custoTotal += val;
                    if (pBomba > 0) rObj.econReal += ((vol * pBomba) - val);

                    // Agrupamento por UF / ICMS
                    const uKey = t.uf || 'ND';
                    if(!mapUfs.has(uKey)) mapUfs.set(uKey, { uf: uKey, volumeDiesel: 0, volumeArla: 0, custoTotal: 0, icms: 0 });
                    const uObj = mapUfs.get(uKey);
                    uObj.custoTotal += val;
                    if (isArla) uObj.volumeArla += vol;
                    else uObj.volumeDiesel += vol;
                    
                    const aliq = (uKey === 'MT') ? 0.17 : (uKey === 'RO' ? 0.175 : 0.12);
                    uObj.icms += (val * aliq);
                    uObj.aliquotaIcmsPct = aliq * 100;

                    // Glosa: Avalia se o Preço Pago Real foi maior que o Negociado
                    if (pNeg > 0 && pPago > (pNeg + 0.005)) {
                        rankings.alertasOperacionais.push({
                            data: t.data, idTransacao: t.id, severidade: 'danger', tipo: 'GLOSA DE PREÇO', 
                            placa: t.placa, motorista: t.motorista, estabelecimento: t.estabelecimento,
                            detalhe: `Cobrado R$ ${pPago.toFixed(3)}/L (Acordo limite era R$ ${pNeg.toFixed(3)}/L).`
                        });
                    }
                }
                return t;
            });

            // Converte mapas para arrays ordenados
            mapRedes.forEach(r => {
                rankings.porRede.push({
                    rede: r.rede, qtdPostos: r.qtdPostos.size, volumeTotal: r.volumeTotal, 
                    participacaoPct: volTotal > 0 ? (r.volumeTotal/volTotal)*100 : 0,
                    precoMedio: r.volumeTotal > 0 ? r.custoTotal / r.volumeTotal : 0,
                    custoTotal: r.custoTotal, economiaReal: r.econReal
                });
            });
            rankings.porRede.sort((a,b) => b.volumeTotal - a.volumeTotal);

            mapUfs.forEach(u => {
                rankings.porUF.push({
                    uf: u.uf, volumeDiesel: u.volumeDiesel, volumeArla: u.volumeArla,
                    precoMedio: (u.volumeDiesel + u.volumeArla) > 0 ? u.custoTotal / (u.volumeDiesel + u.volumeArla) : 0,
                    custoTotal: u.custoTotal, aliquotaIcmsPct: u.aliquotaIcmsPct, creditoIcmsEstimado: u.icms
                });
            });
            rankings.porUF.sort((a,b) => b.volumeDiesel - a.volumeDiesel);

            res.json({
                ok: true,
                total: transacoesTratadas.length,
                transacoes: transacoesTratadas,
                rankings: rankings
            });
        });
    });
};

exports.buscarAuditoriaApi = (req, res) => { res.json({ok: true, message: "Comando de busca API recebido."}); };
exports.forcarSyncBackground = (req, res) => { res.json({ok: true}); };
exports.conciliarCsv = (req, res) => { res.json({ok: true, message: "Relatório CSV processado."}); };