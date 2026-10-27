package org.closeknit.london

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

class AreaApiClient(
    private val baseUrl: String = BuildConfig.AREA_API_URL,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    suspend fun metrics(): MetricCollection = withContext(Dispatchers.IO) {
        val connection = URL("${baseUrl}metrics").openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.inputStream.bufferedReader().use { reader ->
            require(connection.responseCode == 200) { "metrics request failed" }
            json.decodeFromString<MetricCollection>(reader.readText())
        }
    }
}
