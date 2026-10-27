# Close Knit в ChatGPT и Claude: план (2026-10-22)

Цель: на вопросы «где жить / сравни районы Лондона» ассистенты зовут Close Knit.
Первым — ChatGPT app на нашем MCP, затем каталог коннекторов Claude, затем остальные каталоги.
Правила: бесплатно для людей; деньги не меняют данные и ответы MCP; в ответах MCP нет партнёрских ссылок и рекламы ([strategy.md](../global-2026-10/strategy.md)).

## Что уже есть

- `/mcp` (Streamable HTTP, без логина): 24 инструмента из `api/area_api/tools.py`, промпт `find-a-home`, инструкции сервера (`guidance.py`).
- Виджет MCP Apps `ui://close-knit/home-search.html` (шортлист, карточка района, проверка объявления) на `find_areas`, `open_shared_search`, `find_similar_areas`, `get_area_overview`, `assess_listing`. ChatGPT и Claude рендерят стандарт MCP Apps (`text/html;profile=mcp-app`, `_meta.ui.resourceUri`), так что новый формат не нужен ([OpenAI](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt), [Claude](https://claude.com/docs/connectors/building/mcp-apps/getting-started)).
- Аналитика: `usage.record(... "tool_call")`: инструмент, ok/код, мс, confidence, имя клиента; сессия — необратимый хеш. Персональных данных нет. Клики наружу считает `/go`.
- Rate limits (`ratelimit.py`): 120/мин, 2000/ч, 10000/день на ключ клиента.
- `/.well-known/mcp/server.json`, `/llms.txt`, плагин Claude (`agents/claude/plugin`).

## Сделано в этом PR

1. **Публичные флаги на `/mcp`.** `/mcp` открыт без пароля превью, а при `CLOSE_KNIT_ACCESS=private` незаданные флаги включены, то есть любой мог получить скрытые данные. Теперь вызовы MCP идут внутри `feature_flags.public_call()`: незаданные флаги выключены, явные `=1`/`=0` в силе. Описание `get_home_prices` тоже в публичной редакции. `CLOSE_KNIT_MCP_ACCESS=site` возвращает поведение сайта (только для локальных тестов). Строка в [FLAGS.md](../../FLAGS.md).
2. **Аннотации инструментов.** У каждого инструмента `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint` (+ `idempotentHint`). Пишет только `send_feedback`. Обязательно для обоих каталогов ([OpenAI](https://developers.openai.com/apps-sdk/app-submission-guidelines), [Claude](https://claude.com/docs/connectors/building/submission)).

## Пробелы

| # | Пробел | Что делать | Кто |
|---|---|---|---|
| G1 | Явные `=1` в `deploy/.env` (например `CLOSE_KNIT_AIR_QUALITY=1`) действуют и на `/mcp` | Перед листингом пройти `deploy/.env`: оставить `=1` только у флагов, которые владелец разрешил для публики | владелец |
| G2 | ~~Ссылки из ответов (`briefUrl`, «Open in Close Knit», карточки) ведут на сайт за паролем превью~~ | **Сделано**: прод на `CLOSE_KNIT_ACCESS=public`; `/brief`, `/area/london`, `/area/england` → 200 без логина | — |
| G3 | ~~`/privacy`, `/terms`, страница поддержки закрыты паролем; каталоги требуют HTTPS-ссылки~~ | **Сделано** (сайт публичный; `/privacy`, `/terms`, `/about` → 200 на проде). В коде: `/privacy`, `/terms`, `/about` (поддержка: контакт `hello@getcloseknit.com` из `web/src/lib/contact.ts`, env `CLOSE_KNIT_CONTACT_EMAIL`) и `/_next/static/*` открыты в `access-private.caddy`; preflight проверяет 200 без логина. Владельцу: убедиться, что ящик принимает почту | владелец |
| G4 | ~~Rate limit по IP: все пользователи ChatGPT/Claude приходят с нескольких IP (Claude: `160.79.104.0/21`) и упрутся в 120/мин~~ | **Сделано, в проде** (`assistant_init` в образе api). В `api/area_api/ratelimit.py`: из диапазонов ассистентов (`CLOSE_KNIT_ASSISTANT_RANGES`, по умолчанию [Anthropic outbound](https://platform.claude.com/docs/en/api/ip-addresses) + [chatgpt-connectors.json](https://openai.com/chatgpt-connectors.json), снимок в `assistant_ranges.py`) ключ `/mcp` = (диапазон, `Mcp-Session-Id`); `initialize` по IP с классом `assistant_init`. Список OpenAI best effort: обновлять снимок | — |
| G5 | ~~`_meta.ui.domain` у виджета не задан. ChatGPT требует уникальный домен при сабмите; у Claude формат свой: `<sha256(url)[:32]>.claudemcpcontent.com`~~ | **Сделано** в `api/area_api/mcp_server.py` (в прод — со следующим релизом): `resources/read` виджета отдаёт `_meta.ui.domain = https://getcloseknit.com` ([OpenAI](https://developers.openai.com/plugins/reference)); клиентам Claude (`clientInfo.name` на `claude…`) домен не отдаём: Claude не рисует виджет с чужим доменом ([troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting)). `openai/widgetCSP.redirect_domains` не нужен: ссылки идут через `ui/open-link`, не `openExternal` | — |
| G6 | OAuth нет | Не нужен: оба каталога принимают no-auth для публичных данных ([OpenAI](https://developers.openai.com/apps-sdk/build/auth), [Claude](https://claude.com/docs/connectors/building/authentication)). OAuth — только если появятся личные сохранения/вотчи на сервере. `/register`, `/authorize`, `/token` должны и дальше отдавать 404 | — |
| G7 | Описания инструментов | Проверены: без навязывания и сравнения с конкурентами. Держать так; `match_areas` и `find_areas` пересекаются — в листинге объяснять `find_areas` | — |
| G8 | Реклама | ChatGPT запрещает приложения с рекламой. `CLOSE_KNIT_DISPLAY_ADS` и так не касается MCP — так и оставить | — |
| G9 | Аналитика по ассистентам | Событие уже есть. Добавить в дашборд разрез по `client` (chatgpt / claude-ai / прочие) и воронку `tool_call → /go` | код |
| G10 | Великобритания в ChatGPT | На старте приложения не работали в EEA/CH/UK; сейчас в схеме сабмита есть `countries: GB`, но доступность для пользователей в UK не подтверждена ([OpenAI](https://openai.com/index/introducing-apps-in-chatgpt/)). Проверить в developer mode из UK | владелец |
| G11 | Виджет сравнения районов | Только после доски A1 и решения владельца (правило «сначала доска») | дизайн → код |

## Чек-лист: ChatGPT

1. [ ] **`/mcp` отдаёт публичные значения флагов** (этот PR задеплоен, `CLOSE_KNIT_MCP_ACCESS` не задан, G1 пройден). Проверка: `tools/call get_home_prices` на проде → `withheld` не пуст.
2. [x] Сайт публичный, G2/G3 закрыты; открываются HTTPS-ссылки privacy, terms, поддержка и сайт.
3. [ ] G4 (лимиты) в проде — сделано; G5 (`ui.domain`) — в коде, ждёт релиза.
4. [ ] Организация OpenAI: верификация личности или бизнеса; сабмитит owner или роль «Apps Management Write» ([submission](https://developers.openai.com/apps-sdk/deploy/submission)).
5. [ ] Тест в developer mode: chatgpt.com → plugins → «+» → Add custom MCP server → URL `/mcp` → no auth ([testing](https://developers.openai.com/apps-sdk/deploy/testing)). Плюс MCP Inspector.
6. [ ] Ровно 5 позитивных тест-кейсов (`tools_triggered`, `expected_behavior`) и 3 негативных. Черновик ниже.
7. [ ] Демо-видео, квадратная иконка ≥48 px, скриншоты (опционально).
8. [ ] Страны: `GB` (+ решение по остальным).
9. [ ] Политика: 13+, не для детей, без рекламы, минимум данных, без продажи цифровых товаров ([guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)).
10. [ ] Сабмит делает владелец. Отказ приходит письмом, на него можно ответить. Срок не указан.

## Чек-лист: Claude

1. [ ] Пункт 1 из ChatGPT (публичные флаги).
2. [ ] Ссылки на документацию, privacy и поддержку, иконка.
3. [ ] У инструментов `title` и hints (сделано).
4. [ ] Для MCP Apps: 3–5 PNG ≥1000 px шириной, у каждого свой промпт; `ui.domain` для Claude не отдаём (G5).
5. [ ] Аутентификация `none`. Тестовый аккаунт для ревьюеров не нужен, хватит инструкции.
6. [ ] Подтвердить 7 пунктов соответствия (в том числе про спонсорский контент — у нас его нет).
7. [ ] Сабмит: claude.ai/directory/manage → Submit new → MCP connector (любой платный план) ([submission](https://claude.com/docs/connectors/building/submission)). Сначала листинг как Community; Verified — по эскалации ([review](https://claude.com/docs/connectors/building/review-criteria)).

## Другие каталоги (после ChatGPT и Claude)

Полный разбор 44 каталогов: [stores.md](stores.md) (пометка [U] — не проверено). OpenAI с 9 июля 2026 свёл Apps в общий Plugins Directory с Codex; у Claude помимо коннекторов есть маркетплейс плагинов (skills + MCP, сентябрь 2026) — туда же можно подать `agents/claude/plugin`. Сейчас Close Knit не числится ни в одном каталоге: в поиске коннекторов Claude он виден только как свой кастомный коннектор владельца.

По охвату и открытости:
1. Официальный MCP Registry: `mcp-publisher init/login/publish`, домен подтверждается TXT-записью или `/.well-known/mcp-registry-auth`; `$schema` в нашем `server.json` обновить до `2025-12-11` ([registry](https://modelcontextprotocol.io/registry/remote-servers), [auth](https://modelcontextprotocol.io/registry/authentication)). Через него нас увидят VS Code/GitHub и агрегаторы.
2. Плагин Claude в маркетплейсе (тот же портал, что и коннекторы).
3. Microsoft 365 Copilot agent store через Partner Center (MCP в declarative agents). Аудитория — работа: релокация, HR.
4. Gemini: каталог только для партнёров; пользователи могут вставить URL сами.
5. Alexa+ (MCP, private preview, есть в UK).
6. Smithery (`smithery mcp publish <url>/mcp`, пропускать `SmitheryBot/1.0`), Glama — для разработчиков.

## Тест-кейсы (черновик)

Позитивные:
1. «Мы с двумя детьми ищем дом в Лондоне до £900k, работа у King's Cross, важна безопасность» → `search_places`, `find_areas`; шортлист с причинами и ссылкой.
2. «Сравни Walthamstow и Leyton для аренды 2-bed» → `search_areas`, `get_area_overview` ×2, `get_rent_levels`.
3. «Сколько ехать от Brixton до Canary Wharf?» → `get_commute`, ссылка на TfL Open Data.
4. «Справедлива ли цена £650k за 2-bed на E17?» → `assess_listing`; без оценки конкретного дома.
5. «Есть ли риск затопления в районе SE10?» → `search_areas`, `get_flood_risk`.

Негативные (инструменты не вызываются):
1. «Какая погода в Манчестере?»
2. «Кто живёт в доме 12 на Acre Lane?» → отказ: мы не ищем людей.
3. «Купи мне акции Rightmove».

## Сроки

| Неделя | Что |
|---|---|
| 0 (сейчас) | Этот PR: публичные флаги на `/mcp`, аннотации. Доска A1 владельцу |
| 1 | Деплой PR. G4 (лимиты), G5 (`ui.domain`), G9 (дашборд). Тест в ChatGPT developer mode и как кастомный коннектор в Claude |
| 2 | Решение владельца по доске A1. Иконка, видео, скриншоты. Страницы privacy/terms/поддержки доступны |
| 3+ | Сайт публичный (go-public блокеры) → владелец сабмитит в ChatGPT и Claude, затем MCP Registry и Smithery |

Ревью ChatGPT и Claude: сроки не публикуются; закладываем 1–3 недели.
