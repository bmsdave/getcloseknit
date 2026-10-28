"""The API's payloads (contract/base.py says how they are used). First written from the hand-kept
contracts/openapi.yaml (2026-10); edit these, then regenerate: deploy/tools/gen_openapi.py."""

from __future__ import annotations

from datetime import date as Date
from typing import Annotated, Any, Literal

from pydantic import AnyUrl, ConfigDict, Field
from typing_extensions import TypeAliasType

from .base import Carrier, Contract, Email, FactorId, GeographyId, LatLon, LsoaId, MetricId, Period, Quality, Urn


class SchoolLink(Contract):
    """One Visit & links destination; href null when its flag is off (the page draws no tile)"""

    href: Annotated[str | None, Field(description="/go/school-<target>?urn=<urn>&from=web")]
    portal: Annotated[str, Field(description="school-<target>, the portal_click label")]


class SchoolDestination(Contract):
    """DfE destination measures, all students, percentages as published (null when suppressed)"""

    cohortYear: Annotated[str, Field(description="Year the students finished the stage, e.g. 2023/24")]
    destinationYear: Annotated[str, Field(description="The year followed, e.g. 2024/25")]
    cohort: int | None
    version: Literal["Provisional", "Revised"] | None = None
    reportedUrn: str | None = None
    sustainedPercent: float | None
    educationPercent: float | None = None
    higherEducationPercent: Annotated[float | None, Field(description="16-18 only")] = None
    apprenticeshipPercent: float | None = None
    employmentPercent: float | None = None
    notSustainedPercent: float | None = None
    unknownPercent: float | None = None
    sourceRelease: str


class EnvelopeValue(Contract):
    """Tool-specific payload. find_areas and open_shared_search carry the factor release set behind the match as
    value.sourceReleaseSet (productReleaseId stays the active product release, #215)."""

    sourceReleaseSet: Annotated[
        str | None,
        Field(description="The source releases scored, joined with +; find_areas and open_shared_search only"),
    ] = None


class EnvelopeEvidence(Contract):
    """One observation behind the answer; its fields depend on its kind."""

    model_config = ConfigDict(extra="allow")
    kind: Annotated[str, Field(examples=["metric-observation"])]


class EnvelopeSource(Contract):
    model_config = ConfigDict(extra="allow")
    sourceId: str | None = None
    sourceName: str | None = None
    sourceUrl: str | None = None
    release: str | None = None
    licence: str | None = None
    attribution: str | None = None
    transformationVersion: str | None = None
    methodologyPath: str | None = None


class EvidenceEnvelope(Contract):
    schemaVersion: Annotated[str, Field(examples=["tool-area-metric.v1"])]
    productReleaseId: Annotated[str, Field(description="Active product release")]
    dataMode: Annotated[
        Literal["release", "demo"],
        Field(description="demo answers are illustrative fixtures and must not be presented as facts"),
    ]
    value: Annotated[
        EnvelopeValue | None,
        Field(
            description=(
                "Tool-specific payload. find_areas and open_shared_search carry the factor release set behind the match"
                " as value.sourceReleaseSet (productReleaseId stays the active product release, #215)."
            )
        ),
    ]
    confidence: Literal["high", "medium", "low", "none"]
    evidence: list[EnvelopeEvidence]
    sources: list[EnvelopeSource]
    caveats: list[str]
    rankScope: Annotated[
        RankScope | None, Field(description="On /api/v1/areas/{id} routes: the region the figures rank within")
    ] = None


class PropertyLastSale(Contract):
    """The last standard (category A) sale with a floor area, as recorded. Not a valuation."""

    date: str
    period: str
    nominalPrice: int
    floorAreaSquareMetres: Annotated[
        float | None, Field(description="null unless per-home EPC fields may be served (CLOSE_KNIT_EPC_PER_HOME)")
    ]


class PropertySummary(Contract):
    uprn: str
    addressId: Annotated[str, Field(pattern="^uk:addr:[0-9a-f]{12}$")] | None
    displayAddress: str
    geographyId: str
    parcelId: Annotated[str | None, Field(description="HM Land Registry INSPIRE index polygon id")] = None
    location: Annotated[list[float], Field(description="[lon, lat] from OS Open UPRN", max_length=2, min_length=2)]
    lastSale: Annotated[
        PropertyLastSale | None,
        Field(description="The last standard (category A) sale with a floor area, as recorded. Not a valuation."),
    ]
    caveats: list[str]
    sourceVersion: str


class AreaPricesToday(Contract):
    """Today's prices of the same band in the area; open-ended at the top and bottom"""

    from_: Annotated[int | None, Field(alias="from")] = None
    to: int | None = None


class AreaPricesPosition(Contract):
    saleDate: str | None = None
    year: int | None = None
    band: Literal["bottom-10", "bottom-quarter", "lower-middle", "upper-middle", "top-quarter", "top-10"] | None = None
    bandWords: str | None = None
    yearSales: Annotated[int | None, Field(ge=5)] = None
    today: Annotated[
        AreaPricesToday | None,
        Field(description="Today's prices of the same band in the area; open-ended at the top and bottom"),
    ] = None


class ToolIndexTool(Contract):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    schemaVersion: str | None = None
    inputSchema: dict[str, Any] | None = None


class ToolIndex(Contract):
    schemaVersion: Literal["tool-index.v1"] | None = None
    tools: list[ToolIndexTool] | None = None


class Provenance(Contract):
    sourceId: str
    sourceName: str
    sourceUrl: Annotated[str, Field(description="The publisher's URL, or derived(...) for a layer built from others")]
    release: str
    checksum: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    licence: str
    attribution: str
    transformationVersion: str


class LegendStop(Contract):
    value: float
    colour: Annotated[str, Field(pattern="^#[0-9a-fA-F]{6}$")]
    label: str


class MetricCoverage(Contract):
    scopeId: Annotated[str, Field(description="uk:region:<code>, uk:nation:<code> or uk:country:<code>")]
    share: Annotated[float, Field(ge=0.0, le=1.0)]


class MetricDefinition(Contract):
    id: MetricId
    label: str
    shortLabel: str
    description: str
    carrier: Carrier
    unit: str
    direction: Literal["higher-is-more", "higher-is-better", "neutral"]
    periods: Annotated[list[Period], Field(min_length=1)]
    defaultPeriod: str
    legend: Annotated[list[LegendStop], Field(min_length=2)]
    provenance: Provenance
    freshness: str
    methodologyPath: str
    caveats: list[str]
    descriptiveOnly: Annotated[
        bool | None,
        Field(
            description=(
                "Present (true) on Census layers (census-*, student-share): shown on the map and the area page, never"
                " ranked, filtered, weighted or used as a criterion."
            )
        ),
    ] = None
    coverage: Annotated[
        list[MetricCoverage] | None,
        Field(
            description=(
                "Where the release has values (metric_coverage, migration 126): each region, nation and country with a"
                " value at the metric's carrier, and the share of its areas with one in that scope's latest month with"
                " values. A scope not listed has none (a metric whose only region is uk:region:E12000007 is London"
                " only). With CLOSE_KNIT_ENGLAND off, London's region alone. Absent while nothing is stored."
            )
        ),
    ] = None


class MetricCollection(Contract):
    schemaVersion: Literal["area-metrics.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    metrics: list[MetricDefinition]


class SearchStreet(Contract):
    """A street (OS Open Names, migration 042) for a typed address with no recorded sale; geographyId is the LSOA at the
    street's middle"""

    name: str
    number: Annotated[int | None, Field(description="The house number typed")]
    locality: str | None = None
    borough: str | None
    postcodeDistrict: str | None = None
    likelyPostcode: Annotated[
        str | None,
        Field(
            description=(
                "Set only when the nearest recorded homes on the same side, below and above within 10 numbers, share"
                " one postcode"
            )
        ),
    ]
    neighbours: Annotated[list[int], Field(description="The house numbers that decided likelyPostcode")]
    postcodes: Annotated[
        list[str], Field(description="The street's postcodes from recorded homes, most homes first", max_length=6)
    ]
    numberPostcodes: Annotated[
        list[str] | None, Field(description="Every postcode with a recorded home at the typed number (#152)")
    ] = None
    numberGeographyId: Annotated[
        GeographyId | None, Field(description="The LSOA most of the homes at that number sit in")
    ] = None


class SearchResult(Contract):
    kind: Annotated[
        Literal["lad", "msoa", "lsoa", "postcode", "address", "street", "school", "station", "place"] | None,
        Field(
            description=(
                "What the row is; a school, station or place (named park) comes only with scope=all, its geographyId"
                " the LSOA its point is in; a postcode (a full postcode with no recorded home) is labelled with the"
                " postcode, its geographyId the LSOA it is in"
            )
        ),
    ] = None
    geographyId: GeographyId
    label: str
    secondaryLabel: str
    urn: Annotated[str | None, Field(description="A school's URN (kind school)")] = None
    independent: Annotated[
        bool | None,
        Field(description="An independent school (kind school, GIAS): it has no school page, so it opens the map there"),
    ] = None
    stationId: Annotated[str | None, Field(description="A station's id (kind station)")] = None
    placeId: Annotated[str | None, Field(description="A named park's OSM id (kind place)")] = None
    uprn: str | None = None
    addressId: Annotated[str | None, Field(pattern="^uk:addr:[0-9a-f]{12}$")] = None
    saleCount: Annotated[int | None, Field(ge=0)] = None
    street: Annotated[
        SearchStreet | None,
        Field(
            description=(
                "A street (OS Open Names, migration 042) for a typed address with no recorded sale; geographyId is the"
                " LSOA at the street's middle"
            )
        ),
    ] = None
    friendlyName: Annotated[
        str | None,
        Field(description="House of Commons Library name of the area's MSOA (a borough: its name); null when unknown"),
    ] = None
    displayName: Annotated[
        str | None,
        Field(description='The name to show: the friendly title ("Alperton East · HA0"), else the official name'),
    ] = None
    postcodeDistrict: Annotated[
        str | None, Field(description="Postcode district holding most of the area's live postcodes, e.g. NW10")
    ] = None
    postcode: Annotated[str | None, Field(description="An address's postcode (kind address)")] = None
    center: tuple[float, float]
    centerPrecision: Annotated[
        Literal["lsoa-centroid", "uprn"] | None,
        Field(description="An address's point is its LSOA's centre unless uprn: never pin a centroid as the home"),
    ] = None


class SearchResponse(Contract):
    schemaVersion: Literal["area-search.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    results: Annotated[list[SearchResult], Field(max_length=34)]


class RankScope(Contract):
    """The region an area's percentiles, ranks, shares and medians are computed in (CLOSE_KNIT_ENGLAND: ranks within the
    area's region; London = E12000007, so London's figures are London's). Copy says "of <name>"."""

    code: Annotated[str, Field(examples=["E12000002"], pattern="^E1200000[1-9]$")]
    name: Annotated[str, Field(examples=["North West"])]


class AreaSummary(Contract):
    geographyId: GeographyId
    name: str = None
    metricId: MetricId
    period: str
    value: Annotated[float | None, Field(description="null when suppressed: unavailable, never zero")]
    regionPercentile: Annotated[
        int | None,
        Field(
            description=(
                "Percentile within the area's region (rankScope); London's for a London area"
            ),
            ge=0,
            le=100,
        ),
    ]
    countryPercentile: Annotated[
        int | None, Field(description="Percentile within England; null with CLOSE_KNIT_ENGLAND off", ge=0, le=100)
    ]
    direction: Literal["higher-is-more", "higher-is-better", "neutral"] | None = None
    percentileMeaning: Annotated[
        str | None, Field(description='What the percentile means: "90 = lower than 10% of London LSOAs"')
    ] = None
    sampleCount: Annotated[int | None, Field(ge=0)]
    breakdown: Annotated[
        dict[str, float], Field(description="Present on crime: offences by type", examples=[{"Shoplifting": 4}])
    ] = None
    quality: Quality
    sourceVersion: str
    carrier: Annotated[
        Carrier, Field(description="The level the value comes from: a fallback's wider area, else the area itself")
    ]
    carrierGeographyId: Annotated[
        GeographyId | None, Field(description="A fallback's real home (#206): the wider area the value comes from")
    ] = None
    carrierName: Annotated[str | None, Field(description="The carrier area's shown name; null when unknown")] = None
    carrierSampleCount: int | None = None
    areaCount: Annotated[
        int | None, Field(description="An on-the-fly median of LSOA values (#208): how many areas it used")
    ] = None


class AreaResponse(Contract):
    schemaVersion: Literal["area-summary.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    summary: AreaSummary
    parentId: GeographyId | None = None
    friendlyName: Annotated[
        str | None,
        Field(description="House of Commons Library name of the area's MSOA (a borough: its name); null when unknown"),
    ] = None
    displayName: Annotated[
        str | None,
        Field(description='The name to show: the friendly title ("Alperton East · HA0"), else the official name'),
    ] = None
    postcodeDistrict: Annotated[
        str | None, Field(description="Postcode district holding most of the area's live postcodes, e.g. NW10")
    ] = None
    rankScope: RankScope | None = None
    bbox: Annotated[
        tuple[float, float, float, float] | None,
        Field(description="The area's shape's box [west, south, east, north] (WGS84); null without a shape"),
    ] = None
    priceTimeline: list[AreaSummary]
    metricTimeline: list[AreaSummary]


class PropertyTransaction(Contract):
    date: Date
    nominalPrice: int
    floorAreaSquareMetres: float | None
    inflationAdjustedPrice: int
    localMarketAdjustedPrice: int | None


class PropertyHistory(Contract):
    uprn: Annotated[str, Field(pattern="^[0-9]+$")]
    address: str
    geographyId: GeographyId
    transactions: list[PropertyTransaction]
    estimateDisclaimer: str
    sourceVersion: str


class PropertyHistoryResponse(Contract):
    schemaVersion: Literal["property-history.v1"]
    history: PropertyHistory


class AddressSale(Contract):
    """A recorded sale. No per-sale £/m² while the EPC licence is pending."""

    date: Date
    nominalPrice: int
    floorAreaSquareMetres: float | None


class AddressHistory(Contract):
    addressId: Annotated[str, Field(pattern="^uk:addr:[0-9a-f]{12}$")]
    displayAddress: str
    postcode: str
    geographyId: GeographyId
    saleCount: Annotated[int, Field(ge=0)]
    coordinatesPrecision: Literal["postcode"]
    transactions: list[AddressSale]
    estimateDisclaimer: str
    sourceVersion: str


class NearbySale(Contract):
    date: Date
    nominalPrice: int
    propertyType: Literal["detached", "semi-detached", "terraced", "flat", "other"]
    tenure: Literal["freehold", "leasehold", "unknown"]
    newBuild: bool


class NearbySaleGroup(Contract):
    saleCount: Annotated[int, Field(description="Sales in the window; sales lists at most 50", ge=0)]
    sales: Annotated[list[NearbySale], Field(max_length=50)]
    medianPricePerSquareMetre: Annotated[int | None, Field(description="Null under 5 qualifying sales")]
    medianSampleSize: Annotated[int, Field(ge=0)]


class NearbySalesResponse(Contract):
    schemaVersion: Literal["nearby-sales.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    addressId: Annotated[str, Field(pattern="^uk:addr:[0-9a-f]{12}$")]
    windowYears: Literal[10]
    building: NearbySaleGroup | None
    street: NearbySaleGroup | None
    disclaimer: str


class MarketMedian(Contract):
    medianPricePerSquareMetre: Annotated[int | None, Field(description="Null under 10 sales")]
    sampleSize: Annotated[int, Field(ge=0)]


class MarketGrowth(Contract):
    """Price growth of the area's sales over 1, 3, 5 and 10 years to `period`, each with its quality and sample."""

    period: str
    growth1y: float | None
    growth1yQuality: Quality | None = None
    growth1ySampleCount: int | None = None
    growth3y: float | None
    growth3yQuality: Quality | None = None
    growth3ySampleCount: int | None = None
    growth5y: float | None
    growth5yQuality: Quality | None = None
    growth5ySampleCount: int | None = None
    growth10y: float | None
    growth10yQuality: Quality | None = None
    growth10ySampleCount: int | None = None


class MarketSection(Contract):
    available: bool
    periodEnd: Annotated[str | None, Field(description="Latest recorded sale date the windows end at")]
    salesWindowMonths: Literal[12]
    salesCount: Annotated[int | None, Field(description="Category A sales in the 12 months")]
    dwellings: Annotated[int | None, Field(description="Homes with an EPC-linked UPRN (not the full stock)")]
    dwellingsSold: int | None
    turnoverPercent: float | None
    leaseholdShareOfSales: Annotated[
        float | None, Field(description="Share of the 12-month sales recorded as leasehold - of sales", ge=0.0, le=1.0)
    ]
    tenureKnownSales: int | None
    priceWindowMonths: Literal[36]
    minimumSample: Literal[10]
    newBuild: MarketMedian | None
    resale: MarketMedian | None
    newBuildPremiumPercent: Annotated[float | None, Field(description="Null unless both sides have 10 sales")]
    growth: MarketGrowth | None
    sourceVersion: str | None


class SourceRelease(Contract):
    """A source release behind an answer: display its attribution with the data."""

    release: str
    publisher: str | None = None
    sourceUrl: str | None
    licence: str | None
    attribution: str | None
    transformationVersion: str | None = None


class AreaMarket(MarketSection):
    schemaVersion: Literal["area-market.v1"]
    productReleaseId: str
    geographyId: GeographyId
    name: str
    carrier: Carrier
    sources: list[SourceRelease]
    caveats: list[str]


class CrimeType(Contract):
    category: str
    offences: int
    sharePercent: float


class PackCrime(Contract):
    """The latest released crime rate (LSOA metric: MSOAs and boroughs have none), with the commonest offence types of
    that month and a busy-centre note when shoplifting dominates (#238)."""

    period: str
    value: float | None
    unit: str
    regionPercentile: int | None
    quality: Quality
    sourceVersion: str
    offences: int | None = None
    topTypes: list[CrimeType] | None = None
    busyCentre: bool | None = None
    rateExcludingShoplifting: float | None = None
    note: str | None = None
    asbOffences: Annotated[int | None, Field(description="Anti-social behaviour incidents, not in the rate")] = None
    asbNote: str | None = None


class PackNoise(Contract):
    """Share of dwellings at 55 / 65 dB Lden or more (Defra strategic noise mapping)."""

    available: bool
    dwellings: int | None
    road55Share: float | None
    rail55Share: float | None
    air55Share: float | None = None
    any55Share: float | None
    any65Share: float | None
    roadLdenMedian: float | None
    roadLdenMappedShare: Annotated[float | None, Field(description="Share of the homes the road map covers")] = None
    sourceVersion: str | None


class UngradedVisit(Contract):
    year: str | None
    outcome: str | None


class StandingInspection(Contract):
    """The standing Ofsted judgement; an ungraded visit never replaces it."""

    grade: str | None
    framework: str | None
    year: str | None
    ungradedVisit: UngradedVisit | None = None


class ReportCardArea(Contract):
    label: str | None
    grade: str | None


class ReportCard(Contract):
    """#226: the newest report card whole (no single grade): each graded area named, and safeguarding Met / Not
    met."""

    year: str | None
    areas: list[ReportCardArea]
    safeguarding: str | None


class PackSchool(Contract):
    urn: str
    name: str
    phase: str
    distanceMetres: int | None
    latestInspection: str | None
    standingInspection: StandingInspection | None = None
    reportCard: ReportCard | None = None
    sourceVersion: str


class IndependentSchool(Contract):
    urn: str
    name: str
    ages: str | None
    gender: str | None
    faith: str | None
    sixthForm: bool | None
    distanceMetres: int | None
    sourceVersion: str | None


class IndependentSchools(Contract):
    """Independent schools within the radius (migration 067): a count and the nearest few, no grade (#250)."""

    count: int
    note: str
    nearest: list[IndependentSchool]


class PackSchools(Contract):
    radiusMetres: int
    count: int
    primary: int
    secondary: int
    nearest: list[PackSchool]
    independent: Annotated[
        IndependentSchools | None, Field(description="null before migration 067 is applied")
    ] = None


class NearbySaleSummary(Contract):
    saleCount: Annotated[int, Field(ge=0)]
    excludedPartShare: float | None = None
    medianPricePerSquareMetre: Annotated[int | None, Field(description="Null under 5 qualifying sales")]
    medianSampleSize: Annotated[int, Field(ge=0)]


class ValuePackEntry(AreaSummary):
    name: str


class ValuePack(Contract):
    """Every area's value of one metric in one month (area-value-pack.v1): the map's colours."""

    schemaVersion: Literal["area-value-pack.v1"]
    metricId: MetricId
    period: str
    carrier: Annotated[Carrier | None, Field(description="/api/v1/area-values only: the carrier asked for")] = None
    level: Annotated[
        Literal["lsoa", "msoa", "lad"] | None, Field(description="?level=: the zoomed-out level the values are of")
    ] = None
    chunk: Annotated[str | None, Field(description="?chunk=: the region or LAD code of the map chunk")] = None
    region: Annotated[str | None, Field(description="?region=: the region kept")] = None
    sourceVersion: str
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    values: list[ValuePackEntry]


CompactValueRow = TypeAliasType(
    "CompactValueRow", tuple[str, float | None, int | None, int | None, Quality, int | None, dict[str, float] | None]
)


class CompactValuePack(Contract):
    """?format=compact: the pack as the map reads it, one row per area in `fields` order; what every entry repeats is
    said once."""

    schemaVersion: Literal["area-value-pack-compact.v1"]
    metricId: MetricId
    period: str
    sourceVersion: str
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    carrier: Carrier | None
    direction: Literal["higher-is-more", "higher-is-better", "neutral"] | None
    fields: list[str]
    values: list[CompactValueRow]
    chunk: str | None = None
    level: Literal["lsoa", "msoa", "lad"] | None = None
    region: str | None = None


class LensPackValue(Contract):
    geographyId: GeographyId
    name: str
    metricId: str
    period: None
    value: Annotated[float | None, Field(description="Null when suppressed")]
    regionPercentile: Annotated[int | None, Field(ge=0, le=100)]
    countryPercentile: None
    sampleCount: Annotated[int, Field(description="Places inside the area (LSOAs measured for nearest)", ge=0)]
    quality: Literal["observed", "suppressed"]
    sourceVersion: str
    carrier: Literal["msoa", "lad"]


class LensPack(Contract):
    schemaVersion: Literal["area-value-pack.v1"]
    metricId: Annotated[str, Field(examples=["lens:family"])]
    period: Annotated[None, Field(description="Places are a snapshot of the release")]
    carrier: Literal["msoa", "lad"]
    sourceVersion: str
    productReleaseId: str
    unit: Annotated[str, Field(examples=["places per km²"])]
    criterion: Annotated[
        dict[str, Any], Field(description="The preset's custom-criterion.v1 definition (what is counted)")
    ]
    method: Annotated[str, Field(description="How the figure is made")]
    sources: list[dict[str, Any]]
    caveats: list[str]
    values: list[LensPackValue]


class FactorDefinition(Contract):
    id: FactorId
    label: str
    unit: str
    allowedDirections: Annotated[list[Literal["higher", "lower", "target-range"]], Field(min_length=1)]
    defaultDirection: Literal["higher", "lower", "target-range"]
    carrierPolicy: str
    utilityDefinition: str
    periods: Annotated[list[str], Field(min_length=1)]
    scoringEligibility: Literal["eligible", "display-only"]
    caveats: list[str]


class FactorCollection(Contract):
    schemaVersion: Literal["factor-definitions.v1"]
    factors: Annotated[list[FactorDefinition], Field(max_length=9, min_length=9)]


class FactorPreference(Contract):
    factorId: FactorId
    weight: Annotated[int, Field(ge=0, le=5)]
    direction: Literal["higher", "lower", "target-range"]
    minimumUtility: Annotated[float | None, Field(ge=0.0, le=100.0)]
    maximumUtility: Annotated[float | None, Field(ge=0.0, le=100.0)]


class CommuteDestination(Contract):
    id: str
    label: str
    latitude: Annotated[float, Field(ge=-90.0, le=90.0)]
    longitude: Annotated[float, Field(ge=-180.0, le=180.0)]
    mode: Literal["transit", "walk", "cycle"]
    arrivalTime: Annotated[str, Field(pattern="^[0-2][0-9]:[0-5][0-9]$")]
    targetMinutes: Annotated[int, Field(ge=1)]
    weight: Annotated[int, Field(ge=0, le=5)]


class ProfileSchool(Contract):
    phases: list[Literal["primary", "secondary"]]
    characteristics: list[str] | None = None
    facetWeights: dict[str, Annotated[int, Field(ge=0, le=5)]] | None = None
    shortlistUrns: list[Urn]
    desiredSchoolCount: Annotated[int, Field(ge=1)]


class AreaMarks(Contract):
    liked: Annotated[list[GeographyId] | None, Field(max_length=50)] = None
    excluded: Annotated[list[GeographyId] | None, Field(max_length=50)] = None
    notes: dict[str, Annotated[str, Field(max_length=280)]] | None = None


class BudgetCriterion(Contract):
    """One criterion; its id (the component factorId and the relaxable limit id) is affordability, range:<layer>,
    place:<id>, zone or custom:<criterion id>."""

    kind: Literal["budget"]
    must: bool | None = False


class RangeCriterion(Contract):
    """A range on a map layer. scale value: the layer's own unit; scale percentile: the London percentile of the value
    (0 = lowest in London, 100 = highest). Fit 1 in [min, max], linear to 0 at softMin / softMax, 0 beyond. A null
    bound is open. Census layers (census-*) are never criteria."""

    kind: Literal["range"]
    layer: Annotated[str, Field(pattern="^(custom:)?[a-z0-9][a-z0-9-]{0,59}$")]
    scale: Literal["value", "percentile"] | None = "value"
    min: float | None = None
    max: float | None = None
    softMin: Annotated[float | None, Field(description="<= min; ignored when must")] = None
    softMax: Annotated[float | None, Field(description=">= max; ignored when must")] = None
    must: bool | None = False


class PlaceCriterion(Contract):
    """Minutes to a place (pinned, the nearest of a kind, a top-N school, near any of 2-3 points)."""

    kind: Literal["place"]
    id: Annotated[str, Field(pattern="^[a-z0-9-]{1,24}$")]
    label: Annotated[str, Field(max_length=60, min_length=1)]
    target: Annotated[dict[str, Any], Field(description="As PlacePreference.target in web/src/lib/contracts.ts")]
    mode: Literal["walk", "cycle", "transit", "car"]
    when: Literal["weekday-am", "weekday-pm", "saturday"] | None = None
    targetMinutes: Annotated[int, Field(ge=1, le=120)]
    softMinutes: Annotated[
        int | None, Field(description="Fit 0 at this many minutes; default targetMinutes x 1.5", ge=1, le=240)
    ] = None
    must: bool | None = False


class CustomCriterion(Contract):
    """The household's own criterion from places on the map, on its London percentile (the better half inside, soft a
    quarter further)."""

    kind: Literal["custom"]
    criterion: Annotated[dict[str, Any], Field(description="As CustomCriterion in web/src/lib/custom-criteria.ts")]
    direction: Literal["higher", "lower"]
    must: bool | None = False


class MatchCriterionValueBounds(Contract):
    """For a percentile range, the layer values those percentiles stand for today (approximate)"""

    min: float | None = None
    max: float | None = None
    softMin: float | None = None
    softMax: float | None = None


class MatchCriterionEcho(Contract):
    """A criterion as scored, in list order."""

    id: str
    kind: Literal["budget", "range", "place", "where", "custom", "commute"]
    must: bool
    priority: Annotated[int, Field(description="Place in the list", ge=1)]
    weight: Annotated[float, Field(description="Rank-order centroid weight; 0 for a Must", ge=0.0, le=1.0)]
    better: Literal["lower", "higher", "middle"]
    scale: Literal["value", "percentile"]
    layer: str | None = None
    min: float | None
    max: float | None
    softMin: float | None
    softMax: float | None
    valueBounds: Annotated[
        MatchCriterionValueBounds | None,
        Field(description="For a percentile range, the layer values those percentiles stand for today (approximate)"),
    ] = None


class MatchCriterionValue(Contract):
    geographyId: GeographyId
    value: float
    regionPercentile: Annotated[float | None, Field(ge=0.0, le=100.0)]


class MatchCriterionValues(Contract):
    schemaVersion: Literal["match-criterion-values.v1"]
    layer: str
    unit: str | None
    sourceReleaseIds: list[str]
    values: list[MatchCriterionValue]


class StationZone(Contract):
    kind: Literal["station"]
    stationId: Annotated[str, Field(pattern="^osm:[nwr][0-9]{1,15}$")]
    maxWalkMinutes: Annotated[int, Field(ge=5, le=30)]
    label: Annotated[str | None, Field(max_length=80)] = None


class BoroughZone(Contract):
    kind: Literal["borough"]
    id: Annotated[str, Field(pattern="^uk:lad:E[0-9]{8}$")]
    label: Annotated[str | None, Field(max_length=80)] = None


class LsoasZone(Contract):
    kind: Literal["lsoas"]
    ids: Annotated[list[LsoaId], Field(max_length=50, min_length=1)]
    label: Annotated[str | None, Field(max_length=80)] = None


class PolygonZone(Contract):
    kind: Literal["polygon"]
    points: Annotated[
        list[LatLon],
        Field(
            description="[latitude, longitude] corners inside Greater London, closed implicitly",
            max_length=50,
            min_length=3,
        ),
    ]
    label: Annotated[str | None, Field(max_length=80)] = None


class MatchComponent(Contract):
    factorId: Annotated[
        str,
        Field(
            description=(
                "The criterion id: a v1 factor id (migrated), affordability, range:<layer>, place:<id>, zone,"
                " custom:<id>"
            )
        ),
    ]
    rawValue: Annotated[
        float, Field(description="The area's value (minutes for a place, metres outside the zones for Where)")
    ]
    unit: str
    utility: Annotated[float, Field(description="fit x 100", ge=0.0, le=100.0)]
    fit: Annotated[float, Field(ge=0.0, le=1.0)] = None
    fitKind: Annotated[
        Literal["in", "edge", "out"],
        Field(description="For the popup: in range (check), on the soft edge (≈), out (cross)"),
    ] = None
    must: bool = None
    priority: Annotated[int, Field(ge=1)] = None
    percentile: Annotated[float, Field(description="London percentile of the value", ge=0.0, le=100.0)] = None
    layer: str = None
    targetMinutes: int = None
    weight: Annotated[float, Field(description="Rank-order centroid weight; 0 for a Must", ge=0.0, le=1.0)]
    contribution: Annotated[float, Field(description="weight x fit", ge=0.0, le=1.0)]
    carrierGeographyId: GeographyId
    quality: Quality
    sourceVersion: str
    detail: Annotated[
        dict[str, float | None],
        Field(description="Quick criteria (noise, epc-share, leasehold-share) only, the figures behind the value"),
    ] = None


class MatchResultValue(Contract):
    """sort=best-value only, when the area has a good-value figure"""

    typicalPrice: int
    peerPrice: int
    valueRatio: float
    valuePercent: int
    sales: int
    outlier: bool


class MatchResult(Contract):
    geographyId: GeographyId
    name: str
    title: str | None = None
    displayName: str | None = None
    score: Annotated[float | None, Field(description="null when excluded", ge=0.0, le=100.0)]
    rankScore: Annotated[
        float | None,
        Field(
            description="The unrounded score (also for an excluded area: relaxing a Must reveals it)", ge=0.0, le=100.0
        ),
    ] = None
    rank: Annotated[int | None, Field(ge=1)]
    percentile: Annotated[
        int | None, Field(description="Place among the scored areas: 100 best, 0 least like the search", ge=0, le=100)
    ] = None
    evidenceCompleteness: Annotated[float, Field(ge=0.0, le=100.0)]
    missingWeight: Annotated[float | None, Field(ge=0.0, le=1.0)] = None
    excluded: bool
    unmetLimits: list[str]
    reasons: Annotated[
        list[str] | None,
        Field(description="The top 2 contributing criteria (weight x fit), for the why line", max_length=2),
    ] = None
    weakest: Annotated[
        list[str] | None,
        Field(
            description="What sinks the area: a failed Must first, then the biggest weight x (1 - fit)", max_length=2
        ),
    ] = None
    sourceReleaseSet: str
    components: list[MatchComponent]
    inZone: Annotated[bool | None, Field(description="Present only when the profile has zones")] = None
    value: Annotated[
        MatchResultValue | None, Field(description="sort=best-value only, when the area has a good-value figure")
    ] = None
    valueRank: Annotated[int | None, Field(description="sort=best-value only", ge=1)] = None


class SimilarAreaComponent(Contract):
    factorId: FactorId
    rawValue: float
    unit: str
    utility: Annotated[float, Field(ge=0.0, le=100.0)]
    targetUtility: Annotated[float, Field(ge=0.0, le=100.0)]
    targetRawValue: float


class SimilarArea(Contract):
    geographyId: GeographyId
    name: str
    title: Annotated[
        str | None, Field(description='Friendly title ("Pitshanger · W5") when the area is labelled; null otherwise')
    ] = None
    displayName: Annotated[str | None, Field(description="The one name to show: the title, else the official name")] = (
        None
    )
    similarity: Annotated[float, Field(description="100 minus the RMS percentile distance", ge=0.0, le=100.0)]
    components: list[SimilarAreaComponent]


class SimilarAreasCandidates(Contract):
    """How many areas were similar enough and how many of those were cheaper, so an empty answer can say which filter
    emptied it"""

    similar: Annotated[int, Field(ge=0)]
    cheaper: Annotated[int, Field(ge=0)]


class SimilarAreasResponse(Contract):
    schemaVersion: Literal["similar-areas.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    geographyId: GeographyId
    name: str
    factors: list[FactorId]
    cheaper: bool
    outsideZones: bool
    values: Annotated[list[SimilarArea], Field(max_length=10)]
    caveats: list[str]
    candidates: Annotated[
        SimilarAreasCandidates | None,
        Field(
            description=(
                "How many areas were similar enough and how many of those were cheaper, so an empty answer can say"
                " which filter emptied it"
            )
        ),
    ] = None


class StationLine(Contract):
    id: str
    name: str
    mode: str


class StationSearchResult(Contract):
    stationId: Annotated[
        str, Field(description="The walk-table station id find_areas.near_stations takes; twin stations share one")
    ]
    name: str
    modes: list[Literal["tube", "elizabeth-line", "dlr", "overground", "tram", "national-rail"]]
    lines: Annotated[list[StationLine], Field(description="TfL lines serving the station (empty when TfL lists none)")]
    zone: Annotated[str | None, Field(description="TfL fare zone, e.g. 2 or 2/3")]
    center: tuple[float, float]


class StationSearchResponse(Contract):
    schemaVersion: Literal["station-search.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    results: Annotated[list[StationSearchResult], Field(max_length=10)]


class MatchPackBottom(Contract):
    geographyId: GeographyId
    rank: int
    percentile: int
    score: int
    weakest: list[str]


class MatchPack(Contract):
    schemaVersion: Literal["match-pack.v1", "match-pack.v2"]
    profileVersion: Literal["preference-profile.v1", "preference-profile.v2"]
    model: Literal["soft-edge-rank.v1"] | None = None
    sourceReleaseSet: str
    criteria: list[MatchCriterionEcho] | None = None
    scored: Annotated[int | None, Field(ge=0)] = None
    sort: Literal["score", "best-value"] | None = None
    valueAreas: Annotated[
        int | None,
        Field(
            description=(
                "How many areas the Best value sort lists (in the better half, not out, a good-value figure from 20+"
                " sales, not an outlier); the UI hides that sort at 0. Absent when good value could not be read"
            ),
            ge=0,
        ),
    ] = None
    bottom: Annotated[
        list[MatchPackBottom] | None,
        Field(
            description=(
                "The 10 scored areas least like the search, the least first (per user only: never on area, ranking or"
                " SEO pages)"
            ),
            max_length=10,
        ),
    ] = None
    values: list[MatchResult]


class ExtensionPortalMode(Contract):
    mode: Literal["inline", "side-panel", "off"]


class MatchJob(Contract):
    schemaVersion: Literal["match-job.v1"]
    jobId: str
    status: Literal["queued", "running"]
    completedFactors: list[FactorId]
    partial: MatchPack


class AdmissionCutoff(Contract):
    academicYear: str
    distanceMetres: Annotated[float, Field(ge=0.0)]
    sourceUrl: AnyUrl
    priorityGroup: str = None


class AdmissionEvidence(Contract):
    kind: Literal["verified-boundary", "historical-reach", "unavailable"]
    academicYears: list[str]
    yearsWithin: int | None
    measurementMethod: str | None
    sourceUrls: list[AnyUrl]
    cutoffs: list[AdmissionCutoff]
    isProbability: Literal[False]
    authorityCode: str | None = None
    authorityName: str | None = None
    guidanceUrl: str | None = None
    priorityRules: list[str] = None
    priorityArea: str | None = None
    missingYears: list[str] = None


class SchoolAgeRange(Contract):
    from_: Annotated[int, Field(alias="from")]
    to: int


class SchoolObservation(Contract):
    kind: Literal["performance", "inspection-current", "inspection-legacy"]
    academicYear: str
    measure: str
    value: float | str | None
    cohortSize: int | None
    suppressed: bool
    sourceUrl: str
    sourceRelease: str


class SchoolTopBadgeChip(Contract):
    id: str
    label: str
    reason: str | None = None


class SchoolTopBadge(Contract):
    """Top school: top 10% of the region on the phase headline, top 25% on the second measure, and Ofsted Good+."""

    isTop: bool
    chips: list[SchoolTopBadgeChip]
    line: Annotated[str | None, Field(description="null unless isTop")]
    year: str | None
    reasons: list[str]
    missingReason: str | None
    criteria: str


class SchoolSummary(Contract):
    schoolId: Annotated[str, Field(pattern="^uk:school:[0-9]{6}$")]
    urn: Annotated[str, Field(pattern="^[0-9]{6}$")]
    name: str
    previousNames: list[str]
    status: Literal["open", "closed"]
    closedDate: str | None
    predecessorUrn: str | None
    successorUrn: str | None
    observations: list[SchoolObservation]
    missingObservations: list[str]
    distanceMetres: Annotated[
        float | None, Field(description="Straight-line distance from the selected area (area school lists only)")
    ] = None
    phase: Literal["primary", "secondary"]
    type: str
    ageRange: SchoolAgeRange
    gender: str
    faith: str | None
    selectivity: str
    capacity: int | None
    senProvision: list[str]
    latitude: float
    longitude: float
    journeyMinutes: int | None
    qualityFacets: dict[str, float | None]
    inspectionFramework: Literal["report-card", "legacy-overall"]
    parentViewResponses: int | None
    topBadge: Annotated[
        SchoolTopBadge | None, Field(description="Top school badge (school-card.v1 topBadge) where computed")
    ] = None
    admissionEvidence: AdmissionEvidence
    sourceVersion: str


class SchoolSummaryResponse(Contract):
    schemaVersion: Literal["school-summary.v1"]
    school: SchoolSummary


class SchoolRankingRow(Contract):
    urn: Annotated[str, Field(pattern="^[0-9]{6}$")]
    name: str
    borough: str | None
    value: Annotated[float | str, Field(description="KS4 value, the count of exceptional areas, or Outstanding")]
    cohort: int | None
    year: str


class SchoolRanking(Contract):
    schemaVersion: Literal["school-ranking.v1"]
    productReleaseId: str
    axis: str
    phase: Literal["primary", "secondary"]
    measure: str
    year: Annotated[
        str | None,
        Field(
            description=(
                "The one academic year ranked (KS4 axes); null for inspection lists, whose rows carry their own year"
            )
        ),
    ]
    minCohort: int | None
    eligibleSchools: Annotated[int, Field(description="Schools passing every filter")]
    inspectedSchools: Annotated[
        int | None, Field(description="report-card-exceptional only: schools with any report-card grade")
    ] = None
    caveats: list[str]
    attribution: str
    rows: list[SchoolRankingRow]


class PriceForecastRange(Contract):
    p10: float | None = None
    p20: float | None = None
    p50: float | None = None
    p90: float | None = None


class PriceForecastScenarios(Contract):
    downside: float | None = None
    base: float | None = None
    upside: float | None = None


class PriceForecastBacktest(Contract):
    model: str | None = None
    meanAbsoluteError: float | None = None
    intervalCoverage: float | None = None


class PriceForecast(Contract):
    schemaVersion: Literal["price-forecast.v1"]
    geographyId: GeographyId
    carrierGeographyId: GeographyId
    horizon: Literal["1y", "5y"]
    status: Literal["available", "insufficient-history", "failed-backtest"]
    range: PriceForecastRange | None
    scenarios: PriceForecastScenarios | None
    backtest: PriceForecastBacktest | None
    suppressionReason: str | None
    sourceVersion: str


class JourneyOrigin(Contract):
    latitude: float
    longitude: float


class JourneyDestination(Contract):
    latitude: float
    longitude: float


class JourneyRequest(Contract):
    origin: JourneyOrigin
    destination: JourneyDestination
    mode: Literal["transit", "walk", "cycle"]
    arrivalTime: str


class JourneyResult(Contract):
    schemaVersion: Literal["journey-result.v1"]
    status: Literal["available", "unreachable"]
    medianMinutes: float | None = None
    rangeMinutes: Annotated[list[float] | None, Field(max_length=2, min_length=2)] = None
    transfers: int | None = None
    walkingMinutes: float | None = None
    networkVersion: str
    timetableDate: Date


class CorrectionRequest(Contract):
    kind: Literal["publisher-error", "transformation-error", "privacy-objection"]
    observationId: str | None = None
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    sourceReleaseId: str | None = None
    uprn: Annotated[str | None, Field(description="privacy-objection only")] = None
    addressId: Annotated[str | None, Field(description="privacy-objection only")] = None
    email: Annotated[Email | None, Field(description="privacy-objection only; stored as a salted hash")] = None
    description: Annotated[str | None, Field(max_length=2000)] = None


class CorrectionResponse(Contract):
    status: Literal["received", "pending"] | None = None
    kind: str | None = None
    route: Literal["publisher", "transformation", "privacy"] | None = None
    id: int | None = None
    confirmationSent: Annotated[bool | None, Field(description="privacy-objection only")] = None
    confirmationChannel: Annotated[
        Literal["smtp", "webhook"] | None,
        Field(description="privacy-objection only; how the confirmation link was delivered"),
    ] = None
    notified: list[str] | None = None


class Objection(Contract):
    id: int | None = None
    uprn: str | None = None
    addressId: str | None = None
    status: str | None = None


class ObjectionConfirmResponse(Contract):
    status: Literal["active"] | None = None
    objection: Objection | None = None


class AreaNamesResponse(Contract):
    schemaVersion: Literal["area-names.v1"]
    productReleaseId: str
    names: dict[str, str]
    centers: dict[str, LatLon] | None = None


class CommuteRequest(Contract):
    areaId: str
    places: list[Any]


class CustomCriterionRequest(Contract):
    criterion: dict[str, Any]


class HomeFacts(Contract):
    """Type and tenure (last Price Paid record) and certificate facts (latest EPC; null while epc is withheld)."""

    councilTaxBand: Annotated[
        str | None,
        Field(
            description=(
                "The home's council tax band (A-H). Null, with councilTaxBand in withheld, unless"
                " CLOSE_KNIT_COUNCIL_TAX_BAND is on; null today on or off, as no licensed per-home source is loaded."
            )
        ),
    ] = None


class HomeSale(Contract):
    date: str | None = None
    price: int | None = None
    propertyType: str | None = None
    tenure: str | None = None
    newBuild: bool | None = None
    standardSale: bool | None = None
    floorAreaSquareMetres: float | None = None
    sourceUrl: Annotated[str | None, Field(description="The sale's public HM Land Registry Price Paid record")] = None
    pricePerSquareMetre: Annotated[
        int | None,
        Field(
            description=(
                "The sale price over the floor area (GBP/m², rounded). Null, with pricePerSqm in withheld, unless"
                " CLOSE_KNIT_PER_HOME_PRICE_PER_SQM is on; null without a floor area."
            )
        ),
    ] = None


class HomesNearPostcode(Contract):
    postcode: str
    geographyId: GeographyId
    homes: int
    metres: int


class HomesNearResponse(Contract):
    schemaVersion: Literal["homes-near.v1"]
    productReleaseId: str
    point: dict[str, Any]
    radiusMetres: int
    postcodes: list[HomesNearPostcode]
    caveats: list[str]
    coverage: Annotated[
        Literal["london-only"] | None,
        Field(description="Why there is nothing here: per-home data is London's alone and this is elsewhere; null inside it"),
    ] = None


class StreetHomeResponse(Contract):
    uprn: str | None = None
    postcodePage: Literal[True] | None = None
    label: str | None = None
    postcode: str | None = None
    likelyPostcode: str | None = None
    neighbours: list[Any] | None = None
    areaId: GeographyId | None = None
    point: dict[str, Any] | None = None
    withheld: list[str] | None = None


class HomeLastSale(Contract):
    date: str
    price: int


class HomeFlood(Contract):
    """The home's own Environment Agency bands (very-low, low, medium, high)."""

    riversSea: str | None
    surfaceWater: str | None


class PostcodeHome(Contract):
    addressId: Annotated[str | None, Field(description="null for a home known only from its energy certificate")]
    uprn: str | None
    displayAddress: str
    propertyType: str | None
    tenure: str | None
    floorAreaSquareMetres: Annotated[float | None, Field(description="null while per-home EPC fields are withheld")]
    energyRating: str | None
    saleCount: int
    lastSale: HomeLastSale | None
    flood: HomeFlood | None
    addressSource: Literal["epc"] | None = None


class PostcodeHomesResponse(Contract):
    schemaVersion: Literal["postcode-homes.v1"]
    productReleaseId: str
    geographyId: GeographyId | None
    disclaimer: str
    sources: Annotated[
        list[SourceRelease] | None,
        Field(
            description=(
                "Publisher, licence and attribution text of the active sources behind the home (HM Land Registry, OS"
                " Open UPRN, EPC register); display the attribution with the data"
            )
        ),
    ] = None
    postcode: str
    homes: Annotated[
        list[PostcodeHome],
        Field(
            description=(
                "While epcAddresses is not withheld, also the homes known only from an energy certificate: addressId"
                " null, lastSale null, saleCount 0, addressSource epc. Each home also carries flood: its own"
                " Environment Agency bands {riversSea, surfaceWater} (very-low, low, medium, high), or null with no"
                " dwelling_flood row."
            )
        ),
    ]
    withheld: Annotated[
        list[str],
        Field(
            description="The home features whose flags are off (as profile.withheld); their keys stay null in homes."
        ),
    ]


class ExtensionPortals(Contract):
    rightmove: ExtensionPortalMode
    zoopla: ExtensionPortalMode
    onthemarket: ExtensionPortalMode
    spareroom: ExtensionPortalMode
    openrent: ExtensionPortalMode


class ExtensionFeatures(Contract):
    resultsLine: Annotated[bool, Field(description="The line under each search result")]
    mapPopup: Annotated[bool, Field(description="The line inside a portal's map popup card")]


class ExtensionConfigResponse(Contract):
    v: Literal[1]
    portals: ExtensionPortals
    features: ExtensionFeatures
    notice: str


class PortalLinksRequest(Contract):
    market: Literal["buy", "rent"]
    maxPrice: Annotated[int, Field(ge=100, le=100000000)]
    minBedrooms: Annotated[int, Field(ge=0, le=10)]
    zones: Annotated[list[dict[str, Any]] | None, Field(description="As PreferenceProfile.zones", max_length=3)] = None


class PortalLink(Contract):
    portal: Literal["rightmove", "zoopla", "onthemarket"]
    label: str
    href: Annotated[str | None, Field(description="/go link, or null: this portal gets the districts")]


class PortalDistrict(Contract):
    outcode: str
    links: dict[str, str]


class PortalLinksZone(Contract):
    kind: Literal["station", "borough", "lsoas", "polygon"]
    label: str
    portals: list[PortalLink]
    districts: Annotated[list[PortalDistrict], Field(max_length=3)]


class PortalLinksResponse(Contract):
    schemaVersion: Literal["portal-links.v1"]
    market: Literal["buy", "rent"]
    maxPrice: int
    minBedrooms: int
    zones: list[PortalLinksZone]


class ZoneShapesRequest(Contract):
    zones: Annotated[list[dict[str, Any]], Field(description="As PreferenceProfile.zones", max_length=3, min_length=1)]


class ZoneShape(Contract):
    kind: Literal["station", "borough", "lsoas", "polygon"]
    geometry: Annotated[dict[str, Any] | None, Field(description="GeoJSON Polygon or MultiPolygon")]


class ZoneShapesResponse(Contract):
    schemaVersion: Literal["zone-shapes.v1"]
    zones: list[ZoneShape]


class ListingCardBlock(Contract):
    type: Literal[
        "header", "cta", "match", "facts", "price", "costs", "sections", "summary", "home", "actions", "footnote"
    ]


class ListingCardResponse(Contract):
    v: Literal[1]
    schemaVersion: Literal["listing-card.v1"]
    status: Literal["ok", "outside-coverage"]
    geographyId: str | None = None
    blocks: list[ListingCardBlock]


class ListingBadgeRequestItem(Contract):
    listingId: Annotated[str, Field(max_length=40)]
    url: Annotated[str, Field(max_length=500)]
    lat: float | None = None
    lng: float | None = None
    postcode: str | None = None
    market: Literal["buy", "rent"] | None = None
    askingPrice: int | None = None
    bedrooms: int | None = None
    propertyType: Literal["flat", "terraced", "semi-detached", "detached", "bungalow", "other", "unknown"] | None = None


class ListingBadge(Contract):
    listingId: str
    score: int | None
    band: Annotated[int | None, Field(ge=1, le=5)]
    excluded: bool
    bucket: Annotated[int | None, Field(ge=0, le=3)]
    flag: str | None = None


class ListingBadgesResponse(Contract):
    v: Literal[1]
    scale: Literal["match", "area"]
    items: list[ListingBadge]


class SchoolSearchResponse(Contract):
    schemaVersion: Literal["school-search.v1"]
    schools: list[SchoolSummary]


class SchoolIndexResponse(Contract):
    pass


class HomeIndexResponse(Contract):
    pass


class UniversityPoint(Contract):
    id: str
    name: str
    kind: Literal["university", "college"]
    latitude: float
    longitude: float


class UniversityPointsResponse(Contract):
    schemaVersion: Literal["university-points.v1"]
    productReleaseId: str
    attribution: str
    points: list[UniversityPoint]


class SchoolPointALevelRank(Contract):
    """The combined A-level rank (issue #201), present only for ranked sixth forms: London rank among state and
    independent sixth forms"""

    rank: int | None = None
    pool: int | None = None
    year: str | None = None
    note: str | None = None


class SchoolPoint(Contract):
    urn: str
    name: str
    phase: Literal["primary", "secondary"]
    kind: Literal["state", "independent"]
    stage: Literal["primary", "secondary", "all-through"]
    latitude: float
    longitude: float
    ofsted: Literal["outstanding", "good", "requires-improvement", "inadequate", "report-card"] | None = None
    topPercent: Annotated[int | None, Field(ge=1, le=25)] = None
    selective: bool | None = None
    faith: str | None = None
    sixthForm: bool | None = None
    intake: str | None = None
    aLevelRank: Annotated[
        SchoolPointALevelRank | None,
        Field(
            description=(
                "The combined A-level rank (issue #201), present only for ranked sixth forms: London rank among state"
                " and independent sixth forms"
            )
        ),
    ] = None


class SchoolPointsResponse(Contract):
    schools: list[SchoolPoint]


class SchoolCombinedSixthFormRank(Contract):
    """The combined A-level rank (issue #201): the school's place among London's state and independent sixth forms"""

    measure: str | None = None
    measureId: Literal["ks5-alevel-aps"] | None = None
    year: str | None = None
    value: float | None = None
    cohortSize: int | None = None
    regionRank: int | None = None
    regionPool: int | None = None
    englandRank: int | None = None
    englandPool: int | None = None
    selectionNote: str | None = None
    line: Annotated[str | None, Field(examples=["#12 of 480 London sixth forms, state and independent, 2024/25"])] = (
        None
    )
    sourceRelease: str | None = None


class NationalRankYear(Contract):
    academicYear: str
    rank: int
    total: int
    topPercent: int
    value: float
    tiebreakValue: float | None = None
    rankedUrn: str | None = None
    sourceRelease: str


class SchoolNationalRank(Contract):
    rank: Annotated[int | None, Field(description="Rank in the latest year; null with missingReason when not ranked")]
    total: Annotated[int | None, Field(description="Schools in the England pool that year")]
    topPercent: Annotated[int | None, Field(ge=1, le=100)]
    year: Annotated[str, Field(description="Latest academic year ranked nationally, e.g. 2024/25")]
    measure: str
    measureId: Literal["ks2-rwm-expected", "ks4-attainment8"]
    value: float | None = None
    tiebreakValue: Annotated[float | None, Field(description="KS2 % at the higher standard")] = None
    rankedUrn: Annotated[str | None, Field(description="URN the figure was published under")] = None
    sourceRelease: str | None = None
    line: Annotated[str | None, Field(examples=["Ranked 1,234 of 15,057 primaries in England, 2024/25 (top 9%)"])]
    missingReason: str | None
    pool: str
    history: list[NationalRankYear]


class SchoolIntake(Contract):
    label: str | None = None
    mixedSixthForm: bool | None = None


class GiasTrust(Contract):
    name: str | None = None
    code: str | None = None


class SchoolGias(Contract):
    gender: Literal["Mixed", "Girls", "Boys"] | None = None
    trust: GiasTrust | None = None
    capacity: int | None = None
    pupils: int | None = None
    censusDate: str | None = None
    percentFull: Annotated[float | None, Field(description="100 × pupils ÷ capacity, same GIAS row")] = None
    laestab: Annotated[
        str | None, Field(description="GIAS LA code / EstablishmentNumber, 201/3614 (migration 099)")
    ] = None
    sourceRelease: str | None = None


class SchoolPupilsPerTeacher(Contract):
    value: float | None = None
    academicYear: str | None = None
    sourceRelease: str | None = None


class ProfileFigure(Contract):
    measure: str
    label: str
    value: float | None
    suppressed: bool
    academicYear: str
    sourceRelease: str | None = None


class SchoolProfile(Contract):
    """gias is null when not loaded. Each share (girlsPercent, boysPercent, fsm6Percent, ealPercent, senSupportPercent,
    ehcpPercent, overallAbsencePercent, persistentAbsencePercent) is null when the school has no row, else {measure,
    label, value (null when suppressed), suppressed, academicYear, sourceRelease}. pupilsPerTeacher: DfE's ratio from
    the school workforce census, null when not published. intake: GIAS gender as a label, "Girls · mixed sixth form"
    (or Boys …) when a single-sex school with a sixth form counts the other sex in the census; null without gias."""

    intake: SchoolIntake | None = None
    gias: SchoolGias | None = None
    girlsPercent: ProfileFigure | None = None
    boysPercent: ProfileFigure | None = None
    fsm6Percent: Annotated[
        ProfileFigure | None, Field(description="Free school meals at any time in the past 6 years")
    ] = None
    ealPercent: Annotated[ProfileFigure | None, Field(description="First language not English")] = None
    senSupportPercent: ProfileFigure | None = None
    ehcpPercent: ProfileFigure | None = None
    overallAbsencePercent: ProfileFigure | None = None
    persistentAbsencePercent: ProfileFigure | None = None
    pupilsPerTeacher: SchoolPupilsPerTeacher | None = None


class ParentViewNotApplicable(Contract):
    """The answer for parents the question does not apply to, as published; left out of headlinePercent"""

    option: Annotated[str, Field(examples=["Not applicable"])]
    percent: float


class ParentViewQuestion(Contract):
    id: Annotated[str, Field(examples=["Q1"])]
    question: str
    answers: Annotated[dict[str, float], Field(description="Option -> % as published")]
    headline: Literal["agree", "yes", "positive"]
    headlinePercent: Annotated[
        float | None, Field(description="Agree share of the parents the question applies to (notApplicable left out)")
    ]
    notApplicable: Annotated[
        ParentViewNotApplicable | None,
        Field(
            description=(
                "The answer for parents the question does not apply to, as published; left out of headlinePercent"
            )
        ),
    ] = None


class SchoolParentView(Contract):
    """Ofsted Parent View, school level, as Ofsted publishes it, from the newest survey the school has: surveyEra
    current (questions in use since 10 November 2025) or earlier (the questions before it; one academic year of
    submissions, the latest release with 10 or more). The two are never mixed or compared. happyPercent = Q1 strongly
    agree + agree; recommendPercent = the recommend question's Yes (Q10 current, Q14 earlier). Never shown as stars."""

    surveyEra: Literal["current", "earlier"]
    surveyLabel: Annotated[str, Field(examples=["Earlier survey (before Nov 2025)"])]
    responses: Annotated[int, Field(ge=10)]
    responseRate: Annotated[float | None, Field(description="Ofsted's estimate, % of pupils on roll")] = None
    question: Annotated[str | None, Field(description="Q1 text (agreePercent is its share)")] = None
    agreePercent: float | None = None
    happyPercent: float | None
    recommendPercent: float | None
    period: Annotated[str | None, Field(examples=["10 Nov 2025 to 6 Apr 2026"])] = None
    periodStart: Date
    asAt: Date
    survey: Literal["2025-11", "pre-2025-11"]
    line: Annotated[
        str | None, Field(examples=["95.9% say their child is happy · 122 responses, as at 6 Apr 2026"])
    ] = None
    definition: str | None = None
    sourceUrl: str | None = None
    sourceRelease: str
    questions: list[ParentViewQuestion]


class SchoolWorkforce(Contract):
    """School workforce census (FTE = full-time equivalent), figures as DfE printed them"""

    academicYear: str
    teachersFte: float | None = None
    teachingAssistantsFte: float | None = None
    leadershipFte: float | None = None
    supportStaffFte: float | None = None
    workforceFte: float | None = None
    workforceHeadcount: int | None = None
    teachersHeadcount: int | None = None
    pupilsFte: float | None = None
    pupilsPerTeacher: float | None = None
    pupilsPerAdult: Annotated[
        float | None,
        Field(
            description=(
                "DfE pupil-to-adult ratio: teachers, TAs, other school support staff and technicians; excludes"
                " administrative, auxiliary and business staff"
            )
        ),
    ] = None
    definitions: dict[str, str] | None = None
    sourceRelease: str


class FinanceIncomePerPupil(Contract):
    grants: int | None = None
    selfGenerated: int | None = None
    total: int | None = None


class FinanceSpendPerPupil(Contract):
    staff: int | None = None
    premises: int | None = None
    total: int | None = None


class FinanceTrust(Contract):
    kind: Literal["MAT", "SAT"] | None = None
    name: str | None = None
    companyNumber: str | None = None
    academies: int | None = None
    revenueReserve: Annotated[float | None, Field(description="MAT: central services + every academy")] = None
    note: str | None = None


class FinanceFederation(Contract):
    leadUrn: str | None = None
    isLead: bool | None = None
    note: str | None = None


class SchoolFinance(Contract):
    """One return: CFR (maintained, April–March) or AAR (academies, September–August), never both. Money in pounds as
    published (AAR rounded to £1,000). Per-pupil income and spend are null for a return of less than 12 months."""

    accounts: Literal["CFR", "AAR"]
    accountsLabel: str | None = None
    period: Annotated[str, Field(examples=["2025-26"])]
    periodLabel: Annotated[str, Field(examples=["April 2025 to March 2026"])]
    periodMonths: int | None = None
    partialYear: bool | None = None
    pupilsFte: float | None = None
    revenueReserve: float | None
    revenueReservePerPupil: int | None = None
    inDeficit: Annotated[bool | None, Field(description="Revenue reserve below 0")] = None
    inYearBalance: float | None
    totalIncome: float | None = None
    totalExpenditure: float | None = None
    incomePerPupil: FinanceIncomePerPupil | None = None
    spendPerPupil: FinanceSpendPerPupil | None = None
    missingReason: str | None = None
    trust: FinanceTrust | None = None
    federation: FinanceFederation | None = None
    perPupilDefinition: str | None = None
    notComparable: str | None = None
    sourceRelease: str


class SchoolDestinations(Contract):
    """Secondaries: ks4 / post16, null when not published for the school. Null for primaries."""

    ks4: SchoolDestination | None = None
    post16: SchoolDestination | None = None
    definition: str | None = None


class SchoolInspectionCounts(Contract):
    """Counted from the latest inspection that graded anything; never scored from the text"""

    framework: Literal["report-card", "legacy"] | None = None
    graded: int | None = None
    strengths: int | None = None
    weaknesses: int | None = None
    strengthAreas: list[str] | None = None
    weaknessAreas: list[str] | None = None
    safeguarding: str | None = None
    improvePoints: Annotated[int | None, Field(description="null when the report text is not held")] = None
    inspectionDate: str | None = None
    definition: str | None = None
    publicationDate: str | None = None
    reportUrl: str | None = None
    inspectedUrn: str | None = None
    inspectedAsPredecessor: Annotated[
        bool | None, Field(description="The grades are a predecessor school's (before conversion)")
    ] = None
    sourceRelease: str | None = None


class CompareLondon(Contract):
    p10: float
    median: float
    p90: float
    n: int


class CompareBorough(Contract):
    name: str
    median: float
    n: Annotated[int, Field(ge=10)]


class CompareMeasure(Contract):
    label: str
    unit: Literal["count", "percent", "ratio", "pounds"]
    value: float
    year: Annotated[str, Field(description="Academic year, census date, financial period or entry year")]
    london: CompareLondon
    borough: CompareBorough | None
    betterWhen: Literal["lower", "higher"] | None
    accounts: Annotated[Literal["CFR", "AAR"] | None, Field(description="Finance measures only")] = None
    accountsNote: str | None = None
    sourceRelease: str


class SchoolCompare(Contract):
    """Each figure against London state schools in Close Knit of the same phase and year (10th, 50th and 90th
    percentile, PostgreSQL percentile_cont) and the borough median when the borough has minBoroughSchools or more;
    finance only within the same accounts (CFR or AAR). A measure is null when the school has no published figure.
    Computed from the active release."""

    phase: Literal["primary", "secondary"]
    pool: str
    method: str
    minBoroughSchools: Annotated[int, Field(examples=[10])]
    measures: Annotated[
        dict[str, CompareMeasure | None],
        Field(
            description=(
                "Keys: pupils, fsm6Percent, ealPercent, senSupportPercent, ehcpPercent, overallAbsencePercent,"
                " persistentAbsencePercent, pupilsPerTeacher, pupilsPerAdult, incomePerPupil, spendPerPupil,"
                " staffSpendPerPupil, reservePerPupil, firstChoiceOfferedPercent."
            )
        ),
    ]


class SchoolWebsiteLink(Contract):
    href: str | None = None
    portal: str | None = None
    host: str | None = None


class SchoolAdmissionsLink(Contract):
    href: str | None = None
    portal: str | None = None
    via: Literal["website", "council"] | None = None


class SchoolPhoneLink(Contract):
    href: Annotated[str | None, Field(description="tel:+44…")] = None
    number: Annotated[str | None, Field(description="020 7123 4567")] = None


class SchoolCouncilAdmissionsLink(Contract):
    href: str | None = None
    portal: str | None = None
    council: Annotated[
        str | None, Field(description="The London council GOV.UK names, else null (GOV.UK asks for a postcode)")
    ] = None
    phase: Literal["primary", "secondary"] | None = None


class SchoolLinks(Contract):
    """Visit & links (migration 099, area_api/school_links.py). Every key is present. A link is {href, portal}: href is
    a counted click-out /go/school-<target>?urn=<urn>&from=web whose destination /go rebuilds from the URN and the
    database, null when its flag is off (goodSchoolsGuide: CLOSE_KNIT_SCHOOL_LINKS_GSG, locrating:
    CLOSE_KNIT_SCHOOL_LINKS_LOCRATING; FLAGS.md). website is null when GIAS lists none (admissions.via is then
    council: it opens the GOV.UK council page); phone is null without a published number and is a tel: link, not a
    click-out."""

    website: SchoolWebsiteLink | None
    admissions: SchoolAdmissionsLink
    phone: SchoolPhoneLink | None
    councilAdmissions: SchoolCouncilAdmissionsLink
    ofstedReport: SchoolLink
    dfePerformance: SchoolLink
    parentView: SchoolLink
    gias: SchoolLink
    eAdmissions: SchoolLink
    goodSchoolsGuide: SchoolLink
    locrating: SchoolLink


class SchoolAdmissions(Contract):
    demand: list[dict[str, Any]]
    lastOffered: Annotated[
        list[dict[str, Any]] | None, Field(description="Councils' last distance offered, where reuse is confirmed")
    ] = None
    byYear: Annotated[
        list[dict[str, Any]] | None,
        Field(
            description=(
                "Every entry year and entry point (newest first) with firstPreferences, secondPreferences,"
                " thirdPreferences, anyPreferences, offers, preferredOffers, firstPreferenceOffers,"
                " secondPreferenceOffers, thirdPreferenceOffers (null when not published) and"
                " firstChoiceNotOfferedPercent."
            )
        ),
    ] = None
    oversubscriptionDefinition: str | None = None


class SchoolDetails(Contract):
    localAuthority: str | None
    postcode: str | None
    sixthForm: str | None
    pupils: int | None
    predecessorUrn: str | None
    successorUrn: str | None


class SchoolKpiTrend(Contract):
    direction: Literal["up", "down", "flat"]
    deltaPoints: float
    fromYear: str


class SchoolKpi(Contract):
    measure: str
    label: str
    valueText: str
    value: float | str | None
    cohortSize: int | None
    percentile: float | None
    score10: float | None
    trend: SchoolKpiTrend | None
    year: str | None
    basis: str
    regionMedian: float | None
    scope: Annotated[str | None, Field(description="The region the percentile and median are within")] = None
    missingReason: str | None
    note: str | None = None


class SchoolTldr(Contract):
    strengths: list[str]
    improve: list[str]
    inspectionDate: str | None
    publicationDate: str | None
    reportUrl: str | None
    label: str
    inspectedAsPredecessor: bool
    inspectedUrn: str | None
    attribution: str


class SchoolPool(Contract):
    description: str
    minCohort: int


class SchoolMissing(Contract):
    measure: str
    reason: str


class SchoolCardSource(Contract):
    id: str
    licence: str | None
    attribution: str | None
    caveats: list[str]


class SchoolPercentile(Contract):
    academicYear: str
    percentile: float


class SchoolRegionMedian(Contract):
    academicYear: str
    value: float
    poolSize: int


class SchoolCardResponse(Contract):
    """school-card.v1: everything the school page shows, figures as published, compared within the school's region."""

    schemaVersion: Literal["school-card.v1"]
    productReleaseId: str
    urn: str
    areaId: Annotated[str | None, Field(description="The LSOA the school is in")]
    school: SchoolSummary
    details: SchoolDetails
    history: Annotated[
        dict[str, Any],
        Field(description="school-history.v1: {urn, measures (series per measure), inspections, demand, sources}"),
    ]
    percentiles: dict[str, list[SchoolPercentile]]
    regionMedian: dict[str, list[SchoolRegionMedian]]
    pool: SchoolPool
    rankScope: RankScope | None = None
    kpis: list[SchoolKpi]
    topBadge: SchoolTopBadge
    tldr: SchoolTldr | None
    missing: list[SchoolMissing]
    sources: list[SchoolCardSource]
    combinedSixthFormRank: Annotated[
        SchoolCombinedSixthFormRank | None,
        Field(
            description=(
                "The combined A-level rank (issue #201): the school's place among London's state and independent sixth"
                " forms"
            )
        ),
    ] = None
    nationalRank: SchoolNationalRank | None
    profile: Annotated[
        SchoolProfile,
        Field(
            description=(
                "gias is null when not loaded. Each share (girlsPercent, boysPercent, fsm6Percent, ealPercent,"
                " senSupportPercent, ehcpPercent, overallAbsencePercent, persistentAbsencePercent) is null when the"
                " school has no row, else {measure, label, value (null when suppressed), suppressed, academicYear,"
                " sourceRelease}. pupilsPerTeacher: DfE's ratio from the school workforce census, null when not"
                ' published. intake: GIAS gender as a label, "Girls · mixed sixth form" (or Boys …) when a single-sex'
                " school with a sixth form counts the other sex in the census; null without gias."
            )
        ),
    ]
    parentView: Annotated[
        SchoolParentView | None,
        Field(
            description=(
                "Ofsted Parent View, school level, as Ofsted publishes it, from the newest survey the school has:"
                " surveyEra current (questions in use since 10 November 2025) or earlier (the questions before it; one"
                " academic year of submissions, the latest release with 10 or more). The two are never mixed or"
                " compared. happyPercent = Q1 strongly agree + agree; recommendPercent = the recommend question's Yes"
                " (Q10 current, Q14 earlier). Never shown as stars."
            )
        ),
    ]
    workforce: Annotated[
        SchoolWorkforce | None,
        Field(description="School workforce census (FTE = full-time equivalent), figures as DfE printed them"),
    ]
    finance: Annotated[
        SchoolFinance | None,
        Field(
            description=(
                "One return: CFR (maintained, April–March) or AAR (academies, September–August), never both. Money in"
                " pounds as published (AAR rounded to £1,000). Per-pupil income and spend are null for a return of less"
                " than 12 months."
            )
        ),
    ]
    destinations: Annotated[
        SchoolDestinations | None,
        Field(description="Secondaries: ks4 / post16, null when not published for the school. Null for primaries."),
    ]
    inspectionCounts: Annotated[
        SchoolInspectionCounts | None,
        Field(description="Counted from the latest inspection that graded anything; never scored from the text"),
    ]
    compare: Annotated[
        SchoolCompare | None,
        Field(
            description=(
                "Each figure against London state schools in Close Knit of the same phase and year (10th, 50th and 90th"
                " percentile, PostgreSQL percentile_cont) and the borough median when the borough has minBoroughSchools"
                " or more; finance only within the same accounts (CFR or AAR). A measure is null when the school has no"
                " published figure. Computed from the active release."
            )
        ),
    ] = None
    links: Annotated[
        SchoolLinks,
        Field(
            description=(
                "Visit & links (migration 099, area_api/school_links.py). Every key is present. A link is {href,"
                " portal}: href is a counted click-out /go/school-<target>?urn=<urn>&from=web whose destination /go"
                " rebuilds from the URN and the database, null when its flag is off (goodSchoolsGuide:"
                " CLOSE_KNIT_SCHOOL_LINKS_GSG, locrating: CLOSE_KNIT_SCHOOL_LINKS_LOCRATING; FLAGS.md). website is null"
                " when GIAS lists none (admissions.via is then council: it opens the GOV.UK council page); phone is"
                " null without a published number and is a tel: link, not a click-out."
            )
        ),
    ]
    admissions: SchoolAdmissions


class AreaSchoolsResponse(Contract):
    schemaVersion: Literal["area-schools.v1"]
    productReleaseId: Annotated[str, Field(description="Absent from older answers")] = None
    radiusMetres: int | None = None
    geographyId: GeographyId
    schools: list[SchoolSummary]


class TypicalPrice(Contract):
    """The middle price of one type of home sold in an area since `since`, adjusted to `adjustedTo` and rounded to
    £5,000: about the area's sales, never one home."""

    propertyType: Literal["all", "flat", "terraced", "semi", "detached"]
    price: int
    sales: int
    geographyId: GeographyId
    carrier: Carrier
    since: Period
    adjustedTo: Period


class AreaRank(Contract):
    """One regional rank (migration 054): `percentile` 0-100 is the raw value's percent rank among the region's LSOAs,
    lowest value = 0; for bestPrimary it is that school's rank among the region's primaries."""

    percentile: int
    higherIsBetter: bool
    value: Annotated[float, Field(description="The raw value ranked")]
    unit: Literal["minutes", "share", "metres", "percent", "points"]
    ranked: Annotated[int, Field(description="How many LSOAs (or primaries) were ranked")]
    sourceReleaseId: str | None


class RankedSchool(Contract):
    urn: str
    name: str | None
    distanceMetres: float | None
    academicYear: str | None


class SchoolRank(AreaRank):
    school: Annotated[RankedSchool, Field(description="The best state school within 1 km, which the rank describes")]


class RankSource(Contract):
    id: str
    licence: str
    attribution: str
    url: str | None = None


class AreaRanks(Contract):
    """Ranks for the Overview ratings; a null rank shows "No rating", never a guess."""

    scope: Literal["london-lsoa"]
    gettingAround: Annotated[AreaRank | None, Field(description="Median walk to a station (lower is better)")]
    quiet: Annotated[AreaRank | None, Field(description="Share of homes at 55 dB Lden or more (lower is better)")]
    greenSpace: Annotated[AreaRank | None, Field(description="Distance to the nearest park (lower is better)")]
    bestPrimary: SchoolRank | None
    bestSecondary: Annotated[
        SchoolRank | None, Field(description="The best state secondary within 1 km by its rank on Attainment 8")
    ] = None
    sources: list[RankSource]


class ProfileSchools(Contract):
    primary: int
    secondary: int
    radiusMetres: Literal[1000]


class ProfileNoise(Contract):
    available: bool
    any55Share: float | None


class AreaProfileResponse(Contract):
    schemaVersion: Literal["area-profile.v1"]
    geographyId: GeographyId
    name: str | None
    friendlyName: str | None = None
    postcodeDistrict: str | None = None
    displayName: str | None = None
    rankScope: RankScope | None = None
    metrics: Annotated[list[AreaSummary], Field(description="Each metric with a value; absent otherwise, never 0")]
    schools: Annotated[
        ProfileSchools | None, Field(description="State schools within radiusMetres by phase; null when unknown")
    ]
    noise: Annotated[ProfileNoise | None, Field(description="Share of homes at 55 dB Lden or more; null when unknown")]
    regionRanks: Annotated[
        AreaRanks | None, Field(description="Regional ranks (migration 054); null for MSOAs, boroughs and when unknown")
    ] = None
    typicalPrices: Annotated[
        list[TypicalPrice] | None,
        Field(
            description=(
                "Typical (median) price of each type of home in the area today, from the area price bands (migration"
                " 040): each type from the first of the area's own level and its wider ones with 20 sales, else the"
                " largest with 5; left out below that. Rounded to £5,000. About the area's sales, never one home."
            )
        ),
    ] = None


class AreaMarketByTypeResponse(Contract):
    schemaVersion: Literal["area-market-by-type.v1"]
    geographyId: GeographyId
    available: bool
    byType: list[Any]
    trend: list[Any]


class AreaStandoutsResponse(Contract):
    schemaVersion: Literal["area-standouts.v1"]
    geographyId: GeographyId
    verdict: str
    tags: Annotated[list[Any], Field(max_length=5)]
    tiles: Annotated[list[Any], Field(max_length=12, min_length=12)]


class AreaLayersResponse(Contract):
    schemaVersion: Literal["area-layers.v1"]
    areaId: GeographyId
    scope: Literal["all", "overview"]
    layers: list[Any]
    presets: Annotated[list[Any], Field(max_length=3)]
    chips: Annotated[list[Any], Field(max_length=3, min_length=3)]
    withheld: list[str]


class AreaSafetyResponse(Contract):
    schemaVersion: Literal["area-safety.v1"]
    geographyId: GeographyId
    available: bool
    types: Annotated[list[Any], Field(max_length=5)]


class AreaRecentSalesResponse(Contract):
    schemaVersion: Literal["area-recent-sales.v1"]
    total: int
    sales: list[Any]
    coverage: Annotated[
        Literal["london-only"] | None,
        Field(description="Why there is nothing here: per-home data is London's alone and this is elsewhere; null inside it"),
    ] = None


class AreaSinceResponse(Contract):
    schemaVersion: Literal["area-since.v1"]
    newSales: int
    newestSale: str | None
    pricePerSquareMetre: dict[str, Any]


class AreaNatureResponse(Contract):
    schemaVersion: Literal["area-nature.v1"]
    geographyId: GeographyId
    available: bool
    green: dict[str, Any] | None
    trees: dict[str, Any] | None
    site: dict[str, Any] | None
    score: dict[str, Any] | None
    home: dict[str, Any] | None
    wildlife: dict[str, Any] | None
    sources: list[Any]


class AreaPeopleResponse(Contract):
    schemaVersion: Literal["area-people.v1"]
    geographyId: GeographyId
    name: str | None
    population: dict[str, Any] | None
    censusYear: Literal[2021]
    topics: list[dict[str, Any]]
    sources: list[Any]


class AreaMarketResponse(EvidenceEnvelope):
    value: AreaMarket


class AgentToolArguments(Contract):
    """The tool's arguments object (see inputSchema)"""


class HierarchyRegion(Contract):
    """With ?region=: the region kept"""

    code: str | None = None
    name: str | None = None


class HierarchyArea(Contract):
    geographyId: GeographyId
    name: str
    carrier: Carrier
    parentId: str | None
    regionCode: Annotated[
        str | None,
        Field(
            description="The area's English region (area_region, migration 103); its percentiles rank within it",
            pattern="^E1200000[1-9]$",
        ),
    ] = None
    friendlyName: Annotated[
        str | None,
        Field(description="House of Commons Library name of the area's MSOA (a borough: its name); null when unknown"),
    ] = None
    displayName: Annotated[
        str | None,
        Field(description='The name to show: the friendly title ("Alperton East · HA0"), else the official name'),
    ] = None
    postcodeDistrict: Annotated[
        str | None, Field(description="Postcode district holding most of the area's live postcodes, e.g. NW10")
    ] = None
    schools: dict[str, Any] | None


class AreaHierarchyResponse(Contract):
    schemaVersion: Literal["area-hierarchy.v1"]
    productReleaseId: str
    region: Annotated[HierarchyRegion | None, Field(description="With ?region=: the region kept")] = None
    areas: list[HierarchyArea]


class AreaTrailResponse(Contract):
    schemaVersion: Literal["area-hierarchy.v1"]
    productReleaseId: str
    region: HierarchyRegion | None = None
    areas: list[dict[str, Any]]


class PropertyResponse(Contract):
    schemaVersion: Literal["property.v2"]
    productReleaseId: str
    sources: Annotated[
        list[SourceRelease] | None,
        Field(
            description=(
                "Publisher, licence and attribution text of the active sources behind the home (HM Land Registry, OS"
                " Open UPRN, EPC register); display the attribution with the data"
            )
        ),
    ] = None
    property: PropertySummary


class AreaPricesRange(Contract):
    level: Literal["lsoa", "msoa", "borough"] | None = None
    areaId: GeographyId | None = None
    areaName: str | None = None
    sales: Annotated[int | None, Field(ge=5)] = None
    since: Annotated[str | None, Field(description="YYYY-MM, first month of the window")] = None
    adjustedTo: Annotated[str | None, Field(description="YYYY-MM, the index month every sale is adjusted to")] = None
    p10: int | None = None
    p25: int | None = None
    p50: int | None = None
    p75: int | None = None
    p90: int | None = None


class AreaPrices(Contract):
    """Prices in a home's area today, for its Price Paid type. Area statistics only: never a figure for the home. range
    and position are null below 5 sales (note says so); position is a coarse band, never a percentile. Amounts are
    rounded to £5,000."""

    propertyType: str | None
    minimumSales: Literal[5]
    range: AreaPricesRange | None
    position: AreaPricesPosition | None
    note: str | None
    disclaimer: str


class AddressHistoryResponse(Contract):
    schemaVersion: Literal["address-history.v1"]
    history: AddressHistory
    sources: Annotated[
        list[SourceRelease] | None,
        Field(
            description=(
                "Publisher, licence and attribution text of the active sources behind the home (HM Land Registry, OS"
                " Open UPRN, EPC register); display the attribution with the data"
            )
        ),
    ] = None


class PackNearbySales(Contract):
    """Aggregates of nearby-sales.v1 without sale rows"""

    addressId: Annotated[str, Field(pattern="^uk:addr:[0-9a-f]{12}$")]
    windowYears: int
    building: NearbySaleSummary | None
    street: NearbySaleSummary | None
    disclaimer: str


class AreaEvidencePack(Contract):
    schemaVersion: Literal["area-evidence-pack.v1"]
    productReleaseId: str
    geographyId: GeographyId
    name: str
    carrier: Carrier
    market: MarketSection
    crime: PackCrime | None
    noise: PackNoise
    schools: PackSchools
    nearbySales: PackNearbySales | None
    sources: list[SourceRelease]
    caveats: list[str]


class PreferenceProfile(Contract):
    schemaVersion: Literal["preference-profile.v1"]
    market: Literal["buy", "rent"]
    targetBudget: Annotated[float, Field(gt=0.0)]
    maximumBudget: Annotated[float, Field(gt=0.0)]
    bedrooms: Annotated[int, Field(ge=0, le=8)]
    forecastHorizon: Literal["1y", "5y"]
    factors: list[FactorPreference]
    commuteDestinations: list[CommuteDestination]
    school: ProfileSchool
    analyticsConsent: bool
    zones: Annotated[
        list[StationZone | BoroughZone | LsoasZone | PolygonZone] | None,
        Field(
            description=(
                "Optional places to live (omitted when empty). Areas outside every zone carry the relaxable unmet limit"
                " zone:outside; membership only breaks ties between equal scores. Station walks are stored up to 20"
                " minutes."
            ),
            max_length=3,
        ),
    ] = None


class WhereCriterion(Contract):
    """Where: fit 1 inside any zone, falling linearly to 0 at softMetres outside (distance from the area's
    point to the nearest area inside); must = only inside (unmet limit zone:outside)."""

    kind: Literal["where"]
    zones: Annotated[list[StationZone | BoroughZone | LsoasZone | PolygonZone], Field(max_length=3, min_length=1)]
    softMetres: Annotated[int | None, Field(ge=100, le=5000)] = 1000
    must: bool | None = False


class PropertyProfile(Contract):
    addressId: Annotated[
        str | None, Field(description="Null for a home known only from its energy certificate (addressSource epc).")
    ]
    addressSource: Annotated[
        Literal["epc"] | None,
        Field(
            description=(
                "Present only on a home known only from its energy certificate (no recorded sale): its address is the"
                " certificate's. Such homes exist only while CLOSE_KNIT_EPC_ADDRESSES is on (epcAddresses not"
                " withheld); otherwise their profile is 404."
            )
        ),
    ] = None
    withheld: Annotated[
        list[str],
        Field(
            description=(
                "The home features whose flags are off (FLAGS.md): epc, pricePerSqm, valuation, epcAddresses,"
                " councilTaxBand, laeiAir. A withheld feature's keys stay, with null values; clients render their"
                " fallback from this list, never from nulls."
            )
        ),
    ]
    facts: Annotated[
        HomeFacts,
        Field(
            description=(
                "Type and tenure (last Price Paid record) and certificate facts (latest EPC; null while epc is"
                " withheld)."
            )
        ),
    ]
    areaPrices: AreaPrices
    flood: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                "The home's own Environment Agency bands {riversSea, surfaceWater} (very-low, low, medium, high), or"
                " null with no dwelling_flood row. Each otherHomes entry carries its own flood the same way."
            )
        ),
    ] = None
    valuation: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                "An indicative model estimate, not a valuation. Null, with valuation in withheld, unless"
                " CLOSE_KNIT_PER_HOME_VALUATION is on. {value, low, high (GBP, 5k steps), method: floor-area |"
                " indexed-sale, vsLocalMedianPerSqm (% | null), vsLocalTypeMedian (%)}."
            )
        ),
    ]
    salesSummary: Annotated[
        dict[str, Any],
        Field(
            description=(
                "changeSinceLastSale: {home (% a year between the last two standard recorded sales | null), borough"
                " (the borough same-type median trend over the same span, or from a single sale to the newest trend"
                " year | null), since (year), until (year | null)} | null. Standard sales (category A) only. Never a"
                " figure for the home today."
            )
        ),
    ]
    sales: list[HomeSale]


class PropertyProfileResponse(Contract):
    schemaVersion: Literal["property-profile.v2"]
    productReleaseId: str
    sources: Annotated[
        list[SourceRelease] | None,
        Field(
            description=(
                "Publisher, licence and attribution text of the active sources behind the home (HM Land Registry, OS"
                " Open UPRN, EPC register); display the attribution with the data"
            )
        ),
    ] = None
    profile: PropertyProfile


class ListingCardRequest(Contract):
    v: Literal[1] | None = None
    portal: Literal["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"]
    listingId: Annotated[str, Field(max_length=40)]
    url: Annotated[str, Field(max_length=500)]
    address: Annotated[str | None, Field(max_length=200)] = None
    lat: float | None = None
    lng: float | None = None
    postcode: str | None = None
    market: Literal["buy", "rent"] | None = None
    askingPrice: int | None = None
    bedrooms: int | None = None
    floorAreaSqm: float | None = None
    tenure: Literal["freehold", "leasehold", "share-of-freehold", "unknown"] | None = None
    locationApproximate: Annotated[
        bool | None, Field(description="The page gives only an approximate point; the card skips the price check.")
    ] = None
    profile: PreferenceProfile | None = None


class ListingBadgesRequest(Contract):
    v: Literal[1] | None = None
    portal: Literal["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"]
    items: Annotated[list[ListingBadgeRequestItem], Field(max_length=30)]
    profile: PreferenceProfile | None = None


class AreaEvidencePackResponse(EvidenceEnvelope):
    value: AreaEvidencePack


class PreferenceProfileV2(Contract):
    """My match: the household's criteria as ONE ordered list, most important first. Weights come
    from the order (rank-order centroid over the criteria that are not Must); a Must criterion is a filter with no
    weight and no soft edge. Read and written by web/src/lib/match-model.ts and api/area_api/match_model.py; links
    carry it as #profile=v3."""

    schemaVersion: Literal["preference-profile.v2"]
    market: Literal["buy", "rent"]
    targetBudget: Annotated[float, Field(description="Budget range end: fit 1 at or under it", gt=0.0)]
    maximumBudget: Annotated[
        float,
        Field(
            description="Budget soft edge end: fit 0 at or over it; a Must budget keeps areas at or under it", gt=0.0
        ),
    ]
    bedrooms: Annotated[int | None, Field(ge=0, le=8)] = None
    propertyType: Literal["house", "flat", "any"] | None = None
    houseTypes: list[Literal["terraced", "semi", "detached"]] | None = None
    analyticsConsent: Annotated[
        bool | None,
        Field(
            description=(
                "The household agreed to a redacted usage record of this search (privacy.analytics_event); absent = no"
            )
        ),
    ] = None
    criteria: Annotated[
        list[BudgetCriterion | RangeCriterion | PlaceCriterion | WhereCriterion | CustomCriterion],
        Field(
            description="Ordered, top = most important; at most one budget and one where criterion, ids unique.",
            max_length=20,
        ),
    ]
    marks: AreaMarks | None = None


MatchRequest = TypeAliasType("MatchRequest", PreferenceProfileV2 | PreferenceProfile)


class ScopeRegion(Contract):
    id: Annotated[str, Field(examples=["uk:region:E12000007"])]
    code: str
    name: str


class ScopeResponse(Contract):
    """The places this channel serves (scope.v1)."""

    schemaVersion: Literal["scope.v1"]
    id: Annotated[str, Field(examples=["uk:region:E12000007", "uk:nation:E92000001"])]
    level: Literal["region", "nation"]
    name: str
    served: list[ScopeRegion]
    bbox: Annotated[tuple[float, float, float, float], Field(description="[west, south, east, north]")]
    outsideReason: Literal["outside-london", "outside-coverage"]


class CoverageRegion(Contract):
    id: str
    name: str | None
    bbox: tuple[float, float, float, float]


class CoverageChunk(Contract):
    id: Annotated[str, Field(description="A region code (London, loaded whole) or a LAD code")]
    region: str
    bbox: tuple[float, float, float, float]
    areas: Annotated[int, Field(description="LSOAs in the chunk")]


class AreaTiles(Contract):
    """The area boundaries: one static PMTiles archive per kind once built, else the API's tile URL template."""

    release: str
    minzoom: int
    maxzoom: int
    url: Annotated[str, Field(examples=["/tiles/areas-<release>-{kind}.pmtiles"])]


class MapCoverageResponse(Contract):
    """map-coverage.v1: with CLOSE_KNIT_ENGLAND on, England's bounds, every region with loaded areas and the chunks
    (London whole, every other LAD on its own); off, London's bounds and no regions or chunks."""

    schemaVersion: Literal["map-coverage.v1"]
    coverage: Literal["england", "london"]
    productReleaseId: str | None
    bounds: Annotated[
        tuple[tuple[float, float], tuple[float, float]], Field(description="[[west, south], [east, north]]")
    ]
    regions: list[CoverageRegion]
    chunks: list[CoverageChunk]
    areaTiles: Annotated[AreaTiles | None, Field(description="Absent before migration 116")] = None


class MetricValuesResponse(Contract):
    """Every area's value for each month asked, numbers only, in the order of the metric's value packs."""

    schemaVersion: Literal["metric-values.v1"]
    metricId: str
    productReleaseId: str
    values: Annotated[dict[str, list[float | None]], Field(description="YYYY-MM -> one value per area")]


AreaBox = TypeAliasType("AreaBox", tuple[str, float, float, float, float])


class AreaBoxesResponse(Contract):
    """The box index of a map chunk: each area's [geographyId, west, south, east, north] at four decimals."""

    schemaVersion: Literal["area-boxes.v1"]
    carrier: Carrier
    productReleaseId: str
    chunk: str | None = None
    areas: list[AreaBox]
