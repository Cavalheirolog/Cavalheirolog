const { dbAll } = require('../config/database');
const { sincronizarPeriodoSeguro } = require('../services/syncService');
const { construirAnaliseCompleta } = require('../services/biAnalyticsService');
const { resolverCoordenadaPosto } = require('../utils/geoResolver');

// ============================================================================
// CONTROLLER DE ANÁLISE E BI
// ============================================================================

async function getDadosAnalise(req, res) {
    try {
        const { dtIni, dtFim, tipoBomba, combustivel, rede, uf, placa, motorista, sync } = req.query;
        if (!dtIni || !dtFim) return res.status(400).json({ error: "Informe dtIni e dtFim" });

        if (sync === 'true') {
            await sincronizarPeriodoSeguro(dtIni, dtFim, false, 'FiltroAnalise');
        }

        const params = [dtIni, dtFim];
        let filtroExtra = '';

        if (tipoBomba && tipoBomba !== 'todos') {
            filtroExtra += ` AND UPPER(COALESCE(tipoAbastecimento, '')) = ?`;
            params.push(String(tipoBomba).toUpperCase().trim());
        }
        if (combustivel && combustivel !== 'todos') {
            const cUp = combustivel.toUpperCase().trim();
            if (cUp === 'ARLA') {
                filtroExtra += ` AND UPPER(COALESCE(combustivel, '')) LIKE '%ARLA%'`;
            } else if (cUp === 'DIESEL') {
                filtroExtra += ` AND UPPER(COALESCE(combustivel, '')) NOT LIKE '%ARLA%'`;
            } else if (cUp === 'S10') {
                filtroExtra += ` AND UPPER(COALESCE(combustivel, '')) LIKE '%S10%'`;
            } else if (cUp === 'S500') {
                filtroExtra += ` AND UPPER(COALESCE(combustivel, '')) LIKE '%S500%'`;
            }
        }
        if (rede && rede !== 'todos') {
            filtroExtra += ` AND UPPER(COALESCE(rede_posto, '')) = ?`;
            params.push(String(rede).toUpperCase().trim());
        }
        if (uf && uf !== 'todos') {
            filtroExtra += ` AND UPPER(COALESCE(uf, '')) = ?`;
            params.push(String(uf).toUpperCase().trim());
        }
        if (placa && placa !== 'todos') {
            filtroExtra += ` AND UPPER(COALESCE(placa, '')) = ?`;
            params.push(String(placa).toUpperCase().trim());
        }
        if (motorista && motorista !== 'todos') {
            filtroExtra += ` AND UPPER(COALESCE(motorista, '')) LIKE ?`;
            params.push(`%${String(motorista).toUpperCase().trim()}%`);
        }

        const query = `
            SELECT * FROM analise_transacoes 
            WHERE SUBSTR(data, 1, 10) >= ? AND SUBSTR(data, 1, 10) <= ? 
              AND volume > 0 
              AND COALESCE(UPPER(tipo_transacao), 'COMPRA') IN ('COMPRA', 'MANUAL')
              AND COALESCE(UPPER(status_transacao), 'APROVADA') = 'APROVADA'
              AND COALESCE(UPPER(servico), 'ABASTECIMENTO') NOT LIKE '%MANUTENCAO%'
              AND COALESCE(UPPER(tipoAbastecimento), '') NOT LIKE '%ESTORNO%'
              ${filtroExtra}
            ORDER BY data DESC, id DESC
        `;

        const rows = await dbAll(query, params);
        const frotaParams = await dbAll(`SELECT * FROM frota_parametros`);
        const frotaMap = new Map(frotaParams.map(f => [f.placa, f]));

        const transacoesGeorreferenciadas = rows.map(r => {
            const coord = resolverCoordenadaPosto(r.estabelecimento, r.cidade, r.uf, r.coord_posto);
            return {
                ...r,
                lat: coord.lat,
                lng: coord.lng,
                precisaoGeo: coord.precisao
            };
        });

        const analise = construirAnaliseCompleta(transacoesGeorreferenciadas, frotaMap);

        res.json({
            transacoes: transacoesGeorreferenciadas,
            resumo: analise.resumo,
            rankings: analise.rankings
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getDadosAnalise
};