import CloseKnitCore
import SwiftUI

/// Minimum native labelling for AE-35: data mode, carrier, availability.
public struct EvidenceStatusLabel: View {
    private let mode: DataMode
    private let carrier: Carrier
    private let quality: Quality

    public init(mode: DataMode, carrier: Carrier, quality: Quality) {
        self.mode = mode
        self.carrier = carrier
        self.quality = quality
    }

    public var body: some View {
        Text(evidenceStatusText(mode: mode, carrier: carrier, quality: quality))
            .font(.caption)
            .accessibilityIdentifier("evidence-status")
    }
}
