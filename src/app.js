const express = require('express');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API
app.use('/api', apiRoutes);

// Rota raiz para servir o painel frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;