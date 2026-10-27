import Foundation

public actor AreaAPIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func metrics() async throws -> MetricCollection {
        try await get(path: "metrics", as: MetricCollection.self)
    }

    private func get<Value: Decodable & Sendable>(
        path: String,
        as type: Value.Type
    ) async throws -> Value {
        let url = baseURL.appending(path: path)
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(type, from: data)
    }
}
