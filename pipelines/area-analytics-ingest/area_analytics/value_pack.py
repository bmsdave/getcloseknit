import re
from typing import Any, Iterable, Mapping


REQUIRED_SOURCE_FIELDS = {
    "id", "release", "url", "sha256", "licence", "attribution",
    "transformationVersion", "retrievedAt", "geographyVintage",
    "validationStatus", "caveats",
}

REQUIRED_RELEASE_FIELDS = {
    "id", "geographyVintage", "transformationVersions", "members",
    "assets", "validationStatus", "validationRecord",
}


def build_value_pack(
    metric_id: str,
    period: str,
    source: Mapping[str, Any],
    values: Iterable[Mapping[str, Any]],
    release_id: str | None = None,
) -> dict[str, Any]:
    missing = REQUIRED_SOURCE_FIELDS - source.keys()
    if missing:
        raise ValueError(f"source provenance missing: {', '.join(sorted(missing))}")
    if not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
        raise ValueError("source sha256 must be 64 lowercase hexadecimal characters")
    if not isinstance(source["caveats"], list):
        raise ValueError("source caveats must be a list")
    if source["validationStatus"] != "passed":
        raise ValueError("source validation status must be passed")
    ordered = sorted((dict(value) for value in values), key=lambda value: value["geographyId"])
    pack = {
        "schemaVersion": "area-value-pack.v1",
        "metricId": metric_id,
        "period": period,
        "source": dict(source),
        "values": ordered,
    }
    if release_id is not None:
        pack["releaseId"] = release_id
    return pack


def validate_release_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_RELEASE_FIELDS - manifest.keys()
    if missing:
        raise ValueError(f"release manifest missing: {', '.join(sorted(missing))}")
    members = manifest["members"]
    if not isinstance(members, list) or not members:
        raise ValueError("release manifest members must be a non-empty list")
    for member in members:
        _require_member_provenance(member)
    if manifest["validationStatus"] != "passed":
        raise ValueError("release validation status must be passed")
    _require_documented_cadences(manifest, members)
    return {**dict(manifest), "members": [dict(member) for member in members]}


def assert_pack_in_release(pack: Mapping[str, Any], manifest: Mapping[str, Any]) -> bool:
    release_id = pack.get("releaseId")
    if release_id != manifest["id"]:
        raise ValueError(f"value pack release {release_id!r} is not the active release")
    member_ids = {(member["source"], member["release"]) for member in manifest["members"]}
    source = pack["source"]
    if (source["id"], source["release"]) not in member_ids:
        raise ValueError("value pack source is not a member of the release")
    return True


def _require_member_provenance(member: Mapping[str, Any]) -> None:
    needed = {"source", "release", "cadence"} | REQUIRED_SOURCE_FIELDS
    absent = needed - member.keys() - {"id"}
    if absent:
        raise ValueError(f"release member provenance missing: {', '.join(sorted(absent))}")
    if member["validationStatus"] != "passed":
        raise ValueError("release member validation status must be passed")


def _require_documented_cadences(manifest: Mapping[str, Any], members: list) -> None:
    cadences = {member["cadence"] for member in members}
    if len(cadences) < 2:
        return
    if not manifest.get("documentsMixedCadence") or not manifest.get("cadenceNote"):
        raise ValueError("mixed source cadences need documentsMixedCadence and cadenceNote")
