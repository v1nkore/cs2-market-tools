FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# внутри контейнера git-креденшалов нет — пуш выключен
ENV GIT_AUTOPUSH=0
EXPOSE 8317

# Если папка проекта примонтирована с хоста (-v ...:/app), она затеняет node_modules
# образа — тогда доустанавливаем зависимости при старте (браузеры уже в /ms-playwright).
CMD ["sh", "-c", "[ -d node_modules/playwright ] || npm install --omit=dev; exec node server.mjs"]
