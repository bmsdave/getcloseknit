package org.closeknit.london

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Carrier(val wireValue: String) {
    @SerialName("lsoa") LSOA("lsoa"),
    @SerialName("msoa") MSOA("msoa"),
    // A local authority district: answers say lad since step R1 (docs/architecture/global-geography.md).
    @SerialName("lad") LAD("lad"),
    // What answers said before step R1.
    @SerialName("borough") BOROUGH("borough"),
    ;

    // The id segment: a LAD's id is uk:lad: since step R2 (uk:borough: before; the API still reads the old one).
    val idSegment: String get() = if (this == BOROUGH) "lad" else wireValue
}

@Serializable
enum class MetricId {
    @SerialName("price-per-square-metre") PRICE_PER_SQUARE_METRE,
    @SerialName("crime") CRIME,
    @SerialName("deprivation") DEPRIVATION,
    @SerialName("income") INCOME,
    @SerialName("social-renting") SOCIAL_RENTING,
    @SerialName("stock-value-per-square-metre") STOCK_VALUE_PER_SQUARE_METRE,
    @SerialName("station-access") STATION_ACCESS,
    @SerialName("food-hygiene") FOOD_HYGIENE,
}

@Serializable
enum class MapLayerId {
    @SerialName("price-per-square-metre") PRICE_PER_SQUARE_METRE,
    @SerialName("crime") CRIME,
    @SerialName("deprivation") DEPRIVATION,
    @SerialName("income") INCOME,
    @SerialName("social-renting") SOCIAL_RENTING,
    @SerialName("personal-match") PERSONAL_MATCH,
    @SerialName("stock-value-per-square-metre") STOCK_VALUE_PER_SQUARE_METRE,
    @SerialName("station-access") STATION_ACCESS,
    @SerialName("food-hygiene") FOOD_HYGIENE;

    companion object {
        fun fromMetric(metric: MetricId) = valueOf(metric.name)
    }
}

@Serializable
enum class FactorId {
    @SerialName("affordability") AFFORDABILITY,
    @SerialName("market-level") MARKET_LEVEL,
    @SerialName("growth-outlook") GROWTH_OUTLOOK,
    @SerialName("crime") CRIME,
    @SerialName("deprivation") DEPRIVATION,
    @SerialName("income") INCOME,
    @SerialName("social-renting") SOCIAL_RENTING,
    @SerialName("commute") COMMUTE,
    @SerialName("schools") SCHOOLS,
    @SerialName("station-access") STATION_ACCESS,
}

@Serializable
enum class PreferenceDirection {
    @SerialName("higher") HIGHER,
    @SerialName("lower") LOWER,
    @SerialName("target-range") TARGET_RANGE,
}

@Serializable
data class FactorPreference(
    val factorId: FactorId,
    val weight: Int,
    val direction: PreferenceDirection,
    val minimumUtility: Double?,
    val maximumUtility: Double?,
)

@Serializable
data class FactorDefinition(
    val id: FactorId,
    val label: String,
    val unit: String,
    val allowedDirections: List<PreferenceDirection>,
    val defaultDirection: PreferenceDirection,
    val carrierPolicy: String,
    val utilityDefinition: String,
    val periods: List<String>,
    val scoringEligibility: String,
    val caveats: List<String>,
)

@Serializable
data class CommuteDestination(
    val id: String,
    val label: String,
    val latitude: Double,
    val longitude: Double,
    val mode: String,
    val arrivalTime: String,
    val targetMinutes: Int,
    val weight: Int,
)

@Serializable
data class SchoolPreference(
    val phases: List<String>,
    val characteristics: List<String> = emptyList(),
    val facetWeights: Map<String, Int> = emptyMap(),
    val shortlistUrns: List<String>,
    val desiredSchoolCount: Int,
)

@Serializable
data class PreferenceProfile(
    val schemaVersion: String,
    val market: String,
    val targetBudget: Double,
    val maximumBudget: Double,
    val bedrooms: Int,
    val forecastHorizon: String,
    val factors: List<FactorPreference>,
    val commuteDestinations: List<CommuteDestination>,
    val school: SchoolPreference,
    val analyticsConsent: Boolean,
    /** Optional (omitted when empty): at most three zones; areas outside them carry "zone:outside". */
    val zones: List<MatchZone> = emptyList(),
)

/** One zone: kind station (stationId, maxWalkMinutes), borough (id) or lsoas (ids). */
@Serializable
data class MatchZone(
    val kind: String,
    val stationId: String? = null,
    val maxWalkMinutes: Int? = null,
    val id: String? = null,
    val ids: List<String>? = null,
    val label: String? = null,
)

@Serializable
enum class Quality {
    @SerialName("observed") OBSERVED,
    @SerialName("fallback") FALLBACK,
    @SerialName("suppressed") SUPPRESSED,
}

@Serializable
enum class MetricDirection {
    @SerialName("higher-is-more") HIGHER_IS_MORE,
    @SerialName("higher-is-better") HIGHER_IS_BETTER,
    @SerialName("neutral") NEUTRAL,
}

@Serializable
@JvmInline
value class GeographyId(val value: String) {
    constructor(carrier: Carrier, officialCode: String) : this(
        "uk:${carrier.idSegment}:${validateCode(officialCode)}",
    )

    init {
        require(value.matches(Regex("^uk:(lsoa|msoa|lad|borough):E[0-9]{8}$"))) {
            "invalid geography ID"
        }
    }

    companion object {
        private fun validateCode(code: String): String {
            require(code.matches(Regex("^E[0-9]{8}$"))) { "invalid official geography code" }
            return code
        }
    }
}

class MapState(
    val latitude: Double = 51.5074,
    val longitude: Double = -0.1278,
    val zoom: Double = 11.0,
    pitch: Double = 45.0,
    val bearing: Double = -12.0,
    val layer: MapLayerId = MapLayerId.PRICE_PER_SQUARE_METRE,
    val period: String = "2026-06",
    val selected: GeographyId? = null,
) {
    val pitch = pitch.coerceIn(0.0, 60.0)
}

@Serializable
data class MetricDefinition(
    val id: MetricId,
    val label: String,
    val shortLabel: String,
    val description: String,
    val carrier: Carrier,
    val unit: String,
    val direction: MetricDirection,
    val periods: List<String>,
    val defaultPeriod: String,
    val legend: List<LegendStop>,
    val provenance: Provenance,
    val freshness: String,
    val methodologyPath: String,
    val caveats: List<String>,
)

@Serializable
data class MetricCollection(
    val schemaVersion: String,
    val productReleaseId: String? = null,
    val metrics: List<MetricDefinition>,
)

@Serializable
data class LegendStop(val value: Double, val colour: String, val label: String)

@Serializable
data class Provenance(
    val sourceId: String,
    val sourceName: String,
    val sourceUrl: String,
    val release: String,
    val checksum: String,
    val licence: String,
    val attribution: String,
    val transformationVersion: String,
)

@Serializable
data class AreaSummary(
    val geographyId: GeographyId,
    val name: String? = null,
    val metricId: MetricId,
    val period: String,
    val value: Double? = null,
    val londonPercentile: Int? = null,
    val englandPercentile: Int? = null,
    val sampleCount: Int? = null,
    val breakdown: Map<String, Double>? = null,
    val quality: Quality,
    val sourceVersion: String,
    val carrier: Carrier,
)

@Serializable
data class AreaResponse(
    val schemaVersion: String,
    val productReleaseId: String? = null,
    val summary: AreaSummary,
    val parentId: GeographyId? = null,
    val priceTimeline: List<AreaSummary> = emptyList(),
    val metricTimeline: List<AreaSummary> = emptyList(),
)

@Serializable
data class PropertyHistoryResponse(
    val schemaVersion: String,
    val history: PropertyHistory,
)

@Serializable
data class SchoolSummaryResponse(
    val schemaVersion: String,
    val school: SchoolSummary,
)

enum class DataMode {
    DEMO,
    REAL,
}

/** Documented metric carrier policy shared with the web fixtures. */
fun carrierForMetric(metric: MetricId): Carrier = when (metric) {
    MetricId.INCOME -> Carrier.MSOA
    else -> Carrier.LSOA
}

/** Minimum native status line: mode, carrier, and unavailable evidence. */
fun evidenceStatusText(mode: DataMode, carrier: Carrier, quality: Quality): String {
    val modeLabel = if (mode == DataMode.DEMO) "Demo data · not for decisions" else "Real data pilot"
    val availability = when (quality) {
        Quality.OBSERVED -> "Observed"
        Quality.FALLBACK -> "Fallback carrier"
        Quality.SUPPRESSED -> "Not published"
    }
    return "$modeLabel · ${carrier.wireValue.uppercase()} · $availability"
}

@Serializable
data class PropertyTransaction(
    val date: String,
    val nominalPrice: Int,
    val floorAreaSquareMetres: Double? = null,
    val pricePerSquareMetre: Double? = null,
    val inflationAdjustedPrice: Int,
    val localMarketAdjustedPrice: Int? = null,
)

@Serializable
data class PropertyHistory(
    val uprn: String,
    val address: String,
    val geographyId: GeographyId,
    val transactions: List<PropertyTransaction>,
    val estimateDisclaimer: String,
    val sourceVersion: String,
)

@Serializable
data class ValuePack(
    val schemaVersion: String,
    val metricId: MetricId,
    val period: String,
    val sourceVersion: String,
    val productReleaseId: String? = null,
    val values: List<AreaSummary>,
)

@Serializable
data class MatchComponent(
    val factorId: FactorId,
    val rawValue: Double,
    val unit: String,
    val utility: Double,
    val weight: Double,
    val contribution: Double,
    val carrierGeographyId: GeographyId,
    val quality: Quality,
    val sourceVersion: String,
)

@Serializable
data class MatchResult(
    val geographyId: GeographyId,
    val name: String,
    val score: Double? = null,
    val rank: Int? = null,
    val evidenceCompleteness: Double,
    val excluded: Boolean,
    val unmetLimits: List<String>,
    val sourceReleaseSet: String,
    val components: List<MatchComponent>,
    /** Present only when the profile has zones. */
    val inZone: Boolean? = null,
)

@Serializable
data class MatchPack(
    val schemaVersion: String,
    val profileVersion: String,
    val sourceReleaseSet: String,
    val values: List<MatchResult>,
)

@Serializable
data class ForecastRange(val p10: Double, val p20: Double, val p50: Double, val p90: Double)

@Serializable
data class ForecastScenarios(val downside: Double, val base: Double, val upside: Double)

@Serializable
data class ForecastBacktest(val model: String, val meanAbsoluteError: Double, val intervalCoverage: Double)

@Serializable
data class PriceForecast(
    val schemaVersion: String,
    val geographyId: GeographyId,
    val carrierGeographyId: GeographyId,
    val horizon: String,
    val status: String,
    val range: ForecastRange? = null,
    val scenarios: ForecastScenarios? = null,
    val backtest: ForecastBacktest? = null,
    val suppressionReason: String? = null,
    val sourceVersion: String,
)

@Serializable
data class AdmissionCutoff(val academicYear: String, val distanceMetres: Double, val sourceUrl: String)

@Serializable
data class AdmissionEvidence(
    val kind: String,
    val academicYears: List<String>,
    val yearsWithin: Int? = null,
    val measurementMethod: String? = null,
    val sourceUrls: List<String>,
    val cutoffs: List<AdmissionCutoff>,
    val isProbability: Boolean,
)

@Serializable
data class SchoolSummary(
    val schoolId: String,
    val urn: String,
    val name: String,
    val phase: String,
    val type: String,
    val ageRange: AgeRange,
    val gender: String,
    val faith: String? = null,
    val selectivity: String,
    val capacity: Int? = null,
    val senProvision: List<String>,
    val latitude: Double,
    val longitude: Double,
    val journeyMinutes: Int? = null,
    val qualityFacets: Map<String, Double?>,
    val inspectionFramework: String,
    val parentViewResponses: Int? = null,
    val admissionEvidence: AdmissionEvidence,
    val sourceVersion: String,
)

@Serializable
data class AgeRange(val from: Int, val to: Int)
