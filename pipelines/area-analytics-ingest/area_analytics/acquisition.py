from dataclasses import dataclass
from hashlib import sha256
from typing import Callable, Union

from .sources import SourceDefinition, source_definition

FetchResult = Union[bytes, tuple]


@dataclass(frozen=True)
class AcquiredRelease:
    manifest: dict
    content: bytes


def acquire_release(
    source_id: str,
    release: str,
    retrieved_at: str,
    geography_vintage: str,
    transformation_version: str,
    fetch: Callable[[str], object],
    *,
    expected_sha256: Union[str, None] = None,
) -> AcquiredRelease:
    source = source_definition(source_id)
    _require_approved_licence(source_id, source)
    _require_active_status(source_id, source)
    _require_review_fixture(source_id, source)
    _require_geography_vintage(source_id, source, geography_vintage)
    content, content_type = _fetch_payload(source, fetch)
    _reject_html_payload(source_id, content, content_type)
    _require_content_type(source_id, source, content_type)
    _require_checksum(source_id, content, expected_sha256)
    details = {
        "release": release,
        "retrievedAt": retrieved_at,
        "geographyVintage": geography_vintage,
        "transformationVersion": transformation_version,
    }
    manifest = _build_manifest(source_id, source, details, content)
    return AcquiredRelease(manifest, content)


def _build_manifest(
    source_id: str, source: SourceDefinition, details: dict, content: bytes
) -> dict:
    return {
        "id": source_id,
        "release": details["release"],
        "url": source.url,
        "landingUrl": source.landing_url,
        "retrievedAt": details["retrievedAt"],
        "sha256": sha256(content).hexdigest(),
        "licence": source.licence,
        "licenceDecision": source.licence_decision,
        "sourceStatus": source.status,
        "publisher": source.publisher,
        "accessMethod": source.access_method,
        "permittedUse": source.permitted_use,
        "attribution": source.attribution,
        "geographyVintage": details["geographyVintage"],
        "carrierPolicy": source.carrier_policy,
        "transformationVersion": details["transformationVersion"],
        "validationStatus": "passed",
        "reviewFixture": source.fixture,
        "caveats": list(source.caveats),
    }


def _require_approved_licence(source_id: str, source: SourceDefinition) -> None:
    if source.licence_decision != "approved":
        raise ValueError(
            f"licence decision for {source_id} is {source.licence_decision!r}; "
            "acquisition needs an approved review"
        )


def _require_active_status(source_id: str, source: SourceDefinition) -> None:
    if source.status != "active":
        raise ValueError(
            f"source {source_id} is blocked and cannot enter an active release"
        )


def _require_review_fixture(source_id: str, source: SourceDefinition) -> None:
    if not source.fixture:
        raise ValueError(
            f"source {source_id} has no approved government-shaped fixture"
        )


def _require_geography_vintage(
    source_id: str, source: SourceDefinition, geography_vintage: str
) -> None:
    if source.geography_vintage and geography_vintage != source.geography_vintage:
        raise ValueError(
            f"source {source_id} geography vintage must be {source.geography_vintage!r}"
        )


def _fetch_payload(
    source: SourceDefinition, fetch: Callable[[str], object]
) -> tuple[bytes, str]:
    result = fetch(source.url)
    content, content_type = _coerce_result(result)
    if not isinstance(content, bytes) or not content:
        raise ValueError("source acquisition returned no bytes")
    return content, content_type


def _coerce_result(result: object) -> tuple[bytes, str]:
    if isinstance(result, bytes):
        return result, ""
    if isinstance(result, (tuple, list)) and len(result) == 2:
        content, content_type = result
        if isinstance(content, bytes) and isinstance(content_type, str):
            return content, _base_content_type(content_type)
    raise ValueError("source acquisition returned no bytes")


def _base_content_type(content_type: str) -> str:
    return content_type.split(";")[0].strip().lower()


def _reject_html_payload(source_id: str, content: bytes, content_type: str) -> None:
    if content_type == "text/html":
        raise ValueError(
            f"source {source_id} returned an html landing page instead of data bytes"
        )
    head = content.lstrip()[:64].lower()
    if head.startswith((b"<!doctype html", b"<html", b"<head")):
        raise ValueError(
            f"source {source_id} returned an html landing page instead of data bytes"
        )


def _require_content_type(
    source_id: str, source: SourceDefinition, content_type: str
) -> None:
    expected = source.expected_content_type
    if expected and content_type and content_type != expected:
        raise ValueError(
            f"source {source_id} returned unexpected content type {content_type!r}"
        )


def _require_checksum(
    source_id: str, content: bytes, expected_sha256: Union[str, None]
) -> None:
    if expected_sha256 is None:
        return
    if sha256(content).hexdigest() != expected_sha256:
        raise ValueError(f"source {source_id} acquisition checksum mismatch")
