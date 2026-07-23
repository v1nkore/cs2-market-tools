# CS2 Market Tools

Набор независимых инструментов для отслеживания и сравнения цен и статистики по скинам CS2 на разных площадках (lis-skins, Steam, BUFF, YouPin/悠悠, агрегатор SteamDT). Каждый инструмент — отдельная папка со своим README, можно использовать по отдельности.

Все решения проверены на запуск с чистого клона: локально (Windows/Linux/macOS) и в Docker.

## Требования

| Проект | Локальный запуск | Docker |
|---|---|---|
| `cs2-market-radar` | Node.js ≥ 18, npm; Chromium (~500 МБ) ставится сам при `npm install` | образ `mcr.microsoft.com/playwright:v1.61.1-noble` (тянется сам) |
| `lisskins-steamdt-compare` | Node.js ≥ 18, npm; Chromium (~500 МБ) ставится сам при `npm install` | образ `mcr.microsoft.com/playwright:v1.61.1-noble` (тянется сам) |
| `steamdt-cs2-tracker` | Node.js ≥ 18, npm; Chromium ставится сам при `npm ci` | образ `mcr.microsoft.com/playwright:v1.60.0-noble` (тянется сам) |
| `cs2-china-stats` | только браузер | не нужен |

Общее: интернет-доступ к lis-skins.com / steamdt.com (для первых двух); `.bat`-файлы — только Windows, на Linux/macOS используйте команды `node ...`; с датацентровых/VPN IP антибот сайтов срабатывает чаще, чем с домашнего.

## Проекты

### [`cs2-market-radar/`](cs2-market-radar/)

Дашборд активного рынка CS2 (~1000 позиций) по рейтингам SteamDT: что откупают, где обваливаются лоты, где скачет цена, на что идёт хайп. Каскадные фильтры (категория→редкость→износ/финиш→качество), переключение периода (24ч/3д/7д/30д) и **индексы аномалий** (всплеск сделок, обвал лотов, скачок цены, взлёт популярности). Тянет готовый агрегат вместо тысяч карточек — быстро и мимо дневного лимита SteamDT.

**Запуск (Windows):** `Открыть панель.bat` → http://localhost:8319.

**Запуск (любая ОС):**
```
cd cs2-market-radar
npm install          # Chromium скачается автоматически
node server.mjs      # панель на http://localhost:8319
```

**Docker:**
```
cd cs2-market-radar
docker build -t cs2-market-radar .
docker run -d --name cs2-radar -p 8319:8319 -v "%cd%:/app" cs2-market-radar
# PowerShell: -v "${PWD}:/app"   bash: -v "$(pwd):/app"
```
Кнопка «Собрать заново» на панели пересобирает данные (~3-5 мин) и перезаписывает `index.html`/`data.json`.

---

### [`lisskins-steamdt-compare/`](lisskins-steamdt-compare/)

Сравнение цен избранного списка скинов с lis-skins.com против Steam, BUFF и YouPin (данные — через агрегатор SteamDT). Интерактивная HTML-таблица с поиском, фильтрами по категории и редкости, сортировкой и подсветкой самой дешёвой площадки, плюс выгрузка в Excel. Пересборка данных — по кнопке на локальной панели: headless-Chromium сам собирает свежие цены и перезаписывает `index.html`/`comparison.xlsx`/`data.json` на диске.

**Запуск (Windows):** двойной клик по `Открыть панель.bat` → http://localhost:8317 (первый запуск сам ставит зависимости).

**Запуск (любая ОС):**
```
cd lisskins-steamdt-compare
npm install          # Chromium скачается автоматически
node server.mjs      # панель на http://localhost:8317
```

**Запуск в Docker:**
```
cd lisskins-steamdt-compare
docker build -t lisskins-steamdt-compare .
docker run -d --name lisskins-compare -p 8317:8317 -v "%cd%:/app" lisskins-steamdt-compare
# PowerShell: -v "${PWD}:/app"   bash: -v "$(pwd):/app"
```
Том монтирует папку проекта, чтобы пересборка перезаписывала файлы на хосте; если в ней нет `node_modules` (свежий клон) — контейнер доустановит их сам при старте. Готовый `index.html` можно смотреть и просто как файл.

---

### [`steamdt-cs2-tracker/`](steamdt-cs2-tracker/)

Трекер показателя «продано сегодня» (Sold Today) для наклеек киберспортивных команд и популярных пушек — данные снимаются со SteamDT, копится история по дням, строятся HTML-отчёты (дашборд, сводная матрица по дням, снимок за конкретный день).

**Запуск (Windows):** двойной клик по `Открыть панель.bat` → http://localhost:4317 (первый запуск сам ставит зависимости).

**Запуск (любая ОС):**
```
cd steamdt-cs2-tracker
npm ci               # Chromium скачается автоматически
node ui_server.mjs   # панель на http://localhost:4317
```

**Запуск из консоли без панели:**
```
node scrape.mjs                      # полный сбор наклеек
node scrape.mjs --tournament austin  # только один турнир
node report.mjs                      # пересобрать HTML-отчёты
node scrape_guns.mjs                 # сбор пушек
```

**Запуск в Docker:**
```
cd steamdt-cs2-tracker
docker build -t steamdt-cs2-tracker .
docker run -p 4317:4317 -v "%cd%/data:/app/data" -v "%cd%/reports:/app/reports" steamdt-cs2-tracker
# PowerShell: ${PWD} вместо %cd%   bash: $(pwd)
```
Тома для `data/` и `reports/` — чтобы история и отчёты не терялись между перезапусками (для пушек аналогично `data_guns/`, `reports_guns/`). Собранные данные в git не хранятся — свежий клон начинает историю с нуля.

---

### [`cs2-china-stats/`](cs2-china-stats/)

Дашборд статистики по предметам CS2 из инвентарей отслеживаемых китайских инвесторов: таблица с количеством и долей от общего числа, разбивка по 20 категориям, топ-15 предметов, поиск и фильтры. Данные — встроенный снимок из публичной Google-таблицы с кнопкой обновления «на лету».

**Запуск:** открыть `cs2-china-stats/index.html` двойным кликом в любом браузере — установки не требуется. Можно развернуть на GitHub Pages (Settings → Pages → Deploy from a branch).

---

## Общее

- Все три инструмента так или иначе работают со SteamDT и/или lis-skins — оба сайта блокируют прямые API-запросы антиботом, поэтому сбор данных везде идёт либо через управляемый браузер (Playwright, реальный Chromium), либо использует источники, изначально открытые для чтения (публичная Google-таблица).
- `lisskins-steamdt-compare/` содержит конкретный список избранного и цены на момент сбора — это персональные данные, учитывайте это при дальнейшем шаринге.
- История коммитов из исходных отдельных репозиториев (`steamdt-cs2-tracker`, `cs2-china-stats`) сохранена при объединении в этот монорепозиторий.

## Лицензия

MIT для `cs2-china-stats/` (см. [`LICENSE`](cs2-china-stats/LICENSE) внутри папки). Остальные проекты лицензию не указывают.
