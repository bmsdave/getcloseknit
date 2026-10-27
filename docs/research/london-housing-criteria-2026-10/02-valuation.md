# 2. Как продавцы, агенты, сюрвейеры и AVM определяют цену продажи (и аренды)

*Раздел отчёта для London Close Knit. Дата: октябрь 2026. Основан только на исследовательских заметках по темам uk-agent-valuation, uk-surveyor-avm, seller-behaviour, ldn-forum-sellers, journal-uk, journal-global, acad-hedonic-uk и uk-data-tools (плюс фрагменты ldn-renters и ldn-forum-renters про аренду) и на результатах их проверки по первоисточникам. Новых веб-исследований не проводилось. Утверждения, которые проверка подтвердила лишь частично, помечены знаком ⚠. Сводный ответ и единый рейтинг критериев — в [REPORT.md](REPORT.md).*

## Кратко

- **В Англии у одной квартиры три разные «цены».** Агент даёт market appraisal, то есть рекомендованную цену для маркетинга. Оценщик банка (surveyor, работает по стандарту RICS Red Book) даёт valuation, и она становится жёстким потолком для покупателя с ипотекой. AVM (automated valuation model, автоматическая модель оценки) даёт статистическую оценку. Эти три цифры систематически расходятся, и на форумах это главный источник конфликтов.
- **Основа у всех одна: недавние завершённые продажи похожих объектов.** Это comparables, данные HM Land Registry Price Paid. Asking prices (цены в объявлениях) все профессиональные стандарты считают слабым доказательством. Кодекс TPO прямо требует, чтобы рекомендованная агентом цена опиралась на comparables.
- **В Лондоне ключевой единицей стала цена за кв. фут (£/sqft).** В Price Paid нет площади, поэтому её берут из EPC (Energy Performance Certificate, энергосертификат). Для квартир на втором месте после площади стоят tenure и условия аренды земли: leasehold (право на квартиру на срок, обычно 99–999 лет), остаток срока, service charge (ежегодный сбор управляющей компании) и статус безопасности фасада.
- **Завышение цены (overvaluation) носит структурный характер.** Агенты завышают оценку, чтобы получить instruction (договор с продавцом на продажу объекта), а потом снижают цену. 95% агентов видели нереалистичные оценки конкурентов ([PIE/GetAgent 2026](https://propertyindustryeye.com/estate-agents-at-odds-over-overvaluing-to-win-instructions/)). Дома, которым пришлось снижать цену, продаются в 2–3,5 раза дольше (данные Rightmove).
- **Академия описывает это не как чистый «штраф», а как компромисс «цена против ликвидности».** Высокая стартовая цена немного повышает итоговую цену, но сильно снижает вероятность продажи. Главный поведенческий драйвер цены — якорь цены покупки и неприятие убытка (loss aversion).
- **Down-valuation (оценка банка ниже согласованной цены) происходит примерно в 10–25% сделок.** Размер разницы источники оценивают по-разному: в среднем 1,54% по данным SDL за 2020–22 годы, «обычно 2–5%» по What Mortgage (2025); на форумах встречаются случаи на 10–25%. Оспорить её удаётся редко. По словам брокеров, больше всего это касается квартир в крупных лондонских домах.
- **AVM хорошо работают на типовом жилье с плотными comparables и плохо — на перестроенных, уникальных и prime-объектах.** 87% агентов не доверяют AI-оценкам. Портальные оценки служат прежде всего инструментом сбора лидов.
- **Арендная ставка устроена проще.** Её определяют comparables и конкуренция за объявление. С 1 мая 2026 года Renters' Rights Act запрещает торги выше объявленной цены и ограничивает предоплату одним месяцем, поэтому теперь растут сами объявленные ставки, а арендаторы конкурируют профилем, а не ценой.

---

## 1. Три слоя цены и кто за что отвечает

| Слой | Кто | Что это | Регулирование | Как часто ошибается |
|---|---|---|---|---|
| Market appraisal | Агент | Рекомендованная asking price (цена объявления) и/или ожидаемая цена продажи; это не оценка в смысле RICS | Кодекс TPO, п. 4b–4c: цена «в добросовестности», учитывает рынок, подкреплена comparables, которые хранятся в деле ([TPO Code](https://www.lurotbrand.co.uk/wp-content/uploads/2022/09/TPOE22E27-Codes-of-Practice-09.09.22.pdf)) | 71% брокеров сомневаются, что оценки агентов выдержат проверку банка ([Negotiator 2025](https://thenegotiator.co.uk/news/uk-housing-market-news/estate-agents-accused-of-overvaluing-properties/)) |
| Lender valuation | Surveyor из панели банка, AVM или их гибрид | Залоговая стоимость; банк кредитует от меньшей из двух величин: цены или оценки | RICS Red Book; обновление от 31.01.2025 добавило требования к моделированию и ESG ([PIE](https://propertyindustryeye.com/fifty-not-out-rics-red-book-celebrates-half-a-century/)) | Down-valuation в ~10–25% случаев (см. §4.3) |
| AVM | Hometrack, Zoopla, Rightmove, PropertyData, Chimnie и др. | Статистическая оценка, обычно в виде диапазона с уровнем уверенности | В UK нет специального закона об AVM. В США действует межведомственное правило с 01.10.2025 ([CFPB](https://www.consumerfinance.gov/rules-policy/final-rules/quality-control-standards-for-automated-valuation-models/)) | Вендор заявляет «80% в пределах ±10% от оценки surveyor» ([Hometrack](https://www.hometrack.com/mortgage-solutions/automated-valuation-model/)); на форумах сообщают об ошибках в £100–200k |
| Buyer survey | RICS surveyor, нанятый покупателем | Level 1/2/3: состояние объекта, на Level 2 опционально оценка | [RICS Home Survey Standard](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/building-surveying-standards/home-surveys) | — |

На форумах это расхождение обсуждается постоянно. В одной ветке MSE дом в Кроули два агента и действующий банк оценили в £285k, а surveyor другого банка в £265k. Пользователям объяснили, что агент оценивает, за сколько можно выставить и продать, а surveyor консервативно защищает банк ([MSE 5752975](https://forums.moneysavingexpert.com/discussion/5752975)). На Mumsnet оценку агента прямо называют «marketing price» ([Mumsnet 2958243](https://www.mumsnet.com/talk/property/2958243-Property-valuation)).

**Про CMA.** В США CMA означает comparative market analysis: агентский анализ comparables для цены объявления. Его отличают от BPO, AVM и appraisal ([RISMedia](https://www.rismedia.com/2019/01/09/making-sense-valuation-alphabet-soup-cma-bpo-avm-appraisal/)). В британском контексте CMA обычно означает Competition and Markets Authority, антимонопольный регулятор. В заметках **нет ни одного исследования CMA (регулятора) о завышении оценок агентами**. Данные о завышении приходят от Which?, GetAgent, Zoopla и Property Solvers, и приписывать их регулятору нельзя. С регулятором связано другое: после отмены руководства NTSELAT по material information (обязательным сведениям в объявлении) 9 мая 2025 года обязанность раскрывать эти сведения сохраняется по DMCC Act 2024, и CMA может штрафовать за её нарушение ([Negotiator](https://thenegotiator.co.uk/news/regulation-law-news/material-information-rules-axed-overnight-as-new-consumer-act-takes-precedence/)).

---

## 2. Сводная таблица критериев цены продажи

Уровни: **основной** — сдвигает цифру сильнее всего и используется всеми участниками; **дополнительный** — корректировка; **нишевый** — важен в отдельных сегментах.

| Критерий | Уровень | Кто использует | Измеренный эффект / доказательства | Источники |
|---|---|---|---|---|
| Недавние завершённые продажи comparables (та же улица/почтовый индекс, тип, спальни) | основной | агент, оценщик, AVM, продавец, покупатель | RICS: категория A, высший вес. TPO 4b: обязательны. Апелляция против down-valuation без лучших comparables «обычно пустая трата времени» | [RICS Comparable evidence](https://rics.org/content/dam/ricsglobal/documents/standards/comparable_evidence_in_real_estate_valuation.pdf); [Enact 2026](https://www.enact.co.uk/2026/07/why-are-down-valuations-increasing-in-the-uk-housing-market/); [MSE 6356659](https://forums.moneysavingexpert.com/discussion/6356659/down-valuation) |
| Микролокация (улица, а не район) | основной | все | Лондон: локальные эффекты объясняют >30% дисперсии цены; локальные зоны, построенные по уличной сети, работают лучше административных | [Law, UCL 2016](https://discovery.ucl.ac.uk/10049564/3/Law_Street_Based_Loal_Area_SL.pdf) |
| Площадь (£/sqft) и планировка (спальни, ванные) | основной | агент, оценщик, AVM | Nationwide: +10% площади ≈ +5% к цене. Переход от 2 к 3 спальням +13–17%, от 3 к 4 +10–13%, лишняя ванная ≈ +6%, мансарда со спальней и ванной до ≈ +24–25%. Спальни дают больше, чем «сырые» метры | [Nationwide 2023](https://www.nationwide.co.uk/media/hpi/reports/dwd); [PIE 2017](https://propertyindustryeye.com/?p=40384) |
| Тип объекта (дом / квартира) | основной | все | Дом ≈ +20% к квартире на той же улице с тем же числом спален (prime central London, PCL) | [Bracke, Pinchbeck & Wyatt](https://researchonline.lse.ac.uk/id/eprint/86393/1/Pinchbeck_Time%20value%20of%20housing_2018.pdf) |
| Tenure и остаток leasehold | основной (Лондон, квартиры) | все | ⚠ 80–99 лет ≈ −16% к freehold (≈ −13% с доп. фиксированными эффектами), 100–125 лет ≈ −10%, 125–150 лет ≈ −8%, 150–300 лет ≈ −3%; оценка по сделкам до 2014 года по всей Англии и Уэльсу, база — freehold с теми же характеристиками. Другой замер с другой базой: квартиры с остатком ≤60 лет выставляются в среднем на 22,1% дешевле средней квартиры в Англии и лишь на ≈11% дешевле средней квартиры в Лондоне (House Buyer Bureau, 2026, по asking prices, без поправки на размер и качество). Поэтому «11%» нельзя сравнивать с «−16%»: это сырой разрыв к среднему, а не дисконт к аналогичному freehold | [Giglio, Maggiori & Stroebel, NBER w20133](https://www.nber.org/system/files/working_papers/w20133/w20133.pdf); [Landlord Today 2026](https://www.landlordtoday.co.uk/breaking-news/2026/08/landlords-selling-short-lease-flats-face-tens-of-thousands-in-losses/) |
| Service charge относительно стоимости | основной (Лондон, квартиры) | агент, покупатель, банк | Квартиры с сбором ≤1% стоимости на 50% чаще находят покупателя, чем со сбором ≥2%. Средний сбор в Лондоне £2,801/год (+64,5% за 10 лет) | [Landlord Today / Hamptons 2026](https://www.landlordtoday.co.uk/breaking-news/2026/03/soaring-service-charges-on-leasehold-flats-hit-capital-values/) |
| Рыночная конъюнктура (запас, темп продаж, доля снижений) | основной | агент, оценщик | TPO 4b требует её учитывать. В Лондоне лишь ≈30% объектов находят покупателя за 3 месяца (Zoopla, Q2 2026) | [Zoopla HPI](https://www.zoopla.co.uk/discover/property-news/house-price-index/) |
| Потолок ипотечной оценки | основной (для ипотечных сделок) | оценщик, покупатель, продавец | Банк кредитует от меньшей из двух сумм; размер down-valuation: в среднем 1,54% (SDL 2020–22), «обычно 2–5%» (What Mortgage 2025), см. §4.3 | [What Mortgage 2025](https://www.whatmortgage.co.uk/home-buying/news-home-buying/what-are-down-valuations-and-why-are-they-increasing/) |
| Цена покупки продавца (якорь убытка) | основной (поведенческий) | продавец | E&W: ожидаемый убыток 15–25% → цена сделки ≈ +3%, годовая вероятность продажи ниже на ≈2 п.п. Иллюстрация из той же статьи: дом, купленный на пике 2007 года, продаётся на ≈5% дороже такого же, купленного в 2001-м (там разница в ожидаемой прибыли больше), и вдвое реже (§3.2) | [Bracke & Tenreyro, CEP DP1568](https://cep.lse.ac.uk/pubs/download/dp1568.pdf) |
| Состояние / отделка | дополнительный (в PCL почти основной) | оценщик, агент | PCL: «безупречное» состояние ≈ +30% к «требует обновления» при продаже; при аренде +31% к «умеренному» состоянию (базы разные). Академическая оценка: скидка 15–20% за «in need of improvement». Форумы: ремонт кухни или ванной почти не добавляет стоимости | [Savills 2026](https://www.savills.co.uk/research_articles/229130/394353-0); [Mumsnet 5226962](https://www.mumsnet.com/talk/property/5226962-how-are-houses-really-valued) |
| Пристройки / мансарды | дополнительный | агент, AVM (часто пропускает) | 77% агентов: AVM иногда не видят ремонт и состояние | [Negotiator / Alto](https://thenegotiator.co.uk/news/agents-are-anti-ai-when-it-comes-to-property-valuations-agent-poll/) |
| Безопасность фасада (EWS1, PAS 9980), высотность | дополнительный (Лондон: критичен для квартир) | оценщик, банк | Новое руководство RICS (с 01.11.2026) ограничивает случаи, когда нужен EWS1, по высоте здания | [PIE RICS](https://propertyindustryeye.com/rics-releases-updated-guidance-on-home-valuations/) |
| Близость к станции | основной для покупателя и арендатора (как в разделе 01); для оценщика дополнительный, потому что она уже заложена в comparables той же улицы | покупатель, агент | Nationwide: 500 м против 1500 м = +8,0% (£42,700) в Лондоне против 4,6–4,9% в Манчестере и Глазго. Причинная оценка: +1,5…5,8% за км в радиусе 2 км | [PIE/Nationwide](https://propertyindustryeye.com/good-transport-links-still-add-most-value-to-house-prices-in-key-uk-cities/); [Gibbons & Machin](https://cep.lse.ac.uk/pubs/download/dp0611.pdf) |
| EPC-рейтинг | дополнительный (в Лондоне слабый) | оценщик (фактор RICS), арендодатель | A/B ≈ +5% к D, G ≈ −7% по Англии; в Лондоне и на Юго-Востоке эффект мал или незначим. Nationwide 2024: +1,6% для владельцев-жильцов (F/G −1,4%), +12,2% для buy-to-let (покупки под сдачу); Nationwide 2021: A/B ≈ +1,7%, F/G ≈ −3,5% | [Fuerst et al. 2015](https://www.repository.cam.ac.uk/bitstreams/25ab511c-46b9-4141-bbc4-ad06941c988e/download); [Nationwide](https://www.nationwide.co.uk/media/hpi/reports/energy-efficiency-ratings-have-limited-impact-on-owner-occupied-house-prices-despite-increased-interest-in-going-green) |
| Вид, улица, визуальное качество | дополнительный | агент (качественно), AVM нового поколения | Лондон, 130k сделок: добавление признаков из уличных и аэроснимков повышает R² с 72,5% до 76,9% (линейная модель) и с 81,7% до 84,1% (XGBoost) | [arXiv 1807.07155](https://arxiv.org/abs/1807.07155) |
| New-build статус | дополнительный (Лондон: противоречиво) | агент, оценщик | ⚠ Лондон: новостройки в среднем на 10,5% дешевле вторички (из-за доли квартир) против +4,7% у другого агрегатора | [PIE 2026](https://propertyindustryeye.com/new-build-price-premium-rises-to-nearly-a-third/); [new-builds.co.uk](https://www.new-builds.co.uk/blog/new-build-market-report-winter-2026) |
| Пороги цен: порталы, SDLT, round/charm pricing | нишевый | продавец, агент | Эффекты малы, знак различается между исследованиями. UK-исследования бандинга не найдено | [Beracha & Seiler](http://s3.amazonaws.com/fieldexperiments-papers2/papers/00630.pdf); [Cardella & Seiler](http://s3.amazonaws.com/fieldexperiments-papers2/papers/00623.pdf) |
| Налог на дома £2m+ (High Value Council Tax Surcharge, с 2028) | нишевый (Лондон/ЮВ) | оценщик (VOA), продавец | Knight Frank: ~73,600 домов в «серой зоне» £1.8–2.2m; ожидается скопление цен под порогом | [PIE](https://propertyindustryeye.com/council-tax-raid-raises-urgent-property-valuation-questions/) |
| Способ продажи (sealed bids — закрытые предложения; best and final — финальный раунд «лучшее и последнее предложение») | нишевый | агент, продавец | Только ≈2% покупок выше asking price прошли через sealed bids (2025) | [PIE/HomeOwners Alliance](https://propertyindustryeye.com/half-of-homebuyers-paid-the-full-asking-price-or-higher-for-their-property/) |

---

## 3. Что говорит академическая наука

**3.1. Asking price — стратегический якорь, а не оценка.** Merlo и Ortalo-Magné изучили записи одной сети, Halifax Estate Agencies, по Большому Лондону и Южному Йоркширу за 1995–98 годы. ⚠ Объекты продавались примерно за 96% (96,2%) от первоначальной цены объявления, в среднем за ~11 недель. Больше трёх четвертей продаж прошли без изменения цены, почти 40% — по первому предложению. Это выборка одного агентства в другой рыночной фазе, не всей Англии. Более высокая стартовая цена давала более высокую цену сделки, но более долгую экспозицию ([CESifo WP 778](https://www.ifo.de/DocDL/cesifo_wp778.pdf)).

**3.2. Неприятие убытка — главный поведенческий драйвер.**
- **Бостон.** Продавцы с номинальным убытком ставят цену выше на 25–35% от «разрыва убытка» и получают на 3–18% этого разрыва больше, но продают заметно реже ([Genesove & Mayer](https://www.nber.org/papers/w8143)).
- **Англия и Уэльс, ~20 млн сделок.** Из двух одинаковых домов дом, купленный на пике 2007 года, продаётся с премией ~5% к купленному в 2001 году, а вероятность его продажи ~на 50% ниже ([Bracke & Tenreyro](https://cep.lse.ac.uk/pubs/download/dp1568.pdf)).
- **Дания.** Убытки «болят» примерно в 2,5 раза сильнее выигрышей ([Andersen et al.](https://spiral.imperial.ac.uk/handle/10044/1/98407)).
- **Методологическая оговорка.** Наивные оценки неприятия убытка завышены на 50–75%: ожидаемый убыток коррелирует с ненаблюдаемым качеством объекта ([Ross & Zhou](https://www.nber.org/papers/w28796)).

**3.3. Завышение цены — компромисс, а не только штраф.** В Гётеборге брокеры, наоборот, ставят цену ниже рынка, чтобы привлечь торги. Это ускоряет продажу, но снижает цену: +10% недооценки ≈ −8,5% к цене сделки ([Hungria-Gunnelin et al.](https://www.emerald.com/insight/content/doi/10.1108/IJHMA-04-2020-0034/full/html)). В Orange County завышенные «зависшие» объявления поднимают цены объявлений соседей на ~5,5%, а цены сделок на ~5,2% ([Agarwal, Seiler & Siebert](https://www.econstor.eu/bitstream/10419/267302/1/cesifo1_wp10069.pdf)). В 17 городах Польши средние цены объявлений оказались практически единственной значимой переменной, объясняющей цены сделок ([Kokot & Doszyń](http://ws.stat.gov.pl/WS/2026/6/gus_ws_2026_06_sebastian_kokot_mariusz_doszyn_the_effect_of_anchoring_transaction_prices_to_offer.pdf)).

**3.4. Стимулы агента.** В Чикаго агенты продают собственные дома на 3,7% дороже и держат их на рынке ~на 9,5 дня дольше, чем дома клиентов ([Levitt & Syverson](https://www.nber.org/papers/w11053)). Американская модель — «продать быстро и дёшево». Британская устроена наоборот: «завысить, чтобы взять объект, потом снижать».

**3.5. Leasehold: рынок и оценщики расходятся.** Giglio и соавторы выяснили, что многие оценщики ожидают меньших дисконтов за короткий lease, чем показывают сделки. Bracke, Pinchbeck и Wyatt по историческим продажам в PCL показали, что практические таблицы «relativity» (соотношение стоимости lease и freehold) не согласуются с рыночными данными ([BoE WP](https://www.bankofengland.co.uk/working-paper/2016/the-time-value-of-housing-historical-evidence-on-discount-rates); [LSE](https://www.lse.ac.uk/news/latest-news-from-lse/people-may-be-overpaying-for-lease-extensions-says-lse-research)). Ниже 80 лет продление lease включает 50% «marriage value» (прироста стоимости от объединения прав). Leasehold and Freehold Reform Act 2024 отменяет этот механизм, но на октябрь 2026 года отмена **не действует**: она не может заработать, пока не утверждены ставки дисконтирования. Консультация по ним идёт с 7 сентября по 21 октября 2026 года, самый ранний срок внедрения по Which? — 2027 год ([GOV.UK](https://www.gov.uk/government/consultations/leasehold-enfranchisement-valuation-rates/leasehold-enfranchisement-valuation-rates); подробнее в разделе 01, §2.2). Порог в 80 лет действует.

**3.6. Перекрёстные выводы для оценки.**
- Кросс-секционные гедонические модели завышают эффекты локальных удобств. Для ж/д это 8,9% за км против 1,5–5,8% в квазиэкспериментах ([Gibbons & Machin](https://cep.lse.ac.uk/pubs/download/dp0611.pdf)).
- Исследование AVM-интервалов в Осло показало, что стандартные доверительные интервалы откалиброваны неравномерно по районам ([Hjort et al.](https://arxiv.org/abs/2312.06531)).
- В США ~30% ипотечных оценок в точности равны цене контракта, ниже неё меньше 10%. AVM предсказывали дефолт лучше, чем оценки appraiser (Calem, Lambie-Hanson, Nakamura & Kenney, [Philadelphia Fed WP 18-28](https://www.philadelphiafed.org/-/media/frbp/assets/working-papers/2018/wp18-28.pdf); это доработанная версия WP 17-23 тех же авторов, на которую ссылается раздел 03). Вывод, что британские оценщики гораздо реже «подтверждают» цену, — интерпретация исследователя, а не результат статьи.

---

## 4. Что говорят профессионалы: стандарты, журналы, агенты

**4.1. Иерархия доказательств RICS** ([стандарт](https://rics.org/content/dam/ricsglobal/documents/standards/comparable_evidence_in_real_estate_valuation.pdf)):
1. завершённые продажи почти идентичных объектов;
2. завершённые продажи похожих объектов;
3. сделки с неполными данными;
4. объекты под офертой (sold STC, «продано при условии заключения контракта»: цена согласована, но контракты ещё не подписаны);
5. asking prices, «с осторожностью».

Корректировки делаются на локацию, состояние, размер, tenure и условия lease, время, стимулы, энергоэффективность. Корректировка на состояние не равна стоимости работ, потому что покупатель дополнительно закладывает неопределённость и время. Рекомендуется матрица comparables и итоговое взвешивание «со стороны». В 2026 году RICS консультировалась по 2-му изданию, где появились AVM/AI и ESG.

**4.2. Источники данных агента и их ограничения.**

| Источник | Что даёт | Ограничения |
|---|---|---|
| HM Land Registry Price Paid | Цена, дата, тип, флаг новостройки, freehold/leasehold, категория A/B | Нет площади и числа спален. Задержка от 2 недель до 2 месяцев. Нет сделок «не за деньги», в том числе по Right to Buy ([gov.uk](https://www.gov.uk/guidance/about-the-price-paid-data)). Ошибки: shared ownership, внутрисемейные выкупы, неверный тип ([MSE 6094425](https://forums.moneysavingexpert.com/discussion/6094425/are-sold-prices-always-correct-on-rightmove)) |
| EPC | Площадь для расчёта £/sqft | ⚠ То, что площадь в EPC — «чистая жилая» и расходится с планировками, известно только из комментариев читателей к статье [PIE 2017](https://propertyindustryeye.com/?p=40384), официального подтверждения нет |
| Sold STC | Самый свежий сигнал | Согласованная цена обычно не публикуется; агенты узнают её через связи |
| Rightmove / Zoopla (asking) | Конкурирующее предложение, «температура» рынка | По RICS ненадёжны как доказательство стоимости |
| Индексы | Пересчёт старых comparables на текущую дату | Rightmove — asking prices новых объявлений без сезонной корректировки, это опережающий индикатор настроений ([Rightmove](https://rightmove.co.uk/news/?p=15607)). UK HPI — гедонический индекс, первая оценка покрывает ~40% будущих сделок ([gov.uk](https://www.gov.uk/government/publications/about-the-uk-house-price-index/about-the-uk-house-price-index)). Halifax и Nationwide считают только ипотечные сделки, без покупок за наличные, а их в Лондоне много |

**4.3. Down-valuation по данным отраслевой прессы.** ⚠ Частота: e.surv — 25,2% оценок ниже цены в Q1 2022, сама компания называет это «unremarkable» на длинном горизонте. SDL — 19,2% сделок в 2020–22 годах, но в среднем всего на 1,54%. Mojo — ~10% покупок ([Mortgage Strategy 2022](https://www.mortgagestrategy.co.uk/news-analysis-down-valuation-strife-is-back/)). JLM — ~20% после февраля 2025 года ([Mortgage Solutions](https://www.mortgagesolutions.co.uk/better-business/2025/03/24/we-need-insight-into-the-emerging-trend-of-confusing-down-valuations-murphy/)). Связь с обновлением Red Book — осторожная догадка одного брокера, а не общее мнение рынка. Разброс между оценщиками большой: £395k против £475k у двух банков ([MPA Mag](https://www.mpamag.com/uk/mortgage-industry/market-trends/down-valuations-are-rising-in-the-mortgage-market/529657)).

**4.4. AVM в кредитовании.**
- Доля AVM ≈ 25% жилищных оценок в UK по заявлению LSL ([Negotiator](https://thenegotiator.co.uk/news/proptech/lsl-announces-first-major-automated-valuation-contract/)).
- Hometrack обслуживает 18 из 20 крупнейших банков по собственным данным и 16 из 20 по прессе ([Mortgage Strategy](https://www.mortgagestrategy.co.uk/providence-equity-partners-set-to-buy-hometrack/)).
- ⚠ AVM допускаются только для низкорисковых случаев. Примеры: Castle Trust — до 65% LTV и £750k ([Mortgage Strategy](https://www.mortgagestrategy.co.uk/castle-trust-bank-introduces-avms-for-btl-applications/)), Landbay — рефинансирование до 75% LTV. Оба кредитуют buy-to-let (покупку жилья под сдачу). Вывод, что prime London и покупки с высоким LTV почти всегда оцениваются физически, — экстраполяция исследователя.
- Точность. Вендор: 80% в пределах ±10%. PropertyData со ссылкой на RICS: ±5% в >80% случаев для типового городского жилья ([PropertyData](https://propertydata.co.uk/resources/just-how-accurate-are-automated-valuations-models)). Независимого бенчмарка для UK в заметках нет: PwC AVM Benchmarking был недоступен.
- Для сравнения США. Redfin: медианная ошибка 1,89% для объектов на рынке и 7,38% вне рынка ([Redfin](https://www.redfin.com/redfin-estimate)). Низкая ошибка для объектов на рынке объясняется тем, что asking price сама входит в модель.

**4.5. Отношение агентов к AVM.** Опрос Alto, 250 агентов ([Negotiator](https://thenegotiator.co.uk/news/agents-are-anti-ai-when-it-comes-to-property-valuations-agent-poll/)):
- 87% считают, что AI-оценки не отражают реальную стоимость;
- 39% тем не менее сильно на них опираются;
- почти треть корректирует AVM на £10–20k, 10% — больше чем на £20k;
- AVM пропускают пристройки, мансарды и состояние.

Новая модель ValPal выстраивает процесс так: AVM, затем ожидание продавца (ползунок с причинами), затем решение агента о надбавках за вид, станцию, сад, пристройку ([PIE](https://propertyindustryeye.com/new-tool-gives-agents-early-insight-into-sellers-price-expectations/)). PropertyData открыто строит оценку на £/sqft и вводит вторичные факторы: состояние, отделку, outdoor space, парковку, год постройки ([PropertyData](https://propertydata.co.uk/valuation)).

**4.6. Цена завышения в цифрах.**
- Which? (2017): 19% продаж прошли со снижением цены на ≥5%, это обходится продавцам в £4,3 млрд в год плюс 64 дня экспозиции. В Лондоне таких сильных снижений 13% ([Which?](https://www.which.co.uk/news/article/estate-agents-who-overprice-properties-costs-sellers-4-3bn-aByqK9q2ljdq)).
- Which?/Times (2019): 10 агентств с самым сильным завышением берут в среднем вдвое бо́льшую комиссию, чем 10 самых точных ([Which?](https://www.which.co.uk/news/article/selling-a-property-the-priciest-estate-agents-are-most-likely-to-overvalue-aYDod7M6gswp)).
- Rightmove, три замера (сравниваются дома без снижения цены и со снижением; это не «правильная» против «неправильной» стартовой цены, есть эффект отбора):

| Период | Без снижения | Со снижением | Источник |
|---|---|---|---|
| Сен 2020 | 21 день | 47 дней | ⚠ [Negotiator](https://thenegotiator.co.uk/news/over-pricing-increases-time-to-sell-by-26-days-property-market/); 63% против 32% под офертой — это сравнение «без снижения / со снижением» |
| Авг 2025 | ~32 дня | ~99 дней | [PIE](https://propertyindustryeye.com/realistic-pricing-sees-most-active-july-since-2020-says-rightmove/) |
| Май 2026 | 36 дней | 127 дней (32% объектов снижены) | [Rightmove](https://www.rightmove.co.uk/press-centre/house-price-index/may-2026/) |

- Property Solvers (2019, компания быстрого выкупа, коммерческий интерес): самый большой разрыв между asking и итоговой ценой в Лондоне — £82k в SW, £80k в NW, £59k в W ([Negotiator](https://thenegotiator.co.uk/asking-prices-sale-prices-gap/)).
- Лишь ~50,9% объектов, выставленных агентами на продажу, в итоге доходят до обмена контрактами и завершения сделки; остальные снимаются или срываются ([PIE/TPFG, июль 2026](https://propertyindustryeye.com/estate-agents-only-getting-paid-on-50-of-listings/)).
- Агенты советуют продавцам выбирать агента по % от asking price, который реально достигается (33%), по опыту с похожими объектами (28%) и по среднему сроку продажи (22%) ([PIE/GetAgent](https://propertyindustryeye.com/estate-agents-at-odds-over-overvaluing-to-win-instructions/)).

---

## 5. Что говорят люди на форумах (Mumsnet, MSE)

*Reddit и PropertyTribes были недоступны; выборка смещена к проблемным продажам.*

**5.1. Ритуал «три оценки агентов» и его разброс.**
- Юго-восток Лондона: £525–600k, разброс 14% ([Mumsnet 3218246](https://www.mumsnet.com/talk/property/3218246-Range-of-Valuations-SE-London-Confused)).
- Студия в N14: £200–265k, разброс 32%. Выставлена за £265k, лучшее предложение £250k ([MSE 6587309](https://forums.moneysavingexpert.com/discussion/6587309/should-i-accept-lower-offer-for-my-london-flat)).
- Beckton (leasehold): £265–325k ([MSE 6683387](https://forums.moneysavingexpert.com/discussion/6683387/estate-agent-advice-selling-leasehold-flat-in-london)).

Народное правило: игнорировать самую высокую цифру, ориентироваться на середину и проверять по проданным объектам. Типичная история звучит как «выбрал самую высокую оценку и в итоге снизил до самой низкой» ([Mumsnet 960981](https://www.mumsnet.com/talk/property/960981-Had-house-valued-today-by-3-Estate-Agents-50K-difference)). Отдельные сети (KFH, Foxtons, Dexters) на лондонских ветках называют привычными завышателями. Это анекдотические свидетельства.

**5.2. Чем форумы корректируют comparables.**
- Локация (улица, школа, станция) важнее всего.
- Конфигурация (спальни, ванные, ванная, проходная через кухню) важнее «сырой» площади.
- Ремонт почти не окупается. Продавец, вложивший ~£30k, просил £435k при почти идентичной продаже за £400k, и ему посоветовали снизить цену до £400–415k ([Mumsnet 5169231](https://www.mumsnet.com/talk/property/5169231-is-my-house-overpriced)).
- Грубое правило оценщика по версии MSE: завершённые продажи похожих объектов в радиусе ~0,5 мили за последние ~120 дней ([MSE 5923285](https://forums.moneysavingexpert.com/discussion/5923285/disaster-hsbc-have-valued-the-flat-at-20k-under-what-i-offered/p3)).

**5.3. Leasehold-проблемы перевешивают comparables.**
- Квартира в Sydenham: в 2018 году выставлялась примерно за £465k, в 2020-м продана за £325k. Service charge за это время вырос с £1,5k до £6k в год ([Mumsnet 3396285](https://www.mumsnet.com/talk/property/3396285-Impossible-to-sell-flat-with-extortionate-service-charge)).
- Квартира в WC2B за ~£800k: по мнению участников, реалистично ближе к £650k из-за планировки, отделки и lease короче 100 лет ([Mumsnet 5572707](https://www.mumsnet.com/talk/property/5572707-feedback-for-london-flat)).
- Lease короче 100 лет «настораживает», короче 80 лет резко снижает цену. Share of freehold (доля во владении землёй) в викторианских конверсиях держится лучше, чем современные leasehold-дома ([Mumsnet 4573075](https://www.mumsnet.com/talk/property/4573075-london-flat-market)).
- Многие участники согласны, что лондонские leasehold-квартиры с ~2016 года стоят на месте или дешевеют в номинале ([Mumsnet 5407449](https://www.mumsnet.com/talk/property/5407449-drop-in-value-of-leasehold-flats-all-types-in-last-5-7-years-trend-to-continue)).

**5.4. Surveyor как реальный «установщик» цены.**
- Восточный Лондон: предложение £280k, оценка HSBC £260k. Выяснилось, что lease около 70 лет ([MSE 5923285](https://forums.moneysavingexpert.com/discussion/5923285/disaster-hsbc-have-valued-the-flat-at-20k-under-what-i-offered/p3)).
- Юг Лондона: asking £580k, предложение £550k, оценка £520k ([MSE 6263927](https://forums.moneysavingexpert.com/discussion/6263927/advice-on-down-valuation)).
- Типичный исход — поделить разницу пополам.
- Ноябрь 2025: один брокер сообщает о росте down-valuation на лондонских квартирах в крупных домах. Причины — мало comparables, оценки агентов начала года и распродажа объектов арендодателями. Семейные дома у сильных школ держатся лучше ([MPA Mag](https://www.mpamag.com/uk/news/general/london-buyers-hit-by-sharp-rise-in-surveyor-markdowns/557684)). Это мнение одного брокера, а не рыночная статистика.

**5.5. AVM глазами пользователей.**
- На одном объекте Zoopla показала 106% от цены 2010 года, Rightmove — 58,6%. Другой пример: Zoopla £1.093m, Rightmove £1.325m, агент £1.5m ([MSE 6597469](https://forums.moneysavingexpert.com/discussion/6597469/rightmove-vs-zoopla-valuation)).
- Пользователи объясняют логику Zoopla как «последняя продажа × индекс района». Такая оценка годится для типовых террасных домов и плоха для перестроенных и уникальных.
- Исправление числа спален или планировки в профиле объекта улучшает оценку.

**5.6. Форматы цены.** «Offers over» («предложения от») и «OIEO» (offers in excess of, «предложения выше») англичане читают как неуверенность агента и используют, чтобы попасть в нижний ценовой диапазон Rightmove. Многие покупатели такие объявления не любят ([MSE 5792329](https://forums.moneysavingexpert.com/discussion/5792329/offers-over-guide-price-offers-in-excess-of-etc)). В горячих точках Лондона раунды best and final (финальных предложений) дают +5–14% к asking price, но рискуют упереться в down-valuation ([Mumsnet 4213242](https://www.mumsnet.com/talk/property/4213242-Best-and-final-how-high-do-people-actually-go)). Количественных данных о том, работает ли «offers over», в заметках нет.

---

## 6. Где источники расходятся

| Вопрос | Академия | Профессионалы / пресса | Форумы | Комментарий |
|---|---|---|---|---|
| Сколько стоит завышенная стартовая цена | Компромисс: цена немного выше, ликвидность резко ниже (Bracke-Tenreyro, Genesove-Mayer) | Чистый штраф: дольше продаётся и в итоге дешевле (Rightmove, Which?, агенты) | «Взял самую высокую оценку и снизил до самой низкой» | Статистика порталов смешивает эффект цены с качеством объекта |
| Разрыв между asking и итоговой ценой | ~4% (одна сеть, 1995–98) | 19% продаж со снижением ≥5%; £80k+ в SW/NW Лондона (коммерческий источник) | Примеры на 5–30% | Разные методы (первая или последняя цена объявления) и фазы рынка |
| Кто виноват в завышении | Структура стимулов (Levitt-Syverson; конкуренция за договор с продавцом) | Агенты винят продавцов (33% — выбирают самую высокую цифру) | Продавцы винят агентов и конкретные бренды | TPO считает, что кодекс уже запрещает завышение; Propertymark-комментаторы — что нужна профессионализация |
| Скидка за короткий lease | 80–99 лет ≈ −16% (E&W) | Таблицы relativity; в Лондоне квартиры с ≤60 лет выставляются ≈ на 11% ниже средней лондонской квартиры (другая база, см. §2) | «<100 лет — тревожный сигнал» | Оценщики систематически ожидают меньших дисконтов, чем дают сделки |
| Эффект EPC | 5–14% (2013–15), в Лондоне мал | Nationwide 2024: +1,6% (владельцы), +12,2% (покупка под сдачу); Nationwide 2021: +1,7% / −3,5% | — | Разные базовые классы и контроль; для BTL эффект обусловлен регулированием |
| Ремонт и состояние | «In need of improvement» −15–20%; в PCL «безупречное» +30% | Оценщики редко добавляют за презентацию; агенты — что она решает, будет ли достигнута asking price | Ремонт почти не окупается | Дисконт за плохое состояние ≠ надбавка за новый ремонт |
| Down-valuation в Лондоне | — | What Mortgage: рост на дорогом жилье в Лондоне и ЮВ; лондонский брокер: в Лондоне меньше, кроме покупок под сдачу | Много лондонских случаев с квартирами | Зависит от сегмента: prime и покупки под сдачу под давлением, массовый сегмент с плотными comparables — нет |
| Премия за новостройку в Лондоне | Причинной оценки нет | −10,5% против +4,7% | Перепродажа часто в убыток (из вторичных источников) | Сырые средние против сравнения подобного с подобным |
| AVM против оценщика | В США AVM предсказывают дефолт лучше | Appraisal Institute и 87% агентов не доверяют AVM | Ошибки £100–200k | AVM хороши на уровне портфеля и слабы на отдельном нетиповом объекте |

---

## 7. Аренда: как определяется ставка

Данных о методологии оценки арендной ставки в заметках **существенно меньше**, чем по продажам. Что есть:

- **Comparables, но мягче.** Кодекс TPO для lettings требует обосновывать ставку «preferably by comparables» («по возможности comparables»), а не «must», как для продаж ([TPO Code](https://www.lurotbrand.co.uk/wp-content/uploads/2022/09/TPOE22E27-Codes-of-Practice-09.09.22.pdf)). Hometrack Comparables для агентов включает и арендные comparables ([Negotiator](https://thenegotiator.co.uk/news/hometrack-launches-platform-to-help-agents-make-better-decisions/)).
- **Asking против achieved.** Rightmove (asking, Q2 2026): Большой Лондон £2,791/мес ([Rightmove](https://www.rightmove.co.uk/news/content/uploads/2026/07/Rental-Trends-Tracker-Q2-2026.pdf)). Индекс Zoopla/Hometrack по заключённым договорам: £2,206 (май 2026). Hamptons, новые договоры: £2,294 ([Mortgage Solutions](https://www.mortgagesolutions.co.uk/mortgage-news/2026/01/19/2025-closes-with-average-rents-lower-than-start-of-the-year-hamptons/)). Разрыв между asking и achieved аналогичен продажам, и в продукте их нельзя смешивать.
- **Состояние.** В PCL квартира в «безупречном» состоянии сдаётся на 31% дороже квартиры в «умеренном» состоянии ([Savills](https://www.savills.co.uk/research_articles/229130/394382-0)). Для продаж Savills сравнивает с другой базой («требует обновления», +30%).
- **Торги до мая 2026 года (теперь запрещены).** В 2016 году 19,9% лондонских договоров заключались выше asking против 12% по стране ([Countrywide via Property Reporter](https://www.propertyreporter.co.uk/landlords/1-in-5-pays-over-the-asking-price-on-new-tenancies.html)). На форумах: частный арендодатель на OpenRent поставил цену на £150 ниже совета агента, за сутки получил 30 запросов и ставки £1,950–2,050 ([Mumsnet 4606856](https://www.mumsnet.com/talk/property/4606856-asking-for-better-offers-to-rent-a-london-flat-on-openrent)).
- **После Renters' Rights Act (с 01.05.2026).** Ставку нужно объявлять конкретной цифрой, принимать предложения выше неё запрещено, предоплата ограничена одним месяцем ([Reeds Rains](https://www.reedsrains.co.uk/renters-rights/bidding-wars-ban-on-rental-properties)). Реакция рынка: на 36% больше арендодателей повышают стартовую ставку «с запасом», соотношение запросов к заявкам в Лондоне выросло с 1,61 до 1,99 ([Negotiator/Chestertons](https://thenegotiator.co.uk/news/203023/)). Объявленная ставка не всегда совпадает с итоговой, хорошим арендаторам иногда уступают ([LandlordZone](https://www.landlordzone.co.uk/news/renters-rights-act-a-look-at-the-first-4-months)). Отбор сместился с цены на профиль арендатора: доход, стабильность, рекомендации.
- **Доходность для инвесторов.** Gross yield = недельная аренда × 52 / asking price ([PropertyData](https://propertydata.co.uk/)). Для покупки под сдачу EPC становится основным критерием из-за регулирования (+12,2% к цене у Nationwide).
- **Пробел.** Академических гедонических исследований лондонских арендных ставок в заметках этого раздела нет. Есть только общие оценки: эластичность аренды по плотности ~0,15 (мета-анализ 347 оценок, [Ahlfeldt & Pietrostefani 2019](https://researchonline.lse.ac.uk/id/eprint/100482/1/GA_EP_The_economic_effects_of_density.pdf)) и по этажу ~0,07 (Нью-Йорк и Чикаго, [Ahlfeldt & Barr](https://researchonline.lse.ac.uk/id/eprint/108469/1/dp1704.pdf)).

---

## 8. Лондон против остальной Великобритании

*Сводная версия этого сравнения, согласованная с разделами 01 и 03, — в [REPORT.md](REPORT.md), §5.*

- **Лондон.**
  - Стандартная единица — £/sqft.
  - Большинство продаваемого жилья — leasehold-квартиры, поэтому lease, service charge и EWS1 работают почти как фильтры.
  - Ликвидность самая низкая: ~30% объектов продаются за 3 месяца.
  - Премия за станцию самая высокая (8%).
  - EPC почти не влияет на цену.
  - AVM ограничены сверху по стоимости и в prime-сегменте.
  - С 2028 года появляется налоговый порог £2m+.
- **Остальная UK.** Та же процедура «три агента + comparables». По опросу Alto, пятая часть агентов считает, что AVM недооценивают сельское жильё, а 11% — что они сильно недооценивают северные и менее обеспеченные районы ([Alto/The Negotiator](https://thenegotiator.co.uk/news/agents-are-anti-ai-when-it-comes-to-property-valuations-agent-poll/)). Эффект EPC сильнее, особенно на Северо-Востоке.
- **Шотландия.** Home Report включает обязательную оценку surveyor, оплачиваемую продавцом. Asking-цены в формате «offers over» после его введения стали ближе к comparables (по аннотации исследования).

---

## 9. Пробелы в доказательствах

- Нет независимого бенчмарка точности AVM для UK и Лондона: PwC и Bricks&Logic недоступны.
- Нет UK-исследования скоплений цен у порогов ценовых диапазонов Rightmove и у порогов SDLT.
- Цифры по £/sqft для PCL от Knight Frank и LonRes не проверены, поэтому в раздел не включены.
- Мало данных о методике оценки арендной ставки. Нет гедонических исследований аренды по Лондону.
- Reddit r/HousingUK недоступен; форумные данные — только Mumsnet и MSE.
- Ряд статей (Wiltermuth 2022, Meng 2022, Pope et al. 2015, Lo et al. 2022) прочитаны только на уровне аннотаций. Их цифры здесь не используются.

---

## 10. Выводы для продукта London Close Knit

1. **Показывать завершённые продажи (Price Paid, только категория A) и рядом цены текущих объявлений.** Добавить разрыв asking/sold, долю объектов со снижением цены и время до продажи по району и типу. Именно эти метрики агенты советуют продавцам использовать.
2. **Считать £/sqft через соединение с EPC** с явной оговоркой о методе измерения площади. Разделять дома и квартиры, freehold и leasehold.
3. **Для квартир вывести блок leasehold:** остаток срока (с полосами <80 / 80–99 / 100–125 лет), service charge как % стоимости (полосы ≤1% и ≥2% по Hamptons), статус EWS1 и наличие outdoor space.
4. **Флаг риска down-valuation:** премия к comparables, мало comparables, квартира в высоком или облицованном доме, нестандартная конструкция, новостройка, свежая пристройка, не отражённая в EPC.
5. **Новостройки считать отдельно** по флагу new-build. Цену перепродажи сравнивать со вторичными comparables в том же доме, а не с прайс-листом застройщика.
6. **AVM-оценки показывать только диапазоном с уровнем уверенности.** Уверенность снижать для prime, уникальных объектов и улиц со смешанной застройкой.
7. **Индексы подписывать честно:** Rightmove — настроения по asking prices, UK HPI — с задержкой и пересмотрами. Для пересчёта comparables на текущую дату использовать индексы фактических цен.
8. **Для аренды разделять asking и achieved ставки** и учитывать, что после Renters' Rights Act asking-ставки могут расти быстрее фактических.
