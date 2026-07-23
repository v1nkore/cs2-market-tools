FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# браузеры уже в образе; панель берёт путь из этой переменной
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 4317

# при монтировании папки с хоста (-v) node_modules образа затеняется — доустановим
CMD ["sh", "-c", "[ -d node_modules/playwright ] || npm ci --omit=dev; exec node ui_server.mjs"]
