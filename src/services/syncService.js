const fs = require('fs');
const path = require('path');
const { dbRun, dbGet, dbAll, db } = require('../config/database');
const { auth, baixarUnicoDia, fetchComRetentativa } = require('./truckpagService');
const { 
    toMl, toCents, getDataBrasil, getDataHoraBrasilStr, 
    parseTruckPagNum, delay, normalizarDataHora, calcularDelayMinutos, normalizarTexto 
} = require('../utils/helpers');
const { normalizarUf } = require('../utils/geoResolver');
const { 
    obterCNPJEstruturado, inspecionarChaveNFe, classificarTipoBomba, 
    extrairRedePosto, classificarSubtipoCombustivel, extrairIdsEstornadosDaMensagem, 
    calcularMetricasHodometro 
} = require('../utils/businessRules');
const { mapaLocalizacaoPostos } = require('../config/constants');

// ============================================================================
// SERVIÇO DE SMART SYNC, JANELA LOOKAHEAD (+5 DIAS), SANITIZAÇÃO E CAÇADOR NFE
// ============================================================================

async function registrarLogSync(origem, periodo, qtdAnalise, qtdAuditoria, qtdEstornos, status = 'OK', detalhe = '') {
    try {
        await dbRun(
            `INSERT INTO sync_logs (data_hora, origem, periodo, inseridos_analise, inseridos_auditoria, estornos_filtrados, status, detalhe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [getDataHoraBrasilStr(), origem, periodo, qtdAnalise, qtdAuditoria, qtdEstornos, status, detalhe]
        );
        await dbRun(`DELETE FROM sync_logs WHERE id NOT IN (SELECT id FROM sync_logs ORDER BY id DESC LIMIT 200)`);
    } catch (_) {}
}

// Localiza o acordo comercial vigente na data exata da transação (Prioridade: Posto/CNPJ -> Rede -> UF)
function encontrarAcordoCompletoLocal(transacao, listaPrecos) {
    if (!listaPrecos || listaPrecos.length === 0) return null;
    const dataIsoStr = String(transacao.data || '').substring(0, 10);
    const estabUp = normalizarTexto(transacao.estab);
    const cnpjLimpo = String(transacao.cnpjP || '').replace(/\D/g, '');
    const redeUp = normalizarTexto(transacao.redePosto);
    const ufUp = String(transacao.uf || '').toUpperCase().trim();
    const combUp = String(transacao.comb || '').toUpperCase().trim();
    const isArlaLocal = combUp.includes('ARLA');

    const compativelComb = (pCombRaw) => {
        const pComb = String(pCombRaw || '').toUpperCase().trim();
        if (pComb === 'TODOS') return true;
        const pIsArla = pComb.includes('ARLA');
        if (isArlaLocal !== pIsArla) return false;
        if (isArlaLocal && pIsArla) return true;
        if (pComb === combUp) return true;
        if (pComb.includes('ADITIVADO') && combUp.includes('ADITIVADO')) return true;
        if (pComb.includes('S500') && combUp.includes('S500')) return true;
        if (pComb.includes('S10') && combUp.includes('S10') && !pComb.includes('ADITIVADO') && !combUp.includes('ADITIVADO')) return true;
        if (pComb.includes('S10') && combUp.includes('S10')) return true;
        if (pComb === 'DIESEL' && combUp.includes('DIESEL')) return true;
        return false;
    };

    const dentroVig = (p) => {
        const ini = String(p.data_vigencia || '2000-01-01').substring(0, 10);
        const fim = String(p.data_fim || '2099-12-31').substring(0, 10);
        return dataIsoStr >= ini && dataIsoStr <= fim;
    };

    // 1. Match por Posto Específico ou CNPJ
    const matchPosto = listaPrecos.find(p => {
        if (String(p.escopo || 'POSTO').toUpperCase() !== 'POSTO') return false;
        const pEstab = normalizarTexto(p.estabelecimento);
        const pCnpj = String(p.cnpj_posto || '').replace(/\D/g, '');
        const mesmoPosto = (pEstab && pEstab === estabUp) || (pCnpj && cnpjLimpo && pCnpj === cnpjLimpo);
        return mesmoPosto && compativelComb(p.combustivel) && dentroVig(p);
    });
    if (matchPosto) return matchPosto;

    // 2. Match por Rede de Postos
    const matchRede = listaPrecos.find(p => {
        const alvo = normalizarTexto(p.rede_posto || p.estabelecimento);
        return String(p.escopo || '').toUpperCase() === 'REDE' && alvo && alvo === redeUp && compativelComb(p.combustivel) && dentroVig(p);
    });
    if (matchRede) return matchRede;

    // 3. Match por Estado (UF)
    const matchUf = listaPrecos.find(p => {
        const alvo = String(p.uf || p.estabelecimento || '').toUpperCase().trim();
        return String(p.escopo || '').toUpperCase() === 'UF' && alvo && alvo === ufUp && compativelComb(p.combustivel) && dentroVig(p);
    });
    if (matchUf) return matchUf;

    return null;
}

// Rotina OBRIGATÓRIA de Auto-Limpeza Cross-Day e Reaplicação de Acordos Comerciais
async function autoSanitizarBanco() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            // 1. Identifica todos os IDs originais que sofreram operação de ESTORNO (IDServico 99 ou vínculo)
            db.run(`
                UPDATE auditoria_transacoes
                SET status_transacao = 'ESTORNADA'
                WHERE id IN (
                    SELECT id_transacao_estornada
                    FROM auditoria_transacoes
                    WHERE id_transacao_estornada != ''
                      AND id_transacao_estornada != '0'
                      AND (tipo_transacao = 'ESTORNO' OR UPPER(servico) LIKE '%ESTORNO%')
                )
                AND tipo_transacao IN ('COMPRA', 'MANUAL')
            `);

            // 2. Se um lançamento MANUAL substituiu uma compra original, anula a compra original substituída
            db.run(`
                UPDATE auditoria_transacoes
                SET status_transacao = 'ESTORNADA'
                WHERE id IN (
                    SELECT id_transacao_estornada
                    FROM auditoria_transacoes
                    WHERE tipo_transacao = 'MANUAL'
                      AND status_transacao = 'APROVADA'
                      AND id_transacao_estornada != ''
                      AND id_transacao_estornada != '0'
                      AND id_transacao_estornada != id
                )
                AND tipo_transacao = 'COMPRA'
            `);

            // 3. Remove da tabela de Análise qualquer estorno, compra estornada, recusa ou manutenção
            db.run(`
                DELETE FROM analise_transacoes
                WHERE id IN (
                    SELECT id FROM auditoria_transacoes
                    WHERE status_transacao != 'APROVADA'
                       OR tipo_transacao = 'ESTORNO'
                       OR UPPER(servico) LIKE '%ESTORNO%'
                       OR UPPER(servico) LIKE '%MANUTENCAO%'
                )
                OR id IN (
                    SELECT id_transacao_estornada FROM auditoria_transacoes
                    WHERE id_transacao_estornada != ''
                      AND id_transacao_estornada != '0'
                      AND id_transacao_estornada != id
                )
                OR tipo_transacao NOT IN ('COMPRA', 'MANUAL')
                OR status_transacao != 'APROVADA'
                OR volume <= 0
                OR UPPER(servico) LIKE '%ESTORNO%'
                OR UPPER(servico) LIKE '%MANUTENCAO%'
            `);

            // 4. Restaura para analise_transacoes compras/manuais líquidas válidas que estejam na auditoria mas faltem na análise
            db.run(`
                INSERT OR IGNORE INTO analise_transacoes
                SELECT * FROM auditoria_transacoes
                WHERE tipo_transacao IN ('COMPRA', 'MANUAL')
                  AND status_transacao = 'APROVADA'
                  AND volume > 0
                  AND UPPER(servico) NOT LIKE '%ESTORNO%'
                  AND UPPER(servico) NOT LIKE '%MANUTENCAO%'
                  AND id NOT IN (
                      SELECT id_transacao_estornada FROM auditoria_transacoes
                      WHERE id_transacao_estornada != ''
                        AND id_transacao_estornada != '0'
                        AND id_transacao_estornada != id
                  )
            `);

            db.run("COMMIT", (err) => {
                if (err) reject(err); else resolve();
            });
        });
    });
}

let filaSync = Promise.resolve();

function sincronizarPeriodoSeguro(dtIsoIni, dtIsoFim, forcarBusca = false, origem = 'SmartSync') {
    filaSync = filaSync.then(() => _executarSync(dtIsoIni, dtIsoFim, forcarBusca, origem)).catch(err => {
        console.error("❌ Erro na fila de Sync:", err.message);
    });
    return filaSync;
}

async function _executarSync(dtIsoIni, dtIsoFim, forcarBusca, origem) {
    if (!dtIsoIni || !dtIsoFim) return;
    try {
        const hojeIso = getDataBrasil(0);
        const dataLimiteRecente = getDataBrasil(-2);

        let dAtual = new Date(`${dtIsoIni}T12:00:00Z`);
        let dFimSolicitado = new Date(`${dtIsoFim}T12:00:00Z`);

        // JANELA LOOKAHEAD (+5 DIAS): Captura transações noturnas (Bomba Interna registrada após 00h)
        // e lançamentos Manuais/Estornos retroativos registrados dias depois na API da TruckPag
        let dFimLookahead = new Date(dFimSolicitado);
        dFimLookahead.setDate(dFimLookahead.getDate() + 5);
        let dHoje = new Date(`${hojeIso}T12:00:00Z`);
        let dFim = dFimLookahead < dHoje ? dFimLookahead : dHoje;
        if (dFim < dFimSolicitado) dFim = dFimSolicitado;

        const precosNegociados = await dbAll(`SELECT * FROM precos_negociados ORDER BY data_vigencia DESC, id DESC`);

        // Carrega todos os IDs que já sofreram estorno no banco local
        const estornosDb = await dbAll(`
            SELECT id, id_transacao_estornada, tipo_transacao, status_transacao 
            FROM auditoria_transacoes 
            WHERE status_transacao = 'ESTORNADA' 
               OR tipo_transacao = 'ESTORNO' 
               OR (id_transacao_estornada != '' AND id_transacao_estornada != '0')
        `);

        const registrosParaAuditoria = new Map();
        const registrosParaAnalise = new Map();
        const idsOriginaisEstornados = new Set();
        const mapaNotasGlobal = new Map();

        estornosDb.forEach(r => {
            if (r.status_transacao === 'ESTORNADA' || r.tipo_transacao === 'ESTORNO') {
                idsOriginaisEstornados.add(String(r.id).trim());
            }
            if (r.id_transacao_estornada && r.id_transacao_estornada !== '0' && r.id_transacao_estornada !== r.id) {
                idsOriginaisEstornados.add(String(r.id_transacao_estornada).trim());
            }
        });

        while (dAtual <= dFim) {
            const strIso = dAtual.toISOString().substring(0, 10);
            const isDiaRecente = (strIso >= dataLimiteRecente);
            const isDentroDoPeriodoSolicitado = (dAtual <= dFimSolicitado);

            let diaJaExisteCompleto = false;
            if (!(forcarBusca && isDentroDoPeriodoSolicitado) && !isDiaRecente) {
                const rowAuditMeta = await dbGet(
                    `SELECT COUNT(id) as qtd FROM auditoria_transacoes WHERE SUBSTR(data_registro, 1, 10) = ? OR SUBSTR(data, 1, 10) = ?`,
                    [strIso, strIso]
                );
                if (rowAuditMeta?.qtd > 0) {
                    diaJaExisteCompleto = true;
                }
            }

            if (diaJaExisteCompleto) {
                dAtual.setDate(dAtual.getDate() + 1);
                continue;
            }

            console.log(`📥 [${origem}] A descarregar lote de registo ${strIso} na API TruckPag...`);
            const token = await auth();
            const resultadoDia = await baixarUnicoDia(strIso, token);

            resultadoDia.notas.forEach(n => {
                const idTr = String(n.IdTransacao || n.Transacao || '').trim();
                if (idTr) mapaNotasGlobal.set(idTr, n);
            });

            // PASSO 1: Varredura de Estornos, Manutenções e Substituições Manuais
            resultadoDia.transacoes.forEach(t => {
                const idTrans = String(t.Transacao || t.IdTransacao || '').trim();
                if (!idTrans) return;

                const statusRaw = String(t.Status || t.Situacao || 'APROVADA').toUpperCase().trim();
                const tipoRaw = String(t.Tipo || t.TipoTransacao || 'COMPRA').toUpperCase().trim();
                const servicoRaw = String(t.Servico || '').toUpperCase().trim();
                const idServico = String(t.IDServico || '').trim();
                const msgRaw = String(t.Mensagem || t.Observacao || t.Descricao || '').trim();
                const idTransEstornadaAPI = String(t.TransacaoEstornada || t.transacao_estornada || '').trim();
                const vol = parseTruckPagNum(t.Litragem ?? t.Volume);

                const idsVinculadosMsg = extrairIdsEstornadosDaMensagem(idTrans, msgRaw);

                // Se a API informou explicitamente qual transação foi estornada/substituída
                if (idTransEstornadaAPI && idTransEstornadaAPI !== '0' && idTransEstornadaAPI !== idTrans) {
                    idsOriginaisEstornados.add(idTransEstornadaAPI);
                }

                // Se for um Lançamento MANUAL válido, ele anula os IDs antigos citados na mensagem, mas preserva a si mesmo
                if (tipoRaw === 'MANUAL') {
                    idsVinculadosMsg.forEach(idOrig => {
                        if (idOrig !== idTrans) idsOriginaisEstornados.add(idOrig);
                    });
                    return;
                }

                const ehEstorno = (
                    tipoRaw.includes('ESTORNO') ||
                    servicoRaw.includes('ESTORNO') ||
                    idServico === '99' ||
                    msgRaw.toUpperCase().includes('DESFAZIMENTO') ||
                    msgRaw.toUpperCase().includes('ESTORNO') ||
                    Boolean(t.Estornado) ||
                    (idTransEstornadaAPI !== '' && idTransEstornadaAPI !== '0')
                );

                const ehInvalida = ['RECUSADA', 'RECUSADO', 'ESTORNADA', 'ESTORNADO', 'CANCELADA', 'CANCELADO', 'NEGADA', 'ERRO'].some(s => statusRaw.includes(s));
                const ehManutencao = servicoRaw.includes('MANUTENCAO') || idServico === '50' || vol <= 0;

                if (ehEstorno || ehInvalida || ehManutencao) {
                    idsOriginaisEstornados.add(idTrans);
                    idsVinculadosMsg.forEach(idOrig => idsOriginaisEstornados.add(idOrig));
                }
            });

            // PASSO 2: Estruturação dos Registros e Cálculo de Preço Bomba / Negociado
            resultadoDia.transacoes.forEach(t => {
                const idTrans = String(t.Transacao || t.IdTransacao || '').trim();
                if (!idTrans) return;

                const vol = parseTruckPagNum(t.Litragem ?? t.Volume);
                const val = parseTruckPagNum(t.Valor);
                if (vol <= 0 && val <= 0) return;

                const statusRaw = String(t.Status || t.Situacao || 'APROVADA').toUpperCase().trim();
                const tipoRaw = String(t.Tipo || t.TipoTransacao || 'COMPRA').toUpperCase().trim();
                const servicoRaw = String(t.Servico || 'ABASTECIMENTO').toUpperCase().trim();
                const idServico = String(t.IDServico || '').trim();
                const tipoBombaRaw = String(t.TipoAbastecimento || t.TipoBomba || 'EXTERNO').toUpperCase().trim();
                const msgRaw = String(t.Mensagem || t.Observacao || t.Descricao || '').trim();

                const idTransEstornadaAPI = String(t.TransacaoEstornada || t.transacao_estornada || '').trim();
                const idsVinculadosMsg = extrairIdsEstornadosDaMensagem(idTrans, msgRaw);
                const idEstornadaFinal = (idTransEstornadaAPI && idTransEstornadaAPI !== '0' && idTransEstornadaAPI !== idTrans)
                    ? idTransEstornadaAPI
                    : (idsVinculadosMsg.find(x => x !== idTrans) || '');

                const ehOperacaoEstorno = (
                    tipoRaw.includes('ESTORNO') ||
                    servicoRaw.includes('ESTORNO') ||
                    idServico === '99' ||
                    msgRaw.toUpperCase().includes('DESFAZIMENTO') ||
                    (tipoRaw !== 'MANUAL' && idEstornadaFinal !== '')
                );

                // Detecção de Lançamento Manual (via campo Tipo ou se a DataRegistro for de outro dia posterior com menção manual)
                const ehManual = tipoRaw === 'MANUAL' || msgRaw.toUpperCase().includes('ABASTECIMENTO MANUAL');
                const tipoTransacaoFinal = ehOperacaoEstorno ? 'ESTORNO' : (ehManual ? 'MANUAL' : 'COMPRA');

                let statusTransacaoFinal = statusRaw;
                if (['COMPRA', 'MANUAL'].includes(tipoTransacaoFinal) && idsOriginaisEstornados.has(idTrans) && vol > 0) {
                    statusTransacaoFinal = 'ESTORNADA';
                }

                const nota = mapaNotasGlobal.get(idTrans);
                const chaveDaTransacao = String(t.ChaveNFe || t.chave_nfe || '').trim();
                const chaveFinal = (nota && nota.ChaveNFe) ? String(nota.ChaveNFe).trim() : chaveDaTransacao;
                const statusNfeFinal = chaveFinal ? 'Vinculada' : 'Pendente';
                const infoChave = inspecionarChaveNFe(chaveFinal);

                const dataTr = normalizarDataHora(t.DataTransacao || t.Data, resultadoDia.dtIso);
                // Se a API não enviar DataRegistro separada no JSON, grava a data do lote (resultadoDia.dtIso)
                const dataReg = normalizarDataHora(t.DataRegistro || t.DataHoraRegistro || `${resultadoDia.dtIso} ${dataTr.split(' ')[1] || '00:00:00'}`, resultadoDia.dtIso);
                const delayMin = calcularDelayMinutos(dataTr, dataReg);

                const estab = String(t.NomeFantasiaPosto || t.RazaoSocialPosto || t.Estabelecimento || 'POSTO ND').trim();
                const locSalva = mapaLocalizacaoPostos.get(normalizarTexto(estab));
                let cid = String(t.CidadePosto || t.Cidade || (locSalva ? locSalva.cidade : 'ND')).trim();
                if (cid.includes('/')) cid = cid.split('/')[0].trim();
                const uf = normalizarUf(t.UFPosto || t.UF || (locSalva ? locSalva.uf : 'ND'), estab, cid);
                if (estab && cid !== 'ND') mapaLocalizacaoPostos.set(normalizarTexto(estab), { cidade: cid, uf });

                const redePosto = extrairRedePosto(estab);
                const comb = String(t.NomeCombustivel || t.Combustivel || 'Diesel S10').trim();
                const subtipoComb = classificarSubtipoCombustivel(comb);
                const cnpjP = String(t.CNPJPosto || t.CNPJ || (nota && nota.CNPJPosto) || '').trim();
                const cnpjC = String(t.CNPJCliente || (nota && nota.CNPJCliente) || '').trim();

                const hodAnt = t.HodometroAnterior ?? t['Hodometro/Horimetro Anterior'] ?? 0;
                const hodAtu = t.Hodometro ?? t.HodometroAtual ?? t['Hodometro/Horimetro'] ?? 0;
                const kmRodadoApi = t.QuilometrosRodados ?? t.Percorrido ?? 0;
                const metricasHod = calcularMetricasHodometro(hodAnt, hodAtu, vol, comb, kmRodadoApi);

                const precoPagoUnit = vol > 0 ? Number((val / vol).toFixed(4)) : 0;
                let precoTab = parseTruckPagNum(t.PrecoNegociado || t.PrecoTabela || t.ValorTabela || 0);
                let precoBombaRef = parseTruckPagNum(t.PrecoBomba || t.PrecoTransacao || 0);

                // Se na API/Relatório o "PrecoNegociado" veio maior que o "PrecoPago", na verdade ele é o Preço Bomba e o Pago é o Negociado
                if (precoTab > 0 && precoPagoUnit > 0 && precoTab > precoPagoUnit && precoBombaRef <= precoPagoUnit) {
                    precoBombaRef = precoTab;
                    precoTab = precoPagoUnit;
                }

                // Cruza com a tabela de acordos comerciais cadastrados/importados no banco
                if (precosNegociados.length > 0) {
                    const acordo = encontrarAcordoCompletoLocal(
                        { data: dataTr, estab, cid, cnpjP, redePosto, uf, comb },
                        precosNegociados
                    );
                    if (acordo) {
                        if (precoTab === 0 && Number(acordo.preco) > 0) precoTab = Number(acordo.preco);
                        if (Number(acordo.preco_bomba) > 0) precoBombaRef = Number(acordo.preco_bomba);
                    }
                }

                if (precoBombaRef === 0 && precoTab > 0) {
                    precoBombaRef = Math.max(precoTab, precoPagoUnit);
                }

                const objRegistro = {
                    id: idTrans,
                    data: dataTr,
                    estab,
                    cid,
                    uf,
                    tipo: classificarTipoBomba(estab, tipoBombaRaw),
                    placa: String(t.Placa || t.Veiculo || '').trim(),
                    motorista: String(t.Motorista || t.NomeMotorista || '').trim(),
                    vol,
                    val,
                    statusNfe: statusNfeFinal,
                    chaveNfe: chaveFinal,
                    cnpjP,
                    cnpjC,
                    comb,
                    precoTab,
                    precoBombaRef,
                    tipoTransacao: tipoTransacaoFinal,
                    statusTransacao: statusTransacaoFinal,
                    servico: servicoRaw,
                    mensagem: msgRaw,
                    idEstornada: idEstornadaFinal,
                    hodAnt: metricasHod.hodAnt,
                    hodAtu: metricasHod.hodAtu,
                    kmRodado: metricasHod.kmRodado,
                    kmPorLitro: metricasHod.kmPorLitro,
                    um: String(t.UM || t['U.M'] || 'km').trim(),
                    cartao: String(t.CartaoMascarado || t.Cartao || t.NumeroCartao || '').trim(),
                    equipamento: String(t.Equipamento || t.MeioCaptura || '').trim(),
                    operador: String(t.Operador || '').trim(),
                    dataReg,
                    delayMin,
                    redePosto,
                    subtipoComb,
                    coordPosto: String(t.CoordenadasPosto || t['Coordenadas geograficas Estabelecimento'] || '').trim(),
                    coordVeic: String(t.CoordenadasVeiculo || t['Coordenadas geograficas Veiculo'] || '').trim(),
                    modeloNfe: infoChave.modelo,
                    numeroNfe: infoChave.numeroNota,
                    chaveValida: infoChave.valida ? 1 : 0,
                    payloadJson: JSON.stringify(t)
                };

                registrosParaAuditoria.set(idTrans, objRegistro);

                const isManutencaoFinal = servicoRaw.includes('MANUTENCAO') || idServico === '50';
                const ehValidaParaAnalise = (
                    ['COMPRA', 'MANUAL'].includes(tipoTransacaoFinal) &&
                    statusTransacaoFinal === 'APROVADA' &&
                    !idsOriginaisEstornados.has(idTrans) &&
                    !isManutencaoFinal &&
                    vol > 0
                );

                if (ehValidaParaAnalise) {
                    registrosParaAnalise.set(idTrans, objRegistro);
                }
            });

            dAtual.setDate(dAtual.getDate() + 1);
            await delay(900);
        }

        const listaAuditoria = Array.from(registrosParaAuditoria.values());
        const listaAnalise = Array.from(registrosParaAnalise.values());
        const listaIdsEstornados = Array.from(idsOriginaisEstornados);

        if (listaAuditoria.length > 0 || listaIdsEstornados.length > 0) {
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");

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
                            CASE WHEN ? != 'ND' AND ? != '' THEN ? ELSE COALESCE((SELECT cidade FROM ${tabela} WHERE id = ?), 'ND') END,
                            CASE WHEN ? != 'ND' AND ? != '' THEN ? ELSE COALESCE((SELECT uf FROM ${tabela} WHERE id = ?), 'ND') END,
                            ?, ?, ?, ?, ?, ?, 
                            CASE WHEN ? = 'Vinculada' THEN 'Vinculada' ELSE COALESCE((SELECT status_nfe FROM ${tabela} WHERE id = ?), 'Pendente') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT chave_nfe FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT cnpj_posto FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT cnpj_cliente FROM ${tabela} WHERE id = ?), '') END,
                            ?, 
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT preco_tabela FROM ${tabela} WHERE id = ?), 0) END,
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT preco_bomba_referencia FROM ${tabela} WHERE id = ?), 0) END,
                            ?, ?, ?,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT mensagem FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT id_transacao_estornada FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT hodometro_anterior FROM ${tabela} WHERE id = ?), 0) END,
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT hodometro_atual FROM ${tabela} WHERE id = ?), 0) END,
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT km_rodado FROM ${tabela} WHERE id = ?), 0) END,
                            CASE WHEN ? > 0 THEN ? ELSE COALESCE((SELECT km_por_litro FROM ${tabela} WHERE id = ?), 0) END,
                            ?,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT cartao FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT equipamento FROM ${tabela} WHERE id = ?), '') END,
                            CASE WHEN ? != '' THEN ? ELSE COALESCE((SELECT operador FROM ${tabela} WHERE id = ?), '') END,
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                        )`;

                    const stmtAudit = db.prepare(sqlUpsert('auditoria_transacoes'));
                    const stmtAnalise = db.prepare(sqlUpsert('analise_transacoes'));

                    const montarParams = (ts) => {
                        const vLitro = ts.vol > 0 ? ts.val / ts.vol : 0;
                        return [
                            ts.id, ts.data, ts.estab,
                            ts.cid, ts.cid, ts.cid, ts.id,
                            ts.uf, ts.uf, ts.uf, ts.id,
                            ts.tipo, ts.placa, ts.motorista,
                            ts.vol, ts.val, vLitro,
                            ts.statusNfe, ts.id,
                            ts.chaveNfe, ts.chaveNfe, ts.id,
                            ts.cnpjP, ts.cnpjP, ts.id,
                            ts.cnpjC, ts.cnpjC, ts.id,
                            ts.comb,
                            ts.precoTab, ts.precoTab, ts.id,
                            ts.precoBombaRef, ts.precoBombaRef, ts.id,
                            ts.tipoTransacao, ts.statusTransacao, ts.servico,
                            ts.mensagem, ts.mensagem, ts.id,
                            ts.idEstornada, ts.idEstornada, ts.id,
                            ts.hodAnt, ts.hodAnt, ts.id,
                            ts.hodAtu, ts.hodAtu, ts.id,
                            ts.kmRodado, ts.kmRodado, ts.id,
                            ts.kmPorLitro, ts.kmPorLitro, ts.id,
                            ts.um,
                            ts.cartao, ts.cartao, ts.id,
                            ts.equipamento, ts.equipamento, ts.id,
                            ts.operador, ts.operador, ts.id,
                            ts.dataReg, ts.delayMin, ts.redePosto, ts.subtipoComb,
                            ts.coordPosto, ts.coordVeic, ts.modeloNfe, ts.numeroNfe, ts.chaveValida, ts.payloadJson
                        ];
                    };

                    listaAuditoria.forEach(ts => stmtAudit.run(montarParams(ts)));
                    listaAnalise.forEach(ts => stmtAnalise.run(montarParams(ts)));

                    stmtAudit.finalize();
                    stmtAnalise.finalize();

                    db.run("COMMIT", async (err) => {
                        if (err) return reject(err);
                        try {
                            await autoSanitizarBanco();
                            resolve();
                        } catch (sanErr) {
                            console.error("Erro na sanitização:", sanErr);
                            resolve();
                        }
                    });
                });
            });

            await registrarLogSync(origem, `${dtIsoIni} a ${dtIsoFim}`, listaAnalise.length, listaAuditoria.length, listaIdsEstornados.length, 'OK', 'Sincronização concluída');
            console.log(`✅ [${origem}] ${listaAnalise.length} compras líquidas em Análise | ${listaAuditoria.length} em Auditoria.`);
        } else {
            // Mesmo sem novos downloads da API, garante a sanitização local
            await autoSanitizarBanco();
        }
    } catch (error) {
        await registrarLogSync(origem, `${dtIsoIni} a ${dtIsoFim}`, 0, 0, 0, 'ERRO', error.message);
        console.error("❌ ERRO SYNC:", error.message);
    }
}

async function cacaNotasPendentes() {
    try {
        const dtLimite = getDataBrasil(-25);
        const rows = await dbAll(
            `SELECT DISTINCT SUBSTR(data, 1, 10) as dtIso FROM auditoria_transacoes WHERE status_nfe = 'Pendente' AND SUBSTR(data, 1, 10) >= ? ORDER BY dtIso DESC`,
            [dtLimite]
        );
        if (rows.length === 0) return;

        const token = await auth();
        const headers = { 'Authorization': `Bearer ${token}` };

        for (const row of rows) {
            const dtIso = row.dtIso;
            if (!dtIso || dtIso.length !== 10) continue;

            let pag = 1;
            const notasEncontradas = [];
            while (true) {
                const offset = (pag - 1) * 500;
                const urlNfe = `https://api.truckpag.com.br/NotaFiscal/Vinculo?todas=S&dtIni=${dtIso}&dtFim=${dtIso}&pagina=${pag}&page=${pag}&limit=500&offset=${offset}`;
                const dataNfe = await fetchComRetentativa(urlNfe, headers);
                const lote = Array.isArray(dataNfe) ? dataNfe : (dataNfe?.Notas || dataNfe?.Vinculos || dataNfe?.data || []);
                if (!Array.isArray(lote) || lote.length === 0) break;

                notasEncontradas.push(...lote);
                if (lote.length < 500) break;
                pag++;
                await delay(1100);
            }

            if (notasEncontradas.length > 0) {
                await new Promise((resolve) => {
                    db.serialize(() => {
                        db.run("BEGIN TRANSACTION");
                        const sqlUpdateNfe = (tabela) => `
                            UPDATE ${tabela} 
                            SET status_nfe = 'Vinculada', 
                                chave_nfe = ?, 
                                modelo_nfe = ?,
                                numero_nfe = ?,
                                chave_valida = ?,
                                cnpj_cliente = CASE WHEN ? != '' THEN ? ELSE cnpj_cliente END,
                                cnpj_posto = CASE WHEN ? != '' THEN ? ELSE cnpj_posto END
                            WHERE id = ?
                        `;
                        const stmtAudit = db.prepare(sqlUpdateNfe('auditoria_transacoes'));
                        const stmtAnalise = db.prepare(sqlUpdateNfe('analise_transacoes'));

                        notasEncontradas.forEach(n => {
                            const chave = String(n.ChaveNFe || n.chave_nfe || '').trim();
                            const idTr = String(n.IdTransacao || n.Transacao || '').trim();
                            const cnpjCli = String(n.CNPJCliente || '').trim();
                            const cnpjPos = String(n.CNPJPosto || '').trim();
                            if (chave && idTr) {
                                const info = inspecionarChaveNFe(chave);
                                const params = [
                                    chave, info.modelo, info.numeroNota, info.valida ? 1 : 0,
                                    cnpjCli, cnpjCli, cnpjPos, cnpjPos, idTr
                                ];
                                stmtAudit.run(params);
                                stmtAnalise.run(params);
                            }
                        });
                        stmtAudit.finalize();
                        stmtAnalise.finalize();
                        db.run("COMMIT", () => resolve());
                    });
                });
            }
            await delay(1800);
        }
    } catch (e) {
        console.error("⚠️ Erro no Caçador de NFe:", e.message);
    }
}

module.exports = {
    sincronizarPeriodoSeguro,
    cacaNotasPendentes,
    registrarLogSync,
    autoSanitizarBanco,
    encontrarAcordoCompletoLocal
};