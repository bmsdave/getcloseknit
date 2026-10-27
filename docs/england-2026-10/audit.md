# Аудит: что держит Close Knit в Лондоне (2026-10-22)

Приложение к [plan.md](plan.md). Три read-only аудита: данные, код, инфраструктура. Пути относительно корня репо. Числа по Лондону взяты из локальной БД и документации, а не с прода.

## 1. Данные

**Масштаб.** В Англии 33 755 LSOA, 6 856 MSOA и ~296 LAD. В Лондоне 4 994 LSOA, 1 002 MSOA и 33 боро.

**Модель районов:** `lsoa → msoa → borough`. Уровень `borough` принимает только 33 кода E09 (`pipelines/area-analytics-ingest/area_analytics/geography.py:25-33,190,219`). Цены откатываются LSOA → MSOA → боро при < 20 сделок (`property_value.py:15`).

**Лондонская логика рангов:**
- `metric_value.london_percentile` (`deploy/schema.sql:59`, ~15 миграций)
- `area_london_rank` (054) и `rebuild_area_london_rank()` (`deploy/tools/etl_noise.py:170`)
- good-value (069)
- ценовые децили в `peers.py:119`
- веса тренда 0,6/0,25/0,15 (London) в `forecasting.py:320-326`
- порог 1000 жителей Лондона в `census_picks.py:276`
- 32 хаба commute

Сравнение с Англией уже считается (`analytics.py:85-98`), но подавлено (`analytics.py:451`).

### Класс A: национальные, фильтр наш (45)

| Источник | Фильтр | Замечание |
|---|---|---|
| ONS границы и lookup | `geography.py:25-33`, `deploy/tools/boundaries.py:4`, `london-codes.json` | — |
| ONSPD | `civic.py:127` (`rgn != E12000007`), `onspd-london.csv` | На `postcode_civic` опираются многие ETL. |
| Council Tax Table 10 | `civic.py:241` | В двухуровневых районах есть precepts. |
| Democracy Club | `civic.py:62-65,262` | Выборы по третям и половинам. |
| Census 2021, ONS API, население | `census_people.py:178-183,540-557`, `census_api.py:68-72`, `census_picks.py:66` | Запросов к API ×7. |
| PIPR rents | `rents.py:43,133`, `etl_rent_trend.py:44` | — |
| UK HPI | `etl_uk_hpi.py:65` | — |
| FHRS | `food_hygiene.py:63` | ~300 XML. |
| OS Open Names | `streets.py:37,64` | — |
| Geograph | `geograph.py:42,80,134` | — |
| OSM | `places_load.py:30,125`, `flood_risk.py:49`, `etl_commute.py:38`, `etl_station_access.py:48` | england-latest ~1,5 ГБ. |
| Overture / FSQ | `overture_places.py:40,144`, `fsq_places.py:48,276` | Guard 4 ГБ (`fsq_places.py:138`). |
| Companies House, сайты агентств | `agency_companies.py:55,161`, `agency_crawl/verify.py:131` | Краул 1 запрос / 5 с на домен. |
| NaFRA2 flood | `flood_risk.py:47` | WMS-скрейп ~8k тайлов, лучше bulk. |
| Noise Round 4 | `etl_noise.py:39` | — |
| planning.data.gov.uk | `planning_context.py:23`, `etl_home.py:52,112-140` | Покрытие частичное. |
| PPD | `bulk_mappers.py:21`, `bulk_price.py:83`, `etl_price.py:43,57`, `etl_sales.py` | — |
| EPC | `etl_epc.py:119,185` | — |
| INSPIRE | `etl_property.py:40-57,291` | — |
| police.uk | `analytics.py:122`, `bulk_mappers.py:34`, `ziprange.py:27`, `etl.py:87`, `etl_crime_release.py:54` | — |
| GIAS, KS2/4/5, CSCP | `school_history_common.py:43` (`LONDON_LAS`), `etl_school_performance.py:187`, `etl_schools.py:72` | — |
| Ofsted MI и отчёты | `etl_ofsted_history.py:206` | Отчёты по одному PDF. |
| Applications/offers, Ofsted childcare, STATS19 | `etl_school_demand.py:91`, `etl_kids.py:187,204,227` | — |
| Ofcom | `etl_home.py:185`, `etl_mobile.py:87` | — |
| VOA CTSOP, CCOD/OCOD | `etl_council_tax.py:97`, `etl_ownership.py:122` | — |
| NHS GP | `etl_health.py:45,441` | — |
| Sentinel-2, OS Open Roads | `etl_nature.py:58,137`, `etl_green_streets.py:49` | Сырьё ~80–150 ГБ. |
| GBIF | по LSOA | ~10k запросов, дни; нужен download API. |
| IMD, доходы, UPRN, Natural England, CPIH, BoE | косвенно или без фильтра | — |

### Класс B: только Лондон (17)
- TfL: StopPoint/зоны, расписания + R5, Santander, велодорожки/Cycleways, ULEZ/CC, Travelcard
- GLA: conservation areas, Planning Datahub, LDD, Opportunity Areas/Housing Zones, LAEI-воздух, Urban Heat Island, деревья
- Admissions 33 боро (`school_admissions/boroughs/*.yaml`)
- HMO-регистры боро
- future_transport.yaml
- Inside Airbnb London

Замены перечислены в plan.md, фаза 6.

### Класс C: лицензии и масштаб
1. Условия советов для admissions и HMO.
2. Rail Data Marketplace против OGL.
3. Стоимость Google Places.
4. GBIF DOI.
5. Условия Foursquare.
6. ODbL share-alike.
7. ×7 персональных данных в PPD/EPC (ICO, LIA, вопрос к юристу про EPC per-home).
8. Агрегаты CCOD/OCOD.
9. Лицензии LAEI/Datahub перестают быть проблемой, если источники заменены.

## 2. Код

| Подсистема | Где | Тип |
|---|---|---|
| Границы карты | `web/src/lib/map-state.ts:166-192`, `area-map.tsx:516`, `home-mini-map-canvas.tsx:146`, `map-street-trees.ts:302`, `contracts.ts:375` | Замена константы |
| Хлороплеты | `/api/v1/areas/geometry` (`geometry_codec.py`, `evidence.py:747`) + value packs (`app.py:771`, `evidence.py:1646`, `PACK_CACHE_SIZE=64` `evidence.py:109`) | **Дизайн**: тайлы и чанки |
| Точечные тайлы | MVT в PostGIS (`app.py:915-1031`; миграции 008, 036, 065, 066, 102) | Масштабируются. Canopy — PNG-пирамида по bbox Лондона. |
| Martin `area_geometry` | `deploy/schema.sql:331`, миграция 001: `ST_Transform(geom) && bounds` без индекса | Исправить |
| Проверки «outside London» | `matching.py:30,383`, `portal_zones.py:29`, `listing_card.py:31,103`, `photos.py:17`, `commute.py:301-326`, `evidence.py:1268,1307`, `home_search.py:853,1847`, `search_text.py:21-31,89`, `civic.py:66,200` | Константы + coverage |
| Боро | Триггер в миграции 001:33-57, enum `schema.sql:31-35`, `portal_zones.py:40-56`, `schools-hub.ts:25-37`, `custom_criteria.py:262,764` | **Дизайн**: уровни LAD/region |
| Перцентили | ~143 в API, ~151 в вебе, 29 `londonPercentile` в `openapi.yaml`; `percentiles.py`, `location.py:34-113`, `repository.py:30`, `tools.py`, `guidance.py:12`, `extension/src/content/badge.ts:49` | **Дизайн**: scope |
| SEO | `area-pages.ts` (корень `LONDON`, `/area/london`), `seo.ts:17-34,197-252`, `sitemap.ts` (~70k URL > 50k) | **Дизайн** + шардирование |
| Тяжёлые запросы | `POST /matches` (`repository.py:244`, без кэша, все районы), `personal_places.py:61`, `custom_criteria.py:68` (`MAX_PLACES=60000`), `area-pages-data.ts` (всё в памяти Next) | Переписать |
| Поиск | `evidence.py:157-179` (ILIKE мимо trigram-индекса), адреса `evidence.py:375` | Индексы, нагрузочный тест |
| Commute | `commute.py:1-24` (только TfL), `deploy/routing/hubs.csv` (32 хаба) | **Дизайн** |
| Тексты | «London»: ~753 в 186 файлах веба, 344 в API, 45 в контракте, расширение и агенты | Хелпер scope |

## 3. Инфраструктура

**Прод.** Один VPS (по документации OVH VPS-3: 6 vCore shared, 12 ГБ, 100 ГБ NVMe; точная спецификация в репо не зафиксирована). Docker Compose: PostGIS 18-3.6, FastAPI с одним uvicorn-воркером, Next.js, Caddy.
- `shared_buffers` 2 ГБ, `work_mem` 32 МБ.
- БД ~7,3 ГБ, дамп ~1,2 ГБ.
- ETL вручную на Mac, доставка через pg_dump → `ship.sh` → `pg_restore --clean` на живой базе (простой на время restore).

**Крупные таблицы (Лондон, локальная старая БД)**

| Таблица | Размер | Строк |
|---|---|---|
| sale | 2,9 ГБ | 4,0M |
| sale_pin | 1,1 ГБ | 2,1M |
| parcel | 0,97 ГБ | 2,1M |
| city_block | 0,78 ГБ | — |
| metric_value | 0,71 ГБ | 1,4M (+ ~3M census) |
| place | 0,71 ГБ | 0,65M |
| travel_time_matrix | 0,61 ГБ | 1,6M |
| flood_zone | 0,53 ГБ | — |
| street_tree | 0,50 ГБ | — |

**Множители на Англию**

| Что растёт | Множитель |
|---|---|
| Таблицы по LSOA | ×6,8 |
| Сделки | ×7 (~28M) |
| Места | ×6–7 |
| Postcodes | ×4–7 |
| INSPIRE | ×10 (20M+) |
| Площадные таблицы | ×10–80 |
| Commute при региональных хабах | ещё ×5–20 |

Итог: **БД ~50–80 ГБ, дамп ~8–12 ГБ.**

**Что ломается:**
1. Диск 100 ГБ, ломается первым.
2. RAM 12 ГБ: горячий набор ~15–25 ГБ.
3. ETL RAM: NDVI ~15–45 ГБ, индекс EPC ~20–40 ГБ.
4. ETL-время: GBIF и Ofsted идут днями.
5. Restore: ~1–2 ч простоя.
6. Single-worker API: value packs, линзы custom criteria (риск statement timeout 20 с), matches.

**Тайлы.** Цена одного тайла зависит от плотности, а не от покрытия, поэтому они масштабируются. Хуже станет только попадание в кэш.

**Рекомендуемый сервер:** 32–64 ГБ RAM, 8+ dedicated ядер, 300–500 ГБ NVMe. Минимум: VPS-4 (24 ГБ / 200 ГБ). Для ETL — 64 ГБ / 1 ТБ или рефактор NDVI и EPC.
