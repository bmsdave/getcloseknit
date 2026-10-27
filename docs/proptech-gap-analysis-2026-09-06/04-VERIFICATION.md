# Verification record

**6 September 2026.** Documentation-only delivery: gap assessment, priority plan, evidence review, preserved research, task index, and 36 task briefs. No application implementation, deployment, commit, or merge was performed.

## Document checks

The local validator checks that there are exactly 36 task Markdown files; each task has at least 100 substantive words between its problem section and source/context section; all local file and explicit anchor links resolve; all dependency IDs exist; dependencies form an acyclic graph; and the supplied research copy is byte-identical to the attachment. It also checks that this package contains only Markdown files.

Measured task bodies contain **190–224 words each**, totaling **7,268 substantive words**, excluding task headers, dependency metadata, and source/context lists. Every brief includes implementation scope, acceptance, success evidence, cleanup, and links to actual current files. The first validation pass found only the not-yet-written verification record; this record was then added before the final pass. See the final result below.

The preserved research SHA-256 is:

`67d13dd75e4fb12c7be903ce05016253d51c16d078d38db289042a9524f87b7d`

## Executed behavior probe

A read-only Python call imported the existing API scorer and supplied one affordability observation: raw price £500,000, stored utility 60, positive factor weight, and no utility limits. Changing target/maximum budget from £300k/£400k to £600k/£700k returned **60 in both cases**. The probe asserted that observed behavior and passed. This verifies the gap described in AE-08; it is not a test of corrected behavior or an HTTP deployment.

To reproduce from `applications/close-knit`:

```sh
python3 - <<'PYTHON'
import sys
sys.path.insert(0, 'api')
from area_api.matching import build_match_pack
row = {
    'geography_id': 'uk:lsoa:E01000001', 'name': 'Probe',
    'factor_id': 'affordability', 'raw_value': 500000, 'utility': 60,
    'unit': 'GBP', 'carrier_geography_id': 'uk:lsoa:E01000001',
    'quality': 'observed', 'source_release_id': 'probe',
}
profile = {
    'schemaVersion': 'preference-profile.v1', 'market': 'buy',
    'targetBudget': 300000, 'maximumBudget': 400000,
    'factors': [{'factorId': 'affordability', 'weight': 5, 'direction': 'higher'}],
}
low = build_match_pack(profile, [row])['values'][0]['score']
profile.update(targetBudget=600000, maximumBudget=700000)
high = build_match_pack(profile, [row])['values'][0]['score']
print(low, high)
assert low == high == 60
PYTHON
```

## Source and portability checks

Local links resolve against the assessed working tree, not necessarily a clean clone of HEAD `961c16f`. These linked files were already untracked before this report and must be retained or integrated by their owning work before a clean clone can resolve them:

- [route.ts](<../../web/src/app/api/v1/properties/[id]/route.ts>)
- [price-waterfall.tsx](<../../web/src/components/price-waterfall.tsx>)
- [property-panel.tsx](<../../web/src/components/property-panel.tsx>)
- [property-timeline.tsx](<../../web/src/components/property-timeline.tsx>)
- [decompose.py](<../../pipelines/area-analytics-ingest/area_analytics/decompose.py>)
- [peers.py](<../../pipelines/area-analytics-ingest/area_analytics/peers.py>)
- [properties.py](<../../pipelines/area-analytics-ingest/area_analytics/properties.py>)
- [property_pack.py](<../../pipelines/area-analytics-ingest/area_analytics/property_pack.py>)
- [test_properties.py](<../../pipelines/area-analytics-ingest/tests/test_properties.py>)

No ownership, completion, or independent acceptance of that uncommitted implementation is implied. Other pre-existing modifications were left alone. Link validation verifies local targets and explicit anchors, not that every external URL is continuously reachable. Official pages actually retrieved and unsuccessful TfL/GIAS retrievals are described in the evidence review. The worker-note corpus referenced inside the synthesis remains unavailable. The follow-up bibliography now supplies external URLs, indexed in [the source catalogue](05-SOURCE-LINKS.md); code-formatted worker-file paths remain preserved references, not fabricated local Markdown links.

## Checks deliberately not run

Web unit tests, typecheck, build, Playwright, pipeline/API full suites, database integration, native tests, and live-data imports were not run because no application behavior changed. No browser rendering or usability pass is claimed. Behavioral implementation briefs require those checks when executed. Only the bounded read-only scorer probe and documentation validation were performed for this delivery.

## Initial delivery validation result

Passed: 36 tasks; 190–224 substantive words per task; 652 local file/anchor references checked; all dependency IDs valid and the graph acyclic; supplied research byte-identical; Markdown-only package; zero validation errors. External references were not subjected to a blanket availability test.

## Follow-up bibliography update

The user supplied 91 unique URLs, now preserved in a second byte-identical attachment copy and an English source catalogue. All 36 task briefs gained relevant direct research links, while their substantive scope and priorities remain unchanged. Paper/thread namespaces and F competitor references are explicitly mapped; the missing E-A01 reference and secondary-source caveats are documented. No destination contents were newly retrieved for this reference-integration task, so source claims were not upgraded to verified.

Source-link attachment SHA-256: `50431c7bef156531ea0d85c5dfb5da46cc03614e051d45217983cab14b039a0f`.

Follow-up validation passed: all 91 supplied URLs preserved exactly in the catalogue; the source-link attachment is byte-identical; all 36 tasks contain at least two relevant supplied external references; task bodies remain 190–224 words; 736 local file/anchor references resolve; dependency graph remains acyclic; zero document validation errors. HTTP reachability and full-text verification were not claimed.
