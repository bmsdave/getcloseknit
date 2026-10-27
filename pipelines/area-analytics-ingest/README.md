# Area analytics ingestion

This pipeline owns analytics values and provenance for London Close Knit. It
does not own basemap geometry or rendering. Production acquisitions must use a
dated release, record the source URL, checksum, licence, and transformation
version, and write new immutable output rather than mutate an older release.

Implemented deterministic source-manifest validation requires retrieval and
release dates, the release URL, SHA-256, licence, attribution, geography
vintage, transformation version, caveats, and a passed validation result.
Deterministic transformations cover rolling 12-month price per square metre,
the 20-sale reliability gate, LSOA → MSOA → borough carrier
selection, London/England percentiles, CPIH comparisons, and local-market
comparisons. Missing EPC floor area is excluded rather than inferred.
The public source catalogue covers prices, rent, crime denominators,
deprivation, income, tenure, routing, schools, noise, and extensible OSM
amenities. Forecast and admissions modules suppress unsupported claims rather
than filling gaps.

Run the dependency-free test suite:

```sh
python3 -m unittest discover -s tests -v
```

Build a value pack from a reviewed JSON input:

```sh
python3 -m area_analytics.cli --input input.json --output output.json
```

The acquisition adapters for ONS, MHCLG, police.uk, HM Land Registry, DLUHC
EPC, and OS Open datasets deliberately remain offline from tests. Each adapter
must provide a small committed fixture before it gains network acquisition.
