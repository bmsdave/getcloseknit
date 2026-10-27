# География и скоуп для всего мира (архитектура, 26.10.2026)

Документ без кода. Он закрывает пункты 11–14 бэклога из [ревью](../review-2026-10/review.md) (раздел «Почему Лондон и Англия на скотче»), опирается на [план Англии](../england-2026-10/plan.md) и [глобальную концепцию](../global-2026-10/concept.md). Имена из раздела 9 окончательные: следующий PR с переименованием использует именно их.

## 1. Решения коротко

| # | Решение |
|---|---|
| 1 | Одна таблица мест `area_geography`. Уровни (kind) задаёт каждая страна в конфиге `geo_level`, а не enum под Лондон. Для GB: `country > nation > region > lad > msoa > lsoa`. |
| 2 | Id = `<ns>:<kind>:<official code>`. Id не меняется никогда, старые id живут в `area_alias`. Для тайлов отдельный целочисленный `fid`. |
| 3 | Границы версионируются (`boundary_set`), а id нет. Сплиты и слияния лежат в `area_lineage`. |
| 4 | В `metric_value` два хранимых перцентиля: `region_percentile` и `country_percentile`. Их считает одна SQL-функция на сборке релиза. Для любого предка есть квантили в `metric_quantiles`, для произвольного скоупа перцентиль считается на чтении. |
| 5 | Покрытие метрики вычисляется из данных на релизе (`metric_coverage`) и отдаётся в каталоге. Ручные списки в клиенте удаляются. |
| 6 | Один `Scope`: FastAPI dependency, `/api/v1/scope` и `ScopeContext` в вебе. Фильтр делается в SQL, а не в Python. |
| 7 | Флаг покрытия задаёт грант в данных (`scope_grant`): включённый флаг добавляет места в `Scope.served`. У `CLOSE_KNIT_ENGLAND` семантика FLAGS.md без изменений. |
| 8 | Один пайплайн тайлов на релиз: упрощение покрытия, а не полигонов, и один `areas-<hash>.pmtiles`. |
| 9 | ETL устроен как плагины по странам (`etl/countries/<ns>`), источник объявляет своё покрытие. `CLOSE_KNIT_ETL_COVERAGE` уходит. |
| 10 | Имена: `region_percentile`/`regionPercentile`, `country_percentile`/`countryPercentile`, `area_rank`, kind `lad`. Старые поля API живут одну версию контракта как deprecated alias. |

## 2. Как это делают другие

| Система | Иерархия | Id | Статистические единицы | Версии и спорные границы | Что берём |
|---|---|---|---|---|---|
| [Overture divisions](https://docs.overturemaps.org/guides/divisions/) | subtypes от `country` до `microhood`; `parent_division_id`; `hierarchies[]` (их может быть несколько, первая основная); `admin_level` в рамках страны | GERS id из реестра | нет, только админ-деление и населённые пункты | `perspectives.accepted_by/disputed_by`; лицензия ODbL | несколько иерархий, явный parent, наследуемые `country`/`region` (ISO), xref на Wikidata |
| [OSM admin_level](https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative) | 2–11, смысл уровня свой у каждой страны (таблица на вики); 2 = государство | id relation, при правках не стабилен | нет | де-факто границы | таблица «уровень → смысл» отдельно для каждой страны (наш `geo_level`) |
| [GADM](https://gadm.org/license.html) | уровни 0–5, GID вида `GBR.1.2_1` | GID меняется между версиями | нет | версии 3.6/4.1 | ничего: коммерческое использование без разрешения запрещено |
| [Mapbox Boundaries](https://docs.mapbox.com/data/boundaries/reference/feature-lookup-tables/) | слои `adm0–5`, `pos` (почта), `sta` (статистика); у фичи поля `parent_1..4` | целочисленный `feature_id` для feature-state; строковый `id` уникален в рамках worldview | отдельный тип слоя `sta` рядом с `adm` | `worldview`; версии датасета | статистика отдельно от админки, целый fid, денормализованные родители, метаданные в lookup-таблицах |
| [Google Maps DDS](https://developers.google.com/maps/documentation/javascript/dds-boundaries/overview) | `COUNTRY`, `ADMINISTRATIVE_AREA_LEVEL_1/2`, `LOCALITY`, `POSTAL_CODE`, `SCHOOL_DISTRICT` | place ID, который [может меняться](https://developers.google.com/maps/documentation/places/web-service/place-id) | нет | охват зависит от страны | свои данные джойнятся к границе по id; чужие id храним только как xref |
| [H3](https://h3geo.org/docs/highlights/indexing) | разрешения 0–15, апертура 7; дети заполняют родителя лишь приблизительно, логическая вложенность точная | 64-битный id ячейки | одинаковая сетка в любой стране | версий нет | опциональный kind `h3r<N>` для растровых и глобальных метрик; ранги админ-единиц на нём не строим |

**Вывод.** Никто не держит одну глобальную лестницу уровней. Везде есть (а) id, который не зависит от уровня, (б) явный parent и денормализованные предки, (в) per-country смысл уровней, (г) статистические единицы отдельно от административных и (д) версии и worldview границ отдельно от id.

## 3. Модель сущностей

### 3.1 Уровни по странам (`geo_level`, данные, а не enum)

| Поле | Смысл |
|---|---|
| `ns`, `kind` | PK. `ns` — ключ страны (раздел 3.2) |
| `depth` | 0 = страна, растёт вниз |
| `role` | `admin` \| `stat` \| `grid` |
| `parent_kind` | основная иерархия |
| `rank_region` | `true` у уровня, внутри которого считается `region_percentile` |
| `min_zoom`, `max_zoom` | полоса зума в тайлах |
| `url_segment`, `label` | `/area/<segment>/<code>`, подпись |
| `boundary_source` | `source_release.id` базовой геометрии |

| Страна | country (0) | 1 | 2 (rank region) | 3 | 4 | 5 (база тайлов) |
|---|---|---|---|---|---|---|
| GB, England | `uk:country:GB` | `nation` E92 | `region` E12 | `lad` E06/E07/E08/E09 | `msoa` E02 | `lsoa` E01 |
| GB, Wales (потом) | GB | `nation` W92 (одновременно rank region) | — | `lad` W06 | `msoa` W02 | `lsoa` W01 |
| FR (пример) | `fr:country:FR` | `region` (INSEE) | `departement` | `commune` | — | `iris` |
| Без локальных данных | страна (Natural Earth) | admin1 (Overture или geoBoundaries) | admin1 | — | — | — |

`kind` становится `text`, ссылающимся на `geo_level`, а не enum. Пока enum жив, новые значения добавляются через `ALTER TYPE ... ADD VALUE`.

### 3.2 Id и внешние ключи

| Правило | Пример |
|---|---|
| `id = <ns>:<kind>:<official code>`, regex `^[a-z0-9]{2,5}:[a-z0-9_]+:[A-Za-z0-9._-]+$` | `uk:lsoa:E01000001`, `uk:region:E12000007`, `fr:commune:75056` |
| `ns` = ISO 3166-1 alpha-2 в нижнем регистре. Для GB остаётся `uk`: это исключительно зарезервированный в ISO код, и все текущие id уже на нём | `uk`, `fr`, `h3` (сетка), `world` (агрегаты вне стран) |
| Id не переиспользуется и не меняется. Переименование = новая строка в `area_alias(alias_id, area_id)`. API и веб принимают alias (веб отвечает 301) | `uk:borough:E09000001 → uk:lad:E09000001` |
| `fid bigint UNIQUE` используется для тайлов и feature-state. Для английских строк остаётся нынешняя формула (E01000001 → 1000001), поэтому тайлы не меняются; для новых стран берётся sequence с 10¹⁰ | — |
| `area_xref(area_id, system, ext_id)` хранит чужие id и никогда не служит ключом | `wikidata`, `overture` (GERS), `osm`, `ons`, `mapbox`, `google_place` |

### 3.3 Таблицы (эскиз)

| Таблица | Колонки | Заменяет |
|---|---|---|
| `area_geography` (остаётся) | + `ns`, `region_id`, `country_id`, `ancestors text[]` (GIN), `fid`, `local_type` («London borough», «district»…), `valid_from`, `valid_to`; `parent_id` = основная иерархия | `area_region`, `lad_region`, триггер `fill_area_region` |
| `area_parent(area_id, parent_id, hierarchy)` | дополнительные иерархии (статистическая и админ, если не вкладываются) | — |
| `boundary_set(id, ns, kind, source_release_id, valid_from)` | версия границ, например `ons-lsoa-2021-bgc` | `geography_vintage` текстом |
| `area_boundary(area_id, boundary_set_id, geom)` | геометрия по версиям; `area_geography.geometry` = текущая | — |
| `area_lineage(from_id, to_id, weight, method)` | сплиты и слияния между версиями (best-fit lookup ONS) для временных рядов | — |
| `area_alias`, `area_xref` | раздел 3.2 | — |

`region_id` = предок на уровне `rank_region`, `country_id` = предок с depth 0. Их ставит один generic-триггер по цепочке `parent_id` при INSERT и UPDATE. Лондон — обычная строка `uk:region:E12000007`.

## 4. Метрики и перцентили

| Что | Где | Когда | Правило |
|---|---|---|---|
| Значение | `metric_value(geography_id, metric_id, period, value, sample_count, quality, source_release_id)` | ETL | как сейчас |
| `region_percentile` | колонка `metric_value` | сборка релиза, `rebuild_metric_ranks(release)` | `round(100 * percent_rank() OVER (PARTITION BY g.region_id, g.kind ORDER BY value))` — формула 103, так что Лондон не меняется |
| `country_percentile` | колонка `metric_value` | та же функция | `PARTITION BY g.country_id, g.kind`; только среди строк с value, поэтому методики (IMD England и WIMD) не смешиваются: у них разные `metric_id` |
| Квантили и медиана у любого предка | `metric_quantiles(metric_id, period, kind, scope_id, n, q real[101])` | та же функция, для каждого `region`, `nation`, `country` и `lad` | перцентиль «of <LAD>» ищется бинарным поиском по q; `region<X>Median` берётся отсюда |
| Произвольный скоуп (вид карты через регионы, нарисованная зона, мульти-страна) | на чтении | запрос | `percent_rank()` по срезу (индекс `metric_id, period`); кэш по `(metric, period, kind, hash(scope))` |
| Межстрановое сравнение | `metric_definition.comparable` = `world` \| `country` \| `region` | — | при скоупе шире `comparable` ответ `null` с причиной `not-comparable` (правило 1 концепции) |
| Ранги-производные (`quiet`, `park-distance`, `station-walk`, `best-primary`) | `area_rank` (бывшая `area_london_rank`) | `rebuild_area_rank()` | колонки `region_percentile`, `country_percentile`, `ranked`, `country_ranked`. Позже можно сложить в `metric_value` как обычные метрики |

`map_chunks.england_ranks` и рантайм-ранги в `evidence.py` удаляются: `country_percentile` хранится.

## 5. Покрытие из данных

| Объект | Источник | Кто читает |
|---|---|---|
| `metric_coverage(metric_id, period, kind, scope_id, with_value, total)` | считается на релизе по `metric_value` для каждого `region`/`nation`/`country` | каталог `/api/v1/metrics`: `coverage: [{scopeId, share}]` |
| Штриховка no-data | нет значения у места → одна штриховка | карта (удаляются 2 из 3 путей no-data) |
| Чип «нет данных здесь» | `share < 0.95` в скоупе вида | легенда |
| «Только Лондон» | выводится сам: coverage только у `uk:region:E12000007` | текст чипа из имени скоупа |

Удаляются `LAYER_COVERAGE`, `isLondonOnly` и `LONDON_COVERAGE`. Покрытие данных (что загружено) и обслуживаемый скоуп (что разрешено флагом, раздел 7) — разные вещи, их не смешиваем.

## 6. Один `Scope`

| Слой | Форма |
|---|---|
| Контракт | `Scope {id, level, name, ns, served: [areaId], rankLevel, bbox}` и `RankScope {id, code, name, level}` у каждой области |
| API | `scope: Scope = Depends(get_scope)`. Входы: флаги для канала (`public_call` для MCP и расширения), область запроса, `?scope=`. Методы: `sql_filter()` → `g.region_id = ANY(:served)` (или `ancestors && :served`), `rank_scope(area)`, `words` |
| Эндпоинт | `/api/v1/scope` отдаёт скоуп текущего канала |
| Веб | `ScopeContext` грузится в layout. Если `/api/v1/scope` упал, показываем ошибку, а не подставляем Лондон |
| Удаляется | `region_view`/`filter_rows` (14 call-sites), `_LONDON_WORDS`, 7 лондонских боксов (префильтры берут `scope.bbox`), ветки `LONDON_COVERAGE` |

## 7. Флаги как фильтры данных

| Механизм | Как |
|---|---|
| `scope_grant(flag text NULL, area_id)` | `NULL` — база: `uk:region:E12000007`. `CLOSE_KNIT_ENGLAND` → `uk:nation:E92000001` |
| `Scope.served` | база ∪ гранты тех флагов, что включены для канала |
| `CLOSE_KNIT_ENGLAND` off | served = Лондон: вне Лондона `area-not-found`, списки, паки и поиск только лондонские, причина `outside-london`. Ровно как FLAGS.md |
| `CLOSE_KNIT_ENGLAND` on | served = Англия, причина `outside-coverage`, ранги внутри региона |
| MCP и расширение | `public_call()` читает флаг как off, пока сайт private (FLAGS.md, `CLOSE_KNIT_MCP_ACCESS`), значит served = Лондон. Не меняется |
| Новые страны | `CLOSE_KNIT_COUNTRY_<ISO2>` (по умолчанию off) + строка гранта + строка в FLAGS.md в том же PR |
| Флаги источников (`AIR_QUALITY`, `SCHOOL_LINKS_GSG`…) | остаются как есть: скоуп не меняют, удерживают значения (ключи есть, значения null) |

Источники, которые есть только в Лондоне (TfL, ULEZ, GLA…), к флагу отношения не имеют: вне Лондона у них null, это видно по `metric_coverage`.

## 8. Тайлы: один пайплайн на релиз

| Шаг | Как |
|---|---|
| База | нижний `stat`-уровень каждой страны (GB: LSOA 2021 BGC). Вложенные родители (MSOA, LAD, region, nation) собираются через `ST_CoverageUnion` из детей; официальная геометрия остаётся для поиска точки |
| Упрощение | `ST_CoverageSimplify(geom, tol_z) OVER (PARTITION BY ns, kind)` на каждую полосу зума (или tippecanoe с shared nodes) |
| Файл | один `areas-<hash>.pmtiles`, слой = kind, полосы зума из `geo_level`, у фичи только `fid`. Hash берётся от id, хешей геометрии и параметров упрощения, а не только от id (как в `116:27`) |
| Мир | страны и admin1 — те же шаги, слои `country`/`admin1` на z0–6 в том же файле |
| Раздача | статика через Caddy/CDN. `area_tile` в Postgres и прокси через FastAPI/Next убираются после переключения |
| Гейт | `ST_CoverageInvalidEdges = 0` на каждом уровне; `symdiff(parent, union(children)) ≈ 0`; пересечения в контрольных тайлах < 5 unit² |

## 9. ETL как плагины стран

| Интерфейс | Возвращает |
|---|---|
| `CountryPlugin.levels()` | строки `geo_level` |
| `.boundaries(release)` | места, `boundary_set`, parents, xref, lineage |
| `.sources()` | `[Source]`: `id`, `licence`, `covers` (id мест), `fetch`, `validate`, `load` → строки `metric_value` в staging |
| `.grants()` | предлагаемые `scope_grant` (имя флага) |

| Правило | Как |
|---|---|
| Раскладка | `etl/countries/uk/{plugin.py, sources/*.py}`, `etl/countries/world/` (Natural Earth, admin1) |
| Запуск | `python -m etl.release build --ns uk` → staging → общие шаги (ранги, квантили, покрытие, тайлы) → гейт → `product_release` |
| Лондонские источники | `covers=['uk:region:E12000007']` вместо `CLOSE_KNIT_ETL_COVERAGE` (39 мест) и боксов |
| Английские бандлы | 13 файлов `deploy/tools/*england*` раскладываются в источники `uk` по темам (#18) |
| Тесты | у каждого источника фикстура на 10–50 мест и общий контракт-тест интерфейса |
| Лицензии | GADM нельзя. Overture (ODbL): производную базу придётся открыть под ODbL. Альтернативы: geoBoundaries (CC BY 4.0), Natural Earth (public domain). Выбирает владелец |

## 10. Финальные имена

| Сейчас | Новое имя | Где | Переходный период |
|---|---|---|---|
| `metric_value.london_percentile` | `region_percentile` | БД | `RENAME COLUMN` в том же деплое, что и код; откат = обратный rename |
| `metric_value.england_percentile` | `country_percentile` | БД | то же |
| `area_london_rank` | `area_rank` | БД | view `area_london_rank` на один релиз |
| `area_london_rank.london_percentile` | `area_rank.region_percentile` (+ `country_percentile`, `country_ranked`) | БД | в view старое имя |
| `rebuild_area_london_rank()` | `rebuild_area_rank()` | БД | обёртка со старым именем на один релиз |
| `geography_kind` `'borough'` | `'lad'` | БД (`ALTER TYPE ... RENAME VALUE`), API `kind`/`carrier`, веб | на вход `borough` принимается одну версию, на выходе `lad` |
| `uk:borough:<code>` | `uk:lad:<code>` | id, URL | `area_alias` навсегда; `/area/borough/<code>` → 301 `/area/lad/<code>` |
| `londonPercentile` | `regionPercentile` | API, MCP, расширение, iOS | deprecated alias: оба поля, одно значение, одна версия контракта |
| `englandPercentile` | `countryPercentile` | API (паки карты) | то же |
| `london<X>` в значении «в регионе» (`londonShare`, `londonMedian`, `londonRate`, `londonChange`, `londonPer`, `londonRent`, `londonRank`, `londonPool`, `londonMonthlyRent`, `londonEntireHomeShare`, `londonActiveShare`, `londonDensityPerKm`) | `region<X>` | API | то же. PR проверяет каждое поле: если поле действительно про город Лондон, оно остаётся |
| `RankScope {code, name}` | `{id, code, name, level}`, `code` без паттерна E12 | API | только добавление полей |
| `area_region` (таблица), `lad_region` | `area_geography.region_id` + parent chain | БД | view `area_region` на один релиз |
| `map_chunks.england_ranks` | хранимый `country_percentile` | API | удаляется |
| `LAYER_COVERAGE`, `isLondonOnly`, `LONDON_COVERAGE` | `metric_coverage` в каталоге и `ScopeContext` | веб | удаляются |
| причины `outside-london` / `outside-coverage` | без изменений | API | — |

**Deprecated alias для публичного контракта.**
- OpenAPI: `deprecated: true` у старых полей, в описании указана замена.
- Ответы со старыми полями несут заголовки `Deprecation` ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) и `Sunset` ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594)).
- MCP: оба поля в выводе; в описаниях инструментов только новые имена.
- Расширение: читает новое поле, при отсутствии — старое; манифест получает bump версии.
- Golden-фикстуры `contracts/fixtures/golden-v1` и тест «оба поля равны».
- Старые поля удаляются в следующей версии контракта: когда версия расширения с новым полем опубликована и прошло не меньше 30 дней.

## 11. Путь миграции: маленькие шаги

Каждый шаг — отдельный PR и отдельный деплой с откатом. Номера миграций ставятся при мерже.

| # | Шаг | Изменение | Безопасность и откат | Проверка |
|---|---|---|---|---|
| 0 | Фундамент (#19, #20) | журнал миграций, SQL-тесты на реальном PostGIS | — | CI зелёный |
| R1 | Переименование имён (#13) | колонки, `area_rank`, enum `lad`, поля контракта с alias | view/обёртка/alias; код и миграция в одном деплое | лондонские перцентили совпадают с прежними один в один; golden; e2e |
| 1 | Иерархия (#11) | `ADD VALUE` `nation`/`region`/`country` (отдельная миграция без транзакции); id CHECK шире; строки `uk:country:GB`, `uk:nation:E92000001`, 9 регионов (геометрия = union LAD); parent LAD → region → nation → country | только добавление; откат = удалить строки | 1/1/9 строк; у каждого LAD есть регион |
| 2 | Денормализация | `region_id`, `country_id`, `ancestors`, `fid`, `local_type`; generic-триггер; `area_region` становится view | readers идут через view | `region_id` = старому `area_region` на 100% строк |
| 3 | Конфиг-таблицы | `geo_level`, `scope_grant`, `area_alias`, `area_xref`, `boundary_set` | только добавление | строки для `uk` |
| 4 | `Scope` (#12) | dependency, `/api/v1/scope`, `ScopeContext`, SQL-фильтр, `scope.bbox`, 3 бага шва | тот же флаг; снимки London off/on до и после | снимки равны, e2e |
| R2 | Id `uk:borough:` → `uk:lad:` | одна транзакция по всем FK из `pg_constraint` + `area_alias`; 301 в вебе | сначала прогон на копии прода с замером времени | 0 строк `uk:borough:` вне alias; старые URL отвечают 301 |
| 5 | Ранги в SQL | `rebuild_metric_ranks`, `metric_quantiles`, `country_percentile`; удалить рантайм-ранги | сравнение с рантаймом до удаления | diff = 0 |
| 6 | Покрытие (#14) | `metric_coverage`, каталог, одна штриховка, чип | доска до кода | каталог совпадает с данными |
| 7 | Тайлы (#1–8) | PMTiles на релиз, line-слой, гейт | старый путь `area_tile` до переключения | гейт из раздела 8 |
| 8 | ETL-плагины (#16–18) | плагин `uk`, источники по темам, удалить `CLOSE_KNIT_ETL_COVERAGE` | релиз старым и новым ETL, diff | diff `metric_value` = 0 |
| 9 | Версии границ | `area_boundary`, `area_lineage`, перенос геометрии | только добавление | — |
| 10 | Мир и вторая страна | плагины `world` и `<ns>` за `CLOSE_KNIT_COUNTRY_<ISO2>` | флаг off | доска, гейт |
| 11 | Уборка | удалить alias-поля, view, обёртки после Sunset | — | grep старых имён = 0 |

**Сделано.** R1 — миграция 121. Шаги 1–3 — миграции 122–123: строки `uk:country:GB`, `uk:nation:E92000001` и регионов (геометрия = union их LSOA, как `area_shape`), parent LAD → регион, `region_id`/`country_id` (триггер на вставку и `refresh_geography_tree()`; вставка LSOA или LAD перестраивает дерево сама), `area_region` стал view, конфиг-таблицы со строками `uk`. Отличия от плана: `lad_region` остаётся справочником LAD → регион для загрузки (строка региона появляется только вместе с его LSOA); `ancestors`, `fid`, `local_type` и `ns` не добавлены, их первые читатели — шаги 4, 7 и R2; API отдаёт дерево до LAD (`kinds.SQL_LIST`, `kinds.PARENT_SQL`), пока у регионов нет страниц и id в API (шаг 4 и доска #10). Списки регионов в коде (`coverage.py`, `regions.py`, `scope-name.ts`, `england_lads.json`, `etl_kids.py`) остаются: в их местах вызова нет строки БД (имя по коду без запроса, ETL работает до загрузки географии). Их заменят `/api/v1/scope` (шаг 4) и плагины ETL (шаг 8), а пока тест на реальном PostGIS сверяет `coverage.REGIONS` со строками регионов.

**Шаг 4 сделан** (без миграции). `api/area_api/scope.py`: `Scope {id, level, name, regions, bbox, outside_reason}`, `scope.current()` читает флаг на каждый вызов (MCP и расширение видят его выключенным через `public_call`), `get_scope` — FastAPI dependency (`/api/v1/scope`, `/api/v1/matches?regions=`). Фильтр — `sql_filter()` → `id IN (SELECT id FROM area_geography WHERE region_id IN (...))` или обёртка `rows()` для готового запроса; кэши, которые раньше резались в Python, теперь ключуются регионами скоупа. Удалены `regions.scope/keeper/scope_clause/filter_rows/regional_words`, `_LONDON_WORDS` (слова сравнений пишутся с именем региона там, где строятся: standouts, health, hmo), `coverage.england/name/box/contains/outside_reason`, боксы `listing_card`, `photos`, `portal_zones` (кольцо = `scope.bbox` + поле) и `matching.LONDON_BOX` (TfL берёт `scope.LONDON`). В вебе `ScopeContext` (`components/scope-context.tsx`) грузится в layout из `/api/v1/scope`; `useEnglandMap`, проп `england` и `coversEngland()` читают его, рамка нарисованной зоны — `scope.bbox`. Швы: `crimeVersusRegion` (бывший `crimeVersusLondon`) говорит о регионе индекса, неиспользуемый `regionCrime` удалён, карточка листинга вне Лондона при выключенном флаге — «covers London only» (раньше бокс пропускал Эппинг). Снимки ответов API (Лондон и не-Лондон, флаг off/on, MCP) до и после равны, кроме этой карточки. Остались, по решению: `homes_near.BOX` (адресные данные лондонские, это источник, а не скоуп), `borough_standouts._region_view` (ранжирование внутри региона по одному чтению на все регионы), проверка одного id по карте регионов (`Scope.admits`: маршрут области, хиты поиска из нескольких запросов), ветки загрузки карты по `map/coverage` (шаг 7). Если `/api/v1/scope` не ответил, страница говорит об этом строкой поверх всего с Try again (доска #10, `components/scope-context.tsx`).

**Шаг 5 сделан частично** (миграция 124). `rebuild_metric_ranks(release)` хранит `country_percentile`: `round(100 * percent_rank())` по `value` в `PARTITION BY metric_id, period, g.kind, g.country_id`, только среди строк с `value` и `region_percentile` (метрика без рангов, например Census, остаётся без них). Её вызывает `activate_product_release()`, поэтому ранги пересчитываются при любой активации, в том числе при откате. Строка пишется, только если её ранг изменился. Удалены `ENGLAND_RANK_SQL`, `_england_ranks`, `map_chunks.england_ranks` и `rolled_values`. С выключенным флагом `_summary` отдаёт `countryPercentile = null`. Сверка на копии ae-pgold: хранимые ранги против рантайма main дают 0 расхождений на 3,62 млн рангов носителя (все метрики и месяцы). Отличия от плана:
- `region_percentile` пока пишут загрузчики. С одним правилом поменялись бы лондонские числа. IMD (децили), доход и социальная аренда ранжируются по `cume_dist` (`etl_people_metrics.cume_percentiles`): у IMD расхождение в Лондоне до 17 пунктов, во всех строках. `hpi-change-*` несёт вниз ранг своего LAD (`rebuild_hpi_layers`), до 6 пунктов. Crime, £/м², short lets, future stations, income и social renting расходятся на ±1–3 в 0,4–21 % строк: их ранжировали по неокруглённым значениям. Решение за владельцем. После него функции нужна ещё одна строка `SET`, и Python-хелперы загрузчиков удаляются.
- Ранг в стране у свёрток (медианы MSOA/LAD на зумах «country») по-прежнему считается на чтении, но одним SQL (`ROLLED_RANK_SQL`): медиана медиан не хранится. Медиана ранжируется среди медиан того же уровня. Медиана рангов детей (как `region_percentile` в `roll_up`) вдвое сократила бы верхний дециль карты, а это видимое изменение для доски #10. Расхождение с Python — 2 ранга из 749 тыс.: 2 MSOA из 1 001 на точной половине процента (54,5 → 54 против 55), по одной метрике. Хранить свёртки — пункт #17.
- `metric_quantiles` не добавлен: у него нет читателя. Медиана региона нигде не берётся из `metric_value`, а «перцентиль of <LAD>» появится со страницами регионов. Направление метрики при хранении не нужно: все перцентили восходящие, направление применяется на чтении.

**Шаг 6, часть данных и API** (миграция 126). `rebuild_metric_coverage(release)` пишет `metric_coverage(release_id, metric_id, period, kind, scope_id, with_value, total)` для каждого региона, нации (родитель региона) и страны, где у метрики есть значение; строки без значений не пишутся. Её вызывает `activate_product_release()` вместе с рангами; хранятся строки активного релиза и активируемого. Каталог `/api/v1/metrics` отдаёт `coverage: [{scopeId, share}]` на carrier метрики: каждый скоуп со значениями в каком-либо месяце, `share` — в последнем месяце этого скоупа (источник, загруженный по Англии до июня и по Лондону до августа, покрывает оба). С выключенным флагом в `coverage` только Лондон. Веб: `londonOnlyLayers()` (`map-topics.ts`) выводит «London only» из каталога: метрика, у которой единственный регион со значениями — Лондон; detail-слои (Green streets, Green cover) — по слою областей под ними (`nature-score`). `LAYER_COVERAGE` и `isLondonOnly` удалены; тест в `web/tests/map-coverage.test.ts` падает, если ручной список вернётся. Метка теперь там, где данные релиза только лондонские: в локальной копии (ae-pgold) это те же метрики, что в старом списке (short lets, HMO, pipeline, future stations, Green & trees, wildlife, stock value), плюс crime — его английские строки в активный релиз не входят; air-no2 и student-share, где Англия загружена (ревью #14), метку теряют. Остались: оверлеи Show (stations, cycle-lanes, trees) — не метрики, их «London only» объявлен в `MAP_OVERLAYS` (`londonOnly`) до шага 7. Доска #10 (27.10.2026, DESIGN.md §6 «England map»): один серый no-data (90%, внутри покрытия; вне покрытия заливки нет, `lib/no-data.ts`), квадрат «No data» и тег «London only» в легенде, сообщение «<Layer>: London only · Show London»; лестница LAD (до z6.5) → MSOA (до z9) → LSOA, границы line-слоем, подписи регионов. Остались кросс-фейд 0,5 зума, линия региона, пунктир покрытия и тайлы до z14 — им нужны регионы или уровни в одном тайловом файле (шаг 7).

Из шага 7 сделан пункт #7 ревью (миграция 125): формы областей попадают в браузер только векторными тайлами. GeoJSON- и polyline-путь, `?format=boxes`, kill switch `CLOSE_KNIT_AREA_TILES`, Martin и `area_geometry(z,x,y)` удалены; экстенты карта берёт из индекса боксов `/api/v1/areas/boxes`. С `CLOSE_KNIT_ENGLAND` off тайлы держат только области Лондона (`area_region_tile_mvt`, свой release), demo — тайлы фикстур из веб-роута.

Пункт #8 сделан (миграция 127): `deploy/tools/area_pmtiles.py` пакует тайлы `area_shape_zoom` (через `area_region_tile_mvt`, байт в байт как `area_tile`) в статические PMTiles v3, Caddy отдаёт их из `/srv/close-knit-tiles` как immutable с Range-запросами, карта читает их протоколом `pmtiles` в воркерах MapLibre (`importScriptInWorkers`, как любой другой тайл, вне главного потока), service worker кладёт каждый диапазон в кэш релиза. Release — хеш байтов файлов, а не id зон: новая геометрия с теми же id даёт новые имена файлов. Сборки пишутся в `area_pmtiles`, API отдаёт в `areaTiles` самую новую для каждого скоупа (всё / только Лондон при `CLOSE_KNIT_ENGLAND` off). Отличия от плана:
- Не один файл со слоями, а архив на kind: `areas-<release>-{lsoa,msoa,borough}.pmtiles`. Карта рисует один kind почти на всех зумах (свой carrier метрики с z7, LSOA-критерии и match на любом зуме), а LSOA-слой в 2–4 раза тяжелее MSOA: в одном файле каждый тайл вёз бы байты всех трёх (z6 Англии: 1,9 МБ вместо 0,5 МБ MSOA). «LSOA с z7» в общем файле убрало бы LSOA-критерии на z5–6, а это видимое изменение для доски #10. Один файл станет выгоден вместе с полосами зума из `geo_level`.
- Слой границы LAD называется `borough`, как в URL тайлов: R2 оставил его (тайлы несут `fid`, а не id), переименование в `lad` — с шагом 7 (один файл).
- DB-путь (`/api/v1/tiles/areas`, прокси Next, `area_tile`, `build_area_tiles.sql`) остаётся фолбэком: coverage кэшируется браузером на день плюс неделю stale-while-revalidate, и закэшированная coverage называет URL API. Удалить его — отдельный PR не раньше чем через 8 дней после выкладки; тогда же миграция удалит `area_tile`, `area_tile_build`, `build_area_tiles()`, `area_tile_mvt()` и `area_tile_release()` (старый API читает их, пока идёт ship).

**R2 сделан** (миграция 129). `uk:borough:<code>` → `uk:lad:<code>` в `area_geography` и во всех колонках с id: внешние ключи на `area_geography` стали `DEFERRABLE` (каталог, проверка по-прежнему сразу), откладываются на время переименования, затем каждая колонка из `pg_constraint` переписывается по ~300 старым id; колонки без внешнего ключа (`area_label`, `area_market`, `area_noise`, `area_price_growth`, `area_price_year`, `area_recent_sale.borough_id`, `area_shape*`, `zone_price_index`) найдены сканом прода 27.10.2026; `product_event.props` — история, не трогается. Тела функций с `'uk:borough:'` переписаны, как в 121. Старый id — строка `area_alias` навсегда; `geo_level.url_segment` у `lad` = `lad`. На копии ae-pgold: 296 LAD, 1,17 млн ссылающихся строк (metric_value — 79 тыс.), ~3 минуты, из них 2,5 — отложенные проверки FK. Старые id принимаются везде: API — `AreaAliasMiddleware` (путь, query, JSON-тело; `api/area_api/id_alias.py`), MCP и `/tools` — `kinds.canonical_value` в `call_tool` (паттерны входа инструментов принимают оба префикса), ссылки `#profile=v1..v3` — при декодировании (API `share_links`, веб `canonicalAreaIds`), сохранённое в браузере — один раз скриптом `AREA_ID_BOOT` до чтения, `?selected=` — `canonicalAreaId`; веб отвечает 301 с `/area/borough/<code>[/...]` на `/area/lad/<code>[/...]` (`proxy.ts`), sitemap и canonical строятся из id и говорят `lad`. Отличия от плана:
- Тайлы сохраняют kind `borough` (`area_shape*.kind`, `area_tile`, имена PMTiles-файлов и MVT-слоя, `TileKind` в вебе): тайлы несут номер кода (`fid`), а не id, поэтому их байты не меняются и пересборка не нужна; переименование kind — вместе с одним файлом на полосы зума (шаг 7).
- Словари, которые не id, остаются: зона `{kind: "borough", id}`, уровень ценового диапазона `borough`, `civic.subject.kind` и аналитика поиска.
- Сохранённые ответы `release_artifact` с id — новый `FORMAT = 4`, пересобираются `release_build`.
- `local_type` колонкой не добавлен: у него нет читателя, кроме подписи, которую веб берёт по коду (E09).

R1 стоит раньше шага 4 по запросу владельца. Alias держит старые и новые имена одновременно, поэтому двойной путь кода ревью (#13 после #12) не нужен: в R1 меняются только имена, без логики.

## 12. Решения владельца (приняты 27.10.2026)

Владелец передал решения на усмотрение (27.10.2026: «остальные вопросы по твоему усмотрению»); приняты рекомендации.

| # | Вопрос | Решение |
|---|---|---|
| 1 | Флаг off в публичном проде = «английский код, ограниченный лондонскими строками» (ревью #12) | да: так и работает `Scope` (шаг 4) |
| 2 | URL `/area/lad/<code>` или `/area/borough/` для Лондона ради SEO | `/area/lad/<code>`, со старого `/area/borough/<code>` — 301 (R2, миграция 129). Подпись — из типа LAD (`local_type`: «London borough» для E09, иначе «Local authority»), а не из id или сегмента URL |
| 3 | Границы мира и admin1 | Natural Earth для стран + geoBoundaries (CC BY) для admin1; Overture (ODbL) — только после юриста по ODbL. Пока только запись, кода нет (шаг 10) |
| 4 | Срок Sunset для alias | старые поля (`londonPercentile`, `englandPercentile`, `london<X>`) удаляются через 30 дней после публикации расширения с новыми именами. До неё даты нет: ответы несут `Deprecation`, `Sunset` не отправляется; после публикации — `CLOSE_KNIT_ALIAS_SUNSET=YYYY-MM-DD` (дата публикации + 30 дней, RELEASE-CHECKLIST.md) |
