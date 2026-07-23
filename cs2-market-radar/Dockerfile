FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV GIT_AUTOPUSH=0
EXPOSE 8319
CMD ["sh", "-c", "[ -d node_modules/playwright ] || npm install --omit=dev; exec node server.mjs"]
