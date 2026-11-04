# Usa uma imagem leve do Node.js
FROM node:20-alpine

# Define a pasta de trabalho dentro do contêiner
WORKDIR /app

# Copia os arquivos de dependências e instala apenas o necessário para produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o restante dos arquivos do projeto
COPY . .

# Cria a pasta para salvar o banco SQLite de forma persistente
RUN mkdir -p /app/data

# Define as variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Expõe a porta que o app usa
EXPOSE 3000

# Comando para iniciar a aplicação (substitua server.js se o seu arquivo principal tiver outro nome)
CMD ["node", "server.js"]