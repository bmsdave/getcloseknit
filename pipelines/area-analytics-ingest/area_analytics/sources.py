"""Reviewed source registry for launch datasets.

Each entry records the exact distribution URL, publisher, access method,
permitted product use, attribution, release cadence, geography vintage,
and known exclusions. The distribution URL is the reviewed acquisition
target; the landing URL is the human-readable publisher page. A source
with unresolved terms keeps an explicit blocked status instead of a
blanket open-data assumption. See DATA-CATALOGUE.md for the readable
summary and the evidence review for the underlying findings.
"""

import re
from dataclasses import dataclass

ONS_POPULATION_URL = (
    "https://www.ons.gov.uk/peoplepopulationandcommunity/"
    "populationandmigration/populationestimates"
)
PRMS_DATASET_URL = (
    "https://www.ons.gov.uk/peoplepopulationandcommunity/housing/"
    "datasets/privaterentalmarketsummarystatisticsinengland"
)

# Verified against the ONS Private rental market summary statistics
# dataset page: median monthly rents by bedroom category for regions
# and administrative areas (local authorities), from Valuation Office
# Agency lettings data. No LSOA detail exists in this publication.
PRIVATE_RENT_BEDROOMS = (
    "room", "studio", "1 bedroom", "2 bedrooms", "3 bedrooms",
    "4 or more bedrooms",
)
PRIVATE_RENT_STATISTIC = "median"
PRIVATE_RENT_UNIT = "GBP/month"
PRIVATE_RENT_PRECISION_POUNDS = 1
PRIVATE_RENT_MONTHLY_CEILING = 20_000

LSOA_ID_RE = re.compile(r"^uk:lsoa:E[0-9]{8}$")
BOROUGH_ID_RE = re.compile(r"^uk:lad:E[0-9]{8}$")
ONS_INCOME_URL = (
    "https://www.ons.gov.uk/peoplepopulationandcommunity/"
    "personalandhouseholdfinances/incomeandwealth"
)
STATISTICAL_PERMITTED_USE = (
    "Statistical boundaries for area display and scoring; "
    "no street or property precision"
)


@dataclass(frozen=True)
class SourceDefinition:
    name: str
    url: str
    licence: str
    carrier_policy: str
    cadence: str
    caveats: tuple[str, ...] = ()
    publisher: str = ""
    landing_url: str = ""
    access_method: str = ""
    licence_decision: str = "unresolved"
    permitted_use: str = ""
    attribution: str = ""
    geography_vintage: str = ""
    exclusions: tuple[str, ...] = ()
    expected_content_type: str = ""
    status: str = "blocked"
    fixture: str = ""
    purpose: str = ""
    scenario: str = ""
    resolution: str = ""
    publication_date: str = ""
    coverage: str = ""


# School admissions: each council's on-time offer tables (distance of the last place offered).
# Only councils whose own terms state the Open Government Licence are approved; every other
# council's rows load with publishable=false (re-use not confirmed) and are still shown with credit
# and a link to the council's table (owner decision 2026-10-15; hidden per council on a takedown).
LA_ADMISSIONS_APPROVED = frozenset({"lambeth", "harrow"})

# (DfE code, slug, council, newest document read, terms page, licence statement as read),
# from area_analytics/school_admissions/boroughs/<slug>.yaml (tests check they agree).
LA_ADMISSIONS_COUNCILS = (
    (201, 'city_of_london', 'City of London',
     'https://www.cityoflondon.gov.uk/assets/Services-DCCS/Primary-School-Admissions-Booklet.pdf',
     'https://www.cityoflondon.gov.uk/footer/legal-notices',
     'Users may not modify, copy, distribute, transmit, display, reproduce, publish, '
     'licence or create derivative works from data or other content found on the Website'),
    (202, 'camden', 'Camden',
     'https://web.archive.org/web/20251226074126/https://www.camden.gov.uk/documents/d/guest/starting-school-in-camden-2026-admissions-guide',
     None,
     'No licence or re-use statement found.'),
    (203, 'greenwich', 'Greenwich',
     'https://www.royalgreenwich.gov.uk/site/custom_scripts/data/GIS/school-catchment-radius/coords-radii-primary.json',
     'https://www.royalgreenwich.gov.uk/terms-and-privacy',
     'Permission is granted to electronically download, copy and print ... portions of our'
     ' site solely for private or educational use (within the classroom)'),
    (204, 'hackney', 'Hackney',
     'https://education.hackney.gov.uk/sites/default/files/document/How%20Places%20Were%20Offered%20-%20Reception%202026.pdf',
     'https://education.hackney.gov.uk/content/terms-use',
     'The material featured on the Hackney Education website is subject to copyright '
     'protection unless otherwise indicated. Copyright protected material may be '
     'downloaded free of charge ... without requiring specific permission'),
    (205, 'hammersmith_fulham', 'Hammersmith & Fulham',
     'https://web.archive.org/web/20251006131238/https://www.lbhf.gov.uk/sites/default/files/2025-09/primary-starting-school-2026-brochure-final.pdf',
     'https://web.archive.org/web/20190404014900/https://www.lbhf.gov.uk/councillors-and-democracy/data-and-information/freedom-information/copyright-re-using-our-information',
     'All original council information material, including our logo and the content of '
     'this website, is subject to council copyright. To ask for permission to copy and '
     'reuse our content, please email webmaster@lbhf.gov.uk'),
    (206, 'islington', 'Islington',
     'https://www.islington.gov.uk/children-and-families/schools/apply-for-a-school-place/school-admissions-information/cut-off-distance-maps',
     None,
     'No licence or re-use statement found.'),
    (207, 'kensington_chelsea', 'Kensington & Chelsea',
     'https://www.rbkc.gov.uk/media/document/primary-admissions-brochure-2027',
     'https://www.rbkc.gov.uk/web-services/terms-use-accessing-any-part-website',
     'You can copy any information for your own personal use. But you may not republish, '
     'transmit, store, reproduce, communicate or make available to the public any of the '
     'information on this website.'),
    (208, 'lambeth', 'Lambeth',
     'https://www.lambeth.gov.uk/sites/default/files/2026-04/nod-rec26-how-offers-were-made-community-schools.pdf',
     'https://www.lambeth.gov.uk/about-council/using-website/copyright',
     'The site, including sub-sites of the lambeth.gov.uk domain, and its content, '
     'photography and design are covered by copyright and the Open Government Licence.'),
    (209, 'lewisham', 'Lewisham',
     'https://lewisham.gov.uk/-/media/services/education/schools/admissions/grid-for-reception-2026.pdf',
     'https://lewisham.gov.uk/about-this-site/terms-and-conditions',
     "Copyright 2026 © Lewisham Council. (Terms: 'The names, images and logos identifying "
     "Lewisham Council are proprietary marks of the Council.' No OGL statement found.)"),
    (210, 'southwark', 'Southwark',
     'https://www.southwark.gov.uk/sites/default/files/2026-08/Southwark-primary-admissions-brochure-2027-2028.pdf',
     'https://www.southwark.gov.uk/about-council/transparency/website-terms-and-conditions',
     'No copyright, OGL or re-use statement found in the main-site terms. The terms say '
     'only that use of southwark.gov.uk binds you to the terms and conditions.'),
    (211, 'tower_hamlets', 'Tower Hamlets',
     'https://www.towerhamlets.gov.uk/lgnl/education_and_learning/schools/school_admissions/primary_school_admissions.aspx',
     'https://www.towerhamlets.gov.uk/content_pages/legal_notices/legal_notices.aspx',
     'The information featured on this website is the copyright of London Borough of Tower'
     ' Hamlets unless otherwise indicated. Permission is hereby granted to electronically '
     'copy and to print hard copy portions of this web site for the sole purpose of using '
     'this as an information resource...'),
    (212, 'wandsworth', 'Wandsworth',
     'https://www.wandsworth.gov.uk/media/4q2f3jqt/how_places_were_allocated_for_primary_schools_2026.pdf',
     'https://www.wandsworth.gov.uk/about-this-website/terms-and-disclaimer/',
     'Use of the contents is limited to private and non-commercial use purposes only and '
     'may not be further exploited without prior written permission of the Council.'),
    (213, 'westminster', 'Westminster',
     'https://www.westminster.gov.uk/sites/default/files/media/documents/primary-school-admissions-brochure-for-2027.pdf',
     'https://www.westminster.gov.uk/terms-and-conditions',
     'The copyright and material on this Website is owned by Westminster City Council. You'
     ' can copy information for your own personal use. However, you may not republish ... '
     'without our permission.'),
    (301, 'barking_dagenham', 'Barking and Dagenham',
     'https://www.lbbd.gov.uk/sites/default/files/2026-10/LBBD%20MSS%202027%20ebooklet_0.pdf',
     None,
     'No copyright, OGL or terms page found on lbbd.gov.uk: /terms-and-conditions, '
     '/copyright and /website-terms-and-conditions all return 404, and the footer has no '
     'copyright line.'),
    (302, 'barnet', 'Barnet',
     'https://web.archive.org/web/20251030111841/https://www.barnet.gov.uk/sites/default/files/how_primary_school_places_were_allocated_on_16_april_2025_v2_15.pdf',
     'https://web.archive.org/web/20251210060954/https://www.barnet.gov.uk/your-council/policies-plans-and-performance/privacy-notices/copyright',
     '"All rights, including copyright and database right, in Barnet Council\'s Website ...'
     ' are owned by or licensed to Barnet Council" (not OGL; one personal copy only; Open '
     'Barnet datasets exempt)'),
    (303, 'bexley', 'Bexley',
     'https://www.bexley.gov.uk/sites/default/files/2022-08/Admission-to-primary-schools-2023-2024.pdf',
     'https://web.archive.org/web/20260616093916/https://www.bexley.gov.uk/terms-conditions',
     '"Most content on our website is copyright of The London Borough of Bexley ... All '
     'other use of our content is subject to our prior express written permission." '
     '(educational use allowed with acknowledgement; not OGL)'),
    (304, 'brent', 'Brent',
     'https://www.brent.gov.uk/-/media/files/resident-documents/education-documents/how-places-were-offered-reception-2026.pdf',
     'https://www.brent.gov.uk/the-council-and-democracy/legal',
     '"All material on this website, including text and graphics, is copyright Brent '
     'Council unless otherwise stated. Use may be made of this material by educational '
     'organisations without permission ... if an acknowledgement" (not OGL)'),
    (305, 'bromley', 'Bromley',
     'https://www.bromley.gov.uk/downloads/file/3970/primary-education-in-bromley-2027-2028',
     'https://www.bromley.gov.uk/websites/terms-disclaimer',
     '"These pages, unless otherwise stated, are copyright protected. All rights reserved.'
     ' (c) London Borough of Bromley." (not OGL)'),
    (306, 'croydon', 'Croydon',
     'https://www.croydon.gov.uk/sites/default/files/2026-04/allocation-breakdown-2026.xlsx',
     'https://www.croydon.gov.uk/webdisclaimer',
     '"Only a footer notice \'(c) Croydon Council 2026\'; the web disclaimer page gives no '
     'reuse or OGL terms"'),
    (307, 'ealing', 'Ealing',
     'https://www.ealing.gov.uk/download/downloads/id/21522/primary_school_on-time_offers_2026.pdf',
     'https://www.ealing.gov.uk/terms',
     '"All material on this website is the copyright of Ealing Council unless otherwise '
     'stated. Material on this site is for personal, non commercial use." (not OGL)'),
    (308, 'enfield', 'Enfield',
     'https://web.archive.org/web/20250512124219/https://www.enfield.gov.uk/__data/assets/pdf_file/0034/92599/Admission-to-primary-school-2025-and-allocation-information-Education.pdf',
     'https://web.archive.org/web/20260916000128/https://www.enfield.gov.uk/terms-of-use',
     '"Those works are protected by copyright laws and treaties around the world. All such'
     ' rights are reserved." (personal-use copy only; not OGL)'),
    (309, 'haringey', 'Haringey',
     'https://haringey.gov.uk/sites/default/files/2026-04/reception-transfer-2026-how-offers-were-made.pdf',
     'https://haringey.gov.uk/about-this-website',
     'No licence or re-use statement found.'),
    (310, 'harrow', 'Harrow',
     'https://www.harrow.gov.uk/downloads/file/33701/primary-school-allocations-2026-27',
     'https://www.harrow.gov.uk/terms',
     'The content we publish is free to re-use under the Open Government Licence.'),
    (311, 'havering', 'Havering',
     'https://www.havering.gov.uk/downloads/file/7395/infant-and-primary-school-statistics-2026',
     'https://www.havering.gov.uk/',
     '2026 © London Borough of Havering (site footer; no OGL statement found)'),
    (312, 'hillingdon', 'Hillingdon',
     'https://pre.hillingdon.gov.uk/downloads/file/2822/september-2026-allocation-data',
     'https://pre.hillingdon.gov.uk/',
     '2026 © Hillingdon Council. (site footer; no OGL statement found)'),
    (313, 'hounslow', 'Hounslow',
     'https://www.hounslow.gov.uk/downloads/file/14355/allocation-of-primary-school-reception-places-september-2026',
     'https://www.hounslow.gov.uk/council/legal-notices',
     'Users may not modify copy distribute transmit display reproduce publish licence or '
     'create derivative works or sell any information obtained from the website.'),
    (314, 'kingston', 'Kingston upon Thames',
     'https://hubb-production.lon1.cdn.digitaloceanspaces.com/uploads/ckeditor/attachments/20006/Kingston_Prim___Jun_Offers_2026-2023__for_publication_%282%29.pdf',
     'https://kr.afcinfo.org.uk/pages/web-site-information/disclaimer',
     'Copyright 2026 Achieving for Children (AfCinfo footer; no OGL statement; '
     'kingston.gov.uk copyright page not found)'),
    (315, 'merton', 'Merton',
     'https://www.merton.gov.uk/sites/default/files/2026-09/Admissions%20and%20appeals%20data%20for%20recent%20years%20-%20table%20Sept%2026.pdf',
     'https://www.merton.gov.uk/legal/disclaimer',
     "Footer: '(c) 2026 Merton Council'; legal disclaimer page has no copyright/OGL reuse "
     'statement'),
    (316, 'newham', 'Newham',
     'https://www.newham.gov.uk/downloads/file/10890/reception-application-and-offer-statistics-for-web',
     'https://www.newham.gov.uk/contact-information/legal-disclaimer/1',
     'The content of this website, unless otherwise stated, is copyright protected. All '
     'rights reserved.'),
    (317, 'redbridge', 'Redbridge',
     'https://www.redbridge.gov.uk/media/ldbowne5/primary-offer-day-16-april-2026-last-allocated.pdf',
     'https://www.redbridge.gov.uk/terms-of-use/',
     'Information should not be reproduced, modified or distributed or used in any way for'
     ' commercial purposes without our permission.'),
    (318, 'richmond', 'Richmond upon Thames',
     'https://www.richmond.gov.uk/media/wqskgp2n/how_primary_places_were_offered.pdf',
     'https://www.richmond.gov.uk/help/terms-and-conditions',
     'No part of this website may be copied, broadcast, adapted or used in any way without'
     ' the prior permission of the London Borough of Richmond Upon Thames'),
    (319, 'sutton', 'Sutton',
     'https://www.sutton.gov.uk/w/primary-school-allocation-information',
     None,
     'No licence or re-use statement found.'),
    (320, 'waltham_forest', 'Waltham Forest',
     'https://web.archive.org/web/20260812093134/https://www.walthamforest.gov.uk/sites/default/files/2026-04/How%20school%20places%20were%20offered%20reception_2026.pdf',
     'https://www.walthamforest.gov.uk/council-and-elections/information-about-website/website-disclaimer',
     "Footer: '(c) London Borough of Waltham Forest, 2026'; website disclaimer has no "
     'copyright/OGL reuse statement'),
)


def _la_admissions(la: int, slug: str, council: str, newest_document: str,
                   terms_url: str | None, statement: str) -> SourceDefinition:
    approved = slug in LA_ADMISSIONS_APPROVED
    attribution = f"{council} Council, school admissions: on-time offers"
    if approved:
        attribution += (". Contains public sector information licensed under the Open "
                        "Government Licence v3.0.")
    return SourceDefinition(
        name=f"{council} Council school admissions: on-time offers",
        url=newest_document,
        landing_url=terms_url or "",
        publisher=f"{council} Council (DfE LA {la})",
        access_method="per-document download (council site or a Wayback Machine copy) listed "
        f"in area_analytics/school_admissions/boroughs/{slug}.yaml; sha256 per file",
        licence="OGL-3.0" if approved else f"{council} Council copyright; re-use not confirmed",
        licence_decision="approved" if approved else "unresolved",
        permitted_use=(
            "Distance of the last place offered per school and year of entry as printed, "
            "with all-offered flags and counts; never a catchment or an admission chance"
            if approved else
            "Unresolved: the council's terms do not confirm re-use (see caveats); rows load "
            "with publishable=false and are shown credited and linked (owner decision 2026-10-15)"),
        attribution=attribution,
        carrier_policy="school",
        cadence="annual",
        exclusions=(
            "Distances are metres converted from the printed miles/km; raw_value keeps "
            "the cell as printed.",
            "Years and schools the council did not publish, or that failed review, "
            "are absent, never estimated.",
        ),
        status="active" if approved else "blocked",
        fixture=f"acquisition/la-admissions-{slug}-sample.txt" if approved else "",
        caveats=(f"Licence statement: {statement}",),
    )


SOURCE_CATALOGUE = {
    "hmlr-price-paid": SourceDefinition(
        name="HM Land Registry Price Paid Data",
        url="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
        landing_url="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
        publisher="HM Land Registry",
        access_method="monthly bulk download via the official downloads page",
        licence="OGL-3.0 with address conditions",
        licence_decision="approved",
        permitted_use="Price-paid transactions under OGL; full address strings carry "
        "additional HMLR permitted-use conditions, so review the intended address use, "
        "retain attribution, support corrections, and disclose registration lag",
        attribution="HM Land Registry, OGL 3.0",
        carrier_policy="transaction",
        cadence="monthly",
        exclusions=(
            "Latest month is subject to later updates.",
            "Transaction-UPRN links exist only where the source can establish them.",
        ),
        expected_content_type="text/csv",
        status="active",
        fixture="acquisition/hmlr-price-paid-sample.csv",
        caveats=("Latest month is subject to later updates.",),
    ),
    "epc-floor-area": SourceDefinition(
        name="Energy Performance Certificates",
        url="https://get-energy-performance-data.communities.gov.uk/",
        landing_url="https://get-energy-performance-data.communities.gov.uk/",
        publisher="Ministry of Housing, Communities and Local Government",
        access_method="bulk download requires GOV.UK One Login; CSV and API per the service",
        licence="OGL-3.0 for non-address data; OS/Royal Mail notice for address data",
        licence_decision="approved",
        permitted_use="Domestic floor area only for sale/rental energy understanding; "
        "addresses ship with the OS/Royal Mail copyright notice",
        attribution="Energy Performance Certificates data, MHCLG, OGL 3.0; "
        "address data with OS/Royal Mail notice",
        carrier_policy="property",
        cadence="monthly",
        exclusions=(
            "Replaced and expired certificates are not valid stock.",
            "Unmatched homes get no invented floor area.",
        ),
        expected_content_type="text/csv",
        status="active",
        fixture="acquisition/epc-domestic-sample.csv",
    ),
    "ons-cpih": SourceDefinition(
        name="ONS CPIH",
        url="https://www.ons.gov.uk/economy/inflationandpriceindices",
        landing_url="https://www.ons.gov.uk/economy/inflationandpriceindices",
        publisher="Office for National Statistics",
        access_method="monthly bulletin download",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="National CPIH comparisons; not an area price",
        attribution="Office for National Statistics",
        carrier_policy="national",
        cadence="monthly",
        status="active",
        fixture="acquisition/ons-cpih-sample.csv",
    ),
    "ons-private-rent": SourceDefinition(
        name="ONS Private rental market summary statistics in England",
        url=PRMS_DATASET_URL,
        landing_url=PRMS_DATASET_URL,
        publisher="Office for National Statistics",
        access_method="half-yearly bulletin dataset download covering a "
        "12-month reference window",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Borough (local authority) median monthly rent by "
        "bedroom category; visibly coarse when projected to LSOAs and "
        "never a measure of current advertised stock",
        attribution="Office for National Statistics",
        carrier_policy="borough",
        cadence="half-yearly",
        geography_vintage="local authority as published per release",
        exclusions=(
            "No LSOA detail exists in this publication; LSOAs inherit "
            "their borough median with a coarse-evidence carrier.",
            "Bedroom breakdown is limited to the published bedroom cells.",
            "Medians describe achieved lets in the reference window, "
            "not currently advertised listings.",
        ),
        status="active",
        fixture="acquisition/ons-private-rent-sample.csv",
        caveats=(
            "Borough median monthly rent; coarse when shown at LSOA.",
            "Median statistic preserved at publication precision of £1.",
        ),
    ),
    "police-uk": SourceDefinition(
        name="data.police.uk",
        url="https://data.police.uk/data/",
        landing_url="https://data.police.uk/",
        publisher="Home Office (data.police.uk)",
        access_method="monthly bulk download via the publisher downloads service",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Area-level recorded-crime statistics for published LSOAs; locations "
        "are anonymised by the publisher and must not be treated as street-level identifications",
        attribution="Data.police.uk data, Home Office, OGL 3.0",
        carrier_policy="published-lsoa",
        cadence="monthly",
        exclusions=(
            "Locations are anonymised by the publisher.",
            "Force and month coverage varies; "
            "check the publisher changelog before choosing a release.",
        ),
        expected_content_type="text/csv",
        status="active",
        fixture="acquisition/police-uk-street-sample.csv",
        caveats=("Locations are anonymised by the publisher.",),
    ),
    "ons-population": SourceDefinition(
        name="ONS population estimates",
        url=ONS_POPULATION_URL,
        landing_url=ONS_POPULATION_URL,
        publisher="Office for National Statistics",
        access_method="annual bulletin download",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="LSOA denominator estimates; retain the denominator vintage",
        attribution="Office for National Statistics",
        carrier_policy="lsoa",
        cadence="annual",
        exclusions=("Denominator vintage retained.",),
        status="active",
        fixture="acquisition/ons-population-sample.csv",
        caveats=("Denominator vintage retained.",),
    ),
    "imd-2025": SourceDefinition(
        name="English Indices of Deprivation 2025",
        url="https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025",
        landing_url="https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025",
        publisher="Ministry of Housing, Communities and Local Government",
        access_method="release download via the official statistics page",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="LSOA deprivation context; never a measure of individual behaviour",
        attribution="Ministry of Housing, Communities and Local Government",
        carrier_policy="lsoa",
        cadence="release",
        status="active",
        fixture="acquisition/imd-2025-sample.csv",
    ),
    "ons-small-area-income": SourceDefinition(
        name="ONS small-area income",
        url=ONS_INCOME_URL,
        landing_url=ONS_INCOME_URL,
        publisher="Office for National Statistics",
        access_method="release download",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="MSOA income context with confidence intervals; "
        "projected to LSOAs for display only",
        attribution="Office for National Statistics",
        carrier_policy="msoa",
        cadence="release",
        exclusions=("Projected to LSOAs only for display and scoring.",),
        status="active",
        fixture="acquisition/ons-small-area-income-sample.csv",
        caveats=("Projected to LSOAs only for display and scoring.",),
    ),
    "census-tenure-2021": SourceDefinition(
        name="Census 2021 tenure",
        url="https://www.ons.gov.uk/census",
        landing_url="https://www.ons.gov.uk/census",
        publisher="Office for National Statistics",
        access_method="release download",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="LSOA tenure composition; never a measure of individual behaviour",
        attribution="Office for National Statistics",
        carrier_policy="lsoa",
        cadence="release",
        geography_vintage="2021",
        status="active",
        fixture="acquisition/census-tenure-2021-sample.csv",
    ),
    "osm-network": SourceDefinition(
        name="OpenStreetMap network",
        url="https://www.openstreetmap.org/",
        landing_url="https://www.openstreetmap.org/copyright",
        publisher="OpenStreetMap contributors",
        access_method="weekly planet or extract download",
        licence="ODbL-1.0",
        licence_decision="approved",
        permitted_use="Routing network kept as a separately identified derived database",
        attribution="OpenStreetMap contributors, ODbL 1.0",
        carrier_policy="network",
        cadence="weekly",
        status="active",
        fixture="acquisition/osm-network-sample.csv",
    ),
    "tfl-timetables": SourceDefinition(
        name="TfL Journey Planner timetables (TransXChange)",
        url="https://tfl.gov.uk/tfl/syndication/feeds/journey-planner-timetables.zip",
        landing_url="https://tfl.gov.uk/info-for/open-data-users/our-open-data",
        publisher="Transport for London",
        access_method="open feed download; converted to GTFS offline for the route planner",
        licence="TfL open data terms (based on OGL v2.0)",
        licence_decision="approved",
        permitted_use="Commute times from London areas to the commute hubs (offline routing "
        "release); attribution required; no implied TfL endorsement, roundel or line colours",
        attribution="Powered by TfL Open Data",
        carrier_policy="network",
        cadence="weekly",
        status="active",
        fixture="acquisition/tfl-timetables-sample.csv",
    ),
    "dfe-gias": SourceDefinition(
        name="DfE Get Information About Schools (establishments and links)",
        url="https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/"
        "edubasealldata{YYYYMMDD}.csv",
        landing_url="https://get-information-schools.service.gov.uk/Downloads",
        publisher="Department for Education",
        access_method="daily full extract plus links_edubasealldata{YYYYMMDD}.csv; slimmed to "
        "London establishments and links on download, raw files deleted",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="School identity only: URN, LA and establishment number, phase, type, "
        "status, open/close dates and predecessor/successor links, used to map history "
        "published under an old URN onto the school as it is today",
        attribution="Department for Education, Get Information About Schools. Contains "
        "public sector information licensed under the Open Government Licence v3.0.",
        carrier_policy="school",
        cadence="daily",
        exclusions=(
            "Personal data (head teacher and contact names, telephone numbers, email "
            "addresses) is dropped before anything is stored.",
            "Split-school links are ignored; ambiguous or unmatched URNs are reported, "
            "never guessed.",
        ),
        status="active",
        fixture="acquisition/dfe-gias-sample.csv",
        caveats=("Extract of 2026-10-11; schools opened since are not linked until the "
            "next extract.",),
    ),
    "dfe-school-performance": SourceDefinition(
        name="DfE Compare school and college performance (KS2, KS4, KS5, census)",
        url="https://www.compare-school-performance.service.gov.uk/download-data"
        "?download=true&regions=0&filters={KS2|KS4|KS5|CENSUS}&fileformat=csv"
        "&year={YYYY-YYYY}&meta=false",
        landing_url="https://www.compare-school-performance.service.gov.uk/download-data",
        publisher="Department for Education",
        access_method="England-wide CSV per key stage and academic year (browser "
        "User-Agent); meta files with filters=meta&meta=true; mirrored under "
        "~/data/dfe-performance/ because the service closes in autumn 2026",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="School and cohort performance by year with cohort sizes; "
        "suppressed cells stay suppressed",
        attribution="Department for Education, Compare school and college performance. "
        "Contains public sector information licensed under the Open Government Licence v3.0.",
        carrier_policy="school",
        cadence="annual",
        exclusions=(
            "Confidence intervals and cohort sizes retained.",
            "Years with no school-level publication (KS2 2019/20-2021/22, KS4/KS5 "
            "2019/20-2020/21, census 2019/20) are absent, not zero.",
            "Independent schools are skipped.",
        ),
        status="active",
        fixture="acquisition/dfe-school-performance-sample.csv",
        caveats=("Confidence intervals and cohort sizes retained.",
            "Results under a predecessor URN are attributed to the current school "
            "through GIAS links.",),
    ),
    "ofsted": SourceDefinition(
        name="Ofsted report cards",
        url="https://www.gov.uk/guidance/understanding-ofsted-report-cards-and-grades",
        landing_url="https://www.gov.uk/guidance/understanding-ofsted-report-cards-and-grades",
        publisher="Ofsted",
        access_method="release download",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Current report-card facets kept separate; "
        "historical overall judgements labelled legacy",
        attribution="Ofsted",
        carrier_policy="school",
        cadence="release",
        exclusions=("Current facets stay separate; "
            "historical overall judgements are labelled legacy.",),
        status="active",
        fixture="acquisition/ofsted-sample.csv",
        caveats=("Current facets stay separate; "
            "historical overall judgements are labelled legacy.",),
    ),
    "ofsted-history": SourceDefinition(
        name="Ofsted state-funded schools inspections and outcomes (history)",
        url="https://www.gov.uk/government/statistical-data-sets/"
        "monthly-management-information-ofsteds-school-inspections-outcomes",
        landing_url="https://www.gov.uk/government/statistics/"
        "state-funded-schools-inspections-and-outcomes-as-at-31-august-2025",
        publisher="Ofsted",
        access_method="official statistics CSV per year to 31 August, management "
        "information files 2005-2015 and 2015-2019, and the monthly year-to-date file",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Every inspection of a London state school with its framework, "
        "overall grade where one was given and every other judgement as printed; "
        "frameworks are never mapped onto one scale",
        attribution="Ofsted, state-funded schools inspections and outcomes. Contains "
        "public sector information licensed under the Open Government Licence v3.0.",
        carrier_policy="school",
        cadence="monthly",
        exclusions=(
            "Section 8 visits before September 2015 are not in the files.",
            "Special schools, PRUs and nurseries are outside the school table.",
        ),
        status="active",
        fixture="acquisition/ofsted-history-sample.csv",
        caveats=("Report cards (from November 2025) and inspections from September "
            "2024 have no overall grade.",),
    ),
    "ofsted-reports": SourceDefinition(
        name="Ofsted inspection reports (text)",
        url="https://files.ofsted.gov.uk/v1/file/{id}",
        landing_url="https://reports.ofsted.gov.uk/provider/21/{URN}",
        publisher="Ofsted",
        access_method="provider page per inspected URN, then the report PDF matched by "
        "inspection date; at most one request a second; pdftotext",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Short verbatim quotes of a report's summary and improvement "
        "sections, always with a link to the report PDF and the Ofsted attribution",
        attribution="Ofsted inspection reports, Crown copyright. Contains public sector "
        "information licensed under the Open Government Licence v3.0.",
        carrier_policy="school",
        cadence="monthly",
        exclusions=(
            "Sections not found, and PDFs with no text layer, stay empty; no OCR and "
            "no paraphrase.",
        ),
        status="active",
        fixture="acquisition/ofsted-reports-sample.txt",
        caveats=("Quoted verbatim from the report; report_url links to the source PDF.",),
    ),
    "dfe-applications-offers": SourceDefinition(
        name="DfE primary and secondary school applications and offers (school level)",
        url="https://content.explore-education-statistics.service.gov.uk/api/releases/"
        "0bf4f9cf-721d-44e3-8473-266c87e17e00/files/42d0d4e4-9604-413a-8275-00b829ffbdcb",
        landing_url="https://explore-education-statistics.service.gov.uk/find-statistics/"
        "primary-and-secondary-school-applications-and-offers/2026-27",
        publisher="Department for Education",
        access_method="annual release CSV (AppsandOffers_<year>_SchoolLevel*.csv); the "
        "file id changes with each release",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Preferences and offers per school and year of entry (reception, "
        "year 7); never presented as capacity or an admission chance",
        attribution="Department for Education, Primary and secondary school applications "
        "and offers. Contains public sector information licensed under the Open "
        "Government Licence v3.0.",
        carrier_policy="school",
        cadence="annual",
        exclusions=(
            "Offers are not the published admission number; pan stays empty.",
            "Rows of merged schools are never summed; year 9 entry is excluded.",
        ),
        status="active",
        fixture="acquisition/dfe-applications-offers-sample.csv",
        caveats=("Second sites under a dummy LAESTAB: only the main site's row is "
            "loaded.",),
    ),
    "defra-noise": SourceDefinition(
        name="DEFRA strategic noise maps",
        url="https://environment.data.gov.uk/",
        landing_url="https://environment.data.gov.uk/",
        publisher="Department for Environment, Food and Rural Affairs",
        access_method="release download; per-source coverage under review",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Raster-derived LSOA exposure screening; "
        "road, rail, and aircraft sources stay distinct",
        attribution="Department for Environment, Food and Rural Affairs",
        carrier_policy="raster-derived-lsoa",
        cadence="release",
        exclusions=("Road, rail, and aircraft sources remain distinct.",),
        status="active",
        fixture="acquisition/defra-noise-sample.csv",
        caveats=("Road, rail, and aircraft sources remain distinct; road "
            "pilot: see defra-strategic-road-noise.",),
    ),
    "defra-strategic-road-noise": SourceDefinition(
        name="Defra strategic road-traffic noise (modelled pilot)",
        url="https://environment.data.gov.uk/",
        landing_url="https://www.gov.uk/government/publications/strategic-noise-mapping-2022",
        publisher="Department for Environment, Food and Rural Affairs",
        access_method="reviewed corridor download via the Defra data "
        "services platform per release",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Corridor-level modelled road-traffic exposure for "
        "candidate shortlists: mapped corridors report their modelled band, "
        "gaps report no-mapped-exposure (never quiet), areas outside the "
        "reviewed coverage report no-coverage; never a dwelling-level or "
        "nuisance assessment",
        attribution="Department for Environment, Food and Rural Affairs",
        carrier_policy="corridor-screening",
        cadence="release",
        exclusions=(
            "Rail noise is not a reviewed source yet and stays unavailable.",
            "Aircraft exposure stays separate and is not part of this "
            "road pilot.",
            "No speculative nuisance score is derived from this source.",
        ),
        expected_content_type="application/geo+json",
        status="blocked",
        fixture="noise/defra-road-sample.geojson",
        caveats=("Modelled strategic exposure, not a live measurement.",),
        purpose="Reviewed road-traffic noise context plus prompts for "
        "repeat area visits; not neighbour intelligence",
        scenario="Strategic modelled road-traffic exposure; rail "
        "unavailable, aircraft separate",
        resolution="Units dB LAeq,16h (day) and dB Lnight (night); 10m "
        "modelled grid aggregated to corridor polygons on publication "
        "geometry: point locations use corridor intersection, never a "
        "survey measurement",
        publication_date="Pilot reference sample reviewed 2026-09-06; "
        "source date 2022 strategic mapping round; confirm the publisher "
        "release date at each acquisition",
        coverage="Pilot: reviewed road corridors around the West London "
        "preview areas; gaps between corridors report no-mapped-exposure, "
        "outside them screening reports no-coverage",
    ),
    "planning-data-uk-applications": SourceDefinition(
        name="Planning Data UK planning applications (pilot)",
        url="https://www.planning.data.gov.uk/dataset/planning-application",
        landing_url="https://www.planning.data.gov.uk/",
        publisher="Ministry of Housing, Communities and Local Government "
        "(Planning Data)",
        access_method="reviewed national dataset download via the Planning "
        "Data API per release",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Borough-level planning context for candidate "
        "shortlists: proposals stay distinct from decisions, withdrawn "
        "applications stay labelled, boroughs outside the reviewed coverage "
        "report no-coverage; never a no-risk assessment",
        attribution="Planning Data, Ministry of Housing, Communities and "
        "Local Government, OGL 3.0",
        carrier_policy="borough-planning",
        cadence="release",
        exclusions=(
            "Pilot boroughs only; other boroughs report no-coverage, "
            "never absence of development.",
            "Borough adapters run only where a permitted stable interface "
            "fills a demonstrated gap; nothing is scraped.",
            "No planning-risk score is derived from this source.",
        ),
        expected_content_type="application/json",
        status="blocked",
        fixture="planning/national-sample.json",
        caveats=("National entries can lag the council register; check "
            "currency per record.",),
        purpose="Evidence-backed planning questions near a candidate: "
        "nearby proposals with their decision state, never a verdict",
        scenario="National planning-application proposals and decisions; "
        "withdrawn applications stay labelled withdrawn and leave nearby "
        "results",
        resolution="Record-level national entries keyed by council "
        "reference and borough: duplicate references collapse to the "
        "latest entry, decision text stays distinct from proposal text, "
        "overlapping constraints stay separately named",
        publication_date="Pilot reference sample reviewed 2026-09-06; "
        "national dataset refresh 2026-08-30; confirm the publisher "
        "release date at each acquisition",
        coverage="Pilot: Westminster (E09000033) and Camden (E09000007) "
        "from the national dataset; other boroughs report no-coverage, "
        "empty searches report no records in the covered dataset",
    ),
    "osm-amenities": SourceDefinition(
        name="OpenStreetMap amenities",
        url="https://www.openstreetmap.org/",
        landing_url="https://www.openstreetmap.org/copyright",
        publisher="OpenStreetMap contributors",
        access_method="weekly planet or extract download",
        licence="ODbL-1.0",
        licence_decision="approved",
        permitted_use="Point-derived LSOA amenity counts kept with raw counts, "
        "denominator, and confidence",
        attribution="OpenStreetMap contributors, ODbL 1.0",
        carrier_policy="point-derived-lsoa",
        cadence="weekly",
        exclusions=("Raw counts, denominator, and confidence retained.",),
        status="active",
        fixture="acquisition/osm-amenities-sample.csv",
        caveats=("Raw counts, denominator, and confidence retained.",),
    ),
    "ons-lsoa-boundaries-2021": SourceDefinition(
        name="ONS LSOA 2021 boundaries",
        url="https://geoportal.statistics.gov.uk/",
        landing_url="https://geoportal.statistics.gov.uk/",
        publisher="Office for National Statistics",
        access_method="reviewed download per release via ONS Geoportal",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use=STATISTICAL_PERMITTED_USE,
        attribution="Office for National Statistics",
        carrier_policy="lsoa",
        cadence="release",
        geography_vintage="2021",
        exclusions=("Statistical boundaries only; no street or property precision.",),
        expected_content_type="application/geo+json",
        status="active",
        fixture="geography/lsoa-2021-sample.geojson",
        caveats=("Statistical boundaries only; no street or property precision.",),
    ),
    "ons-msoa-boundaries-2021": SourceDefinition(
        name="ONS MSOA 2021 boundaries",
        url="https://geoportal.statistics.gov.uk/",
        landing_url="https://geoportal.statistics.gov.uk/",
        publisher="Office for National Statistics",
        access_method="reviewed download per release via ONS Geoportal",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use=STATISTICAL_PERMITTED_USE,
        attribution="Office for National Statistics",
        carrier_policy="msoa",
        cadence="release",
        geography_vintage="2021",
        exclusions=("Statistical boundaries only; no street or property precision.",),
        expected_content_type="application/geo+json",
        status="active",
        fixture="geography/msoa-2021-sample.geojson",
        caveats=("Statistical boundaries only; no street or property precision.",),
    ),
    "ons-borough-boundaries-2021": SourceDefinition(
        name="ONS London borough 2021 boundaries",
        url="https://geoportal.statistics.gov.uk/",
        landing_url="https://geoportal.statistics.gov.uk/",
        publisher="Office for National Statistics",
        access_method="reviewed download per release via ONS Geoportal",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Statistical boundaries for area display and scoring; London boroughs only",
        attribution="Office for National Statistics",
        carrier_policy="borough",
        cadence="release",
        geography_vintage="2021",
        exclusions=("London boroughs only; no street or property precision.",),
        expected_content_type="application/geo+json",
        status="active",
        fixture="geography/borough-sample.geojson",
        caveats=("London boroughs only; no street or property precision.",),
    ),
    "ea-flood-risk-rivers-sea": SourceDefinition(
        name="Environment Agency Risk of Flooding from Rivers and Sea",
        url="https://environment.data.gov.uk/",
        landing_url="https://www.gov.uk/check-long-term-flood-risk",
        publisher="Environment Agency",
        access_method="reviewed polygon download via the Defra data "
        "services platform per release",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Area-level flood screening for candidate "
        "shortlists: locations report polygon intersection, coarse areas "
        "report area exposure; never a property-level or insurance "
        "assessment",
        attribution="Environment Agency, OGL 3.0",
        carrier_policy="polygon-screening",
        cadence="release",
        exclusions=(
            "Surface water and other mechanisms stay separately named "
            "observations, never merged into this screening.",
            "Areas outside the reviewed coverage report no-coverage, "
            "never no-mapped-exposure.",
            "No single generic flood score and no insurance-cost "
            "prediction are derived from this source.",
        ),
        expected_content_type="application/geo+json",
        status="blocked",
        fixture="flood/ea-rofrs-sample.geojson",
        caveats=("Area exposure, not building-level risk.",),
        purpose="Area-level flood screening for candidate shortlists; "
        "not a property-level or insurance assessment",
        scenario="Rivers and sea as the reviewed mechanism; surface "
        "water only as a separately named observation",
        resolution="Polygon screening on publication geometry: point "
        "locations use polygon intersection, coarse areas use planar "
        "area-exposure share, not a survey measurement",
        publication_date="Pilot reference sample reviewed 2026-09-06; "
        "confirm the publisher release date at each acquisition",
        coverage="Pilot: reviewed polygons around the West London "
        "preview areas; outside them screening reports no-coverage",
    ),
    "ons-lookup-lsoa-msoa-lad": SourceDefinition(
        name="ONS LSOA to MSOA to LAD lookup",
        url="https://geoportal.statistics.gov.uk/",
        landing_url="https://geoportal.statistics.gov.uk/",
        publisher="Office for National Statistics",
        access_method="reviewed download per release via ONS Geoportal",
        licence="OGL-3.0",
        licence_decision="approved",
        permitted_use="Hierarchy reconciliation only: LSOA to MSOA to LAD joins follow this "
        "lookup, never inference; the lookup carries its own reuse conditions",
        attribution="Office for National Statistics",
        carrier_policy="lookup",
        cadence="release",
        geography_vintage="2021",
        exclusions=(
            "Hierarchy is reconciled against this lookup, not inferred.",
            "Lookup datasets carry their own reuse conditions; verify before redistribution.",
        ),
        expected_content_type="text/csv",
        status="active",
        fixture="geography/lookup-sample.csv",
        caveats=("Hierarchy is reconciled against this lookup, not inferred.",),
    ),
    **{f"la-admissions-{row[1]}": _la_admissions(*row) for row in LA_ADMISSIONS_COUNCILS},
}


def source_definition(source_id: str) -> SourceDefinition:
    try:
        return SOURCE_CATALOGUE[source_id]
    except KeyError as error:
        raise ValueError(f"unknown source: {source_id}") from error


def bedroom_cell_for(bedrooms) -> str:
    if isinstance(bedrooms, bool) or not isinstance(bedrooms, int):
        raise ValueError(f"invalid bedroom count: {bedrooms!r}")
    if bedrooms < 0 or bedrooms > 8:
        raise ValueError(f"bedroom count out of range: {bedrooms!r}")
    if bedrooms == 0:
        return "studio"
    if bedrooms == 1:
        return "1 bedroom"
    if bedrooms <= 3:
        return f"{bedrooms} bedrooms"
    return "4 or more bedrooms"


def parse_private_rent_cell(record) -> dict:
    geography_id = record.get("geography_id")
    if not isinstance(geography_id, str) or not BOROUGH_ID_RE.match(geography_id):
        raise ValueError(f"private rent needs a borough carrier: {geography_id!r}")
    bedroom = record.get("bedroom")
    if bedroom not in PRIVATE_RENT_BEDROOMS:
        raise ValueError(f"unknown private-rent bedroom cell: {bedroom!r}")
    rent = record.get("median_monthly_rent")
    if isinstance(rent, bool) or not isinstance(rent, (int, float)) or rent <= 0:
        raise ValueError(f"invalid monthly rent (GBP/month): {rent!r}")
    if rent > PRIVATE_RENT_MONTHLY_CEILING:
        raise ValueError(f"median above plausible monthly rent; check monthly units: {rent!r}")
    period = record.get("period")
    if not isinstance(period, str) or not period.strip():
        raise ValueError("private-rent cell needs a source period")
    return {
        "carrier_geography_id": geography_id, "bedroom": bedroom,
        "median_monthly_rent": rent, "unit": PRIVATE_RENT_UNIT,
        "statistic": PRIVATE_RENT_STATISTIC, "period": period.strip(),
        "precision_pounds": PRIVATE_RENT_PRECISION_POUNDS,
        "quality": "fallback",
        "source_bedroom_label": record.get("source_bedroom_label", bedroom),
    }


def resolve_rent_carrier(lsoa_id: str, lookup) -> str:
    if not isinstance(lsoa_id, str) or not LSOA_ID_RE.match(lsoa_id):
        raise ValueError(f"invalid lsoa geography id: {lsoa_id!r}")
    try:
        parent = lookup[lsoa_id]
    except (KeyError, TypeError) as error:
        raise ValueError(f"lsoa without official lookup entry: {lsoa_id}") from error
    if not isinstance(parent, str) or not BOROUGH_ID_RE.match(parent):
        raise ValueError(f"rent carrier must be a borough geography id: {parent!r}")
    return parent
