import Testing
import Foundation
@testable import CloseKnitCore

@Test func geographyIdRequiresAnOfficialEnglandCode() throws {
    let geography = try GeographyID(carrier: .lsoa, officialCode: "E01000001")

    #expect(geography.rawValue == "uk:lsoa:E01000001")
    #expect(throws: AreaContractError.self) {
        try GeographyID(carrier: .lsoa, officialCode: "preview")
    }
}

@Test func ladCarrierDecodesAndKeepsTheBoroughId() throws {
    // Step R1: answers say carrier lad; step R2: a LAD's id is uk:lad:.
    let summary = try JSONDecoder().decode(AreaSummary.self, from: Data(#"""
    {
      "geographyId":"uk:lad:E09000007","name":"Camden","metricId":"crime","period":"2026-06","value":90,
      "regionPercentile":40,"countryPercentile":null,"londonPercentile":40,"englandPercentile":null,
      "sampleCount":null,"quality":"observed","sourceVersion":"police-uk-2026-06","carrier":"lad"
    }
    """#.utf8))

    #expect(summary.carrier == .lad)
    #expect(summary.londonPercentile == 40)
    #expect(try GeographyID(carrier: .lad, officialCode: "E09000007").rawValue == "uk:lad:E09000007")
}

@Test func publicEvidenceContractsDecodeWebAPIShapes() throws {
    let decoder = JSONDecoder()
    let summary = try decoder.decode(AreaSummary.self, from: Data(#"""
    {
      "geographyId":"uk:lsoa:E01000001","name":"Westminster preview",
      "metricId":"price-per-square-metre","period":"2026-06","value":9600,
      "londonPercentile":92,"englandPercentile":98,"sampleCount":42,
      "quality":"observed","sourceVersion":"price-paid-2026-06","carrier":"lsoa"
    }
    """#.utf8))
    let history = try decoder.decode(PropertyHistory.self, from: Data(#"""
    {
      "uprn":"100000000001","address":"Preview address",
      "geographyId":"uk:lsoa:E01000001","sourceVersion":"price-paid-2026-06",
      "estimateDisclaimer":"Comparisons are not valuations.",
      "transactions":[{"date":"2020-01-10","nominalPrice":500000,
        "floorAreaSquareMetres":50,"pricePerSquareMetre":10000,
        "inflationAdjustedPrice":600000,"localMarketAdjustedPrice":575000}]
    }
    """#.utf8))

    #expect(summary.londonPercentile == 92)
    #expect(summary.englandPercentile == 98)
    #expect(history.transactions.first?.nominalPrice == 500_000)
}

@Test func mapStateClampsPitchToSharedStyleLimit() {
    let state = MapState(pitch: 85, layer: .personalMatch)

    #expect(state.pitch == 60)
    #expect(MetricID.allCases.count == 8)
    #expect(FactorID.allCases.last == .stationAccess)
    #expect(FactorID(rawValue: "station-access") == .stationAccess)
    #expect(state.layer == .personalMatch)
}

@Test func personalMatchAndForecastDecodeSharedApiShapes() throws {
    let decoder = JSONDecoder()
    let pack = try decoder.decode(MatchPack.self, from: Data(#"""
    {"schemaVersion":"match-pack.v1","profileVersion":"preference-profile.v1",
    "sourceReleaseSet":"release-v1","values":[{"geographyId":"uk:lsoa:E01000001",
    "name":"Preview","score":82,"rank":1,"evidenceCompleteness":75,"excluded":false,
    "unmetLimits":[],"sourceReleaseSet":"release-v1","components":[]}]}
    """#.utf8))
    let forecast = try decoder.decode(PriceForecast.self, from: Data(#"""
    {"schemaVersion":"price-forecast.v1","geographyId":"uk:lsoa:E01000001",
    "carrierGeographyId":"uk:msoa:E02000001","horizon":"1y","status":"available",
    "range":{"p10":7000,"p20":7200,"p50":7600,"p90":8100},"scenarios":null,
    "backtest":{"model":"damped-trend","meanAbsoluteError":210,"intervalCoverage":0.8},
    "sourceVersion":"forecast-v1"}
    """#.utf8))

    #expect(pack.values.first?.score == 82)
    #expect(pack.values.first?.sourceReleaseSet == "release-v1")
    #expect(forecast.range?.p20 == 7_200)
}

@Test func matchResultRequiresSourceProvenance() {
    let payload = Data(#"""
    {"geographyId":"uk:lsoa:E01000001","name":"Preview","score":82,"rank":1,
    "evidenceCompleteness":75,"excluded":false,"unmetLimits":[],"components":[]}
    """#.utf8)

    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(MatchResult.self, from: payload)
    }
}
