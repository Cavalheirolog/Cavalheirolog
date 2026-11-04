const fs = require('fs');
const path = require('path');
const { dbRun, dbAll } = require('../config/database');
const { parseTruckPagNum, normalizarDataHora, calcularDelayMinutos } = require('../utils/helpers');
const { normalizarUf } = require('../utils/geoResolver');
const { 
    inspecionarChaveNFe, classificarTipoBomba, extrairRedePosto, 
    classificarSubtipoCombustivel, extrairIdsEstornadosDaMensagem, 
    calcularMetricasHodometro 
} = require('../utils/businessRules');
const { mapaLocalizacaoPostos } = require('../config/constants');

// ============================================================================
// SERVIÇO DE CONCILIAÇÃO UNIVERSAL DE CSVS E SANEAMENTO DA BASE
// ============================================================================

async function processarQualquerCSVTruckPag(conteudoLatin1, nomeArquivo = 'CSV') {
    const linhas = String(conteudoLatin1 || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    if (linhas.length < 2) return { lidos: 0, estornos: 0, tipoRelatorio: 'VAZIO' };

    const linha0 = linhas[0].toLowerCase();

    // FORMATO 1: analitico-abastecimentos.csv
    if (linha0.startsWith('cliente;placa;marca;modelo') || linhas.some(l => l.toLowerCase().startsWith('transacao;data;hora;estabelecimento;cidade;motorista;hodometro'))) {
        let placaAtual = '';
        let atualizados = 0;
        const acordosExtraidos = [];

        await dbRun("BEGIN TRANSACTION");
        for (let i = 0; i < linhas.length; i++) {
            const l = linhas[i].trim();
            if (l.toLowerCase().startsWith('cliente;placa;')) {
                if (i + 1 < linhas.length) {
                    const cVeic = linhas[i + 1].split(';');
                    placaAtual = (cVeic[1] || '').trim();
                }
                i += 1;
                continue;
            }
            if (l.toLowerCase().startsWith('transacao;data;hora;') || l.includes(';Totais do veiculo;') || l.startsWith(';;;;')) {
                continue;
            }
            const cols = l.split(';').map(x => x.replace(/^"|"$/g, '').trim());
            if (cols.length >= 13 && /^\d+$/.test(cols[0])) {
                const id = cols[0];
                const dtBr = cols[1];
                const hr = cols[2] || '00:00:00';
                const estab = cols[3];
                const cidUf = cols[4] || '';
                const mot = cols[5] || '';
                const hodAtu = parseTruckPagNum(cols[6]);
                const um = cols[7] || 'km';
                const vol = parseTruckPagNum(cols[8]);
                const comb = cols[9] || 'Diesel S10';
                const precoTrans = parseTruckPagNum(cols[10]);
                const precoNeg = parseTruckPagNum(cols[11]);
                const valTotal = parseTruckPagNum(cols[12]);
                const numNfe = cols[13] || '';

                let cidade = 'ND', uf = 'ND';
                if (cidUf.includes('/')) {
                    const partes = cidUf.split('/');
                    cidade = partes[0].trim();
                    uf = (partes[1] || 'ND').trim().toUpperCase();
                } else if (cidUf) {
                    cidade = cidUf;
                }
                uf = normalizarUf(uf, estab, cidUf);
                if (estab && cidade !== 'ND') {
                    mapaLocalizacaoPostos.set(estab.toUpperCase(), { cidade, uf });
                }

                const dataIso = normalizarDataHora(`${dtBr} ${hr}`, '2026-01-01');
                const apenasData = dataIso.substring(0, 10);
                const tipoBomba = classificarTipoBomba(estab, '');
                const redePosto = extrairRedePosto(estab);
                const subComb = classificarSubtipoCombustivel(comb);
                const vLitro = vol > 0 ? valTotal / vol : precoTrans;
                const refTabela = precoNeg > 0 ? precoNeg : precoTrans;

                if (precoNeg > 0 && estab) {
                    acordosExtraidos.push({ estab, uf, redePosto, comb: subComb, dtIso: apenasData, precoBomba: refTabela, precoNeg });
                }

                const sqlUpsertAbast = (tabela) => `
                    INSERT OR REPLACE INTO ${tabela} (
                        id, data, estabelecimento, cidade, uf, tipoAbastecimento, placa, motorista,
                        volume, valor_total, valor_litro, status_nfe, chave_nfe, cnpj_posto, cnpj_cliente,
                        combustivel, preco_tabela, preco_bomba_referencia, tipo_transacao, status_transacao, servico,
                        mensagem, id_transacao_estornada, hodometro_anterior, hodometro_atual, km_rodado, km_por_litro,
                        unidade_medida, cartao, equipamento, operador, data_registro, delay_minutos, rede_posto,
                        subtipo_combustivel, coord_posto, coord_veiculo, modelo_nfe, numero_nfe, chave_valida, payload_json
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        COALESCE((SELECT status_nfe FROM ${tabela} WHERE id = ?), 'Pendente'),
                        COALESCE((SELECT chave_nfe FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT cnpj_posto FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT cnpj_cliente FROM ${tabela} WHERE id = ?), ''),
                        ?, ?, ?,
                        COALESCE((SELECT tipo_transacao FROM ${tabela} WHERE id = ?), 'COMPRA'),
                        COALESCE((SELECT status_transacao FROM ${tabela} WHERE id = ?), 'APROVADA'),
                        'ABASTECIMENTO',
                        COALESCE((SELECT mensagem FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT id_transacao_estornada FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT hodometro_anterior FROM ${tabela} WHERE id = ?), 0),
                        CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT hodometro_atual FROM ${tabela} WHERE id = ?), 0) END,
                        COALESCE((SELECT km_rodado FROM ${tabela} WHERE id = ?), 0),
                        COALESCE((SELECT km_por_litro FROM ${tabela} WHERE id = ?), 0),
                        ?,
                        COALESCE((SELECT cartao FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT equipamento FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT operador FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT data_registro FROM ${tabela} WHERE id = ?), ?),
                        COALESCE((SELECT delay_minutos FROM ${tabela} WHERE id = ?), 0),
                        ?, ?,
                        COALESCE((SELECT coord_posto FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT coord_veiculo FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT modelo_nfe FROM ${tabela} WHERE id = ?), ''),
                        CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT numero_nfe FROM ${tabela} WHERE id = ?), '') END,
                        COALESCE((SELECT chave_valida FROM ${tabela} WHERE id = ?), 0),
                        COALESCE((SELECT payload_json FROM ${tabela} WHERE id = ?), '')
                    )
                `;

                const params = [
                    id, dataIso, estab, cidade, uf, tipoBomba, placaAtual, mot,
                    vol, valTotal, vLitro,
                    id, id, id, id,
                    comb, precoNeg, refTabela,
                    id, id, id, id, id,
                    hodAtu, hodAtu, id,
                    id, id,
                    um,
                    id, id, id,
                    id, dataIso, id,
                    redePosto, subComb,
                    id, id, id,
                    numNfe, numNfe, id,
                    id, id
                ];

                await dbRun(sqlUpsertAbast('analise_transacoes'), params);
                await dbRun(sqlUpsertAbast('auditoria_transacoes'), params);
                atualizados++;
            }
        }

        for (const ac of acordosExtraidos) {
            await dbRun(
                `INSERT OR REPLACE INTO precos_negociados (escopo, estabelecimento, rede_posto, uf, combustivel, data_vigencia, data_fim, preco_bomba, preco, observacao)
                 VALUES ('POSTO', ?, ?, ?, ?, ?, '2099-12-31', ?, ?, 'Extraído de analitico-abastecimentos.csv')`,
                [ac.estab, ac.redePosto, ac.uf, ac.comb, ac.dtIso, ac.precoBomba, ac.precoNeg]
            );
        }

        await dbRun("COMMIT");
        return { lidos: atualizados, estornos: 0, tipoRelatorio: 'ANALITICO_ABASTECIMENTOS' };
    }

    // FORMATO 2: listagem-abastecimentos.csv
    if (linha0.includes('hodometro/horimetro anterior') && linha0.includes('percorrido') && linha0.includes('tipo de bomba')) {
        let atualizados = 0;
        await dbRun("BEGIN TRANSACTION");

        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].trim().split(';').map(x => x.replace(/^"|"$/g, '').trim());
            if (cols.length < 25) continue;

            const id = cols[1];
            const dtBr = cols[2];
            const hr = cols[3] || '00:00:00';
            const estab = cols[4];
            const estadoExtenso = cols[5] || '';
            const cidade = cols[6] || 'ND';
            const placa = cols[13] || '';
            const mot = cols[16] || '';
            const hodAtu = parseTruckPagNum(cols[17]);
            const hodAnt = parseTruckPagNum(cols[18]);
            const percorrido = parseTruckPagNum(cols[19]);
            const vol = parseTruckPagNum(cols[20]);
            const comb = cols[21] || 'Diesel S10';
            const tipoBombaCol = cols[22] || 'Externo';
            const valTotal = parseTruckPagNum(cols[24]);

            if (!id || vol <= 0) continue;

            const uf = normalizarUf(estadoExtenso, estab, cidade);
            if (estab && cidade !== 'ND') {
                mapaLocalizacaoPostos.set(estab.toUpperCase(), { cidade, uf });
            }

            const dataIso = normalizarDataHora(`${dtBr} ${hr}`, '2026-01-01');
            const tipoBomba = classificarTipoBomba(estab, tipoBombaCol);
            const redePosto = extrairRedePosto(estab);
            const subComb = classificarSubtipoCombustivel(comb);
            const metHod = calcularMetricasHodometro(hodAnt, hodAtu, vol, comb, percorrido);
            const vLitro = vol > 0 ? valTotal / vol : 0;

            const sqlUpsertList = (tabela) => `
                INSERT OR REPLACE INTO ${tabela} (
                    id, data, estabelecimento, cidade, uf, tipoAbastecimento, placa, motorista,
                    volume, valor_total, valor_litro, status_nfe, chave_nfe, cnpj_posto, cnpj_cliente,
                    combustivel, preco_tabela, preco_bomba_referencia, tipo_transacao, status_transacao, servico,
                    mensagem, id_transacao_estornada, hodometro_anterior, hodometro_atual, km_rodado, km_por_litro,
                    unidade_medida, cartao, equipamento, operador, data_registro, delay_minutos, rede_posto,
                    subtipo_combustivel, coord_posto, coord_veiculo, modelo_nfe, numero_nfe, chave_valida, payload_json
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT status_nfe FROM ${tabela} WHERE id = ?), 'Pendente'),
                    COALESCE((SELECT chave_nfe FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT cnpj_posto FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT cnpj_cliente FROM ${tabela} WHERE id = ?), ''),
                    ?,
                    COALESCE((SELECT preco_tabela FROM ${tabela} WHERE id = ?), 0),
                    COALESCE((SELECT preco_bomba_referencia FROM ${tabela} WHERE id = ?), ?),
                    COALESCE((SELECT tipo_transacao FROM ${tabela} WHERE id = ?), 'COMPRA'),
                    COALESCE((SELECT status_transacao FROM ${tabela} WHERE id = ?), 'APROVADA'),
                    'ABASTECIMENTO',
                    COALESCE((SELECT mensagem FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT id_transacao_estornada FROM ${tabela} WHERE id = ?), ''),
                    ?, ?, ?, ?, 'km',
                    COALESCE((SELECT cartao FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT equipamento FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT operador FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT data_registro FROM ${tabela} WHERE id = ?), ?),
                    COALESCE((SELECT delay_minutos FROM ${tabela} WHERE id = ?), 0),
                    ?, ?,
                    COALESCE((SELECT coord_posto FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT coord_veiculo FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT modelo_nfe FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT numero_nfe FROM ${tabela} WHERE id = ?), ''),
                    COALESCE((SELECT chave_valida FROM ${tabela} WHERE id = ?), 0),
                    COALESCE((SELECT payload_json FROM ${tabela} WHERE id = ?), '')
                )
            `;

            const params = [
                id, dataIso, estab, cidade, uf, tipoBomba, placa, mot,
                vol, valTotal, vLitro,
                id, id, id, id,
                comb,
                id, id, vLitro,
                id, id, id, id,
                metHod.hodAnt, metHod.hodAtu, metHod.kmRodado, metHod.kmPorLitro,
                id, id, id, id, dataIso, id,
                redePosto, subComb,
                id, id, id, id, id, id
            ];

            await dbRun(sqlUpsertList('analise_transacoes'), params);
            await dbRun(sqlUpsertList('auditoria_transacoes'), params);
            atualizados++;
        }

        await dbRun("COMMIT");
        return { lidos: atualizados, estornos: 0, tipoRelatorio: 'LISTAGEM_ABASTECIMENTOS' };
    }

    // FORMATO 3: analitico-transacoes.csv
    if (linha0.includes('data de registro') && linha0.includes('mensagem')) {
        const registros = [];
        const idsEstornados = new Set();

        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].trim().split(';').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < 27) continue;

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
            const servico = (cols[13] || 'ABASTECIMENTO').toUpperCase().trim();
            const hodAnt = cols[14];
            const hodAtu = cols[15];
            const um = cols[16] || 'km';
            const vol = parseTruckPagNum(cols[17]);
            const comb = cols[18] || 'Diesel S10';
            const val = parseTruckPagNum(cols[20]);
            const equip = cols[21] || '';
            const oper = cols[22] || '';
            const tipoTr = (cols[26] || 'COMPRA').toUpperCase().trim();
            const statusTr = (cols[27] || 'APROVADA').toUpperCase().trim();
            const msg = cols[28] || '';

            if (!id) continue;

            const dataIso = normalizarDataHora(`${dtBr} ${hr}`, '2026-01-01');
            const dataRegIso = normalizarDataHora(`${dtRegBr} ${hrReg}`, dataIso.substring(0, 10));
            const idsVinc = extrairIdsEstornadosDaMensagem(id, msg);

            if (tipoTr === 'MANUAL') {
                idsVinc.forEach(x => idsEstornados.add(x));
            }

            const ehOperacaoEstorno = (
                tipoTr.includes('ESTORNO') ||
                msg.toUpperCase().includes('DESFAZIMENTO') ||
                (tipoTr !== 'MANUAL' && idsVinc.length > 0)
            );
            const ehStatusInvalido = ['ESTORNADA', 'ESTORNADO', 'RECUSADA', 'RECUSADO', 'CANCELADA', 'CANCELADO'].includes(statusTr);
            const ehNaoCombustivel = servico.includes('MANUTENCAO') || vol <= 0;

            if (ehOperacaoEstorno || ehStatusInvalido || ehNaoCombustivel) {
                idsEstornados.add(id);
                idsVinc.forEach(x => idsEstornados.add(x));
            }

            const locSalva = mapaLocalizacaoPostos.get(estab.toUpperCase());
            const cidFinal = locSalva ? locSalva.cidade : 'ND';
            const ufFinal = locSalva ? locSalva.uf : normalizarUf('ND', estab, '');
            const metricasHod = calcularMetricasHodometro(hodAnt, hodAtu, vol, comb);

            registros.push({
                id,
                dataIso,
                dataRegIso,
                delayMin: calcularDelayMinutos(dataIso, dataRegIso),
                estab,
                cid: cidFinal,
                uf: ufFinal,
                tipoBomba: classificarTipoBomba(estab, ''),
                redePosto: extrairRedePosto(estab),
                placa,
                mot,
                servico,
                vol,
                val,
                vLitro: vol > 0 ? val / vol : 0,
                comb,
                subtipoComb: classificarSubtipoCombustivel(comb),
                cnpjP,
                cartao,
                equip,
                oper,
                coordPosto,
                coordVeic,
                um,
                ...metricasHod,
                tipoTransacao: ehOperacaoEstorno ? 'ESTORNO' : (tipoTr === 'MANUAL' ? 'MANUAL' : 'COMPRA'),
                statusTransacao: statusTr,
                mensagem: msg,
                idEstornada: idsVinc[0] || ''
            });
        }

        if (registros.length > 0) {
            await dbRun("BEGIN TRANSACTION");
            for (const r of registros) {
                const statusFinal = (['COMPRA', 'MANUAL'].includes(r.tipoTransacao) && idsEstornados.has(r.id) && r.statusTransacao === 'APROVADA' && r.vol > 0)
                    ? 'ESTORNADA'
                    : r.statusTransacao;

                const sqlUpsert = (tabela) => `
                    INSERT OR REPLACE INTO ${tabela} (
                        id, data, estabelecimento, cidade, uf, tipoAbastecimento, placa, motorista,
                        volume, valor_total, valor_litro, status_nfe, chave_nfe, cnpj_posto, cnpj_cliente,
                        combustivel, preco_tabela, preco_bomba_referencia, tipo_transacao, status_transacao, servico,
                        mensagem, id_transacao_estornada, hodometro_anterior, hodometro_atual, km_rodado, km_por_litro,
                        unidade_medida, cartao, equipamento, operador, data_registro, delay_minutos, rede_posto,
                        subtipo_combustivel, coord_posto, coord_veiculo, modelo_nfe, numero_nfe, chave_valida, payload_json
                    ) VALUES (
                        ?, ?, ?,
                        COALESCE((SELECT CASE WHEN cidade != 'ND' AND cidade != '' THEN cidade ELSE NULL END FROM ${tabela} WHERE id = ?), ?),
                        COALESCE((SELECT CASE WHEN uf != 'ND' AND uf != '' THEN uf ELSE NULL END FROM ${tabela} WHERE id = ?), ?),
                        ?, ?, ?, ?, ?, ?,
                        COALESCE((SELECT status_nfe FROM ${tabela} WHERE id = ?), 'Pendente'),
                        COALESCE((SELECT chave_nfe FROM ${tabela} WHERE id = ?), ''),
                        CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT cnpj_posto FROM ${tabela} WHERE id = ?), '') END,
                        COALESCE((SELECT cnpj_cliente FROM ${tabela} WHERE id = ?), ''),
                        ?,
                        COALESCE((SELECT preco_tabela FROM ${tabela} WHERE id = ?), 0),
                        COALESCE((SELECT preco_bomba_referencia FROM ${tabela} WHERE id = ?), ?),
                        ?, ?, ?, ?, ?,
                        CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT hodometro_anterior FROM ${tabela} WHERE id = ?), 0) END,
                        CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT hodometro_atual FROM ${tabela} WHERE id = ?), 0) END,
                        CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT km_rodado FROM ${tabela} WHERE id = ?), 0) END,
                        CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT km_por_litro FROM ${tabela} WHERE id = ?), 0) END,
                        ?,
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?,
                        COALESCE((SELECT modelo_nfe FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT numero_nfe FROM ${tabela} WHERE id = ?), ''),
                        COALESCE((SELECT chave_valida FROM ${tabela} WHERE id = ?), 0),
                        COALESCE((SELECT payload_json FROM ${tabela} WHERE id = ?), '')
                    )
                `;

                const params = [
                    r.id, r.dataIso, r.estab,
                    r.id, r.cid,
                    r.id, r.uf,
                    r.tipoBomba, r.placa, r.mot, r.vol, r.val, r.vLitro,
                    r.id, r.id,
                    r.cnpjP, r.cnpjP, r.id,
                    r.id,
                    r.comb,
                    r.id, r.id, r.vLitro,
                    r.tipoTransacao, statusFinal, r.servico, r.mensagem, r.idEstornada,
                    r.hodAnt, r.hodAnt, r.id,
                    r.hodAtu, r.hodAtu, r.id,
                    r.kmRodado, r.kmRodado, r.id,
                    r.kmPorLitro, r.kmPorLitro, r.id,
                    r.um,
                    r.cartao, r.equip, r.oper, r.dataRegIso, r.delayMin, r.redePosto, r.subtipoComb,
                    r.coordPosto, r.coordVeic,
                    r.id, r.id, r.id, r.id
                ];

                await dbRun(sqlUpsert('auditoria_transacoes'), params);

                const ehValidaAnalise = (
                    ['COMPRA', 'MANUAL'].includes(r.tipoTransacao) &&
                    statusFinal === 'APROVADA' &&
                    !idsEstornados.has(r.id) &&
                    !r.servico.includes('MANUTENCAO') &&
                    r.vol > 0
                );
                if (ehValidaAnalise) {
                    await dbRun(sqlUpsert('analise_transacoes'), params);
                }
            }

            for (const idRem of idsEstornados) {
                await dbRun(`DELETE FROM analise_transacoes WHERE id = ?`, [idRem]);
                await dbRun(`UPDATE auditoria_transacoes SET status_transacao = 'ESTORNADA' WHERE id = ? AND tipo_transacao = 'COMPRA' AND status_transacao = 'APROVADA' AND volume > 0`, [idRem]);
            }
            await dbRun("COMMIT");
        }

        return { lidos: registros.length, estornos: idsEstornados.size, tipoRelatorio: 'ANALITICO_TRANSACOES' };
    }

    return { lidos: 0, estornos: 0, tipoRelatorio: 'DESCONHECIDO' };
}

async function conciliarCSVsLocaisAutomaticamente() {
    try {
        const pastas = [path.join(__dirname, '../../'), path.join(__dirname, '../../csv_historico')];
        const todosArquivos = [];
        for (const dir of pastas) {
            if (!fs.existsSync(dir)) continue;
            for (const f of fs.readdirSync(dir)) {
                if (f.toLowerCase().endsWith('.csv')) {
                    todosArquivos.push({ nome: f, caminho: path.join(dir, f) });
                }
            }
        }

        const ordem = (n) => {
            const l = n.toLowerCase();
            if (l.includes('listagem-abastecimentos')) return 1;
            if (l.includes('analitico-abastecimentos')) return 2;
            if (l.includes('analitico-transacoes')) return 3;
            return 4;
        };
        todosArquivos.sort((a, b) => ordem(a.nome) - ordem(b.nome));

        for (const arq of todosArquivos) {
            const lower = arq.nome.toLowerCase();
            if (lower.includes('listagem-abastecimentos') || lower.includes('analitico-abastecimentos') || lower.includes('analitico-transacoes')) {
                const conteudo = fs.readFileSync(arq.caminho, 'latin1');
                const res = await processarQualquerCSVTruckPag(conteudo, arq.nome);
                if (res.lidos > 0) {
                    console.log(`📂 [Auto-Conciliação ${res.tipoRelatorio}] ${arq.nome}: ${res.lidos} linhas sincronizadas.`);
                }
            }
        }
    } catch (e) {
        console.warn("⚠️ Aviso na leitura automática de CSVs:", e.message);
    }
}

async function sanearBaseExistente() {
    try {
        for (const tabela of ['analise_transacoes', 'auditoria_transacoes']) {
            const conhecidos = await dbAll(`SELECT DISTINCT estabelecimento, cidade, uf FROM ${tabela} WHERE cidade != 'ND' AND cidade != ''`);
            conhecidos.forEach(c => {
                mapaLocalizacaoPostos.set(c.estabelecimento.toUpperCase(), {
                    cidade: c.cidade,
                    uf: normalizarUf(c.uf, c.estabelecimento, c.cidade)
                });
            });
        }

        await dbRun(`
            DELETE FROM analise_transacoes
            WHERE volume <= 0
               OR UPPER(COALESCE(servico, '')) LIKE '%MANUTENCAO%'
               OR UPPER(COALESCE(combustivel, '')) = 'NAO INFORMADO'
        `);

        const especiais = await dbAll(`
            SELECT id, data, estabelecimento, placa, combustivel, volume, valor_total, mensagem, id_transacao_estornada, tipoAbastecimento, tipo_transacao, status_transacao
            FROM auditoria_transacoes
            WHERE UPPER(COALESCE(tipo_transacao, '')) IN ('ESTORNO', 'MANUAL')
               OR UPPER(COALESCE(tipoAbastecimento, '')) LIKE '%ESTORNO%'
               OR UPPER(COALESCE(status_transacao, '')) IN ('ESTORNADA', 'ESTORNADO', 'CANCELADA', 'CANCELADO', 'RECUSADA', 'RECUSADO')
               OR UPPER(COALESCE(mensagem, '')) LIKE '%DESFAZIMENTO%'
               OR (UPPER(COALESCE(mensagem, '')) LIKE '%TRANSACAO%' AND LENGTH(COALESCE(mensagem, '')) - LENGTH(REPLACE(UPPER(COALESCE(mensagem, '')), 'TRANSACAO', '')) > 9)
        `);

        const idsExpurgarAnalise = new Set();
        const chavesEspelhoEstorno = [];

        for (const e of especiais) {
            const tipoUp = String(e.tipo_transacao || '').toUpperCase();
            const extraidos = extrairIdsEstornadosDaMensagem(e.id, e.mensagem);

            if (tipoUp === 'MANUAL') {
                extraidos.forEach(idOrig => idsExpurgarAnalise.add(idOrig));
                if (e.id_transacao_estornada) idsExpurgarAnalise.add(String(e.id_transacao_estornada).trim());
            } else {
                idsExpurgarAnalise.add(String(e.id).trim());
                if (e.id_transacao_estornada) idsExpurgarAnalise.add(String(e.id_transacao_estornada).trim());
                extraidos.forEach(idOrig => idsExpurgarAnalise.add(idOrig));

                chavesEspelhoEstorno.push({
                    idEstorno: String(e.id).trim(),
                    dataDia: String(e.data || '').substring(0, 10),
                    estab: String(e.estabelecimento || '').trim(),
                    placa: String(e.placa || '').trim(),
                    volMl: Math.round((Number(e.volume) || 0) * 1000),
                    valCents: Math.round((Number(e.valor_total) || 0) * 100)
                });
            }
        }

        const todasAnalise = await dbAll(`SELECT id, data, estabelecimento, placa, combustivel, volume, valor_total FROM analise_transacoes ORDER BY id ASC`);
        for (const esp of chavesEspelhoEstorno) {
            todasAnalise.forEach(row => {
                if (
                    String(row.data || '').substring(0, 10) === esp.dataDia &&
                    String(row.estabelecimento || '').trim() === esp.estab &&
                    String(row.placa || '').trim() === esp.placa &&
                    Math.round((Number(row.volume) || 0) * 1000) === esp.volMl &&
                    Math.round((Number(row.valor_total) || 0) * 100) === esp.valCents
                ) {
                    idsExpurgarAnalise.add(String(row.id).trim());
                }
            });
        }

        await dbRun("BEGIN TRANSACTION");
        await dbRun(`
            DELETE FROM analise_transacoes
            WHERE UPPER(COALESCE(tipo_transacao, '')) LIKE '%ESTORNO%'
               OR UPPER(COALESCE(tipoAbastecimento, '')) LIKE '%ESTORNO%'
               OR UPPER(COALESCE(status_transacao, '')) IN ('ESTORNADA', 'ESTORNADO', 'CANCELADA', 'CANCELADO', 'RECUSADA', 'RECUSADO')
        `);

        for (const idRem of idsExpurgarAnalise) {
            await dbRun(`DELETE FROM analise_transacoes WHERE id = ?`, [idRem]);
            await dbRun(`UPDATE auditoria_transacoes SET status_transacao = 'ESTORNADA' WHERE id = ? AND tipo_transacao = 'COMPRA'`, [idRem]);
        }

        for (const tabela of ['analise_transacoes', 'auditoria_transacoes']) {
            const rows = await dbAll(`SELECT id, estabelecimento, cidade, uf, tipoAbastecimento, combustivel, chave_nfe, hodometro_anterior, hodometro_atual, km_rodado, volume FROM ${tabela}`);
            for (const r of rows) {
                const loc = mapaLocalizacaoPostos.get(r.estabelecimento.toUpperCase());
                let cidNova = (r.cidade && r.cidade !== 'ND') ? r.cidade : (loc ? loc.cidade : 'ND');
                if (cidNova.includes('/')) cidNova = cidNova.split('/')[0].trim();
                const ufNova = normalizarUf((r.uf && r.uf !== 'ND') ? r.uf : (loc ? loc.uf : 'ND'), r.estabelecimento, r.cidade);

                const novoTipoBomba = classificarTipoBomba(r.estabelecimento, r.tipoAbastecimento);
                const novaRede = extrairRedePosto(r.estabelecimento);
                const novoSubComb = classificarSubtipoCombustivel(r.combustivel);
                const infoNfe = inspecionarChaveNFe(r.chave_nfe);
                const metHod = calcularMetricasHodometro(r.hodometro_anterior, r.hodometro_atual, r.volume, r.combustivel, r.km_rodado);

                await dbRun(
                    `UPDATE ${tabela} SET 
                        cidade = ?,
                        uf = ?,
                        tipoAbastecimento = ?, 
                        rede_posto = ?, 
                        subtipo_combustivel = ?, 
                        modelo_nfe = ?,
                        numero_nfe = CASE WHEN ? != '' THEN ? ELSE numero_nfe END,
                        chave_valida = ?,
                        km_rodado = ?,
                        km_por_litro = ?
                    WHERE id = ?`,
                    [
                        cidNova, ufNova, novoTipoBomba, novaRede, novoSubComb,
                        infoNfe.modelo, infoNfe.numeroNota, infoNfe.numeroNota, infoNfe.valida ? 1 : 0,
                        metHod.kmRodado, metHod.kmPorLitro,
                        r.id
                    ]
                );
            }
        }
        await dbRun("COMMIT");
    } catch (err) {
        await dbRun("ROLLBACK").catch(() => {});
        console.error("⚠️ Aviso durante saneamento:", err.message);
    }
}

module.exports = {
    processarQualquerCSVTruckPag,
    conciliarCSVsLocaisAutomaticamente,
    sanearBaseExistente
};