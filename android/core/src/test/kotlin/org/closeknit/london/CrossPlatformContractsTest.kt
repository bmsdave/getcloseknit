package org.closeknit.london

import java.io.File
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertNull

private val goldenJson = Json { ignoreUnknownKeys = true }

private fun golden(name: String): String {
    var dir = File(System.getProperty("user.dir"))
    repeat(10) {
        val candidate = File(dir, "contracts/fixtures/golden-v1/$name")
        if (candidate.isFile) return candidate.readText()
        dir = dir.parentFile ?: return@repeat
    }
    throw IllegalStateException("golden fixture missing: $name")
}

class CrossPlatformContractsTest {
    @Test
    fun realAreaDecodesIdenticalEvidence() {
        val response = goldenJson.decodeFromString<AreaResponse>(golden("area-real.json"))

        assertEquals(48.5, response.summary.value)
        assertEquals(Quality.OBSERVED, response.summary.quality)
        assertEquals(Carrier.LSOA, response.summary.carrier)
        assertEquals(10.7, response.summary.breakdown?.get("burglary"))
        assertEquals("official-2026-06", response.productReleaseId)
        assertEquals(2, response.metricTimeline.size)
    }

    @Test
    fun demoFallbackCarrierKeepsItsCarrier() {
        val response = goldenJson.decodeFromString<AreaResponse>(golden("area-demo.json"))

        assertEquals(Quality.FALLBACK, response.summary.quality)
        assertEquals(Carrier.MSOA, response.summary.carrier)
        assertEquals(18.0, response.summary.breakdown?.get("matchedSales"))
        assertNull(response.productReleaseId)
    }

    @Test
    fun missingValuationIsUnavailableNeverZero() {
        val response = goldenJson.decodeFromString<AreaResponse>(golden("area-suppressed.json"))

        assertEquals(Quality.SUPPRESSED, response.summary.quality)
        assertNull(response.summary.value)
    }

    @Test
    fun propertyIdentitySurvivesTheWire() {
        val response =
            goldenJson.decodeFromString<PropertyHistoryResponse>(golden("property-history.json"))

        assertEquals("100000000001", response.history.uprn)
        assertEquals(2, response.history.transactions.size)
        assertNull(response.history.transactions[1].localMarketAdjustedPrice)
        assertNull(response.history.transactions[1].pricePerSquareMetre)
    }

    @Test
    fun malformedResponsesAreRejected() {
        assertFails { goldenJson.decodeFromString<AreaResponse>(golden("malformed-area.json")) }
        assertFails {
            goldenJson.decodeFromString<PropertyHistoryResponse>(golden("malformed-property.json"))
        }
    }

    @Test
    fun oldClientsDecodeWithoutNewerOptionalFields() {
        val response = goldenJson.decodeFromString<AreaResponse>(golden("area-old-client.json"))

        assertEquals(48.5, response.summary.value)
        assertNull(response.summary.breakdown)
        assertNull(response.productReleaseId)
    }

    @Test
    fun metricCarriersMatchDocumentedPolicy() {
        assertEquals(Carrier.MSOA, carrierForMetric(MetricId.INCOME))
        assertEquals(Carrier.LSOA, carrierForMetric(MetricId.PRICE_PER_SQUARE_METRE))
        assertEquals(Carrier.LSOA, carrierForMetric(MetricId.CRIME))
    }

    @Test
    fun statusLabelsNameModeCarrierAndAvailability() {
        assertEquals(
            "Demo data · not for decisions · LSOA · Observed",
            evidenceStatusText(DataMode.DEMO, Carrier.LSOA, Quality.OBSERVED),
        )
        assertEquals(
            "Real data pilot · LSOA · Observed",
            evidenceStatusText(DataMode.REAL, Carrier.LSOA, Quality.OBSERVED),
        )
        assertEquals(
            "Demo data · not for decisions · MSOA · Fallback carrier",
            evidenceStatusText(DataMode.DEMO, Carrier.MSOA, Quality.FALLBACK),
        )
        assertEquals(
            "Real data pilot · LSOA · Not published",
            evidenceStatusText(DataMode.REAL, Carrier.LSOA, Quality.SUPPRESSED),
        )
    }
}
