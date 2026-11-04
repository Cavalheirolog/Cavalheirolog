const { toMl, fromMl, toCents, fromCents, calcularDelayMinutos } = require('../utils/helpers');
const { resolverCoordenadaPosto, normalizarUf } = require('../utils/geoResolver');
const { classificarSubtipoCombustivel, extrairRedePosto } = require('../utils/businessRules');
const { ALIQUOTAS_ICMS_UF, mapaLocalizacaoPostos } = require('../config/constants');
const { normalizarTexto } = require('../utils/helpers');

// ============================================================================
// SERVIÇO DE BI & ANALYTICS (INDICADORES, RANKINGS E ALERTAS)
// ============================================================================

function construirAnaliseCompleta(rows, frotaMap = new Map()) {
    const postosSet = new Set();
    const placasSet = new Set();
    const motoristasSet = new Set();

    const acumDiesel = {
        volMl: 0, pagoCents: 0, volTabMl: 0, tabNegociadoCents: 0, tabBombaCents: 0,
        ecoRealCents: 0, descNegociadoCents: 0, glosaCents: 0,
        qtd: 0, minLitro: Infinity, maxLitro: 0, s10Ml: 0, s500Ml: 0
    };
    const acumArla = {
        volMl: 0, pagoCents: 0, volTabMl: 0, tabNegociadoCents: 0, tabBombaCents: 0,
        ecoRealCents: 0, descNegociadoCents: 0, glosaCents: 0,
        qtd: 0, minLitro: Infinity, maxLitro: 0
    };

    let kmRodadoTotal = 0;
    let litrosComHodometroValido = 0;

    const mapPostos = new Map();
    const mapRedes = new Map();
    const mapUFs = new Map();
    const mapPlacas = new Map();
    const mapMotoristas = new Map();
    const alertasOperacionais = [];

    const porPlacaTempo = [...rows].sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const ultimoAbastPorPlacaComb = new Map();

    porPlacaTempo.forEach(r => {
        const chave = `${r.placa}|${r.subtipo_combustivel || r.combustivel}`;
        if (r.placa && ultimoAbastPorPlacaComb.has(chave)) {
            const ant = ultimoAbastPorPlacaComb.get(chave);
            const diffMin = calcularDelayMinutos(ant.data, r.data);
            if (diffMin >= 0 && diffMin <= 30 && ant.estabelecimento === r.estabelecimento && ant.id !== r.id) {
                alertasOperacionais.push({
                    tipo: 'DUPLA_PASSAGEM',
                    severidade: 'warning',
                    idTransacao: r.id,
                    data: r.data,
                    placa: r.placa,
                    motorista: r.motorista,
                    estabelecimento: r.estabelecimento,
                    detalhe: `Abastecimento repetido em ${diffMin} min no mesmo posto (${r.volume} L após transação #${ant.id} de ${ant.volume} L).`
                });
            }
        }
        if (r.placa) ultimoAbastPorPlacaComb.set(chave, r);
    });

    rows.forEach(r => {
        const vol = Number(r.volume) || 0;
        const val = Number(r.valor_total) || 0;
        const vLitroPago = vol > 0 ? val / vol : (Number(r.valor_litro) || 0);
        const precoNegociado = Number(r.preco_tabela) || 0;
        const precoBombaRef = Number(r.preco_bomba_referencia) > 0 ? Number(r.preco_bomba_referencia) : (precoNegociado > 0 ? Math.max(precoNegociado, vLitroPago) : vLitroPago);

        const volMl = toMl(vol);
        const valCents = toCents(val);

        const comb = String(r.combustivel || '').toUpperCase();
        const subComb = r.subtipo_combustivel || classificarSubtipoCombustivel(comb);
        const isArla = comb.includes('ARLA');
        const estab = r.estabelecimento || 'POSTO ND';
        const rede = r.rede_posto || extrairRedePosto(estab);
        const uf = normalizarUf(r.uf, estab, r.cidade);
        const cidade = (r.cidade && r.cidade !== 'ND') ? r.cidade : (mapaLocalizacaoPostos.get(normalizarTexto(estab))?.cidade || 'ND');
        const placa = r.placa || 'SEM PLACA';
        const motorista = r.motorista || 'NÃO INFORMADO';

        postosSet.add(estab);
        if (r.placa) placasSet.add(r.placa);
        if (r.motorista) motoristasSet.add(r.motorista);

        const paramPlaca = frotaMap.get(placa);
        const capMax = paramPlaca ? paramPlaca.capacidade_tanque : 1000;
        if (!isArla && vol > capMax) {
            alertasOperacionais.push({
                tipo: 'ACIMA_CAPACIDADE_TANQUE',
                severidade: 'danger',
                idTransacao: r.id,
                data: r.data,
                placa,
                motorista,
                estabelecimento: estab,
                detalhe: `Abastecimento de ${vol.toFixed(2)} L excede a capacidade parametrizada do tanque (${capMax} L).`
            });
        }

        const alvo = isArla ? acumArla : acumDiesel;
        alvo.volMl += volMl;
        alvo.pagoCents += valCents;
        alvo.qtd += 1;
        if (vLitroPago > 0) {
            if (vLitroPago < alvo.minLitro) alvo.minLitro = vLitroPago;
            if (vLitroPago > alvo.maxLitro) alvo.maxLitro = vLitroPago;
        }
        if (!isArla) {
            if (subComb.includes('S500')) acumDiesel.s500Ml += volMl;
            else acumDiesel.s10Ml += volMl;
        }

        let ecoCentsItem = 0;
        let custoNegociadoCentsItem = 0;
        let custoBombaRefCentsItem = 0;

        if (precoNegociado > 0) {
            custoNegociadoCentsItem = toCents(vol * precoNegociado);
            custoBombaRefCentsItem = toCents(vol * precoBombaRef);
            ecoCentsItem = custoNegociadoCentsItem - valCents;

            alvo.volTabMl += volMl;
            alvo.tabNegociadoCents += custoNegociadoCentsItem;
            alvo.tabBombaCents += custoBombaRefCentsItem;
            alvo.ecoRealCents += ecoCentsItem;
            alvo.descNegociadoCents += (custoBombaRefCentsItem - custoNegociadoCentsItem);

            if (valCents > custoNegociadoCentsItem) {
                alvo.glosaCents += (valCents - custoNegociadoCentsItem);
            }

            if (vLitroPago - precoNegociado > 0.02) {
                alertasOperacionais.push({
                    tipo: 'ACIMA_PRECO_ACORDO',
                    severidade: 'danger',
                    idTransacao: r.id,
                    data: r.data,
                    placa,
                    motorista,
                    estabelecimento: estab,
                    detalhe: `Cobrado R$ ${vLitroPago.toFixed(3)}/L vs Negociado R$ ${precoNegociado.toFixed(3)}/L (Glosa de R$ ${(Math.abs(ecoCentsItem) / 100).toFixed(2)}).`
                });
            }
        }

        const kmRod = Number(r.km_rodado) || 0;
        if (!isArla && kmRod > 0) {
            kmRodadoTotal += kmRod;
            litrosComHodometroValido += vol;
        }

        if (!mapPostos.has(estab)) {
            const coord = resolverCoordenadaPosto(estab, cidade, uf, r.coord_posto);
            mapPostos.set(estab, {
                posto: estab, rede, cidade, uf, cnpj_posto: r.cnpj_posto,
                lat: coord.lat, lng: coord.lng, precisaoGeo: coord.precisao,
                volMl: 0, dieselMl: 0, arlaMl: 0, custoCents: 0, ecoCents: 0,
                tabNegCents: 0, tabBombaCents: 0, volTabMl: 0, qtd: 0
            });
        }
        const pObj = mapPostos.get(estab);
        pObj.volMl += volMl;
        if (isArla) pObj.arlaMl += volMl; else pObj.dieselMl += volMl;
        pObj.custoCents += valCents;
        pObj.ecoCents += ecoCentsItem;
        pObj.tabNegCents += custoNegociadoCentsItem;
        pObj.tabBombaCents += custoBombaRefCentsItem;
        if (precoNegociado > 0) pObj.volTabMl += volMl;
        pObj.qtd += 1;

        if (!mapRedes.has(rede)) {
            mapRedes.set(rede, { rede, postosSet: new Set(), volMl: 0, dieselMl: 0, arlaMl: 0, custoCents: 0, ecoCents: 0, qtd: 0 });
        }
        const rObj = mapRedes.get(rede);
        rObj.postosSet.add(estab);
        rObj.volMl += volMl;
        if (isArla) rObj.arlaMl += volMl; else rObj.dieselMl += volMl;
        rObj.custoCents += valCents;
        rObj.ecoCents += ecoCentsItem;
        rObj.qtd += 1;

        if (!mapUFs.has(uf)) {
            mapUFs.set(uf, { uf, volMl: 0, dieselMl: 0, arlaMl: 0, custoCents: 0, ecoCents: 0, qtd: 0, aliquotaIcms: ALIQUOTAS_ICMS_UF[uf] || 0.12 });
        }
        const uObj = mapUFs.get(uf);
        uObj.volMl += volMl;
        if (isArla) uObj.arlaMl += volMl; else uObj.dieselMl += volMl;
        uObj.custoCents += valCents;
        uObj.ecoCents += ecoCentsItem;
        uObj.qtd += 1;

        if (!mapPlacas.has(placa)) {
            mapPlacas.set(placa, { placa, motoristaPrincipal: motorista, volMl: 0, dieselMl: 0, arlaMl: 0, custoCents: 0, ecoCents: 0, kmRodado: 0, litrosComHod: 0, qtd: 0 });
        }
        const plObj = mapPlacas.get(placa);
        plObj.volMl += volMl;
        if (isArla) plObj.arlaMl += volMl; else plObj.dieselMl += volMl;
        plObj.custoCents += valCents;
        plObj.ecoCents += ecoCentsItem;
        if (!isArla && kmRod > 0) {
            plObj.kmRodado += kmRod;
            plObj.litrosComHod += vol;
        }
        plObj.qtd += 1;

        if (!mapMotoristas.has(motorista)) {
            mapMotoristas.set(motorista, { motorista, placasSet: new Set(), volMl: 0, dieselMl: 0, arlaMl: 0, custoCents: 0, ecoCents: 0, kmRodado: 0, litrosComHod: 0, qtd: 0 });
        }
        const mObj = mapMotoristas.get(motorista);
        if (r.placa) mObj.placasSet.add(r.placa);
        mObj.volMl += volMl;
        if (isArla) mObj.arlaMl += volMl; else mObj.dieselMl += volMl;
        mObj.custoCents += valCents;
        mObj.ecoCents += ecoCentsItem;
        if (!isArla && kmRod > 0) {
            mObj.kmRodado += kmRod;
            mObj.litrosComHod += vol;
        }
        mObj.qtd += 1;
    });

    const dieselVol = fromMl(acumDiesel.volMl);
    const dieselPago = fromCents(acumDiesel.pagoCents);
    const dieselVolTab = fromMl(acumDiesel.volTabMl);
    const dieselTab = fromCents(acumDiesel.tabNegociadoCents);
    const dieselEco = fromCents(acumDiesel.ecoRealCents);

    const arlaVol = fromMl(acumArla.volMl);
    const arlaPago = fromCents(acumArla.pagoCents);
    const arlaVolTab = fromMl(acumArla.volTabMl);
    const arlaTab = fromCents(acumArla.tabNegociadoCents);
    const arlaEco = fromCents(acumArla.ecoRealCents);

    const volumeGlobal = fromMl(acumDiesel.volMl + acumArla.volMl);
    const faturamentoGlobal = fromCents(acumDiesel.pagoCents + acumArla.pagoCents);
    const economiaGlobal = fromCents(acumDiesel.ecoRealCents + acumArla.ecoRealCents);
    const volumeComTabelaGlobal = fromMl(acumDiesel.volTabMl + acumArla.volTabMl);
    const valorTabelaGlobal = fromCents(acumDiesel.tabNegociadoCents + acumArla.tabNegociadoCents);
    const glosaTotalGlobal = fromCents(acumDiesel.glosaCents + acumArla.glosaCents);

    const proporcaoArlaSobreDieselPct = dieselVol > 0 ? Number(((arlaVol / dieselVol) * 100).toFixed(2)) : 0;
    const mediaKmPorLitroFrota = litrosComHodometroValido > 0 ? Number((kmRodadoTotal / litrosComHodometroValido).toFixed(2)) : 0;

    const porPosto = Array.from(mapPostos.values()).map(p => {
        const vol = fromMl(p.volMl);
        const volTab = fromMl(p.volTabMl);
        const custo = fromCents(p.custoCents);
        const tabNeg = fromCents(p.tabNegCents);
        const tabBomba = fromCents(p.tabBombaCents);
        const pmPago = vol > 0 ? Number((custo / vol).toFixed(3)) : 0;
        const pmNegociado = volTab > 0 ? Number((tabNeg / volTab).toFixed(3)) : 0;
        const pmBombaRef = volTab > 0 ? Number((tabBomba / volTab).toFixed(3)) : pmPago;
        return {
            posto: p.posto,
            rede: p.rede,
            cidade: p.cidade,
            uf: p.uf,
            cnpj_posto: p.cnpj_posto,
            lat: p.lat,
            lng: p.lng,
            precisaoGeo: p.precisaoGeo,
            qtdAbastecimentos: p.qtd,
            volume: vol,
            volumeDiesel: fromMl(p.dieselMl),
            volumeArla: fromMl(p.arlaMl),
            volComTabela: volTab,
            custo,
            custoTabela: tabNeg,
            precoBombaMedio: pmBombaRef,
            precoTabelaMedio: pmNegociado,
            precoMedio: pmPago,
            economia: fromCents(p.ecoCents),
            economiaPorLitro: volTab > 0 ? Number(((tabNeg - custo) / volTab).toFixed(3)) : 0
        };
    }).sort((a, b) => b.volume - a.volume);

    const porRede = Array.from(mapRedes.values()).map(x => ({
        rede: x.rede,
        qtdPostos: x.postosSet.size,
        qtdAbastecimentos: x.qtd,
        volumeTotal: fromMl(x.volMl),
        volumeDiesel: fromMl(x.dieselMl),
        volumeArla: fromMl(x.arlaMl),
        custoTotal: fromCents(x.custoCents),
        precoMedio: x.volMl > 0 ? Number((fromCents(x.custoCents) / fromMl(x.volMl)).toFixed(3)) : 0,
        economiaReal: fromCents(x.ecoCents),
        participacaoPct: volumeGlobal > 0 ? Number(((fromMl(x.volMl) / volumeGlobal) * 100).toFixed(2)) : 0
    })).sort((a, b) => b.volumeTotal - a.volumeTotal);

    const porUF = Array.from(mapUFs.values()).map(x => {
        const custo = fromCents(x.custoCents);
        return {
            uf: x.uf,
            qtdAbastecimentos: x.qtd,
            volumeTotal: fromMl(x.volMl),
            volumeDiesel: fromMl(x.dieselMl),
            volumeArla: fromMl(x.arlaMl),
            custoTotal: custo,
            precoMedio: x.volMl > 0 ? Number((custo / fromMl(x.volMl)).toFixed(3)) : 0,
            economiaReal: fromCents(x.ecoCents),
            aliquotaIcmsPct: Number((x.aliquotaIcms * 100).toFixed(1)),
            creditoIcmsEstimado: Number((custo * x.aliquotaIcms).toFixed(2))
        };
    }).sort((a, b) => b.volumeTotal - a.volumeTotal);

    const porPlaca = Array.from(mapPlacas.values()).map(x => {
        const dL = fromMl(x.dieselMl);
        const aL = fromMl(x.arlaMl);
        const cT = fromCents(x.custoCents);
        return {
            placa: x.placa,
            motoristaPrincipal: x.motoristaPrincipal,
            qtdAbastecimentos: x.qtd,
            volumeTotal: fromMl(x.volMl),
            volumeDiesel: dL,
            volumeArla: aL,
            proporcaoArlaPct: dL > 0 ? Number(((aL / dL) * 100).toFixed(2)) : 0,
            custoTotal: cT,
            precoMedio: x.volMl > 0 ? Number((cT / fromMl(x.volMl)).toFixed(3)) : 0,
            economiaReal: fromCents(x.ecoCents),
            kmRodado: Number(x.kmRodado.toFixed(1)),
            kmPorLitro: x.litrosComHod > 0 ? Number((x.kmRodado / x.litrosComHod).toFixed(2)) : 0,
            custoPorKm: x.kmRodado > 0 ? Number((cT / x.kmRodado).toFixed(2)) : 0
        };
    }).sort((a, b) => b.volumeTotal - a.volumeTotal);

    const porMotorista = Array.from(mapMotoristas.values()).map(x => {
        const cT = fromCents(x.custoCents);
        return {
            motorista: x.motorista,
            placas: Array.from(x.placasSet).join(', '),
            qtdAbastecimentos: x.qtd,
            volumeTotal: fromMl(x.volMl),
            volumeDiesel: fromMl(x.dieselMl),
            volumeArla: fromMl(x.arlaMl),
            custoTotal: cT,
            precoMedio: x.volMl > 0 ? Number((cT / fromMl(x.volMl)).toFixed(3)) : 0,
            economiaReal: fromCents(x.ecoCents),
            kmRodado: Number(x.kmRodado.toFixed(1)),
            kmPorLitro: x.litrosComHod > 0 ? Number((x.kmRodado / x.litrosComHod).toFixed(2)) : 0
        };
    }).sort((a, b) => b.volumeTotal - a.volumeTotal);

    return {
        resumo: {
            postosUtilizados: postosSet.size,
            placasAtivas: placasSet.size,
            motoristasAtivos: motoristasSet.size,
            totalTransacoes: rows.length,
            volumeGlobal,
            faturamentoGlobal,
            economiaGlobal,
            glosaTotalGlobal,
            economiaPorLitroGlobal: volumeComTabelaGlobal > 0 ? Number((economiaGlobal / volumeComTabelaGlobal).toFixed(3)) : 0,
            volumeComTabelaGlobal,
            valorTabelaGlobal,
            coberturaTabelaPercentual: volumeGlobal > 0 ? Number(((volumeComTabelaGlobal / volumeGlobal) * 100).toFixed(2)) : 0,
            proporcaoArlaSobreDieselPct,
            kmRodadoTotal: Number(kmRodadoTotal.toFixed(1)),
            mediaKmPorLitroFrota,
            diesel: {
                volume: dieselVol,
                volumeS10: fromMl(acumDiesel.s10Ml),
                volumeS500: fromMl(acumDiesel.s500Ml),
                valorPago: dieselPago,
                volumeComTabela: dieselVolTab,
                valorTabela: dieselTab,
                economiaReal: dieselEco,
                economiaPorLitro: dieselVolTab > 0 ? Number((dieselEco / dieselVolTab).toFixed(3)) : 0,
                qtdAbastecimentos: acumDiesel.qtd,
                precoMedioPago: dieselVol > 0 ? Number((dieselPago / dieselVol).toFixed(3)) : 0,
                precoMedioTabela: dieselVolTab > 0 ? Number((dieselTab / dieselVolTab).toFixed(3)) : 0,
                menorPrecoPago: acumDiesel.minLitro === Infinity ? 0 : Number(acumDiesel.minLitro.toFixed(3)),
                maiorPrecoPago: Number(acumDiesel.maxLitro.toFixed(3))
            },
            arla: {
                volume: arlaVol,
                valorPago: arlaPago,
                volumeComTabela: arlaVolTab,
                valorTabela: arlaTab,
                economiaReal: arlaEco,
                economiaPorLitro: arlaVolTab > 0 ? Number((arlaEco / arlaVolTab).toFixed(3)) : 0,
                qtdAbastecimentos: acumArla.qtd,
                precoMedioPago: arlaVol > 0 ? Number((arlaPago / arlaVol).toFixed(3)) : 0,
                precoMedioTabela: arlaVolTab > 0 ? Number((arlaTab / arlaVolTab).toFixed(3)) : 0,
                menorPrecoPago: acumArla.minLitro === Infinity ? 0 : Number(acumArla.minLitro.toFixed(3)),
                maiorPrecoPago: Number(acumArla.maxLitro.toFixed(3))
            }
        },
        rankings: {
            porPosto,
            porRede,
            porUF,
            porPlaca,
            porMotorista,
            alertasOperacionais: alertasOperacionais.slice(0, 100)
        }
    };
}

module.exports = {
    construirAnaliseCompleta
};