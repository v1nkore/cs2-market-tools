# CS2 Market Tools

Инструменты для отслеживания и сравнения цен на скины CS2. Три проекта в одном репозитории:

- [`lisskins-steamdt-compare/`](lisskins-steamdt-compare/) — сравнение цен избранного с lis-skins против Steam/BUFF/YouPin (через SteamDT). Один HTML-файл, зависимостей нет — просто открыть в браузере.
- [`steamdt-cs2-tracker/`](steamdt-cs2-tracker/) — трекер дневных продаж скинов CS2 (Node + Playwright). Нужен Node.js и Chromium — есть [`Dockerfile`](steamdt-cs2-tracker/Dockerfile).
- [`cs2-china-stats/`](cs2-china-stats/) — статистика по китайским площадкам CS2. Один HTML-файл, зависимостей нет — просто открыть в браузере.

Каждый проект — самостоятельный, со своим README внутри папки.
