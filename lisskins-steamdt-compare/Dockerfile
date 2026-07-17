FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# внутри контейнера git-креденшалов нет — пуш выключен
ENV GIT_AUTOPUSH=0
EXPOSE 8317

CMD ["node", "server.mjs"]
