"""The ETL as code: every load step, the theme it belongs to, what it waits for and the bundle it ships.

One loader per theme, parameterised by scope: the England loaders take their coverage from
area_coverage.from_env() (every English LAD; CLOSE_KNIT_ETL_COVERAGE=london rebuilds London alone), so
London is rows inside them. Steps with scope "london" stay London-scoped, each with the reason in `why`:
a London-only source (TfL, the GLA, council admissions, HMO registers, Inside Airbnb...) or per-home data
(owner decision: per-home rows stay London-only).

Run it with deploy/tools/etl.py (`etl.py plan`, `etl.py run --theme X`); see that file. Commands are bash,
run from `cwd` (tools = deploy/tools, ingest = pipelines/area-analytics-ingest, repo = the checkout), with
${NAME} replaced from VARS (each overridable by the environment variable ETL_<NAME>).
"""
from __future__ import annotations

from dataclasses import dataclass, field

VARS = {
    "DB": "postgresql://postgres@localhost:5434/area_explorer",
    "PY": "python3",  # etl.py passes its own interpreter (the .ae-venv one)
    "PSQL": "psql ${DB}",
    "DATA": "~/data",
    "W": "~/data/aework",
    "E": "~/data/england-2026-10",
    "BUNDLES": "~/data/england-2026-10/bundles",
    "LOCK": "~/data/england-2026-10/release.lock",
    "CRIME_END": "2026-08",
    "PRICE_END": "2026-08",
    "KIDS": "~/data/kids/2026-10",
    "OSM_PBF": "~/data/england-2026-10/transport/osm/england-261020.osm.pbf",
    # What builds a staged release's artifacts before it goes live (run from api/ with CLOSE_KNIT_DATABASE_URL=${DB});
    # on the host: ETL_RELEASE_BUILD="docker compose -f ... exec -T api python -m area_api.release_build".
    "RELEASE_BUILD": "${PY} -m area_api.release_build",
}

PER_HOME = "per-home data stays London-only (owner decision; prod disk)"


@dataclass(frozen=True)
class Step:
    id: str                          # "<theme>.<name>"
    run: str                         # bash, ${VARS}
    after: tuple[str, ...] = ()      # step ids that must have run first
    cwd: str = "tools"               # tools | ingest | repo
    scope: str = "england"           # england (coverage-parameterised) | london
    why: str = ""                    # the reason a step is London-scoped
    lock: bool = False               # stages a product release: hold ${LOCK} while it runs
    bundle: str = ""                 # the production bundle this step writes
    needs: tuple[str, ...] = ()      # input files the step reads that no step downloads
    probe: bool = False              # can run inside etl.py london-diff --probe (rolled back)
    manual: str = ""                 # why `run` skips it unless named (paid, days long, owner login)

    @property
    def theme(self) -> str:
        return self.id.split(".", 1)[0]


S = Step
STEPS: tuple[Step, ...] = (
    # --- core: migrations and the statistical geography ------------------------------------------------
    S("core.migrate", 'CLOSE_KNIT_PSQL="${PSQL}" ./migrate.sh apply', cwd="deploy"),
    S("core.boundaries", "BOUNDARIES_OUT=${E}/core/boundaries ${PY} boundaries.py ALL", ("core.migrate",)),
    S("core.geography", "BOUNDARIES_OUT=${E}/core/boundaries ${PY} etl_england_geography.py "
      "${BUNDLES}/core/geography.sql.gz && gunzip -c ${BUNDLES}/core/geography.sql.gz | ${PSQL} -v ON_ERROR_STOP=1",
      ("core.boundaries",), bundle="${BUNDLES}/core/geography.sql.gz"),
    S("core.cpih", "${PY} etl_cpih.py download ${DATA}/ons/cpih-l522.csv && "
      "${PY} etl_cpih.py load ${DB} ${DATA}/ons/cpih-l522.csv", ("core.migrate",)),

    # --- people ------------------------------------------------------------------------------------------
    S("people.census-fetch", "AE_DATA=${E}/people ${PY} -m area_analytics.census_api fetch", ("core.geography",),
      cwd="ingest"),
    S("people.census-load", "AE_DATA=${E}/people ${PY} -m area_analytics.census_people check && "
      "AE_DATA=${E}/people ${PY} -m area_analytics.census_people load ${DB}", ("people.census-fetch",), cwd="ingest"),
    S("people.census-picks", "AE_DATA=${E}/people ${PY} -m area_analytics.census_picks write",
      ("people.census-load",), cwd="ingest"),
    S("people.postcodes", "AE_WORK=${E}/people/civic ${PY} -m area_analytics.civic build postcodes && "
      "AE_WORK=${E}/people/civic ${PY} -m area_analytics.civic load ${DB} postcodes", ("core.geography",),
      cwd="ingest"),
    S("people.labels", "AE_WORK=${E}/people/labels AE_LAD_BOUNDARIES=${E}/core/boundaries/geom-lad.json "
      "${PY} -m area_analytics.area_labels build && AE_WORK=${E}/people/labels ${PY} -m area_analytics.area_labels "
      "load ${DB}", ("core.geography",), cwd="ingest", needs=("${E}/people/labels/MSOA-Names-2.3.csv",)),
    S("people.streets", "AE_WORK=${E}/people/streets ${PY} -m area_analytics.streets build && "
      "AE_WORK=${E}/people/streets ${PY} -m area_analytics.streets load ${DB}", ("people.postcodes",), cwd="ingest"),
    S("people.settled", "AE_WORK=${E}/people/census ${PY} etl_home.py load ${DB} settled", ("people.census-load",)),
    S("people.census-layers", "${PY} etl_census_layers.py load ${DB}", ("people.census-load",), lock=True),
    S("people.metrics", "${PY} etl_people_metrics.py check ${DB} && ${PY} etl_people_metrics.py load ${DB}",
      ("people.census-load",), lock=True, probe=True),
    S("people.short-lets", "AE_WORK=${W}/short-lets ${PY} etl_short_lets.py download && "
      "AE_WORK=${W}/short-lets ${PY} etl_short_lets.py load ${DB}", ("people.census-load",), scope="london",
      why="Inside Airbnb publishes a London snapshot only", lock=True),
    S("people.bundle", "${PY} etl_england_people_bundle.py people ${DB} ${BUNDLES}/people/load.sql.gz && "
      "${PY} etl_england_people_bundle.py layers ${DB} ${BUNDLES}/people/census-layers.sql.gz",
      ("people.census-picks", "people.labels", "people.streets", "people.settled", "people.census-layers",
       "people.metrics"), bundle="${BUNDLES}/people/load.sql.gz ${BUNDLES}/people/census-layers.sql.gz"),

    # --- crime -------------------------------------------------------------------------------------------
    S("crime.window", "AE_WORK=${E}/crime ${PY} deploy/tools/ziprange.py WINDOW ${CRIME_END}", ("core.geography",),
      cwd="repo"),
    S("crime.release", "AE_WORK=${E}/crime ${PY} etl_crime_release.py ${CRIME_END} ${DB}",
      ("crime.window", "people.postcodes"), lock=True, probe=True),
    S("crime.bundle", "AE_WORK=${E}/crime ${PY} etl_crime_release.py ${CRIME_END} ${DB} --bundle "
      "${BUNDLES}/crime/load.sql.gz", ("crime.release",), bundle="${BUNDLES}/crime/load.sql.gz"),

    # --- prices and housing ------------------------------------------------------------------------------
    S("prices.hpi", "AE_WORK=${W}/hpi ${PY} etl_uk_hpi.py download && AE_WORK=${W}/hpi ${PY} etl_uk_hpi.py load ${DB}",
      ("core.geography",), lock=True, probe=True),
    S("prices.rents", "AE_WORK=${E}/prices/rents ${PY} -m area_analytics.rents build && "
      "AE_WORK=${E}/prices/rents ${PY} -m area_analytics.rents load ${DB} && "
      "${PSQL} -c \"SELECT rebuild_typical_rent('src-ons-pipr-2026-09-england')\"", ("core.geography",),
      cwd="ingest"),
    S("prices.rent-trend", "AE_WORK=${W}/rent-trend ${PY} etl_rent_trend.py download && "
      "AE_WORK=${W}/rent-trend ${PY} etl_rent_trend.py load ${DB}", ("core.geography",), lock=True, probe=True),
    S("prices.council-tax", "AE_WORK=${W}/council-tax ${PY} etl_council_tax.py download && "
      "AE_WORK=${W}/council-tax ${PY} etl_council_tax.py load ${DB}", ("core.geography",), lock=True, probe=True),
    S("prices.postcodes", "AE_WORK=${E}/prices ${PY} etl_england_prices.py postcodes", ("core.geography",),
      needs=("${DATA}/civic/ONSPD_AUG_2026.zip",)),
    S("prices.link", "AE_WORK=${E}/prices ${PY} etl_england_prices.py link", ("prices.postcodes",),
      needs=("${DATA}/hmlr/pp-complete.csv", "EPC")),
    # London's per-home price build (sale, property, property_epc, the £/m² index read per home).
    S("prices.epc-london", "${PY} epc_bulk.py london-csv", scope="london", why=PER_HOME, needs=("EPC",)),
    S("prices.london-linked", "AE_WORK=${E}/prices ${PY} etl_england_prices.py london-linked", ("prices.link",),
      scope="london", why=PER_HOME),
    S("prices.address-spine", "${PY} etl_address_spine.py build && ${PY} etl_address_spine.py load ${DB}",
      ("core.geography",), scope="london", why=PER_HOME, lock=True,
      needs=("${DATA}/hmlr/pp-complete.csv", "${DATA}/epc-london-floor.sqlite",
             "${DATA}/boundaries/onspd-london-2025.csv", "${DATA}/boundaries/onspd-london-grid.csv")),
    S("prices.sales", "AE_WORK=${W}/sales ${PY} etl_sales.py extract && AE_WORK=${W}/sales ${PY} etl_sales.py emit && "
      "AE_WORK=${W}/sales ${PY} etl_sales.py load ${DB} && AE_WORK=${W}/sales ${PY} etl_sales.py release ${DB}",
      ("prices.address-spine", "prices.epc-london", "core.cpih", "prices.price-index"), scope="london",
      why=PER_HOME, lock=True, needs=("${DATA}/hmlr/pp-complete.csv", "${DATA}/address-history.sqlite")),
    S("prices.property", "${PY} etl_property.py && ${PSQL} -v ON_ERROR_STOP=1 -f property-load.sql",
      ("prices.epc-london",), scope="london", why=PER_HOME, needs=("${DATA}/address-history.sqlite",),
      manual="property-load.sql needs its \\copy paths set to $AE_DATA first"),
    S("prices.epc-per-home", "${PY} etl_epc.py extract && ${PY} etl_epc.py load ${DB}", ("prices.sales",),
      scope="london", why=PER_HOME, needs=("EPC",)),
    # The index before the sales: the sales load reruns every index-dependent rebuild on the new index.
    S("prices.price-index", "AE_WORK=${W}/sales ${PY} etl_price_release.py ${PRICE_END} ${DB}",
      ("prices.london-linked", "prices.address-spine"), scope="london", why=PER_HOME, lock=True),
    S("prices.aggregate", "AE_WORK=${E}/prices ${PY} etl_england_prices.py aggregate ${DB} && "
      "AE_WORK=${E}/prices ${PY} etl_england_prices.py diff ${DB}", ("prices.link", "core.cpih", "people.streets")),
    S("prices.sectors", "AE_WORK=${E}/prices ${PY} etl_england_prices.py sectors ${DB}", ("prices.postcodes",)),
    # The bundle adds every area outside London; applying it after a London rebuild puts England's rows back.
    S("prices.bundle", "AE_WORK=${E}/prices ${PY} etl_england_prices.py bundle ${DB} && "
      "gunzip -c ${BUNDLES}/prices/load.sql.gz | ${PSQL} -v ON_ERROR_STOP=1",
      ("prices.aggregate", "prices.sectors", "prices.hpi", "prices.rents", "prices.rent-trend", "prices.council-tax",
       "prices.price-index", "prices.sales"), lock=True, bundle="${BUNDLES}/prices/load.sql.gz"),
    S("prices.ownership", "AE_WORK=${W}/ownership ${PY} etl_ownership.py load ${DB}", ("people.postcodes",),
      scope="london", why="titles are placed in Greater London only so far (flag CLOSE_KNIT_OWNERSHIP)",
      lock=True, needs=("${W}/ownership",), manual="needs the owner's HM Land Registry CCOD/OCOD files"),
    S("prices.hmo", "AE_WORK=${W}/hmo ${PY} etl_hmo.py download && AE_WORK=${W}/hmo ${PY} etl_hmo.py load ${DB}",
      ("people.postcodes", "people.census-load"), scope="london", why="borough HMO registers (London councils)",
      lock=True),
    S("prices.pipeline", "AE_WORK=${W}/pipeline ${PY} etl_pipeline.py download && "
      "AE_WORK=${W}/pipeline ${PY} etl_pipeline.py load ${DB}", ("environment.noise-homes",), scope="london",
      why="GLA London Development Database, Opportunity Areas, Housing Zones", lock=True),

    # --- schools and kids --------------------------------------------------------------------------------
    S("schools.add-missing", "AE_DATA=${E}/schools/data ${PY} etl_schools.py add-missing ${DB}", ("core.geography",)),
    S("schools.independent", "AE_DATA=${E}/schools/data ${PY} etl_independent_schools.py fetch && "
      "AE_DATA=${E}/schools/data ${PY} etl_independent_schools.py load ${DB}", ("schools.add-missing",)),
    S("schools.gias", "AE_DATA=${E}/schools/data ${PY} school_history_common.py gias ${DB}", ("schools.add-missing",)),
    S("schools.performance", "AE_DATA=${E}/schools/data ${PY} etl_school_performance.py load ${DB} "
      "${DATA}/dfe-performance/2026-10 && AE_DATA=${E}/schools/data ${PY} etl_school_performance.py load ${DB} "
      "${E}/schools/absence/dfe-performance/2026-10", ("schools.gias",)),
    S("schools.ofsted", "AE_DATA=${E}/schools/data ${PY} etl_ofsted_history.py load ${DB} && "
      "AE_DATA=${E}/schools/data ${PY} etl_schools.py inspections ${DB}", ("schools.gias",)),
    S("schools.demand", "AE_DATA=${E}/schools/data ${PY} etl_school_demand.py load ${DB}", ("schools.gias",)),
    S("schools.facts", " && ".join(
        f"AE_DATA=${{E}}/schools/data ${{PY}} {script} fetch && AE_DATA=${{E}}/schools/data ${{PY}} {script} load ${{DB}}"
        for script in ("etl_school_profile.py", "etl_school_finance.py", "etl_school_workforce.py",
                       "etl_school_destinations.py")), ("schools.gias",)),
    S("schools.parent-view", "AE_DATA=${E}/schools/data ${PY} etl_school_parent_view.py load ${DB} && "
      "AE_DATA=${E}/schools/data ${PY} etl_school_parent_view.py load-earlier ${DB}", ("schools.gias",)),
    S("schools.kids", "${PY} etl_kids.py load ${DB} ${KIDS}", ("people.census-load",), lock=True),
    S("schools.admissions", "AE_DATA=${DATA} ${PY} etl_school_distances.py all ${DB}", ("schools.gias",),
      scope="london", why="council admission documents (London boroughs, per-council licences)"),
    S("schools.feeders", "${PY} etl_school_feeders.py fetch && ${PY} etl_school_feeders.py load ${DB}",
      ("schools.gias",), scope="london", why="GLA London Schools Atlas feeder flows"),
    S("schools.ofsted-reports", "${PY} etl_ofsted_reports.py run ${DB}", ("schools.ofsted",), scope="london",
      why="report text per PDF: days for England", manual="one request per inspection report PDF"),
    S("schools.stage", "AE_DATA=${E}/schools/data ${PY} school_history_common.py stage ${DB}",
      ("schools.independent", "schools.performance", "schools.ofsted", "schools.demand", "schools.facts",
       "schools.parent-view", "schools.kids", "schools.admissions", "schools.feeders"), lock=True),
    S("schools.bundle", "${PY} etl_england_schools_bundle.py ${DB} ${BUNDLES}/schools/load.sql.gz",
      ("schools.stage",), bundle="${BUNDLES}/schools/load.sql.gz"),

    # --- places ------------------------------------------------------------------------------------------
    S("places.osm", "AE_WORK=${E}/places/work/osm ${PY} -m area_analytics.places_load extract && "
      "AE_WORK=${E}/places/work/osm ${PY} -m area_analytics.places_load load ${DB} --no-poi", ("core.geography",),
      cwd="ingest", needs=("${E}/places/osm",)),
    S("places.overture", "OVERTURE_RAW_DIR=${E}/places/overture/2026-09-23.1 AE_WORK=${E}/places/work/overture "
      "${PY} -m area_analytics.overture_places extract ${DB} && OVERTURE_RAW_DIR=${E}/places/overture/2026-09-23.1 "
      "AE_WORK=${E}/places/work/overture ${PY} -m area_analytics.overture_places build", ("core.geography",),
      cwd="ingest"),
    S("places.fsq", "export FSQ_BASE=hf://datasets/foursquare/fsq-os-places FSQ_RELEASE=2026-09-15 "
      "FSQ_RAW_DIR=${E}/places/foursquare/2026-09-15 AE_WORK=${E}/places/work/fsq; "
      "${PY} -m area_analytics.fsq_places extract && ${PY} -m area_analytics.fsq_places build", ("core.geography",),
      cwd="ingest"),
    S("places.fhrs", "export FHRS_DIR=${E}/places/fhrs/2026-10-22 FHRS_RETRIEVED=2026-10-22 "
      "AE_WORK=${E}/places/work/fhrs; ${PY} -m area_analytics.food_hygiene download && "
      "${PY} -m area_analytics.food_hygiene build && ${PY} -m area_analytics.food_hygiene load ${DB}",
      ("core.geography",), cwd="ingest"),
    S("places.unified", "${PY} -m area_analytics.places_unified build-files ${DB} ${E}/places/build/place-england.tsv.gz"
      " && ${PY} -m area_analytics.places_unified load-files ${DB} ${E}/places/build/place-england.tsv.gz",
      ("places.osm", "places.overture", "places.fsq", "places.fhrs"), cwd="ingest"),
    S("places.step-free", "${PY} etl_quick_criteria.py step-free ${DB}", ("places.unified",), scope="london",
      why="TfL StopPoint lift access (London stations)"),
    S("places.food-hygiene", "${PY} etl_food_hygiene.py load ${DB}", ("places.fhrs",), lock=True, probe=True),
    S("places.supermarket-walk", "${PY} etl_layers_v5.py load ${DB} supermarket-walk", ("places.unified",),
      lock=True, probe=True),
    S("places.bundle", "${PY} etl_england_places_bundle.py ${DB} ${BUNDLES}/places/load.sql.gz",
      ("places.step-free", "places.food-hygiene", "places.supermarket-walk"), bundle="${BUNDLES}/places/load.sql.gz"),

    # --- environment -------------------------------------------------------------------------------------
    S("environment.homes", "${PY} england_homes.py build ${DB}", ("core.geography",),
      needs=("EPC", "${E}/environment/uprn/osopenuprn_202609_csv.zip")),
    S("environment.flood", "${PY} england_flood.py water && ${PY} england_flood.py tiles ${DB} 6 && "
      "${PY} england_flood.py compare ${DB} && ${PY} england_flood.py load ${DB}", ("environment.homes",)),
    S("environment.noise", "${PY} england_noise.py tiles 3 && ${PY} england_noise.py load ${DB}",
      ("environment.homes",)),
    S("environment.air", "${PY} england_air.py download && ${PY} england_air.py load ${DB}", ("environment.homes",)),
    S("environment.nature-sites", "AE_WORK=${E}/environment/nature ${PY} etl_nature.py sites ${DB}",
      ("core.geography",), lock=True),
    S("environment.roads", "${PY} etl_kids.py roads ${DB} ${KIDS}", ("people.census-load",), lock=True),
    # London's per-home environment build: noise and flood at every home of `property`.
    S("environment.flood-homes", "AE_WORK=${W}/flood ${PY} -m area_analytics.flood_risk download && "
      "AE_WORK=${W}/flood ${PY} -m area_analytics.flood_risk water && "
      "AE_WORK=${W}/flood ${PY} -m area_analytics.flood_risk load ${DB}", ("prices.property",), cwd="ingest",
      scope="london", why=PER_HOME),
    S("environment.noise-homes", "AE_WORK=${W}/noise ${PY} etl_noise.py download && "
      "AE_WORK=${W}/noise ${PY} etl_noise.py load ${DB}", ("prices.property",), scope="london", why=PER_HOME),
    S("environment.noise-layer", "${PY} etl_noise_layer.py load ${DB}", ("environment.noise", "environment.noise-homes"),
      lock=True, probe=True),
    S("environment.flood-risk", "${PY} etl_layers_v5.py load ${DB} flood-risk",
      ("environment.flood", "environment.flood-homes"), lock=True, probe=True),
    S("environment.air-london", "AE_WORK=${W}/health ${PY} etl_health.py download && "
      "AE_WORK=${W}/health ${PY} etl_health.py load-air ${DB} && AE_WORK=${W}/health ${PY} etl_health.py load-heat ${DB}",
      ("prices.property",), scope="london", why="GLA LAEI 20 m air model and GLA urban heat", lock=True),
    S("environment.nature-london", "AE_WORK=${W}/nature ${PY} etl_nature.py download && "
      "AE_WORK=${W}/nature ${PY} etl_nature.py load ${DB} && AE_WORK=${W}/nature ${PY} etl_nature.py layers ${DB}",
      ("prices.property", "environment.nature-sites"), scope="london",
      why="GLA street trees and Sentinel-2 green cover (80-150 GB for England: deferred)", lock=True),
    S("environment.wildlife", "AE_WORK=${W}/nature ${PY} etl_nature.py wildlife ${DB}", ("environment.nature-london",),
      scope="london", why="GBIF, one request per area: hours for London, ~33k for England",
      manual="several hours of rate-limited GBIF requests"),
    S("environment.canopy", "AE_WORK=${W}/nature ${PY} etl_canopy.py bundle ${W}/nature/canopy.sql.gz",
      ("environment.nature-london",), scope="london", why="GLA canopy cover tiles",
      bundle="${W}/nature/canopy.sql.gz"),
    S("environment.green-streets", "AE_WORK=${W}/green-streets ${PY} etl_green_streets.py download && "
      "AE_WORK=${W}/green-streets ${PY} etl_green_streets.py bundle ${DB} ${W}/green-streets/load.sql.gz",
      ("environment.nature-london",), scope="london", why="GLA public realm trees",
      bundle="${W}/green-streets/load.sql.gz"),
    S("environment.bundle", "${PY} etl_england_environment_bundle.py ${DB} ${BUNDLES}/environment/load.sql.gz",
      ("environment.flood", "environment.noise", "environment.air", "environment.nature-sites", "environment.roads",
       "environment.noise-layer", "environment.flood-risk"), bundle="${BUNDLES}/environment/load.sql.gz"),

    # --- civic and services ------------------------------------------------------------------------------
    S("civic.councils", "AE_WORK=${E}/civic/work ${PY} -m area_analytics.civic download && "
      "AE_WORK=${E}/civic/work ${PY} -m area_analytics.civic build && "
      "AE_WORK=${E}/civic/work ${PY} -m area_analytics.civic load ${DB} civic", ("people.postcodes",), cwd="ingest"),
    S("civic.locations", "AE_PLANNING_DATA=${E}/civic/planning ${PY} -m area_analytics.location_layers download && "
      "AE_PLANNING_DATA=${E}/civic/planning ${PY} -m area_analytics.location_layers load ${DB}", ("core.geography",),
      cwd="ingest", needs=("${E}/civic/planning/conservation-area.csv",)),
    S("civic.restrictions", "AE_WORK=${W}/home ${PY} etl_home.py load ${DB} restrictions", ("civic.councils",)),
    S("civic.broadband", "AE_WORK=${W}/home ${PY} etl_home.py load ${DB} broadband", ("core.geography",)),
    S("civic.gp", "AE_WORK=${W}/health ${PY} etl_health.py load-gp ${DB}", ("people.postcodes",)),
    S("civic.mobile", "AE_WORK=${W}/mobile ${PY} etl_mobile.py download && AE_WORK=${W}/mobile ${PY} etl_mobile.py "
      "load ${DB}", ("core.geography",), lock=True, probe=True),
    S("civic.layers", "${PY} etl_layers_v5.py load ${DB} gp-walk broadband-gigabit", ("civic.gp", "civic.broadband"),
      lock=True, probe=True),
    S("civic.future-transport", "AE_WORK=${W}/future-transport ${PY} etl_future_transport.py download && "
      "AE_WORK=${W}/future-transport ${PY} etl_future_transport.py load ${DB}", ("core.geography",), scope="london",
      why="a hand-curated list of TfL and GLA schemes", lock=True),
    S("civic.bundle", "${PY} etl_england_civic_bundle.py ${DB} ${BUNDLES}/civic/load.sql.gz",
      ("civic.councils", "civic.locations", "civic.restrictions", "civic.mobile", "civic.layers"),
      bundle="${BUNDLES}/civic/load.sql.gz"),

    # --- transport ---------------------------------------------------------------------------------------
    S("transport.stations", "AE_WORK=${E}/transport/stations AE_OSM_PBF=${OSM_PBF} ${PY} etl_station_access.py download"
      " && AE_WORK=${E}/transport/stations ${PY} etl_station_access.py homes ${DB} && "
      "AE_RELEASE_LOCK=${LOCK} AE_WORK=${E}/transport/stations ${PY} etl_station_access.py load ${DB} && "
      "${PY} etl_station_access.py naptan-check ${DB}", ("people.postcodes", "prices.property"), needs=("EPC",)),
    S("transport.commute", "${PY} etl_commute.py load ${DB} ${W}/commute/matrix.csv ${W}/commute/itineraries.csv",
      ("core.geography",), scope="london", why="TfL timetables and the R5 graph of 32 London hubs",
      needs=("${W}/commute/matrix.csv",)),
    S("transport.bundle", "AE_WORK=${E}/transport/stations ${PY} etl_station_access.py bundle ${DB} "
      "${BUNDLES}/transport/load.sql.gz", ("transport.stations",), bundle="${BUNDLES}/transport/load.sql.gz"),
)

THEMES = ("core", "people", "crime", "prices", "schools", "places", "environment", "civic", "transport")

# A refresh (etl.py refresh <name>): these steps in this order, each stage only, then one activation of the
# release they compose, after release_build has built it (release_guard.finish). "prices" is the monthly HM Land
# Registry Price Paid refresh: London's per-home build (spine, £/m² index, sales), then England's area bundle.
REFRESH = {
    "prices": ("prices.link", "prices.london-linked", "prices.address-spine", "prices.price-index", "prices.sales",
               "prices.aggregate", "prices.sectors", "prices.bundle"),
}

# Map metrics whose London cells the London diff (london_snapshot.py) checks, per theme.
THEME_METRICS = {
    "people": ("deprivation", "income", "social-renting", "short-lets-per-1000", "census-tenure-owned",
               "census-age-0-14", "census-arrival-born-in-the-uk"),
    "crime": ("crime",),
    "prices": ("price-per-square-metre", "stock-value-per-square-metre", "typical-price", "typical-price-flat",
               "hpi-change-5y", "hpi-change-10y", "rent-change-1y", "typical-rent", "council-tax-band-mean",
               "hmo-per-1000", "pipeline-homes-per-1000"),
    "places": ("food-hygiene", "supermarket-walk"),
    "environment": ("flood-risk", "noise", "nature-score", "road-collisions", "wildlife-fox"),
    "civic": ("broadband-gigabit", "gp-walk", "mobile-4g-indoor", "mobile-5g-outdoor"),
    "transport": ("station-access", "future-station-distance"),
}
SNAPSHOT_CELLS = {"people": 30, "crime": 20, "prices": 50, "places": 20, "environment": 40, "civic": 25,
                  "transport": 15}

# London cells that differ from the snapshot on purpose: metric -> why. The diff lists them but does not fail.
INTENTIONAL_LONDON_DIFFS = {
    "nature-score": "national nature sites (Natural England) replaced London's: edge areas may get a nearer site",
    "station-access": "England build reads the newer OSM extract (2026-10-20) and counts stations over the boundary",
    "gp-walk": "the national GP list is a newer fetch; practices near the boundary count",
}

# Value tolerance of the diff: |new - old| <= ABS + REL * |old|; percentiles within PERCENTILE points.
TOLERANCE = {"abs": 1e-6, "rel": 1e-4, "percentile": 0}


def step(step_id: str) -> Step:
    for item in STEPS:
        if item.id == step_id:
            return item
    raise KeyError(step_id)
