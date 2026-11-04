const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '../../banco_cavalheiro.sqlite');

// Regra Fiscal Atualizada (ICMS) - Define o CNPJ que a Nota deve ter consoante a UF do Abastecimento
function getCNPJEstruturado(uf, cidade, posto) {
    const u = String(uf || '').toUpperCase().trim();
    const cid = String(cidade || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const p = String(posto || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Exceção PA: Apenas Postos Miriam em Itaituba e Miritituba faturam no CNPJ 0009-88
    if (u === 'PA' && (p.includes('MIRIAM') || p.includes('MIRIAN')) && (cid.includes('ITAITUBA') || cid.includes('MIRITITUBA') || p.includes('ITAITUBA') || p.includes('MIRITITUBA'))) {
        return '07.689.042/0009-88';
    }

    // Regra Padrão Filial (0004-73): SP, PR, SC, RS, MG, BA, PE, MA, SE, AL, TO, PA, MT, MS, ES, RJ, PI
    const r73 = ['SP','MG','BA','PE','MA','SE','AL','TO','PA','ES','RJ','PI'];
    if (r73.includes(u)) return '07.689.042/0004-73';

    // Regra Filial MT (0009-88): Faturamento exclusivo MT
    if (u === 'MT') return '07.689.042/0009-88';

    // Regra Matriz (0001-20): PR, SC, RS, MS e demais estados não mapeados (como RO, GO, AC)
    return '07.689.042/0001-20';
}

function formatarCNPJ(cnpj) {
    if(!cnpj) return '';
    const limpo = String(cnpj).replace(/\D/g, '');
    if(limpo.length !== 14) return cnpj;
    return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

exports.obterAuditoria = (req, res) => {
    const dtIni = req.query.dtIni || '2026-01-01';
    const dtFim = req.query.dtFim || '2099-12-31';

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) return res.status(500).json({ error: "Erro ao abrir banco de dados." });
    });

    db.all(`SELECT * FROM auditoria_transacoes WHERE SUBSTR(data, 1, 10) BETWEEN ? AND ? ORDER BY data DESC`, [dtIni, dtFim], (err, rows) => {
        db.close();
        if (err) return res.status(500).json({ error: "Erro ao consultar auditoria." });

        const rankFiscalMap = new Map();

        const transacoesTratadas = rows.map(t => {
            let payload = {};
            try { payload = JSON.parse(t.payload_json || '{}'); } catch(e){}

            // CORREÇÃO: Lê prioritariamente o campo CNPJNFe enviado pela TruckPag (CNPJ real da nota)
            const cnpj_real_nfe = formatarCNPJ(payload.CNPJNFe || t.cnpj_cliente);
            const cnpj_esperado = getCNPJEstruturado(t.uf, t.cidade, t.estabelecimento);
            
            t.cnpj_cliente = cnpj_real_nfe; // Injeta o CNPJ correto no frontend
            t.cnpj_esperado = cnpj_esperado;

            const hasNfe = t.status_nfe === 'Vinculada' && t.chave_nfe;
            const tipo = String(t.tipo_transacao || 'COMPRA').toUpperCase();
            const status = String(t.status_transacao || 'APROVADA').toUpperCase();
            const ehAtiva = ['COMPRA', 'MANUAL'].includes(tipo) && status === 'APROVADA' && Number(t.volume) > 0;

            t.credito_icms_estimado = 0;
            if (ehAtiva) {
                const aliquota = (t.uf === 'MT') ? 0.17 : ((t.uf === 'RO') ? 0.175 : 0.12);
                t.credito_icms_estimado = (t.valor_total * aliquota).toFixed(2);
            }

            if (ehAtiva) {
                if (hasNfe) {
                    t.status_cnpj = (cnpj_real_nfe === cnpj_esperado) ? 'OK' : 'DIVERGENTE';
                } else {
                    t.status_cnpj = 'AGUARDANDO_NFE';
                }

                if (t.status_cnpj !== 'OK') {
                    const k = `${t.estabelecimento}|${t.uf}`;
                    if (!rankFiscalMap.has(k)) {
                        rankFiscalMap.set(k, { posto: t.estabelecimento, uf: t.uf, totalCompras: 0, nfePendentes: 0, cnpjDivergente: 0, icmsEmRisco: 0 });
                    }
                    const m = rankFiscalMap.get(k);
                    m.totalCompras++;
                    m.icmsEmRisco += Number(t.credito_icms_estimado);
                    if (!hasNfe) m.nfePendentes++;
                    if (hasNfe && cnpj_real_nfe !== cnpj_esperado) m.cnpjDivergente++;
                }
            } else {
                t.status_cnpj = 'ISENTO_ESTORNO';
            }

            return t;
        });

        const rankingFiscal = Array.from(rankFiscalMap.values()).sort((a,b) => b.icmsEmRisco - a.icmsEmRisco);

        res.json({
            ok: true,
            total: transacoesTratadas.length,
            transacoes: transacoesTratadas,
            resumoAuditoria: { rankingInadimplenciaFiscal: rankingFiscal }
        });
    });
};

exports.relatorioGlosa = (req, res) => {
    const dtIni = req.query.dtIni || '2026-01-01';
    const dtFim = req.query.dtFim || '2099-12-31';

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.all(`SELECT * FROM auditoria_transacoes WHERE SUBSTR(data, 1, 10) BETWEEN ? AND ?`, [dtIni, dtFim], (err, rows) => {
        db.close();
        if (err) return res.status(500).json({ error: "Erro" });

        const glosas = [];
        let totalGlosa = 0;
        rows.forEach(t => {
            if (['COMPRA', 'MANUAL'].includes(t.tipo_transacao) && t.status_transacao === 'APROVADA') {
                const pNeg = parseFloat(t.preco_tabela) || 0;
                const pPago = parseFloat(t.valor_litro) || 0;
                if (pNeg > 0 && pPago > (pNeg + 0.005)) {
                    const glosaItem = (pPago - pNeg) * t.volume;
                    totalGlosa += glosaItem;
                    glosas.push({
                        id: t.id,
                        data: t.data,
                        estabelecimento: t.estabelecimento,
                        rede_posto: t.rede_posto,
                        uf: t.uf,
                        placa: t.placa,
                        motorista: t.motorista,
                        combustivel: t.combustivel,
                        volume: t.volume,
                        preco_tabela: pNeg,
                        valor_litro: pPago,
                        diferenca_litro: (pPago - pNeg).toFixed(3),
                        glosa_reembolso: glosaItem.toFixed(2)
                    });
                }
            }
        });
        res.json({ ok: true, totalGlosaReembolso: totalGlosa, divergencias: glosas });
    });
};

exports.gerarDanfeHtml = (req, res) => {
    const chave = req.params.chave;
    const idTransacao = req.query.id || '';

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    
    let sql = `SELECT * FROM auditoria_transacoes WHERE chave_nfe = ? LIMIT 1`;
    let params = [chave];
    if (idTransacao) {
        sql = `SELECT * FROM auditoria_transacoes WHERE id = ? LIMIT 1`;
        params = [idTransacao];
    }

    db.get(sql, params, (err, t) => {
        db.close();
        if (err || !t) return res.status(404).send("DANFE não encontrado.");

        let payload = {};
        try { payload = JSON.parse(t.payload_json || '{}'); } catch(e){}

        const cnpj_nfe_real = formatarCNPJ(payload.CNPJNFe || t.cnpj_cliente);
        const cnpj_esperado = getCNPJEstruturado(t.uf, t.cidade, t.estabelecimento);
        const emitidoCerto = cnpj_nfe_real === cnpj_esperado;

        const alerta = emitidoCerto 
            ? `<div style="background:#f0fdf4; border:1px solid #16a34a; color:#166534; padding:12px; margin-top:15px; border-radius:6px; font-weight:bold; text-align:center;">✅ ALERTA DE COMPLIANCE FISCAL: A nota foi emitida corretamente para a filial exigida (${cnpj_esperado}) na regra tributária de ${t.uf}.</div>`
            : `<div style="background:#fef2f2; border:1px solid #dc2626; color:#991b1b; padding:12px; margin-top:15px; border-radius:6px; font-weight:bold; text-align:center;">❌ ALERTA DE DIVERGÊNCIA FISCAL: A nota foi emitida para o CNPJ ${cnpj_nfe_real}, mas para abastecimentos em ${t.cidade || 'ND'} / ${t.uf} a regra tributária exige emissão para a filial ${cnpj_esperado}.</div>`;

        const ncm = String(t.combustivel).toUpperCase().includes('ARLA') ? '3102.10.10' : '2710.19.21';
        const cfop = (t.uf === 'MT') ? '5656' : '5656';
        const aliquota = (t.uf === 'MT') ? '17,0%' : ((t.uf === 'RO') ? '17,5%' : '12,0%');
        const valorIcms = (t.valor_total * (parseFloat(aliquota)/100)).toLocaleString('pt-BR', {minimumFractionDigits:2});

        const html = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>DANFE - ${t.numero_nfe || 'S/N'}</title>
            <style>
                body { background: #0f172a; padding: 30px; font-family: 'Arial', sans-serif; display: flex; flex-direction: column; align-items: center; }
                .header-bar { width: 900px; background: #1e293b; padding: 15px 25px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; color: white; border-left: 5px solid #ff4500; box-shadow: 0 10px 30px rgba(0,0,0,0.5); box-sizing: border-box;}
                .header-bar h2 { margin: 0; font-size: 18px; font-weight: 800; }
                .header-bar .chave { font-family: monospace; color: #cbd5e1; font-size: 12px; margin-top: 4px; }
                .actions button { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; color: white; margin-left: 8px; transition: 0.2s;}
                .btn-copy { background: #64748b; } .btn-print { background: #10b981; } .btn-portal { background: #3b82f6; }
                .btn-copy:hover{ background: #475569;} .btn-print:hover{background:#059669;} .btn-portal:hover{background:#2563eb;}
                .danfe-page { width: 900px; background: white; padding: 30px; box-sizing: border-box; box-shadow: 0 15px 40px rgba(0,0,0,0.3); border-radius: 4px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
                table, th, td { border: 1px solid #000; }
                th, td { padding: 6px; text-align: left; vertical-align: top; }
                .title-box { font-size: 9px; text-transform: uppercase; color: #444; margin-bottom: 3px; display: block; }
                .val-box { font-size: 13px; font-weight: bold; color: #000; display: block; }
                .text-center { text-align: center; } .text-right { text-align: right; }
                .barcode-container { text-align: center; padding: 10px; }
                .barcode { width: 340px; height: 50px; background: repeating-linear-gradient(90deg, #000, #000 2px, #fff 2px, #fff 4px, #000 4px, #000 5px, #fff 5px, #fff 8px); margin: 0 auto; }
                .chave-acesso { font-family: monospace; font-size: 13px; font-weight: bold; margin-top: 10px; letter-spacing: 1px;}
            </style>
        </head>
        <body>
            <div class="header-bar">
                <div>
                    <h2>📄 Visualizador Direto de DANFE — CavalheiroLog</h2>
                    <div class="chave">Chave: ${t.chave_nfe}<br>(Transação TruckPag #${t.id})</div>
                </div>
                <div class="actions">
                    <button class="btn-copy" onclick="navigator.clipboard.writeText('${t.chave_nfe}'); alert('Chave copiada!')">📋 Copiar Chave</button>
                    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
                    <button class="btn-portal" onclick="window.open('https://www.fsist.com.br/', '_blank')">🏛️ Consultar Portal SEFAZ</button>
                </div>
            </div>

            <div class="danfe-page">
                <table>
                    <tr>
                        <td colspan="3" style="border-right:none;">
                            <span class="title-box">RECEBEMOS DE ${t.estabelecimento} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO</span>
                        </td>
                        <td rowspan="2" class="text-center" style="width: 140px; border-left:none;">
                            <span class="title-box">NF-E</span>
                            <span class="val-box" style="font-size:16px;">Nº ${t.numero_nfe || 'S/N'}</span>
                            <span class="title-box" style="margin-top:4px;">Série ${t.modelo_nfe === '65' ? 'NFC-e' : '001'} | Mod. ${t.modelo_nfe || '55'}</span>
                        </td>
                    </tr>
                    <tr>
                        <td><span class="title-box">DATA DE RECEBIMENTO</span><br>&nbsp;</td>
                        <td colspan="2"><span class="title-box">IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR (${t.motorista || 'NÃO INFORMADO'})</span><br>&nbsp;</td>
                    </tr>
                </table>

                <table style="margin-top: 20px;">
                    <tr>
                        <td style="width: 40%;">
                            <span class="title-box">IDENTIFICAÇÃO DO EMITENTE (POSTO FORNECEDOR)</span>
                            <span class="val-box" style="font-size: 16px;">${t.estabelecimento}</span>
                            <div style="font-size: 11px; margin-top:5px;">
                                ${t.rede_posto ? `REDE ${t.rede_posto}<br>` : ''}
                                ${t.cidade || 'ND'} / ${t.uf || 'ND'} - CEP: ND
                            </div>
                        </td>
                        <td class="text-center" style="width: 20%; vertical-align: middle;">
                            <span style="font-size: 18px; font-weight:bold;">DANFE</span><br>
                            <span class="title-box">DOCUMENTO AUXILIAR DA<br>NOTA FISCAL ELETRÔNICA</span>
                            <br>1 - SAÍDA<br>
                            <span class="val-box" style="font-size: 14px; margin-top:5px;">Nº ${t.numero_nfe || 'S/N'}</span>
                        </td>
                        <td style="width: 40%;" class="text-center">
                            <span class="title-box">CONTROLE DO FISCO / CÓDIGO DE BARRAS DA CHAVE</span>
                            <div class="barcode-container">
                                <div class="barcode"></div>
                                <div class="chave-acesso">${t.chave_nfe}</div>
                            </div>
                        </td>
                    </tr>
                </table>

                <table>
                    <tr>
                        <td style="width: 50%;"><span class="title-box">NATUREZA DA OPERAÇÃO</span><span class="val-box">VENDA DE COMBUSTÍVEL OU LUBRIFICANTE A CONSUMIDOR OU USUÁRIO FINAL</span></td>
                        <td style="width: 25%;"><span class="title-box">CNPJ DO EMITENTE</span><span class="val-box">${formatarCNPJ(t.cnpj_posto)}</span></td>
                        <td style="width: 25%;"><span class="title-box">DATA / HORA DA TRANSAÇÃO</span><span class="val-box">${t.data ? t.data.split('-').reverse().join('/').replace(' ', ' às ') : ''}</span></td>
                    </tr>
                </table>

                <div style="font-size: 12px; font-weight:bold; margin-top:15px; margin-bottom:5px;">DESTINATÁRIO / REMETENTE (AUDITORIA CAVALHEIROLOG)</div>
                <table>
                    <tr>
                        <td style="width: 50%;"><span class="title-box">NOME / RAZÃO SOCIAL</span><span class="val-box">CAVALHEIRO LOGISTICS LTDA</span></td>
                        <td style="width: 25%;"><span class="title-box">CNPJ EMITIDO NA NOTA</span><span class="val-box" style="color:${emitidoCerto?'#000':'#dc2626'}">${cnpj_nfe_real}</span></td>
                        <td style="width: 25%;"><span class="title-box">CNPJ EXIGIDO PELA REGRA ICMS (${t.uf || 'ND'})</span><span class="val-box">${cnpj_esperado}</span></td>
                    </tr>
                </table>

                <div style="font-size: 12px; font-weight:bold; margin-top:15px; margin-bottom:5px;">CÁLCULO DO IMPOSTO & CRÉDITO ESTIMADO DE ICMS</div>
                <table>
                    <tr>
                        <td><span class="title-box">BASE DE CÁLCULO ICMS</span><span class="val-box">R$ ${Number(t.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
                        <td><span class="title-box">ALÍQUOTA UF (${t.uf})</span><span class="val-box">${aliquota}</span></td>
                        <td><span class="title-box">VALOR CRÉDITO ICMS EST.</span><span class="val-box">R$ ${valorIcms}</span></td>
                        <td><span class="title-box">VALOR TOTAL DOS PRODUTOS</span><span class="val-box">R$ ${Number(t.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
                        <td><span class="title-box">VALOR TOTAL DA NOTA</span><span class="val-box">R$ ${Number(t.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
                    </tr>
                </table>

                <div style="font-size: 12px; font-weight:bold; margin-top:15px; margin-bottom:5px;">IDENTIFICAÇÃO DO VEÍCULO, MOTORISTA E TELEMETRIA TRUCKPAG</div>
                <table>
                    <tr>
                        <td><span class="title-box">PLACA DO VEÍCULO</span><span class="val-box">${t.placa || 'ND'}</span></td>
                        <td><span class="title-box">MOTORISTA CONDUTOR</span><span class="val-box">${t.motorista || 'ND'}</span></td>
                        <td><span class="title-box">HODÔMETRO ATUAL</span><span class="val-box">${t.hodometro_atual || 0} km</span></td>
                        <td><span class="title-box">KM RODADO / MÉDIA</span><span class="val-box">${t.km_rodado || 0} km (${Number(t.km_por_litro).toLocaleString('pt-BR',{minimumFractionDigits:2})} Km/L)</span></td>
                        <td><span class="title-box">CARTÃO / TRANSAÇÃO</span><span class="val-box">#${t.id}</span></td>
                    </tr>
                </table>

                <div style="font-size: 12px; font-weight:bold; margin-top:15px; margin-bottom:5px;">DADOS DOS PRODUTOS / SERVIÇOS ABASTECIDOS</div>
                <table>
                    <thead>
                        <tr>
                            <th><span class="title-box">CÓD.</span></th>
                            <th><span class="title-box">DESCRIÇÃO DO PRODUTO / COMBUSTÍVEL</span></th>
                            <th><span class="title-box">NCM/SH</span></th>
                            <th><span class="title-box">CFOP</span></th>
                            <th><span class="title-box">UNID.</span></th>
                            <th class="text-right"><span class="title-box">QUANTIDADE</span></th>
                            <th class="text-right"><span class="title-box">VALOR UNITÁRIO</span></th>
                            <th class="text-right"><span class="title-box">PREÇO ACORDO</span></th>
                            <th class="text-right"><span class="title-box">VALOR TOTAL</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="text-center">10</td>
                            <td><b>${t.combustivel || 'Combustível'}</b> ${t.rede_posto ? `(${t.rede_posto})` : ''}</td>
                            <td class="text-center">${ncm}</td>
                            <td class="text-center">${cfop}</td>
                            <td class="text-center">L</td>
                            <td class="text-right"><b>${Number(t.volume).toLocaleString('pt-BR',{minimumFractionDigits:3})}</b></td>
                            <td class="text-right">R$ ${Number(t.valor_litro).toLocaleString('pt-BR',{minimumFractionDigits:4})}</td>
                            <td class="text-right">${t.preco_tabela > 0 ? 'R$ '+Number(t.preco_tabela).toLocaleString('pt-BR',{minimumFractionDigits:4}) : '—'}</td>
                            <td class="text-right"><b>R$ ${Number(t.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</b></td>
                        </tr>
                    </tbody>
                </table>

                ${alerta}
            </div>
        </body>
        </html>
        `;

        res.send(html);
    });
};