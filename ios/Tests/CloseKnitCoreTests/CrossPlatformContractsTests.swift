import Testing
import Foundation
@testable import CloseKnitCore

private func goldenData(_ name: String) throws -> Data {
    var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    for _ in 0..<10 {
        let candidate = directory
            .appendingPathComponent("contracts/fixtures/golden-v1/\(name)")
        if FileManager.default.fileExists(atPath: candidate.path) {
            return try Data(contentsOf: candidate)
        }
        directory.deleteLastPathComponent()
    }
    throw AreaContractError.invalidGeographyCode("golden fixture missing: \(name)")
}

@Suite func crossPlatformContracts() throws {
    let decoder = JSONDecoder()

    @Test func realAreaDecodesIdenticalEvidence() throws {
        let response = try decoder.decode(
            AreaResponse.self, from: goldenData("area-real.json"))

        #expect(response.summary.value == 48.5)
        #expect(response.summary.quality == .observed)
        #expect(response.summary.carrier == .lsoa)
        #expect(response.summary.breakdown?["burglary"] == 10.7)
        #expect(response.productReleaseId == "official-2026-06")
        #expect(response.metricTimeline.count == 2)
    }

    @Test func demoFallbackCarrierKeepsItsCarrier() throws {
        let response = try decoder.decode(
            AreaResponse.self, from: goldenData("area-demo.json"))

        #expect(response.summary.quality == .fallback)
        #expect(response.summary.carrier == .msoa)
        #expect(response.summary.breakdown?["matchedSales"] == 18)
        #expect(response.productReleaseId == nil)
    }

    @Test func missingValuationIsUnavailableNeverZero() throws {
        let response = try decoder.decode(
            AreaResponse.self, from: goldenData("area-suppressed.json"))

        #expect(response.summary.quality == .suppressed)
        #expect(response.summary.value == nil)
    }

    @Test func propertyIdentitySurvivesTheWire() throws {
        let response = try decoder.decode(
            PropertyHistoryResponse.self, from: goldenData("property-history.json"))

        #expect(response.history.uprn == "100000000001")
        #expect(response.history.transactions.count == 2)
        #expect(response.history.transactions[1].localMarketAdjustedPrice == nil)
        #expect(response.history.transactions[1].pricePerSquareMetre == nil)
    }

    @Test func malformedResponsesAreRejected() {
        #expect(throws: DecodingError.self) {
            try decoder.decode(AreaResponse.self, from: goldenData("malformed-area.json"))
        }
        #expect(throws: DecodingError.self) {
            try decoder.decode(
                PropertyHistoryResponse.self, from: goldenData("malformed-property.json"))
        }
    }

    @Test func oldClientsDecodeWithoutNewerOptionalFields() throws {
        let response = try decoder.decode(
            AreaResponse.self, from: goldenData("area-old-client.json"))

        #expect(response.summary.value == 48.5)
        #expect(response.summary.breakdown == nil)
        #expect(response.productReleaseId == nil)
    }

    @Test func statusLabelsNameModeCarrierAndAvailability() {
        #expect(evidenceStatusText(mode: .demo, carrier: .lsoa, quality: .observed)
            == "Demo data · not for decisions · LSOA · Observed")
        #expect(evidenceStatusText(mode: .real, carrier: .lsoa, quality: .observed)
            == "Real data pilot · LSOA · Observed")
        #expect(evidenceStatusText(mode: .demo, carrier: .msoa, quality: .fallback)
            == "Demo data · not for decisions · MSOA · Fallback carrier")
        #expect(evidenceStatusText(mode: .real, carrier: .lsoa, quality: .suppressed)
            == "Real data pilot · LSOA · Not published")
    }
}
