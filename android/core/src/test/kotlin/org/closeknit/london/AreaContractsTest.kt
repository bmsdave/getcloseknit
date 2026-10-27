package org.closeknit.london

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AreaContractsTest {
    @Test
    fun geographyIdRequiresOfficialEnglandCode() {
        assertEquals("uk:lsoa:E01000001", GeographyId(Carrier.LSOA, "E01000001").value)
        assertFailsWith<IllegalArgumentException> { GeographyId(Carrier.LSOA, "preview") }
    }

    @Test
    fun mapStateClampsPitchToSharedStyleLimit() {
        assertEquals(60.0, MapState(pitch = 85.0, layer = MapLayerId.PERSONAL_MATCH).pitch)
        assertEquals(8, MetricId.entries.size)
        assertEquals(FactorId.STATION_ACCESS, FactorId.entries.last())
        assertEquals(FactorId.STATION_ACCESS, Json.decodeFromString<FactorId>("\"station-access\""))
        assertEquals(MapLayerId.PERSONAL_MATCH, MapState(layer = MapLayerId.PERSONAL_MATCH).layer)
    }

    @Test
    fun publicEvidenceContractsDecodeWebApiShapes() {
        val summary = Json.decodeFromString<AreaSummary>(
            """{"geographyId":"uk:lsoa:E01000001","name":"Westminster preview",
            "metricId":"price-per-square-metre","period":"2026-06","value":9600,
            "londonPercentile":92,"englandPercentile":98,"sampleCount":42,
            "quality":"observed","sourceVersion":"price-paid-2026-06","carrier":"lsoa"}""",
        )
        val history = Json.decodeFromString<PropertyHistory>(
            """{"uprn":"100000000001","address":"Preview address",
            "geographyId":"uk:lsoa:E01000001","sourceVersion":"price-paid-2026-06",
            "estimateDisclaimer":"Comparisons are not valuations.","transactions":[
            {"date":"2020-01-10","nominalPrice":500000,"floorAreaSquareMetres":50,
            "pricePerSquareMetre":10000,"inflationAdjustedPrice":600000,
            "localMarketAdjustedPrice":575000}]}""",
        )

        assertEquals(92, summary.londonPercentile)
        assertEquals(98, summary.englandPercentile)
        assertEquals(500_000, history.transactions.first().nominalPrice)
    }

    @Test
    fun personalMatchDecodesSharedApiShape() {
        val pack = Json.decodeFromString<MatchPack>(
            """{"schemaVersion":"match-pack.v1","profileVersion":"preference-profile.v1",
            "sourceReleaseSet":"release-v1","values":[{"geographyId":"uk:lsoa:E01000001",
            "name":"Preview","score":82,"rank":1,"evidenceCompleteness":75,"excluded":false,
            "unmetLimits":[],"sourceReleaseSet":"release-v1","components":[]}]}""",
        )

        assertEquals(82.0, pack.values.first().score)
        assertEquals("release-v1", pack.values.first().sourceReleaseSet)
    }
}
