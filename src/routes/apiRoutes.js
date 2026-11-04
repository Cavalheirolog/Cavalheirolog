
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const dadosController = require('../controllers/dadosController');
const configController = require('../controllers/configController');
const precosController = require('../controllers/precosController');
const auditoriaController = require('../controllers/auditoriaController');
const syncController = require('../controllers/syncController');


// ============================================================================
// ROTAS DA API MODULAR CAVALHEIROLOG
// ============================================================================

// Autenticação e Utilizadores
router.post('/usuarios/login', authController.login);
router.post('/usuarios', authController.salvarUsuario);

// Dados e Análise de Abastecimentos Líquidos
router.get('/dados', dadosController.obterDadosAnalise);
// Rotas de Sincronização Nativa com a API TruckPag
router.post('/buscar-auditoria', syncController.sincronizarAbastecimentosApi);
router.post('/forcar-sync-background', syncController.sincronizarVeiculos);
router.post('/conciliar-csv', dadosController.conciliarCsv);

// Configurações do Sistema e Layout
router.get('/configuracoes', configController.obterConfiguracoes);
router.post('/configuracoes', configController.salvarConfiguracoes);
router.get('/status-sistema', configController.statusSistema);

// Gestão Automatizada de Preços, Benchmark e Impacto Financeiro (Bomba x Negociado x Pago)
router.get('/precos-negociados', precosController.listarPrecosNegociados);
router.post('/precos-negociados', precosController.salvarPrecoNegociado);
router.delete('/precos-negociados/:id', precosController.excluirPrecoNegociado);
router.post('/conciliar-precos-lote', precosController.conciliarPrecosLote);
router.get('/relatorio-impacto', precosController.relatorioImpactoPrecos);

// Auditoria Fiscal (NFe, SLA, CNPJ ICMS, Glosa e Visualizador Direto de DANFE)
router.get('/auditoria', auditoriaController.obterAuditoria);
router.get('/relatorio-glosa', auditoriaController.relatorioGlosa);
router.get('/danfe/:chave', auditoriaController.gerarDanfeHtml);

module.exports = router;