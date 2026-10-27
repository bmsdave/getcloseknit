import Foundation

public enum Carrier: String, Codable, CaseIterable, Sendable {
    case lsoa
    case msoa
    /// A local authority district: answers say lad since step R1 (docs/architecture/global-geography.md).
    case lad
    /// What answers said before step R1.
    case borough

    /// The id segment: a LAD's id is uk:lad: since step R2 (uk:borough: before; the API still reads the old one).
    public var idSegment: String { self == .borough ? "lad" : rawValue }
}

public enum MetricID: String, Codable, CaseIterable, Sendable {
    case pricePerSquareMetre = "price-per-square-metre"
    case crime
    case deprivation
    case income
    case socialRenting = "social-renting"
    case stockValuePerSquareMetre = "stock-value-per-square-metre"
    case stationAccess = "station-access"
    case foodHygiene = "food-hygiene"
}

public enum MapLayerID: String, Codable, CaseIterable, Sendable {
    case pricePerSquareMetre = "price-per-square-metre"
    case crime
    case deprivation
    case income
    case socialRenting = "social-renting"
    case personalMatch = "personal-match"
    case stockValuePerSquareMetre = "stock-value-per-square-metre"
    case stationAccess = "station-access"
    case foodHygiene = "food-hygiene"
}

public enum FactorID: String, Codable, CaseIterable, Sendable {
    case affordability
    case marketLevel = "market-level"
    case growthOutlook = "growth-outlook"
    case crime
    case deprivation
    case income
    case socialRenting = "social-renting"
    case commute
    case schools
    case stationAccess = "station-access"
}

public enum PreferenceDirection: String, Codable, Sendable {
    case higher
    case lower
    case targetRange = "target-range"
}

public struct FactorPreference: Codable, Sendable {
    public let factorId: FactorID
    public let weight: Int
    public let direction: PreferenceDirection
    public let minimumUtility: Double?
    public let maximumUtility: Double?
}

public struct FactorDefinition: Codable, Identifiable, Sendable {
    public let id: FactorID
    public let label: String
    public let unit: String
    public let allowedDirections: [PreferenceDirection]
    public let defaultDirection: PreferenceDirection
    public let carrierPolicy: String
    public let utilityDefinition: String
    public let periods: [String]
    public let scoringEligibility: String
    public let caveats: [String]
}

public struct CommuteDestination: Codable, Sendable {
    public let id: String
    public let label: String
    public let latitude: Double
    public let longitude: Double
    public let mode: String
    public let arrivalTime: String
    public let targetMinutes: Int
    public let weight: Int
}

public struct SchoolPreference: Codable, Sendable {
    public let phases: [String]
    public let characteristics: [String]?
    public let facetWeights: [String: Int]?
    public let shortlistUrns: [String]
    public let desiredSchoolCount: Int
}

public struct PreferenceProfile: Codable, Sendable {
    public let schemaVersion: String
    public let market: String
    public let targetBudget: Double
    public let maximumBudget: Double
    public let bedrooms: Int
    public let forecastHorizon: String
    public let factors: [FactorPreference]
    public let commuteDestinations: [CommuteDestination]
    public let school: SchoolPreference
    public let analyticsConsent: Bool
    /// Optional (omitted when empty): at most three zones; areas outside them carry "zone:outside".
    public let zones: [MatchZone]?
}

/// One zone of a preference profile. `kind` is station (stationId, maxWalkMinutes),
/// borough (id) or lsoas (ids); unknown kinds decode and are left to the server.
public struct MatchZone: Codable, Sendable {
    public let kind: String
    public let stationId: String?
    public let maxWalkMinutes: Int?
    public let id: String?
    public let ids: [String]?
    public let label: String?
}

public enum Quality: String, Codable, Sendable {
    case observed
    case fallback
    case suppressed
}

public enum MetricDirection: String, Codable, Sendable {
    case higherIsMore = "higher-is-more"
    case higherIsBetter = "higher-is-better"
    case neutral
}

public enum AreaContractError: Error {
    case invalidGeographyCode(String)
}

public struct GeographyID: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String

    public init(carrier: Carrier, officialCode: String) throws {
        guard officialCode.range(of: #"^E[0-9]{8}$"#, options: .regularExpression) != nil else {
            throw AreaContractError.invalidGeographyCode(officialCode)
        }
        rawValue = "uk:\(carrier.idSegment):\(officialCode)"
    }

    public init?(rawValue: String) {
        guard rawValue.range(
            of: #"^uk:(lsoa|msoa|lad|borough):E[0-9]{8}$"#,
            options: .regularExpression
        ) != nil else { return nil }
        self.rawValue = rawValue
    }
}

public struct MapState: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var zoom: Double
    public var pitch: Double
    public var bearing: Double
    public var layer: MapLayerID
    public var period: String
    public var selected: GeographyID?

    public init(
        latitude: Double = 51.5074,
        longitude: Double = -0.1278,
        zoom: Double = 11,
        pitch: Double = 45,
        bearing: Double = -12,
        layer: MapLayerID = .pricePerSquareMetre,
        period: String = "2026-06",
        selected: GeographyID? = nil
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.zoom = min(18, max(8, zoom))
        self.pitch = min(60, max(0, pitch))
        self.bearing = min(180, max(-180, bearing))
        self.layer = layer
        self.period = period
        self.selected = selected
    }
}

public struct MetricDefinition: Codable, Identifiable, Sendable {
    public let id: MetricID
    public let label: String
    public let shortLabel: String
    public let description: String
    public let carrier: Carrier
    public let unit: String
    public let direction: MetricDirection
    public let periods: [String]
    public let defaultPeriod: String
    public let legend: [LegendStop]
    public let provenance: Provenance
    public let freshness: String
    public let methodologyPath: String
    public let caveats: [String]
}

public struct MetricCollection: Codable, Sendable {
    public let schemaVersion: String
    public let metrics: [MetricDefinition]
}

public struct LegendStop: Codable, Sendable {
    public let value: Double
    public let colour: String
    public let label: String
}

public struct Provenance: Codable, Sendable {
    public let sourceId: String
    public let sourceName: String
    public let sourceUrl: String
    public let release: String
    public let checksum: String
    public let licence: String
    public let attribution: String
    public let transformationVersion: String
}

public struct AreaSummary: Codable, Sendable {
    public let geographyId: GeographyID
    public let name: String?
    public let metricId: MetricID
    public let period: String
    public let value: Double?
    public let londonPercentile: Int?
    public let englandPercentile: Int?
    public let sampleCount: Int?
    public let breakdown: [String: Double]?
    public let quality: Quality
    public let sourceVersion: String
    public let carrier: Carrier
}

public struct AreaResponse: Codable, Sendable {
    public let schemaVersion: String
    public let productReleaseId: String?
    public let summary: AreaSummary
    public let parentId: GeographyID?
    public let priceTimeline: [AreaSummary]
    public let metricTimeline: [AreaSummary]
}

public struct PropertyHistoryResponse: Codable, Sendable {
    public let schemaVersion: String
    public let history: PropertyHistory
}

public struct SchoolSummaryResponse: Codable, Sendable {
    public let schemaVersion: String
    public let school: SchoolSummary
}

public enum DataMode: String, Sendable {
    case demo
    case real
}

/// Minimal native status line: mode, carrier, and unavailable evidence.
/// A missing valuation stays nil here; callers render nil as "Not published".
public func evidenceStatusText(mode: DataMode, carrier: Carrier, quality: Quality) -> String {
    let modeLabel = mode == .demo ? "Demo data · not for decisions" : "Real data pilot"
    let availability: String
    switch quality {
    case .observed: availability = "Observed"
    case .fallback: availability = "Fallback carrier"
    case .suppressed: availability = "Not published"
    }
    return "\(modeLabel) · \(carrier.rawValue.uppercased()) · \(availability)"
}

public struct PropertyTransaction: Codable, Sendable {
    public let date: String
    public let nominalPrice: Int
    public let floorAreaSquareMetres: Double?
    public let pricePerSquareMetre: Double?
    public let inflationAdjustedPrice: Int
    public let localMarketAdjustedPrice: Int?
}

public struct PropertyHistory: Codable, Sendable {
    public let uprn: String
    public let address: String
    public let geographyId: GeographyID
    public let transactions: [PropertyTransaction]
    public let estimateDisclaimer: String
    public let sourceVersion: String
}

public struct ValuePack: Codable, Sendable {
    public let schemaVersion: String
    public let metricId: MetricID
    public let period: String
    public let sourceVersion: String
    public let productReleaseId: String?
    public let values: [AreaSummary]
}

public struct MatchComponent: Codable, Sendable {
    public let factorId: FactorID
    public let rawValue: Double
    public let unit: String
    public let utility: Double
    public let weight: Double
    public let contribution: Double
    public let carrierGeographyId: GeographyID
    public let quality: Quality
    public let sourceVersion: String
}

public struct MatchResult: Codable, Sendable {
    public let geographyId: GeographyID
    public let name: String
    public let score: Double?
    public let rank: Int?
    public let evidenceCompleteness: Double
    public let excluded: Bool
    public let unmetLimits: [String]
    public let sourceReleaseSet: String
    public let components: [MatchComponent]
    /// Present only when the profile has zones.
    public let inZone: Bool?
}

public struct MatchPack: Codable, Sendable {
    public let schemaVersion: String
    public let profileVersion: String
    public let sourceReleaseSet: String
    public let values: [MatchResult]
}

public struct ForecastRange: Codable, Sendable {
    public let p10: Double
    public let p20: Double
    public let p50: Double
    public let p90: Double
}

public struct ForecastScenarios: Codable, Sendable {
    public let downside: Double
    public let base: Double
    public let upside: Double
}

public struct ForecastBacktest: Codable, Sendable {
    public let model: String
    public let meanAbsoluteError: Double
    public let intervalCoverage: Double
}

public struct PriceForecast: Codable, Sendable {
    public let schemaVersion: String
    public let geographyId: GeographyID
    public let carrierGeographyId: GeographyID
    public let horizon: String
    public let status: String
    public let range: ForecastRange?
    public let scenarios: ForecastScenarios?
    public let backtest: ForecastBacktest?
    public let suppressionReason: String?
    public let sourceVersion: String
}

public struct AdmissionCutoff: Codable, Sendable {
    public let academicYear: String
    public let distanceMetres: Double
    public let sourceUrl: String
}

public struct AdmissionEvidence: Codable, Sendable {
    public let kind: String
    public let academicYears: [String]
    public let yearsWithin: Int?
    public let measurementMethod: String?
    public let sourceUrls: [String]
    public let cutoffs: [AdmissionCutoff]
    public let isProbability: Bool
}

public struct SchoolSummary: Codable, Sendable {
    public let schoolId: String
    public let urn: String
    public let name: String
    public let phase: String
    public let type: String
    public let ageRange: AgeRange
    public let gender: String
    public let faith: String?
    public let selectivity: String
    public let capacity: Int?
    public let senProvision: [String]
    public let latitude: Double
    public let longitude: Double
    public let journeyMinutes: Int?
    public let qualityFacets: [String: Double?]
    public let inspectionFramework: String
    public let parentViewResponses: Int?
    public let admissionEvidence: AdmissionEvidence
    public let sourceVersion: String
}

public struct AgeRange: Codable, Sendable {
    public let from: Int
    public let to: Int
}
