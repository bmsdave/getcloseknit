package org.closeknit.london

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(applicationContext)
        setContent { MaterialTheme { CloseKnitScreen() } }
    }
}

@Composable
fun CloseKnitScreen() {
    var metric by remember { mutableStateOf(MetricId.PRICE_PER_SQUARE_METRE) }
    Box(Modifier.fillMaxSize()) {
        NativeMap(MapState(layer = MapLayerId.fromMetric(metric)))
        EvidenceStatusColumn(metric, onSelect = { metric = it })
    }
}

@Composable
private fun EvidenceStatusColumn(metric: MetricId, onSelect: (MetricId) -> Unit) {
    Column(
        modifier = Modifier.padding(top = 44.dp, start = 8.dp, end = 8.dp),
    ) {
        LayerPicker(metric, onSelect = onSelect)
        Text(evidenceStatusText(DataMode.DEMO, carrierForMetric(metric), Quality.SUPPRESSED))
    }
}

@Composable
private fun NativeMap(state: MapState) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            MapView(context).apply {
                onCreate(null)
                getMapAsync { map ->
                    map.setStyle(BuildConfig.MAP_STYLE_URL)
                    map.cameraPosition = CameraPosition.Builder()
                        .target(LatLng(state.latitude, state.longitude))
                        .zoom(state.zoom)
                        .tilt(state.pitch)
                        .bearing(state.bearing)
                        .build()
                }
            }
        },
        onRelease = { view -> view.onDestroy() },
    )
}

@Composable
private fun LayerPicker(active: MetricId, onSelect: (MetricId) -> Unit) {
    Row(
        modifier = Modifier
            .background(Color(0xEEF5F3ED))
            .horizontalScroll(rememberScrollState())
            .padding(6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MetricId.entries.forEach { metric ->
            Button(onClick = { onSelect(metric) }, enabled = metric != active) {
                Text(metric.name.replace('_', ' ').lowercase())
            }
        }
    }
}
