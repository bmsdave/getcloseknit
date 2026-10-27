# 03. Чем Лондон отличается от других городов Великобритании и крупных городов мира и какой аналитикой там пользуются

*Октябрь 2026. Раздел опирается только на тематические заметки из `raw/` и на результаты их проверки по первоисточникам. Новых веб-поисков не делалось. Где проверка подтвердила утверждение лишь частично, стоит знак ⚠️, а где проверить не удалось, стоит пометка «не проверено». Сводный ответ, единый рейтинг критериев и расширенная таблица аналитических инструментов (включая аренду и страны-доноры) — в [REPORT.md](REPORT.md).*

## Коротко

- **Главное отличие Лондона в том, что бюджет здесь жёстко ограничивает поиск.** Отношение цены жилья к доходу в Лондоне 10,6 против 7,6 по Англии и 5,0 на Северо-Востоке. Аренда съедает 41,6% дохода против 19,8% на Северо-Востоке. Поэтому лондонец сначала выбирает место и транспорт, а затем решает, на какой тип жилья хватит денег. В регионах наоборот: сначала тип дома (семи/детач, сад, парковка), а бюджет ограничивает гораздо слабее ([ONS 2025](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/housingaffordabilityinenglandandwales/2025), [ONS rent](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/privaterentalaffordabilityengland/2024)).
- **Транспорт в Лондоне стоит на первом месте, в США почти не важен.** В опросе NAR общественный транспорт как причину выбора района называют только 6% американских покупателей ([NAR 2025](https://www.nar.realtor/sites/default/files/2025-04/2025-home-buyers-and-sellers-generational-trends-04-01-2025.pdf)). В Токио, Москве, Сингапуре и Дубае «минуты пешком до станции» оцениваются явно, и зависимость нелинейная: в Токио после 8-й минуты каждая лишняя минута стоит примерно в 6 раз дороже ([Diewert & Shimizu](https://cigs.canon/event/report/uploads/pdf/151016_diewert_paper.pdf)).
- **Во всех мегаполисах форма собственности — один из первых фильтров: многие варианты отпадают по ней ещё до сравнения цен.** Только содержание у неё в каждом городе своё: в Лондоне leasehold (владение квартирой на срок аренды) и service charge (плата управляющей компании), в Нью-Йорке co-op/condo и одобрение совета дома, в Стокгольме avgift (взнос) и долг кооператива, в Майами резервы ТСЖ, в Сингапуре остаток 99-летней аренды. Деталь, которая есть только в Лондоне, — «обрыв» на 80 годах остатка аренды.
- **Лондонский рынок по сравнению с другими беден данными.** Нет общей базы продаж в реальном времени, как MLS в США. Нет юридически заверенной площади, как loi Carrez в Париже. В открытых данных о сделках (Price Paid Data Land Registry) нет площади, спален и состояния ([GOV.UK](https://www.gov.uk/guidance/about-the-price-paid-data)); площадь приходится подтягивать из EPC сопоставлением адресов. В Дубае, наоборот, сделку можно найти по номеру титула или договора конкретной квартиры. Про британский идентификатор объекта UPRN заметки ничего не говорят, см. «Ограничения» в [REPORT.md](REPORT.md). Продукт может закрыть именно этот пробел: давать цену за кв. фут, сопоставимые сделки на уровне дома и минуты пешком по реальной сети улиц.
- **Цена, которую показывает портал, якорит рынок.** Каждый 1% роста Zestimate до выставления поднимает цену листинга на 0,733%, а цену сделки только на 0,081% ([NBER w29880](https://www.nber.org/system/files/working_papers/w29880/w29880.pdf)). У объектов, ещё не выставленных на продажу, ошибка AVM около 7% ([Redfin](https://www.redfin.com/redfin-estimate)).
- **Регулирование аренды делит рынки на «своих» и «чужих».** Так устроены Берлин, Париж, Стокгольм, Барселона, Нью-Йорк и Дубай. В Лондоне потолков аренды нет, поэтому запрашиваемая цена ближе к рыночной. До мая 2026 года арендатор конкурировал ценой и предоплатой. С 1 мая 2026 года Renters' Rights Act запретил принимать предложения выше объявленной ставки и ограничил предоплату одним месяцем, поэтому теперь конкурируют скоростью въезда и прохождением проверки дохода (распространённое правило — годовой доход около 30 месячных аренд, доля агентств не измерена), а не местом в очереди.
- **Видимость риска меняет поведение.** Когда школы, наводнения или энергокласс показаны в момент поиска, их вес резко растёт ([NBER w27209](https://www.nber.org/system/files/working_papers/w27209/w27209.pdf), [NBER w33119](https://www.nber.org/papers/w33119)). Отрасль сопротивляется: Zillow убрал климатические скоры после жалоб брокеров ([TechCrunch](https://techcrunch.com/2025/12/01/zillow-drops-climate-risk-scores-after-agents-complained-of-lost-sales)).

---

## 1. Как читать раздел

**Уровни критериев:**
- **основной** — жёсткий фильтр или главный фактор цены;
- **дополнительный** — корректирует цену или решает при равенстве;
- **нишевый** — важен для отдельного сегмента.

**Кто пользуется критерием:** покупатель, арендатор, агент, продавец, оценщик.

**Ограничения источников:**
- Reddit, Rightmove/Zoopla-форумы, Savills, PropertyGuru, Funda и часть порталов в большинстве тематических подборок были недоступны (403/429).
- Поэтому «голос форумов» взят из MoneySavingExpert, Mumsnet, HardwareZone, RikaTillsammans, Blind, Hacker News и тех Reddit-веток, которые удалось прочитать через архив.
- Форумные данные по Гонконгу и Японии старые (2004–2007); их используем только как описание привычек, а не как текущий рынок.
- Милан фактически не покрыт. По Сиэтлу, Лос-Анджелесу и Сан-Франциско есть только данные о Walk Score, MLS и AVM (см. [REPORT.md](REPORT.md), §6); Вена в заметках не разбиралась.

---

## 2. Лондон и остальная Великобритания

*Сводная версия этого сравнения, согласованная с разделами 01 и 02, — в [REPORT.md](REPORT.md), §5.*

### 2.1 Структурная разница: доступность жилья

| Показатель | Лондон | Остальная Англия / регионы | Источник |
|---|---|---|---|
| Цена / доход (2025) | 10,6 (Kensington & Chelsea 25,2) | Англия 7,6; North East 5,0; Hyndburn и Hull 4,1 | [ONS 2025](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/housingaffordabilityinenglandandwales/2025) |
| Аренда / доход арендатора (FYE 2024) | 41,6%; по ONS все 10 наименее доступных местных властей Англии находятся в Лондоне (это рейтинг худших, а не утверждение, что каждое боро выше 40%; последнее не подтверждено) | Англия 36,3%; North East 19,8%; Hartlepool 15,9% | [ONS rent](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/privaterentalaffordabilityengland/2024) |
| Годовая динамика цен (Zoopla, сент. 2026) | −1,0% (худший регион) | North West +3,1%, Scotland +2,6%, North East +2,3% | [Zoopla HPI](https://www.zoopla.co.uk/discover/property-news/house-price-index/) |
| Доля продаж за 3 месяца | ~30% | Шотландия ~75% | там же |
| Рост за 10 лет (Rightmove) | +7% | Манчестер +63% | [The Negotiator](https://thenegotiator.co.uk/news/uk-housing-market-news/manchester-fastest-london-slowest-north-south-divide-in-house-prices/) |

Вне Лондона ONS называет наименее доступными по аренде Bristol, Bath & NE Somerset, Brighton, Trafford, Sevenoaks и Watford ([ONS rent](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/privaterentalaffordabilityengland/2024)). Для арендаторов они ведут себя как «мини-Лондоны» (это наша интерпретация, а не термин ONS): лондонская логика «бюджет ограничивает всё» распространяется на пригородный пояс.

Насколько «горяч» город, зависит от выбранного индекса. По данным Land Registry Манчестер упал на 4,2% (2025), а по Rightmove и Zoopla Северо-Запад лидирует. Land Registry отстаёт, потому что фиксирует завершённые сделки ([The Negotiator](https://thenegotiator.co.uk/columns/town-and-city-tracker-manchester-lows-and-belfast-highs/)).

### 2.2 Критерии: Лондон и регионы

| Критерий | Уровень в Лондоне → в регионах | Кто использует | Измеренный эффект / свидетельство | Источники |
|---|---|---|---|---|
| Транспорт (зона TfL, PTAL, минуты до станции) | основной → дополнительный (в регионах доступ к трассе M62/M6 и машина) | покупатель, арендатор, агент | PTAL (индекс транспортной доступности TfL) — лондонская метрика от 0 до 6b. Публичный набор данных устарел (сетка 2015 года), скорость и давку не учитывает | [PTAL dataset](https://data.london.gov.uk/dataset/public-transport-accessibility-levels), [regional report](https://thenegotiator.co.uk/features/regional-property-reports/regional-report-81/) |
| Тип дома (дом/квартира, семи/детач) | дополнительный → основной | покупатель, агент | В регионах сравнивают разные типы домов при одном бюджете, в Лондоне один тип в разных локациях. Zoopla 2026: семи +1,7%, квартиры −1,3% | [Zoopla HPI](https://www.zoopla.co.uk/discover/property-news/house-price-index/), [MSE Bicester](https://forums.moneysavingexpert.com/discussion/6684254/why-aren-t-we-getting-more-viewings-honest-feedback-welcome) |
| Парковка / гараж | нишевый → основной для семей ⚠️ | покупатель | ⚠️ Свидетельства слабые: один агент из Западного Йоркшира и одна ветка MSE. Тезис, что парковка — «главный фильтр» и из-за неё «встают продажи», проверка по первоисточникам считает преувеличением | [Negotiator](https://thenegotiator.co.uk/features/regional-property-reports/regional-report-81/), [MSE](https://forums.moneysavingexpert.com/discussion/6684254/why-aren-t-we-getting-more-viewings-honest-feedback-welcome) |
| Сад и зелень | дополнительный (дефицит, высокая премия) → ожидаемый по умолчанию | покупатель | +1 п.п. доли садов, зелени и воды в уорде даёт около +1% к цене (Англия, 1 млн сделок 1996–2008) | [SERC DP74](https://researchonline.lse.ac.uk/id/eprint/33594/1/sercdp0074.pdf) |
| Школы | основной для семей (везде) | покупатель | Около 3% цены за 1 SD value-added школы по всей Англии. Давление снижается: 71% начальных школ в 2025/26 взяли всех, кто указал их первыми | [SERC DP18](https://researchonline.lse.ac.uk/id/eprint/30814/8/sercdp0018.pdf), [Hamptons](https://www.hamptons.co.uk/articles/getting-into-an-oversubscribed-school-is-becoming-easier) |
| Эпоха постройки | дополнительный (в Лондоне больше «period») | покупатель, агент | Georgian £531/кв. фут против 2020s £511 и 1920–30s £507. В Лондоне самая большая доля викторианского фонда (28,5%) | [Hamptons](https://www.hamptons.co.uk/articles/period-drama-what-age-of-property-commands-the-highest-prices) |
| EPC (сертификат энергоэффективности) и расходы на содержание | дополнительный | покупатель, арендодатель | Nationwide, два замера: 2021 год — A/B примерно +1,7%, F/G примерно −3,5% к D; обновление 2024 года — A/B +1,6%, F/G −1,4% для владельцев и +12,2% за A/B при покупке под сдачу ([Nationwide 2024](https://www.nationwide.co.uk/media/hpi/reports/energy-efficiency-ratings-have-limited-impact-on-owner-occupied-house-prices-despite-increased-interest-in-going-green)). Частная аренда должна выйти на EPC C к 1 октября 2030 года. В регионах вес EPC растёт для больших старых домов, но форумы спорят, отражает ли EPC реальные счета | [Property Reporter](https://www.propertyreporter.co.uk/property/epc-ratings-having-limited-impact-on-house-prices-nationwide.html), [Elmhurst](https://www.elmhurstenergy.co.uk/blog/2026/01/22/domestic-private-rented-properties-required-to-meet-epc-band-c-by-october-2030/), [MSE Surrey](https://forums.moneysavingexpert.com/discussion/6680888/maintenance-and-running-costs-for-a-larger-older-house) |
| Leasehold и service charge | основной для квартир → менее важен (в регионах больше домов во freehold) | покупатель, оценщик | Остаток аренды 80–99 лет даёт около −16% к freehold, 100–125 лет около −10%. Оценка по Англии и Уэльсу до 2014 года, не только Лондон. Средний service charge в Лондоне £2 801 в год, +41,2% за 5 лет | [NBER w20133](https://www.nber.org/system/files/working_papers/w20133/w20133.pdf), [Landlord Today](https://www.landlordtoday.co.uk/breaking-news/2026/03/soaring-service-charges-on-leasehold-flats-hit-capital-values/) |

### 2.3 Шотландия: другой ценовой сигнал

В Шотландии продавец обязан предоставить **Home Report**: обследование с оценкой независимого сюрвейера, анкету и EPC. Дома выставляют по формуле «offers over» и при нескольких покупателях проводят **closing date** с закрытыми ставками через солиситоров ([mygov.scot](https://www.mygov.scot/buying-a-home/home-report)). Поэтому ценовой якорь здесь — **оценка сюрвейера**, а не цена агента.

- **Исследования.** Thanos & White изучили около 19 300 продаж в Абердине. Премия к цене «offers over» была ниже 5% в 1995–2001 годах и выросла примерно до 35% на пике в I квартале 2007 года. Цены «offers over» отставали от цен сделок на 2–3 квартала, а премия реагировала на ожидания быстрее всего ([NTU](http://irep.ntu.ac.uk/id/eprint/7701/1/217709_PubSub962_White%2520.pdf)). Lo et al. (79 тыс. сделок) показали, что после введения Home Report цены сильнее привязались к соседним сопоставимым сделкам ([Ulster](https://pure.ulster.ac.uk/en/publications/f3cbd6be-6056-4beb-a95e-d9d147657fe8)).
- **Профессионалы.** В 2014 году агенты хвалили Home Report за прозрачность. Представитель Law Society of Scotland после кризиса 2008 года называл его непригодным, а банки иногда не принимали его оценку ([The Negotiator](https://thenegotiator.co.uk/features/home-reports-model-follow/)).
- **Форумы 2026.** Нормой считается нанимать солиситора до просмотра. Closing date могут перенести на «через несколько часов после просмотра». В одной ветке под Глазго покупатель заплатил на 10% выше оценки Home Report ([MSE](https://forums.moneysavingexpert.com/discussion/6684715/ftb-question-accelerated-closing-date), [MSE](https://forums.moneysavingexpert.com/discussion/6682564/home-improvements-translating-into-value)).

**Вывод для Лондона.** В Англии цену фактически задаёт агент, и в горячие годы агенты завышают оценку, чтобы получить объект на продажу. Агент из Солсбери говорил об этом открыто в 2022 году ([Negotiator](https://thenegotiator.co.uk/features/regional-property-reports/regional-report-70/)). К 2026 году сигнал развернулся: дома с реалистичной ценой продаются, завышенные стоят ([Negotiator](https://thenegotiator.co.uk/news/uk-housing-market-news/three-in-five-homes-not-selling-reports-zoopla/)).

Аренда в Шотландии тоже устроена иначе. После заморозки и потолков 2022–25 годов повышение внутри договора получили только 28% арендаторов против 53% в Англии. Объявлений об аренде к марту 2023 года стало на 39% меньше ([Hamptons](https://www.hamptons.co.uk/articles/what-weve-learnt-from-scotlands-rental-system)).

### 2.4 Где источники расходятся (UK)

- **Наука и Hamptons о школах.** Исследования дают устойчивую премию около 3% за SD. Hamptons считает, что из-за падения рождаемости конкуренция за места и премия ослабнут, и в первую очередь в Лондоне.
- **Форумы и EPC.** О старых домах со сплошными кирпичными стенами одни пишут, что счета «минимум удвоятся», другие опытные владельцы — что дом держит тепло лучше ожидаемого. Значит, EPC может плохо отражать реальные расходы.
- **Агенты и продажи.** Формулировка «парковка тормозит продажи» есть только в форумной ветке. Агенты её прямо не подтверждают ⚠️.

---

## 3. Лондон и мировые города

### 3.1 Сводная таблица критериев, специфичных для городов

| Критерий | Уровень | Кто использует | Город и измеренный эффект | Источники |
|---|---|---|---|---|
| Минуты пешком до станции (нелинейно) | основной | покупатель, арендатор, оценщик | Токио: −0,35%/мин на 2–8 мин и −2,01%/мин на 8–13 мин (стоимость земли). Москва: −3,9% за каждые 10 мин пешком (данные 2003 года; это ориентир по форме зависимости, а не текущая премия, свежий индекс ИЭП 2026 года величину эффекта метро не приводит). Дубай: пик +13% на расстоянии 701–900 м, но от −9% до −17,7% ближе 500 м (шум) | [CIGS](https://cigs.canon/event/report/uploads/pdf/151016_diewert_paper.pdf), [Cyberleninka](https://cyberleninka.ru/article/n/the-price-of-moscow-apartments), [JTLU](https://jtlu.org/index.php/jtlu/article/view/750) |
| Общественный транспорт (США) | нишевый | покупатель | NAR: 6% называют его причиной выбора района. При этом +1 балл Walk Score даёт около +0,9% к цене, то есть заявленные предпочтения занижают реальную важность | [NAR](https://www.nar.realtor/sites/default/files/2025-04/2025-home-buyers-and-sellers-generational-trends-04-01-2025.pdf), [Redfin](https://www.redfin.com/news/how-much-is-a-point-of-walk-score-worth/) |
| Форма собственности: co-op / condo (Нью-Йорк) | основной | покупатель, оценщик | Типичная премия condo +8,8%; +13,4% к co-op без ограничений; −25,4% к co-op, не допускающим ипотеку. Совет co-op с лимитом DTI 25% против 43% у банка вдвое сокращает доступную цену ($475k против $999k при доходе $150k) | [Schill et al.](https://millersamuel.wpengine.com/files/2006/07/coop-condo-article-july-23_2006.pdf), [Hauseit](https://www.hauseit.com/can-i-afford-to-buy-an-apartment-nyc/) |
| Плата за дом как часть цены (avgift, HOA, condomínio, service charge в Дубае) | основной для квартир | покупатель, оценщик | Стокгольм: участники форума сравнивают цену плюс взнос и долг кооператива на м². Нью-Йорк: оценщики спорят, нужно ли корректировать цену и на сколько ($25–50 за $1 месячной разницы). Дубай: от AED 3 до 30+ за кв. фут | [RikaTillsammans](https://rikatillsammans.se/forum/t/kopa-var-forsta-lagenhet-stambyte/111658), [AppraisersForum](https://appraisersforum.com/forums/threads/co-op-maintenance-adjustments.140375/), [Gulf News](https://gulfnews.com/living-in-uae/housing/what-are-service-charges-in-dubai-everything-new-property-buyers-need-to-know-1.500439859) |
| Цена за м² по заверенной или чистой площади | основной (Париж, Гонконг, Индия) | покупатель, агент, оценщик | Париж: площадь по loi Carrez; если реальная меньше заявленной более чем на 5%, можно потребовать снижения цены. Гонконг: с конца 2012 года цена за saleable sq ft. Индия: carpet против super built-up, «загрузка» 25–50% (по данным форума) | [PAP](https://www.pap.fr/acheteur/compromis-vente/erreur-de-superficie-pouvez-vous-exiger-une-baisse-du-prix-apres-la-promesse-de-vente/a26767), [JLL](https://research.jllapsites.com/the-impact-of-saleable-floor-areas-on-residential-prices/), [Reddit](https://www.reddit.com/r/indianrealestate/comments/1uoc5vv/should_people_in_india_pay_appartment_based_on/) |
| Этаж × лифт | дополнительный | покупатель, оценщик | Париж (SeLoger): 6-й этаж с лифтом около +1,5%, без лифта около −2,6% ко 2-му. Нью-Йорк: +0,6–1,0% за этаж. Москва: первый и последний этаж около −9,3% | [SeLoger](https://edito.seloger.com/conseils-d-experts/acheter/l-impact-d-un-etage-prix-d-un-appartement-paris-article-16840.html), [Schill et al.](https://millersamuel.wpengine.com/files/2006/07/coop-condo-article-july-23_2006.pdf), [Cyberleninka](https://cyberleninka.ru/article/n/the-price-of-moscow-apartments) |
| Вид / высокий этаж в башнях | дополнительный | покупатель, агент | Дубай: оценки консультантов 10–30%. В официальном гедоническом индексе DLD переменных вида и этажа нет | [DLD](https://dubailand.gov.ae/media/qnslugbi/the-dubai-house-price-index-methodology.pdf), [Cushman](https://www.cushwake.ae/en/news/tenants-pay-premium-to-rent-top-floor-units-in-dubai) |
| Энергокласс | основной для арендодателей (Франция), дополнительный для покупателей | арендодатель, покупатель, оценщик | Франция: G запрещён для новых договоров аренды с 2025 года, F с 2028, E с 2034. ⚠️ В Париже F/G был **на +1,1% дороже**, хотя по стране −13% (пресс-релиз апреля 2022 года, данные с 2019-го; объяснение — «cachet de l'ancien»). Ирландия: A около +15%, G около −15% относительно среднего, а не класса C | [service-public](https://www.service-public.gouv.fr/particuliers/vosdroits/F16096), [SeLoger/MA](https://www.precarite-energie.org/wp-content/uploads/2022/05/cp-etude-dpe-seloger-meilleursagents.pdf), [arXiv](https://arxiv.org/abs/2511.12625) |
| Школьная зона | основной для семей | покупатель | Пекин: 4–8% за муниципальную ключевую школу (каузальная оценка). «30%» — сырой разрыв по словам агента. Сидней: зона Killara/Lindfield +$1,3 млн (39,8%). ⚠️ Но в большинстве премиальных зон Сиднея и Мельбурна рост за 15 лет был ниже. Сингапур: приоритет по расстоянию до 1 км | [Bournemouth](https://eprints.bournemouth.ac.uk/36221/1/Elite%20School%20Designation%20and%20Housing%20Prices%20manu%20Resub2%20v2c.pdf), [Cotality](https://www.cotality.com/au/insights/articles/families-pay-six-figure-premiums-to-secure-homes-in-top-public-school-catchment-zones), [MOE](https://moe.gov.sg/primary/p1-registration/distance) |
| Остаток аренды земли | основной | покупатель, оценщик, банк | Сингапур: с 2019 года CPF пропорционально урезается, если аренда не покрывает младшего покупателя до 95 лет. Лондон: «обрыв» на 80 годах из-за marriage value | [CPF](https://www.cpf.gov.sg/member/infohub/news/cpf-related-announcements/more-flexibility-to-buy-a-home-for-life-while-safeguarding-retir), [NBER w20133](https://www.nber.org/system/files/working_papers/w20133/w20133.pdf) |
| Разрыв между ценой и оценкой банка | основной | покупатель, банк | Сингапур: COV (cash over valuation, превышение цены над оценкой HDB) не кредитуется и платится наличными; ⚠️ лимит CPF источник не называет. Нидерланды: всё выше оценки банка платится наличными | [Stacked](https://stackedhomes.com/editorial/cash-over-valuation-to-keep-climbing-for-hdb-flats), [DutchReview](https://dutchreview.com/expat/housing/buying/how-to-calculate-winning-offer-dutch-home/) |
| Off-plan и надёжность застройщика | основной (Дубай) | покупатель, инвестор | 72% сделок в I кв. 2026 года — off-plan. В 2021–25 годах завершено около 60% обещанного | [Knight Frank](https://www.knightfrank.ae/site-assets/pdf/2026/dubai-residential-market-review-q1-2026.pdf) |
| Порог «золотой визы» | нишевый, но с резким скачком цены | продавец, покупатель | Португалия: после 2012 года скопление сделок у €500 тыс. выросло примерно на 60%. Дубай: 10-летняя виза при стоимости от AED 2 млн по оценке DLD, а не по цене в договоре (известно только по сводкам поисковой выдачи, сами страницы вернули 403, поэтому ссылки нет) | [IZA](https://repec.iza.org/dp16857.pdf) |
| Климатические и сейсмические риски | основной там, где риск раскрыт | покупатель, банк | Калифорния: при обязательном раскрытии дома в зоне высокой пожарной опасности продаются примерно на 4,3% дешевле. Токио: здания, построенные до кодекса 1981 года, принято отсеивать | [RFF](https://media.rff.org/documents/WP_23-26.pdf), [realestate.co.jp](https://resources.realestate.co.jp/living/chiku-nen-%E7%AF%89%E5%B9%B4-real-estate-japans-word-of-the-day/) |
| Вода, электричество, генератор | основной (Лагос, Бенгалуру) | арендатор | Урбанизированная Индия: кухня с водой +40,1%, смывной туалет +25,2%, электричество +43,9% к аренде | [World Bank](https://documents1.worldbank.org/curated/en/099342105022229388/pdf/IDU0ba4ed93c0c44a0485c09c6b046aabdec42dc.pdf) |
| Ориентация (север в Австралии, Vastu в Индии, «счастливые» номера) | нишевый | покупатель | Ванкувер (Fortin, Hill & Huang, ~117 тыс. продаж): в кварталах, где этнических китайцев не меньше 18%, адрес на 4 даёт около −CAD 8 тыс. (−2,2%), на 8 — около +CAD 10 тыс. (+2,5%) при средней цене около CAD 400 тыс. Раздел 04 приводит те же цифры в процентах по версии статьи для IZA. Сингапур: «несчастливые» номера дали более высокую доходность при перепродаже | [AEA](https://aeaweb.org/conference/2011/retrieve.php?pdfid=215), [Stacked](https://stackedhomes.com/editorial/do-property-superstitions-really-affect-profits-we-look-at-26-years-of-data) |

### 3.2 Нью-Йорк: тот же «плотный» рынок, но другие ворота

**Общее с Лондоном:** минуты до метро как жёсткий критерий, район важнее квартиры, площадь часто не указана (вместо неё «junior 4», «classic 6»).

**Отличия:**
- **Аренда.** Правило 40x: годовой доход не меньше 40 месячных аренд, у поручителя около 80x. Поручительскую норму по первоисточнику проверить не удалось ([Reddit](https://www.reddit.com/r/NYCapartments/comments/1t3aiw2/)). В Лондоне распространённое правило — около 30x, но насколько оно повсеместно, не измерено.
- **Регулирование аренды.** Для договоров с 1 октября 2026 года по 30 сентября 2027 года повышение для rent-stabilised квартир установлено на 0% ([RGB Order #58](https://rentguidelinesboard.cityofnewyork.us/2026-27-apartment-loft-order-58/)). ⚠️ Цифру «около 1 млн квартир» источник не подтверждает.
- **Плотность рынка.** В январе 2026 года вакантность на Манхэттене 2,44%, торги за квартиру шли в 16,4% новых договоров, в среднем +9,9% к запрошенной цене ([Miller Samuel](https://millersamuel.com/wp-content/uploads/2026/02/Rental-01_2026.pdf)).
- **FARE Act (2025)** запретил брать с арендатора комиссию брокера, которого нанял арендодатель. Это аналог британского Tenant Fees Act 2019. StreetEasy оценивает переток в аренду примерно в +1,1%, но эти цифры проверить по первоисточнику не удалось (страницы недоступны).

**Какие аналитики используют:**
- StreetEasy: фильтры must-have / nice-to-have. Первым идёт стиральная машина в квартире, потом лифт, консьерж, посудомойка ([StreetEasy](https://streeteasy.com/blog/apartment-amenities-new-yorkers-want-most/)).
- Отчёты Miller Samuel / Elliman: цена за кв. фут, запас предложения в месяцах, доля торгов, доля скидок.
- Финансовое состояние co-op: ипотека здания, резервы, сборы. Покупатели на форуме разбирают отчётность дома построчно ([Reddit](https://www.reddit.com/r/NYCapartments/comments/1vqg0di/)).

### 3.3 США: стек оценки, которого нет в Лондоне

Четыре слоя, каждый питает следующий:
1. **MLS** — общая брокерская база с ценами сделок почти в реальном времени.
2. **CMA** — сравнительный анализ рынка агентом (comparative market analysis; не путать с британским регулятором Competition and Markets Authority). Типичный набор — 3,7–8,7 аналога ([RealEstateNews](https://www.realestatenews.com/2026/07/27/better-informed-sellers-are-raising-the-stakes-for-cmas)).
3. **Оценка банка по форме URAR** с рейтингами качества и состояния. С ноября 2026 года UAD 3.6 записывает состояние каждой кухни и ванной в структурированном виде ([Appraisal Institute](https://www.appraisalinstitute.org/insights-and-resources/insights/blog/the-new-urar-rollout-has-begun)).
4. **AVM** на каждой странице объявления.

Слабые места этого стека:
- Около 30% банковских оценок точно совпадают с ценой договора, ниже неё оказываются меньше 10%. Риск дефолта AVM предсказывает лучше, чем оценщик (Calem, Lambie-Hanson, Nakamura & Kenney, [Philadelphia Fed WP 18-28](https://www.philadelphiafed.org/-/media/frbp/assets/working-papers/2018/wp18-28.pdf); раннюю версию той же работы см. как [WP 17-23](https://www.philadelphiafed.org/-/media/frbp/assets/working-papers/2017/wp17-23.pdf)).
- В Техасе цены сделок не раскрываются, и в Остине AVM расходятся на десятки процентов: по одному дому $460k, $600k и $530k ([Blind](https://www.teamblind.com/post/zillow-estimation-is-too-wrong-in-austin-qevnugdc)).

**Для Лондона.** Land Registry раскрывает каждую сделку, так что британский AVM по устройству ближе к Калифорнии, чем к Техасу. Но данные приходят с лагом в недели и месяцы, и в них нет площади.

### 3.4 Континентальная Европа: формулы и очереди вместо рынка

- **Париж.** Все говорят в евро за м², микролокация — arrondissement и quartier. Открытая база DVF содержит площадь, но в ней нет этажа, лифта и вида, поэтому агент по-прежнему нужен ([Habity](https://habity.fr/blog/prix-immobilier-fiabilite-dvf-seloger-meilleursagents)).
  - Ограничение аренды снизило ставки на 5–5,2%, в 2023/24 году эффект вырос до −8,2%. При этом 43,2% объявлений превышали потолок, а устойчивого влияния на предложение не нашли ([APUR](https://www.apur.org/sites/default/files/2025-06/rapport-impact_encadrement_loyers_paris.pdf)).
  - Арендаторы конкурируют качеством досье: доход от 3x аренды, гарант или Visale. Ценой конкурировать нельзя.
- **Барселона.** Под потолком аренды объявлений стало на 22,2% меньше, на одно объявление приходится 462 обращения против 103 в Мадриде ([idealista](https://www.idealista.com/news/node/903549)). Здесь Париж и Барселона расходятся: в Париже эффекта на предложение нет, в Каталонии предложение падает (у Monràs & Montalvo около −15%; ⚠️ эта статья по первоисточнику не проверялась).
- **Берлин.** Mietspiegel — государственная гедоническая модель: Wohnlage, затем возраст здания, затем площадь, затем оснащение ([berlin.de](https://www.berlin.de/aktuelles/8897403-958090-neuer-mietspiegel-liegt-vor-mietsteigeru.html)).
  - Средняя ставка по Mietspiegel около €7,2–7,7 за м² против запрашиваемых €15,80. ⚠️ Разделение на «своих» и «чужих» — вывод исследователя, источники его прямо не формулируют.
  - Mietendeckel 2020 года сразу снизил запрашиваемые ставки на 7–11%. Объявлений стало резко меньше, около половины соблюдали правила, цены перетекли в Потсдам ([DIW](https://www.econstor.eu/bitstream/10419/229901/1/1747772909.pdf)).
  - Цены продаж оценивает Gutachterausschuss по всем нотариальным сделкам: Bodenrichtwert и коэффициенты сравнения ([berlin.de](https://www.berlin.de/sen/sbw/presse/pressemeldungen/pressemitteilung.1588960.php)).
- **Амстердам.** В I квартале 2026 года 71% покупок прошли выше запрошенной цены ([MVA](https://mva.nl/en/nieuws/kwartaalcijfers-q1-2026)).
  - Снижение цены портит объявление. 12,5% продавцов снизили цену в среднем на 9,3%. Их дома получили только +3,2% сверх цены против +4,8% у реалистично выставленных, а почти треть ушла даже ниже сниженной цены ([NL Times](https://nltimes.nl/2026/07/30/125-dutch-home-sellers-lower-asking-price-eu41551-average)).
  - Erfpacht (муниципальная аренда земли) ближе всего к лондонскому leasehold, но здесь это подтверждено только сниппетами.
- **Стокгольм / Цюрих.** На Hemnet в 2025 году прошло 82% продаж в Швеции. Вакантность в городе Цюрихе 0,10%, в кантоне 0,48% ([Hemnet](https://mfn.se/all/a/hemnet-group/82-percent-of-homes-sold-in-2025-were-advertised-on-hemnet), [zh.ch](https://www.zh.ch/de/news-uebersicht/medienmitteilungen/2025/08/leerwohnungsziffer-faellt-unter-0-5-prozent.html)). В Цюрихе ставки аренды отслеживает гедонический индекс Homegate/ZKB.

### 3.5 Дубай: рынок на государственных ID

- Каждая сделка и каждый договор аренды регистрируются: DLD и Ejari.
- DXBinteract бесплатно показывает сделки по зданию.
- Bayut TruEstimate находит квартиру по номеру титула или договора.
- Индекс аренды с 2025 года делит здания на 5 классов.
- Повышать аренду можно, только если она более чем на 10% ниже индекса. Шкала идёт до +20% и действует лишь при отставании от индекса больше чем на 40%. Об изменении нужно уведомить за 90 дней ([bhomes](https://www.bhomes.com/en/blog/betterinformed/how-rent-increases-are-calculated-under-rera-index-2025-edition-a-tenants-guide)).

UBS: квалифицированному работнику сервиса нужно около 5 лет дохода на центральную квартиру 60 м² в Дубае против 11 лет в Лондоне ([The National](https://www.thenationalnews.com/business/property/2026/09/24/buy-dubai-property-bubble-strong-rents-demand-ubs-report/)). Британцы — вторая по величине группа иностранных покупателей (17%). Для лондонских «уезжающих» Дубай — главный альтернативный ориентир, и они приносят оттуда ожидания: цена за кв. фут, оценка по ID квартиры, рассрочка от застройщика.

### 3.6 Восточная Азия, Австралия и Канада, развивающиеся мегаполисы

- **Гонконг, Сингапур, Сеул.** Цена привязана к данным на уровне квартиры (комплекс, корпус, этаж, номер) и к оценке банка, которая ограничивает кредит. Тот, кто переезжает оттуда в Лондон, ждёт увидеть цену за кв. фут по чистой площади и оценку до подачи предложения.
- **Япония.** По опросу Минюста 2016 года, 39–40% иностранцев получали отказ в аренде. Въезд стоит 4–6 месячных аренд ([Village House](https://www.villagehouse.jp/blog/en/japanese-apartment-life/why-your-rental-application-is-getting-rejected/)).
- **Сидней и Мельбурн.** Объявленная цена — «гайд» аукциона, а не цена продажи.
  - Чистая ожидаемая премия аукциона около 0,3%, неудачный аукцион даёт дисконт 1,3–2,6% ([NBER w30760](https://www.nber.org/papers/w30760), [UNSW](https://www.unsw.edu.au/newsroom/news/2026/05/what-is-the-hidden-cost-of-a-failed-property-auction)).
  - ⚠️ В Виктории новые правила о продаже жилья вступили в силу 1 октября 2026 года, но обязанность публиковать резервную цену за 7 дней до торгов касается только аукционов, которые проходят 16 октября или позже. В Property Price Statement обязательны 3 сопоставимые продажи: в Мельбурне за 6 месяцев в радиусе 2 км, в регионах за 18 месяцев и 5 км ([CAV](https://www.consumer.vic.gov.au/licensing-and-registration/estate-agents/new-changes-to-property-sales-and-underquoting-laws/industry-qas-new-changes-to-property-sales-and-underquoting-laws)). Это ближе всего к законодательному определению CMA.
- **Торонто.** Тактика «выставить ниже рынка и назначить день предложений» дала больше 70% листингов без принятого предложения (июль 2023, [Globe and Mail](https://www.theglobeandmail.com/real-estate/article-study-shows-most-properties-with-a-set-offer-date-failed-to-sell/)). ⚠️ Тезис, что форумы 2026 года считают эту тактику провальной, по первоисточнику не проверен.
- **Москва.** Институт Гайдара (ИЭП) считает гедонический индекс на CatBoost по 72 230 объявлениям о вторичном жилье Москвы и области за июнь 2025 — июнь 2026 года: +11,9% в номинале. Индекс Росстата за сопоставимый период вырос примерно на 1,2% по Москве, но его данные на момент публикации доходили только до I квартала 2026 года, то есть периоды совпадают не полностью. Автор объясняет разрыв методикой: гедоника учитывает смену состава объявлений. Ссылка на мониторинг ИЭП за июль 2026 года ([ИЭП](https://www.iep.ru/ru/doc/43893/hedonic-price-trends-for-the-secondary-housing-market-in-moscow-and-moscow-oblast-14-219-july-2026.pdf); цифры «14-219» — часть имени файла на сайте ИЭП, дату публикации, июль 2026 года, берём из заметки). ⚠️ Рекордные 81% ипотеки в покупках новостроек относятся к 2022 году, а не к 2023-му.
- **Лагос.** Сверх аренды платят агентские около 10%, юридические около 10% и залог 10–20% ([Discover Lagos](https://www.discoverlagos.ng/post/the-rental-market-nightmare-practical-tips-for-renting-in-high-demand-lagos-areas)). ⚠️ «До 50% годовой аренды» — верхняя граница, а оплата «за 1–2 года вперёд» в прочитанных источниках не подтверждена.
- **Сан-Паулу.** Плата за кондоминиум и налог IPTU показываются рядом с арендой как полная стоимость проживания. Место для машины на форуме оценивают в R$50–70 тыс. ([Reddit](https://www.reddit.com/r/saopaulo/comments/1u1213u/dúvida_apartamentos_sem_vaga_de_garagem_no/)).

---

## 4. Какие аналитические инструменты используют в мире и что есть в Лондоне

| Город / рынок | Инструмент | Что делает | Аналог в Лондоне / пробел |
|---|---|---|---|
| США | MLS + CMA (RPR AI CMA) + URAR/UAD 3.6 + Zestimate/Redfin Estimate | Общая база сделок в реальном времени, стандартизированное состояние объекта, публичная AVM | Нет общей базы. Land Registry с лагом и без площади. Агенты собирают аналоги вручную |
| Нью-Йорк | StreetEasy (must-have фильтры), отчёты Miller Samuel | Доля торгов, запас в месяцах, цена за кв. фут, доля скидок | Rightmove/Zoopla публикуют меньше таких рыночных метрик |
| Шотландия | Home Report | Независимая оценка до выставления | В Англии нет: цену задаёт агент |
| Париж | DVF + MeilleursAgents, loi Carrez | Открытые сделки с площадью; заверенная площадь | Площадь берут из EPC, и она не заверена |
| Берлин | Gutachterausschuss, Bodenrichtwert, Mietspiegel | Официальная стоимость земли; формула аренды | Ничего подобного нет |
| Нидерланды | Funda, WOZ, Huurcommissie | Налоговая оценка как публичный ориентир; баллы аренды | Council tax band (оценка 1991 года) — очень грубый аналог |
| Швеция | Hemnet + Booli | Финальные цены в том же доме | Отчасти Land Registry + портал |
| Дубай | DXBinteract, Property Monitor, TruEstimate | Сделки по зданию, AVM с поправкой на вид и этаж, поиск по ID | Нет открытого поиска сделок по номеру конкретной квартиры (про UPRN см. «Ограничения» в REPORT.md) |
| Гонконг | Centa-City Index, банковские онлайн-оценки | Гедоника с поправками на этаж, вид и ориентацию | Нет |
| Пекин / Шанхай | Beike «Housing Dictionary», ACN, VR | Дедуплицированный реестр квартир | Нет; объявления дублируются |
| Австралия | Cotality RP Data, Domain/PropTrack AVM, Property Price Statement | Обязательные 3 аналога с окном по времени и радиусу | Нет требований к гайду или резерву |
| Канада | MLS HPI (гибрид), Teranet (повторные продажи), HouseSigma | Индекс «эталонного дома» | ONS/Land Registry HPI |
| Москва | Гедоника на CatBoost (ИЭП), ЦИАН/Авито | Индекс по объявлениям с поправкой на состав | — |
| Сингапур | Оценка HDB после выдачи опциона, индекс HDB RPI, данные брокеров (PropNex, Stacked Homes) | Оценка ограничивает кредит и CPF, переплата сверх неё (COV) идёт наличными; остаток 99-летней аренды | Down-valuation в Англии непрозрачна; данные URA по частным сделкам и SRX в заметках не прочитаны |
| Сеул | Рыночная цена KB (KB sise), банковская оценка, Zigbang | Лимит кредита — по меньшей из цены, KB-цены и оценки | Нет; данные MOLIT, Naver и Hogangnono в заметках не разбирались |
| Токио | Правила показа объявлений (80 м = 1 минута пешком), год постройки и норма 1981 года, Real Estate Japan | Стандартизированные поля объявления | Нет единой формулы «минут до станции»; REINS и данные MLIT в заметках не прочитаны |
| Индия | MagicBricks, 99acres, NoBroker, Housing.com; регистрационный номер RERA | Поиск; проверка легитимности застройщика; carpet против super built-up | Сайты были заблокированы, фильтры не изучены; реестры IGR не разбирались |
| Лагос | Nigeria Property Centre, PrivateProperty; Certificate of Occupancy | Поиск; проверка титула покупателем | Титул проверяет конвейенсер |
| Сан-Паулу | Индекс FipeZap (asking prices ZAP, VivaReal, OLX; отдельные ряды продажи и аренды), QuintoAndar | Цена за м² по числу спален; аренда + condomínio + IPTU в одном окне | Полную стоимость проживания (рента + сбор + налог) порталы не сводят |
| США (запад) | Walk Score / Transit Score, GreatSchools | Баллы пешей доступности и школ | Публичного индекса пешей доступности нет; PTAL устарел |

Индексы аренды отдельно сведены в [REPORT.md](REPORT.md), §6.2.

Чтобы ослабить порочный круг «AVM якорит цену», американские рынки движутся к данным о состоянии, которые дают сами владельцы. Ассоциация оценщиков против: AVM не видят состояния, планировки и разницы между стоимостью ремонта и добавленной ценностью ([HousingWire](https://www.housingwire.com/articles/ai-home-valuation-appraisals/)). Для Лондона, где в Land Registry нет площади, этот пробел ещё больше.

---

## 5. Исследования, профессионалы и форумы: где расходятся

**Что говорят исследования:**
- Поиск начинается с географии. На Rightmove около 50% нарисованных пользователями зон поиска меньше 5 км² (меньше одного боро), а в 51,5% поисков число спален сначала не задано ([Rae & Sener](http://eprints.whiterose.ac.uk/99893/1/1-s2.0-S0264275115300251-main.pdf)).
- На уровне почтовых индексов популярность района на Trulia объясняют рестораны и бары (25,3% вариации), а школы только 2,6%. Но когда семьям показали рейтинги школ в объявлениях, они переехали к школам на 0,10 SD лучше и были готовы платить 54 минутами дороги за 10 перцентилей качества школы ([NBER w20823](https://www.nber.org/papers/w20823), [NBER w27209](https://www.nber.org/system/files/working_papers/w27209/w27209.pdf)).
- Каузальные премии меньше сырых разрывов: в Пекине 4–8% против «30%» по словам агента.
- Аукцион почти не повышает цену (+0,3%).

**Что говорят профессионалы:**
- Агенты верят MLS и сопоставимым сделкам. 84% называли Zestimate неточным (опрос Inman 2020 года; известен только по пересказу в поисковой выдаче, сама статья не открылась, поэтому ссылки нет).
- Knight Frank: глобальные prime-цены +3,2% в 2025 году. Для крупных покупателей главный критерий выбора города — стабильность налогов и предсказуемость управления. В Лондоне сегмент продаж от $10 млн «движется назад», конкуренты Лондона — ОАЭ, Италия, Швейцария. ⚠️ Изменения цен в Лондоне эти страницы не дают ([Knight Frank](https://www.knightfrank.com/research/article/2026/4/london-learns-share-spotlight)).
- Брокеры в Торонто говорят, что тактика «выставить ниже рынка» работает только при занижении на 20–30% и только в горячих точках ([Globe and Mail](https://www.theglobeandmail.com/real-estate/article-study-shows-most-properties-with-a-set-offer-date-failed-to-sell/)). Брокеры в Париже называют снижение цены на 3–5% за каждый этаж выше третьего без лифта. Эта цифра известна только по сниппетам брокерских сайтов (ссылки нет) и сильно расходится с гедоникой SeLoger.

**Что говорят люди на форумах:**
- Австралия: покупатели не различают намеренное занижение гайда и честный аукцион и просят инструмент, который сравнивал бы гайд с ближайшими продажами ([Reddit](https://www.reddit.com/r/AusProperty/comments/1s0ljum/underquoting/)).
- Bay Area: AVM — «маркетинговый инструмент, ±10% в лучшем случае» ([Blind](https://www.teamblind.com/post/why-are-zestimates-redfin-estimates-way-off-from-sold-prices-qjzf3jdj)).
- Стокгольм: всерьёз считают долг кооператива на м².
- Москва: правило «не первый и не последний этаж».

**Главные расхождения:**

| Вопрос | Исследования | Профессионалы | Форумы |
|---|---|---|---|
| Точны ли AVM? | Да для выставленных (<2%), примерно 7% для невыставленных; AVM лучше оценщика предсказывают дефолт | Оценщики: не видят состояния; 84% агентов (2020) считают неточными | «±10% в лучшем случае», «ошибка $50–200k» (AU) |
| Работает ли аукцион или «list-low»? | +0,3%; провал −1,3…−2,6% | AU: аукцион даёт лучшую цену; Торонто: работает при занижении на 20–30% | Торонто 2026: в мягком рынке не работает ⚠️ (не проверено) |
| Школы | Около 3% за SD (Англия); значительны, если информация показана в момент поиска | Hamptons: давление снижается | Семьи (Mumsnet, Blind) ставят школы первыми |
| Транспорт в США | Walk Score капитализируется (около +0,9% за балл) | — | NAR: 6% называют транспорт |
| Потолки аренды и предложение | Париж: эффекта нет; Каталония: около −15% | Spanish Property Insight (отраслевое издание, скептичное к потолкам): разрыв между заявленной в договорах и объявленной арендой растёт, это признак теневого рынка ([SPI](https://www.spanishpropertyinsight.com/2026/02/24/barcelona-rent-controls-nine-months-into-2025)) | — |
| EPC/DPE в историческом фонде | Париж 2022: F/G дороже на 1,1% ⚠️; Англия: эффект скромный | Парижский брокер 2026: G −10…−20% ([UFE](https://ufe.org/article-feed/proprietaires-expatries-dpe/)) | MSE: EPC плохо отражает реальные счета |

---

## 6. Что из этого следует для London Close Knit

1. **Считать время пешком по сети улиц и показывать его диапазонами (5/10/15 минут)**, а не расстояние по прямой. Учитывать нелинейность и шум прямо у станции. Этого ждут переезжающие из Токио, Москвы и Сингапура, и это первоочередной критерий именно для Лондона.
2. **Давать цену за кв. фут по площади из EPC и сделки на уровне здания.** Это закрывает главный пробел лондонских данных по сравнению с Парижем, Дубаем и Гонконгом.
3. **Показывать полную стоимость владения:** service charge, council tax, остаток аренды (80-летний обрыв), EPC и срок 2030 года для арендодателей. Так делают Сан-Паулу (condomínio + IPTU), Стокгольм (avgift) и Нью-Йорк (maintenance).
4. **Предупреждать, что оценки портала якорят цену**, и показывать диапазон ошибки. Для невыставленных объектов это около 7% в США. Для Лондона измерения в заметках нет.
5. **Выносить риски (наводнение, школы) в момент поиска.** Исследования показывают, что именно видимость делает их основными критериями. При этом стоит ожидать сопротивления агентов, как в истории Zillow и CRMLS.
6. **Для регионов (если продукт туда пойдёт)** набор фильтров другой: тип дома, сад и, с оговорками, парковка вместо зоны TfL. В Шотландии главный ценовой сигнал — Home Report и премия к цене «offers over».

## 7. Пробелы

- В лондонских заметках нет измеренной ошибки AVM Rightmove/Zoopla. Сравнение с американскими 7% — аналогия, а не данные.
- Нет количественной оценки премии за ориентацию (север в Австралии, юг в Китае) и надёжной оценки премии за парковку в британских регионах.
- Цифры StreetEasy (FARE Act, медиана $4 199), утверждения о кликах на Funda и форумный консенсус Торонто проверить по первоисточникам не удалось.
- Милан, Вена и BC Assessment не покрыты. По Сиэтлу есть только Walk Score и спор NWMLS о закрытых листингах. Индексы аренды Zillow ZORI, парижская обсерватория аренды OLAP и данные URA по аренде в Сингапуре в заметках не встречаются.
