# Close Knit в каталоге Claude: комплект для подачи

Что нужно, чтобы подать Close Knit (1) в **Connectors Directory** как MCP-коннектор и (2) в **каталог плагинов** как плагин `close-knit` со скиллом `find-a-home`.
Заметки для владельца — по-русски; всё, что вставляется в формы, — по-английски.
Проверено 27.10.2026: документация claude.com/docs и support.claude.com, живой сервер `https://getcloseknit.com/mcp` (v2.0.3, релиз `rel-202610230107-census-layers-england`).
Связанные планы: [chatgpt-app.md](chatgpt-app.md) (пробелы G1–G11), [stores.md](stores.md).

## 1. Правила каталога (что требует Anthropic)

### Общее

- Подаёт владелец со своего claude.ai: план Pro, Max, Team или Enterprise; Free не может. На Pro/Max ролей нет, на Team/Enterprise подаёт Owner. Листинг принадлежит организации, из которой подали ([publish](https://claude.com/docs/directory/publish)).
- Портал один для обоих типов: [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector** или **Plugin bundle**.
- Anthropic советует подать **оба**: сервер как коннектор (листинг, дашборд здоровья, правка авторизации) и плагин, который на него ссылается; потом их можно связать (pairing). В `.mcp.json` плагина — тот же URL, чтобы у пользователя был один набор инструментов ([publish](https://claude.com/docs/directory/publish#submit-your-plugin-and-your-mcp-server-as-a-connector)).
- Условия: [Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) и [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).
- Срок ревью не публикуется («Review time isn't fixed»). Статус и замечания — в портале ([submission-status](https://claude.com/docs/directory/submission-status)). Эскалации по коннектору: `mcp-review@anthropic.com`; по плагину: `directory@anthropic.com`.
- Подтверждение домена (DNS, `.well-known`) каталогу Anthropic не нужно, это только для MCP Registry ([directory](https://claude.com/docs/connectors/directory)).

### Коннектор: требования ([submission](https://claude.com/docs/connectors/building/submission), [review criteria](https://claude.com/docs/connectors/building/review-criteria))

| Требование | Как у нас |
|---|---|
| Удалённый сервер, HTTPS, Streamable HTTP | Есть: `https://getcloseknit.com/mcp`, без логина |
| У каждого инструмента `title` и `readOnlyHint` или `destructiveHint` | Есть у всех 24 (проверено в `tools/list`). Пишет только `send_feedback` (`readOnlyHint: false`, `destructiveHint: false`) |
| Имя инструмента ≤ 64 символов; узкое точное описание; без prompt injection (не звать чужие инструменты, не «вести себя» вне функции, не рекламировать) | Имена короткие. Описания — что делает инструмент. Риск низкий, см. §6 п. 12 |
| Авторизация: OAuth 2.0 для аккаунтов пользователя, **без авторизации — для публичных данных** | `none` ([authentication](https://claude.com/docs/connectors/building/authentication)) |
| Каждый инструмент отвечает успешно на валидные параметры; понятные ошибки, не голый 500 | В основном да; см. §5 и §6 (таймауты, `list_metrics`) |
| Разумный размер ответа: claude.ai/Desktop ≈150 000 символов, Claude Code 25 000 токенов; таймаут 240 с ([limits](https://claude.com/docs/connectors/building/index#design-within-the-size-and-timeout-limits)) | **`list_metrics` отдаёт 2,6 млн символов** — блокер, §6 п. 1 |
| Не собирать данные разговора сверх нужного; не трогать память и историю Claude | Аналитика без персональных данных; `send_feedback` запрещает личное в описании поля |
| Свои first-party API, домен сервера = домен сервиса | Да, `getcloseknit.com` |
| Нельзя: переводы денег, AI-генерация картинок/видео/аудио | Нет такого |
| Политика: privacy policy (ссылка), проверенный контакт поддержки, документация (как работает, назначение, troubleshooting), ≥3 рабочих примера промптов, тестовый аккаунт «с данными» (policy 3A–3E) | Ссылки за паролем превью (G3). Аккаунт не нужен: сервер без логина |
| Нет рекламы, спонсорского контента, product placement (policy 4C) | В MCP нет; `CLOSE_KNIT_DISPLAY_ADS` MCP не касается |
| Высокорисковые темы (финансы, юр.) требуют раскрытия и human-in-the-loop (policy 1A/1B) | Цены — «ballpark, never a valuation», в каждом ответе caveats. Держать так |
| MCP App: 3–5 PNG ≥1000 px шириной, обрезка до ответа приложения, без промпта на картинке, к каждому — свой промпт; видео/GIF нельзя | Скриншотов нет. Шаблон: [Figma](https://www.figma.com/community/file/1597641111449594397/mcp-apps-for-claude) |
| `_meta.ui.domain` | Для Claude **не обязателен** (нужен, только если виджет сам делает OAuth). Если задавать: `a95f151559c7c2fa7a4fdcb757a878f5.claudemcpcontent.com` = sha256(`https://getcloseknit.com/mcp`)[:32] ([troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting)). G5 для Claude не блокер |
| Allowed link URIs (если виджет зовёт `ui/open-link`) | Необязательно; только свои домены: `https://getcloseknit.com` |

Шаги портала для коннектора: 1 Connection (URL) → 2 Tools (синхронизируются сами, флагуют пропуски аннотаций) → 3 Listing (имя ≤100, one-liner ≤200, описание ≤2000, 1–5 категорий, docs URL, privacy URL, support, иконка, slug — **slug навсегда**) → 4 Use cases → 5 Company → 6 Authentication → 7 Data handling → 8 Test & launch → 9 Compliance (7 галочек) → 10 Review and submit.
После подачи — автоматическая проверка и листинг как **Community**; Verified Anthropic назначает сам, заявки нет ([verification](https://claude.com/docs/connectors/verification)).
Формат иконки в документации **не указан**. Готовить квадратный PNG 512×512 (и SVG на случай, если примут).

### Плагин: требования ([submit](https://claude.com/docs/plugins/submit), [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [build](https://claude.com/docs/plugins/build))

- Плагин читается **из GitHub**. Репозиторий может быть приватным на время проверки, но **публичным к публикации**. Наш основной репо приватный → подавать из публичного `bmsdave/close-knit-mcp`.
- GitHub-аккаунт подключён к claude.ai в той же организации и имеет push в репо (иначе портал не даст создать сабмит).
- Блокирующие проверки: `.claude-plugin/plugin.json` (name: строчные, цифры, дефисы, ≤64, не `claude`/`mcp`/`plugin`/`test`, не занято); **README ≥40 слов** в папке плагина (код не считается; что делает, как пользоваться, какие данные отправляет); **LICENSE** или `license` в `plugin.json`; `.mcp.json` — валидный JSON, у удалённого сервера `type: http` и `url` — абсолютный `https://` (или `${user_config.KEY}`); нет `.DS_Store`; нет секретов.
- Предупреждения: задать `description`, `author`, `version`; поднимать `version` на каждый релиз.
- Security scan: в README описать всё, что плагин запускает, отправляет или читает. Нераскрытая отправка данных — отказ.
- Data handling: читает/хранит ли персональные данные, шлёт ли данные куда-то кроме своих коннекторов, сколько хранит, для детей ли. Compliance: контактный email + 4 галочки.
- Новый листинг смотрит человек; дальнейшие версии подтягиваются с ветки (webhook или по расписанию). Лимит: 10 сабмитов в сутки на организацию.
- Проверить локально: `claude plugin validate ./<папка>`; в портале — **Validate**.

## 2. Что есть сейчас

| Что | Значение | Где |
|---|---|---|
| Имя сервера | `close-knit` (registry `com.getcloseknit/close-knit`) | `api/area_api/mcp_server.py`, `server.json` |
| Title | `Close Knit` | там же |
| Описание сервера | London neighbourhoods and homes: crime, schools, prices, rents, commute, green space, sourced. | там же |
| Версия | 2.0.3 | там же |
| Иконка | `https://getcloseknit.com/icon.svg` (128×128 viewBox). PNG нет: `/icon.png` → 404 | `ICON` |
| Сайт | `https://getcloseknit.com` (публичный, `CLOSE_KNIT_ACCESS=public`) | `WEBSITE_URL` |
| Репо для пользователей | `https://github.com/bmsdave/close-knit-mcp` (публичный, MIT; `.mcp.json`, `skills/find-a-home/SKILL.md`, README, Gemini-расширение) | `REPOSITORY` |
| Инструменты | 24; 5 с виджетом MCP Apps `ui://close-knit/home-search.html` | `tools/list` |
| Промпт | `find-a-home` («Find a home in London») | `prompts/list` |
| Плагин в основном репо | `agents/claude/plugin`: `plugin.json` v0.7.0, `.mcp.json` с `${CLOSE_KNIT_MCP_URL:-…}`, скилл + 3 файла `references/`; README и LICENSE в папке плагина **нет** | `agents/claude/` |

## 3. Тексты для формы коннектора (вставлять как есть)

**Server name (≤100):**
```
Close Knit
```

**Tagline (≤60; в портале one-liner ≤200):**
```
Evidence on London neighbourhoods and homes, with sources
```

**Short description (≤100):**
```
Choose where to live in London: area shortlists, sale prices, crime, schools, flood risk, sourced.
```

**Long description (~150 words):**
```
Close Knit helps you decide where to live in London, with evidence you can check. Tell Claude your budget, the number of bedrooms, where you travel and what matters most, and Close Knit shortlists neighbourhoods that fit and explains the trade-offs. For any area you get recorded sale prices and trends from HM Land Registry, the official UK House Price Index, crime from police.uk, nearby schools with their Ofsted grades, road and rail noise, Environment Agency flood bands, council tax and door-to-door commute times on TfL timetables. Paste a listing's postcode and asking price to see how it compares with local sales. Close Knit then gives you pre-filtered searches on the major property portals and a ready prompt for a scheduled watch for new homes. Every answer carries its sources, confidence and caveats, and ballpark figures are never presented as valuations. London is covered in depth, with area data across England. Free to use, with no account or sign-in.
```

**Categories (1–5; список в портале не опубликован — выбрать ближайшие):** `Lifestyle`, `Data & research` (запасные: `Travel & local`, `Productivity`).

**Use cases (шаг 4):**
```
1. Shortlist London neighbourhoods for a budget, bedrooms, commute and priorities such as safety or schools.
2. Get a cited overview of one area: prices and trends, crime, schools, noise, flood risk, council tax, transport.
3. Check whether a listing's asking price is in line with recorded local sales.
4. See the recorded sale history of an address and its street.
5. Get pre-filtered portal searches and a prompt for a scheduled watch of new listings.
```
- What users need before connecting: `Nothing. No account, plan or setup; the server is public.`
- Reads or writes: `Reads data. The only write is send_feedback, which sends a short product note to the Close Knit team after the user approves the text.`

**Company (шаг 5):** Company name `Close Knit`, website `https://getcloseknit.com`, primary contact `hello@getcloseknit.com`.

**Links:**
- Documentation URL: `https://github.com/bmsdave/close-knit-mcp#readme` (публичный уже сейчас; позже — `https://getcloseknit.com/claude`, когда сайт откроется)
- Privacy policy: `https://getcloseknit.com/privacy`
- Terms: `https://getcloseknit.com/terms`
- Support contact: `hello@getcloseknit.com` (MX есть: пересылка Porkbun)
- Website: `https://getcloseknit.com`
- Repository: `https://github.com/bmsdave/close-knit-mcp`
- Icon: `https://getcloseknit.com/icon.svg` + загрузить PNG 512×512 (сделать, §7)
- Slug: `close-knit`
- Allowed link URIs: `https://getcloseknit.com`

**Authentication (шаг 6):** `No authentication` (Authentication requirement: none).

**Data handling (шаг 7):**
```
API ownership: our own first-party API (Close Knit). Data comes from open public datasets (HM Land Registry, ONS, police.uk, Ofsted, Environment Agency, TfL Open Data, OpenStreetMap) under their open licences, served by our own server.
Personal health data: no.
Sponsored content: no. No ads, affiliate links or paid placement in tool results.
```

**Test & launch (шаг 8):**
```
No account is needed. Add https://getcloseknit.com/mcp as a custom connector with no authentication, or connect from the listing. Every tool can be called straight away. Example prompts and expected tool calls are below; results are cited evidence envelopes (value, confidence, evidence, sources, caveats). send_feedback writes a short note to our team, so please prefix test feedback with "REVIEW TEST".
We ran every tool through a scripted MCP client against the live server and as a custom connector in Claude.
```
(Перед подачей владелец сам гоняет каждый инструмент в Claude как custom connector — галочка это подтверждает.)

**Compliance (шаг 9):** 7 галочек — directory guidelines, first-party API, финансовые операции (нет), AI-медиа (нет), prompt injection, сбор данных разговора, публичная документация. Все ставим; условия выполняются после п. 2–4 §7.

### Инструменты (24, по одной строке)

| Tool | One line |
|---|---|
| `find_areas` | Shortlist London neighbourhoods for a budget, bedrooms, priorities and places, with reasons and a map link. |
| `open_shared_search` | Reopen a search shared from the Close Knit site (a #profile link) and re-run it. |
| `find_similar_areas` | Find neighbourhoods like one the user liked, optionally only cheaper ones. |
| `get_area_overview` | One area in detail: local market, official HPI, crime, noise, schools, planning, council tax, transport. |
| `assess_listing` | Compare a listing's asking price with recorded local sales and show the area's evidence. |
| `list_metrics` | List the area metrics and match factors the current release serves. |
| `search_areas` | Resolve an area name, ONS code, postcode or street to area and address ids. |
| `get_area_metric` | One metric for one area and month, with regional and England percentiles. |
| `rank_areas_by_metric` | Rank areas (all, or one region) by one metric and return the top N. |
| `get_address_history` | Recorded sale prices for one address from HM Land Registry. |
| `get_home_prices` | One London home's recorded sales and the price range of similar homes in its area today. |
| `match_areas` | Score every area against an ordered list of criteria (the engine behind find_areas). |
| `get_market_depth` | Sales, turnover, leasehold share and £/m² medians for one neighbourhood. |
| `get_nearby_sales_summary` | Sale counts and median £/m² in the same building and on the same street as an address. |
| `get_area_evidence_pack` | One cited pack for an area: market, crime, noise and nearby state schools. |
| `search_places` | Resolve a station, borough, neighbourhood, postcode or street the user mentions, forgiving spelling. |
| `get_commute` | Door-to-door weekday-morning minutes from an area to the user's places by transit, bike, car and foot. |
| `get_flood_risk` | Environment Agency flood bands for an area's land and, with a UPRN, for one home. |
| `get_rent_levels` | Median monthly rent by bedroom count for areas. |
| `get_listing_search_links` | Pre-filtered Rightmove, Zoopla, OnTheMarket and OpenRent searches for shortlisted areas. |
| `list_custom_presets` | Ready-made criteria built from places on OpenStreetMap, such as cafés vs kebab shops. |
| `evaluate_custom_criterion` | Score every London neighbourhood on a criterion built from places on the map. |
| `build_watch_spec` | Turn a finished search into a watch spec and a prompt for a scheduled task. |
| `send_feedback` | Send product feedback to the Close Knit team after the user approves the text. |

## 4. Тексты и файлы для плагина

Подавать из **публичного** `bmsdave/close-knit-mcp` (корень репо = папка плагина). Сейчас там нет `.claude-plugin/plugin.json`, у `.mcp.json` нет `"type": "http"`, а `SKILL.md` ссылается на `references/*.md`, которых в репо нет. Перед подачей синхронизировать из `agents/claude/plugin` (это отдельный PR в публичный репо, не в этой ветке).

`.claude-plugin/plugin.json`:
```json
{
  "name": "close-knit",
  "displayName": "Close Knit",
  "version": "0.8.0",
  "description": "Find where to live in London, and across England, by talking to Claude: an area shortlist with evidence, a check of any listing against local sales, portal searches and a watch for new homes.",
  "author": { "name": "Close Knit", "url": "https://getcloseknit.com" },
  "homepage": "https://getcloseknit.com",
  "repository": "https://github.com/bmsdave/close-knit-mcp",
  "license": "MIT",
  "keywords": ["london", "england", "housing", "home search", "property", "neighbourhoods"]
}
```

`.mcp.json` (без `${CLOSE_KNIT_MCP_URL:-…}`: валидатор принимает только абсолютный `https://` или `${user_config.KEY}`):
```json
{ "mcpServers": { "close-knit": { "type": "http", "url": "https://getcloseknit.com/mcp" } } }
```

Раздел README, который нужен для security scan (вставить в README публичного репо):
```
## What this plugin sends and stores

- The find-a-home skill calls the Close Knit MCP server at https://getcloseknit.com/mcp. Tool arguments (areas, postcodes, budgets, bedroom counts, places you travel to) go to that server to compute answers. No account, name or contact details are sent.
- send_feedback sends a short product note to the Close Knit team, only after you approve the text. It must not contain personal details.
- Listing searches are links to the property portals' public search pages. Close Knit never fetches, stores or ranks listings; your own Claude opens those pages on your behalf.
- If you set up a watch, your Claude keeps a small state file of listing URLs already reported at ~/.close-knit/watches/<name>.json on your own machine. Nothing about the watch is stored by Close Knit.
- Privacy policy: https://getcloseknit.com/privacy
```

Data handling (плагин):
```
Reads or stores personal data: no. Search criteria are sent to the Close Knit connector only to compute answers.
Sends data to services other than its declared connectors: no. Portal links are opened by the user's own Claude.
Data retention: Close Knit keeps feedback notes and anonymous tool-usage counts (tool, success, latency, client name); no conversation text.
Intended for people under 18: no.
```
Контакт для compliance: `hello@getcloseknit.com`. Отслеживаемая ветка: `main`; новые версии — GitHub push webhook.

## 5. 10 тест-промптов: ожидание и что наблюдалось на живом сервере

Как проверяли: `initialize` → `notifications/initialized` → `tools/call` с `mcp-session-id`, тем же путём, что и Claude, 27.10.2026. Ниже — **наблюдения** по ответам сервера, а не ответ модели. Промпты — на английском, для формы.

| # | Prompt | Expected tool calls | A correct answer contains | Observed on the live server |
|---|---|---|---|---|
| 1 | `We're buying a 2-bed in London, up to £600k. I work at King's Cross and want under 40 minutes door to door. Safety matters most.` | `search_places` (King's Cross) → `find_areas` (budget, bedrooms, crime priority, place with max 40 min) → `get_commute` for the top pick | 5–8 areas with ballpark price and budget fit, why each fits, commute minutes, "Open in Close Knit" link, caveat that the price is a ballpark, "Powered by TfL Open Data" | OK. `search_places` → King's Cross St Pancras (zone 1, 6 tube lines) in 0.6 s. `find_areas` (4.1 s): East Ham North E12, Ilford North West IG1, Canning Town East E16, Forest Gate South E7, Custom House E16; ballparks £343k–372k; commute 38–40 min; `briefUrl` present; 4 caveats, 3 sources. `get_commute` East Ham → KX: 40 min by transit (36–44), H&C line, 0 changes. Note: budget comes first by default, so the top picks have 36–65 crimes per 1,000; for "safety first" Claude should pass `budget_importance` lower or crime `must` |
| 2 | `Tell me about Walthamstow: prices, crime, schools, how it's changing.` | `search_areas` → `get_area_overview` | Area name, local £/m² and growth, borough HPI, crime rate and its percentile with offence mix, schools with Ofsted grades, noise, caveats, sources cited | OK. `search_areas` → Upper Walthamstow E17 (MSOA E02000909) 0.4 s. `get_area_overview` 1.5 s: crime 49.1 per 1,000, 16th percentile in London, top offence types; 17 sources, 10 caveats; also council tax, deprivation, health, transport |
| 3 | `What has 112 Orford Road, E17 sold for in the past?` | `search_areas` → `get_address_history` (+ `get_nearby_sales_summary`) | Recorded sales with dates and prices from HM Land Registry, "not a valuation", street context | OK. Address id found, 1 recorded sale (12 Nov 1998, £99,995); street: 86 sales in 10 years, median £8,117/m². Bug: `displayAddress` repeats the town ("London, London") |
| 4 | `What do 2-bed flats rent for in Walthamstow and East Ham?` | `search_areas` → `get_rent_levels` | Median monthly rent per area for 2 beds, source and month | **Fails on data**: `medianMonthlyRent: null`, no source, for every LSOA tried. `find_areas` with `market: rent` returns no `estimatedPrice`, so the rent budget does not narrow anything. Rents are not loaded on prod |
| 5 | `Is there a flood risk at 10 Ballast Quay, SE10?` | `search_areas` → `get_flood_risk` (with UPRN) | Area bands for rivers/sea and surface water, the home's own bands, "modelled, not a record", link to the EA check, EA attribution | OK (0.1 s). Area: rivers/sea highest "low"; surface water highest "high" (5.6% of land). Home (UPRN 100020937894): very low for both. EA attribution and 5 caveats present |
| 6 | `Compare Walthamstow and Leyton for buying a 2-bed.` | `search_areas` ×2 → `get_area_overview` ×2 | Side by side: ballpark, £/m², growth, crime, schools, noise; the trade-off in one line | OK. Leyton East E10 (E02000919): resale median £7,522/m², ballpark £548k (70 m²), growth 9.0% 1y / 46.2% 10y, 80 sales in 12 months, 35% leasehold. Walthamstow as in #2 |
| 7 | `Is £650,000 fair for a 68 m² 2-bed flat at E17 9QX?` | `assess_listing` | Asking £/m² vs local median, difference %, verdict worded as "above local sales", stamp duty and council tax, questions to ask, "not a valuation" | OK (1.1 s). Asking £9,559/m² vs local resale median £7,786/m², +22.8%, verdict `above-local`; 12 sources, 7 caveats |
| 8 | `Watch for new 2-bed flats under £600k around Euston and tell me daily.` | `search_areas` → `build_watch_spec` → scheduled task (if the client supports it) | Watch name, the portal searches per postcode district, schedule, a note that the watch runs in the user's Claude and Close Knit stores nothing | OK (0.2 s). Spec for NW1 with Rightmove, Zoopla, OnTheMarket links and a ready `schedulePrompt` (state file `~/.close-knit/watches/<slug>.json`). `get_listing_search_links` gives `/go` links that redirect (302) to the portal search |
| 9 | `Find me a 2-bed in Glasgow under £250k.` (outside coverage: must decline politely) | `search_places` or `assess_listing` → stop | A polite "Close Knit covers England, London in depth; Scotland isn't covered", no made-up figures, maybe a suggestion to use other sources | **Partly OK.** Postcode `G1 1XQ`: `search_places` → no results, `reason: "outside-london"`; `assess_listing` → error "postcode G1 1XQ is not in Close Knit's London coverage". But free text `Glasgow` matches "1 Glasgow Road, London E13" and `Edinburgh` matches "Edinburgh Lodge, Orpington", with no `reason`: Claude must notice the mismatch. Manchester (`M1 1AE`, "Manchester Piccadilly") is served, so the "London coverage" wording is wrong |
| 10 | `That was useful. Send Close Knit feedback that the flood check helped but rents were missing.` | Claude drafts the note, shows it, waits for "yes" → `send_feedback` (`kind: missing-data`, `tools: ["get_rent_levels"]`) | The draft shown first; no personal details; sent only after approval; confirmation | Not sent to prod (it writes to the feedback store). Validation checked: a 5-character message → clear error "String should have at least 10 characters". Tool is open regardless of the data flag |

Также: `tools/list` — 24 инструмента с аннотациями; `resources/list` — `ui://close-knit/home-search.html`, `text/html;profile=mcp-app`, CSP jsDelivr + OpenFreeMap; `prompts/list` — `find-a-home`.

**Сбой во время проверки.** Первые ~4 минуты все инструменты, которые ходят в БД (`search_places`, `search_areas`, `list_metrics`, `get_rent_levels`, `get_flood_risk`, `get_listing_search_links`), через 20 с отвечали `query-timeout: canceling statement due to statement timeout`. Без БД работали `list_custom_presets` и валидация. Потом всё восстановилось без нашего вмешательства. Причина не выяснена; в дашборде каталога такой эпизод даст error rate выше 2% («Worth a look»).

## 6. Что мешает подаче (найдено при проверке)

1. **`list_metrics` слишком большой**: 670 метрик, 2,6 млн символов текста (5 МБ JSON с `structuredContent`). В claude.ai результат уйдёт в файл песочницы, в Claude Code упрётся в 25 000 токенов; ревью требует «reasonably sized». Нужно: краткий список по умолчанию (id, label, unit) + фильтр/пагинация, подробности — по id. Код. **Исправлено в коде:** по умолчанию — id, label и unit по темам и один источник на релиз (≈84 тыс. символов текста на каталоге прода), `detail=[id или тема]` — полные определения, не больше 10; на проде — после выкладки.
2. **Аренда не загружена на проде**: `get_rent_levels` → `null`, `find_areas(market=rent)` не учитывает бюджет. Нарушает «every tool must return a successful response» по смыслу. Загрузить ренты (ONS PIPR) или пометить инструмент.
3. **Таймауты БД** (§5): разобраться до подачи; health badge считается по 30 дням.
4. ~~**`/privacy`, `/terms`, `/agents`, `/claude` за паролем превью (401)** — G3, G2.~~ **Исправлено**: сайт публичный после переключения доступа; `/privacy`, `/terms`, `/about`, `/agents`, `/brief`, `/area/london` → 200 без логина.
5. **Нет PNG-иконки**: `/icon.png` → 404, есть только SVG 128×128. Сделать PNG 512×512.
6. **Нет скриншотов MCP App**: 3–5 PNG ≥1000 px, каждый со своим промптом (шортлист, карточка района, проверка объявления). Снять после G2, чтобы карта и ссылки работали.
7. **Покрытие названо по-разному**: описание сервера, `find_areas`, промпт `find-a-home` — «London»; `plugin.json` и `SKILL.md` — «England, London in depth»; ответы для шотландских индексов — `outside-london`, а Манчестер обслуживается. Решить, что пишем в листинге, и выровнять `reason`/тексты ошибок (`outside-coverage`).
8. **Свободный текст вне покрытия** («Glasgow», «Edinburgh») находит лондонские улицы без `reason` — ревьюер на тест-промпте вне Лондона увидит странный ответ.
9. **Плагин**: подавать из публичного `close-knit-mcp`; добавить `.claude-plugin/plugin.json`, `"type": "http"` в `.mcp.json`, `references/`, раздел README про данные (§4). В `agents/claude/plugin/.mcp.json` URL с `${CLOSE_KNIT_MCP_URL:-…}` валидатор заблокирует. GitHub владельца подключить к claude.ai.
10. Мелкое: `displayAddress` «London, London»; `get_commute` даёт 40 мин в `modes.transit`, а первый маршрут — 50 мин (проверить, что Claude не путается).
11. ~~**G4 (лимиты по IP)**: весь трафик Claude идёт из диапазонов Anthropic; лимит 120/мин на IP ударит по всем пользователям сразу.~~ **Исправлено, в проде**: для диапазонов Claude/ChatGPT ключ `/mcp` = (диапазон, `Mcp-Session-Id`), `initialize` — класс `assistant_init`.
12. Prompt injection, низкий риск: инструкции сервера просят Claude один раз предложить отзыв, а при выключенном флаге текст coming-soon говорит «don't try other Close Knit tools». Это про наши же инструменты и согласие пользователя, но формулировки держать нейтральными.
13. Флаги: **исправлено** — `/mcp` отдаёт реальные данные (`CLOSE_KNIT_MCP_DATA=1` на проде, `dataMode: release`, coming-soon нет). Остаётся G1 (явные `=1` в `deploy/.env`) у владельца.

## 7. Чек-лист перед подачей

Коннектор:
1. [ ] Публичные `/privacy`, `/terms` и страница поддержки/документации (G3) — открыты на проде; осталось сверить содержание: privacy описывает сбор, использование, хранение, третьих лиц, срок хранения, контакт.
2. [x] Ссылки из ответов открываются без пароля (G2): сайт публичный.
3. [ ] `list_metrics` укорочен (§6 п. 1); ренты загружены (п. 2); таймауты БД разобраны (п. 3).
4. [ ] Тексты о покрытии выровнены (п. 7–8).
5. [ ] PNG-иконка 512×512 вне пароля.
6. [ ] 3–5 скриншотов виджета, PNG ≥1000 px, с промптами.
7. [ ] Владелец добавил `https://getcloseknit.com/mcp` как custom connector в claude.ai и вызвал каждый инструмент (галочка на шаге 8), прогнал 10 промптов из §5.
8. [ ] G1 закрыт (G4 в проде; `CLOSE_KNIT_MCP_DATA=1` на проде).
9. [ ] Ящик `hello@getcloseknit.com` реально доходит до владельца.
10. [ ] Подаёт **владелец** со своего платного аккаунта Claude: claude.ai/directory/manage → Submit new → MCP connector; тексты из §3.

Плагин (после коннектора):
1. [ ] PR в `bmsdave/close-knit-mcp`: `plugin.json`, `.mcp.json` с `type`, `references/`, README-раздел о данных (§4); `claude plugin validate .` → `✔ Validation passed`.
2. [ ] GitHub владельца подключён к claude.ai, есть push в репо.
3. [ ] Submit new → Plugin bundle → репо `bmsdave/close-knit-mcp`, ветка `main` → Validate → Data handling и Compliance из §4 → Submit for review.
4. [ ] После публикации — связать плагин с коннектором (pairing) в портале.
