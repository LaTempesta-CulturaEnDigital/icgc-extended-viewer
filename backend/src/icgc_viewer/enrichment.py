from copy import deepcopy
from urllib.parse import urlsplit


class UnsupportedManifest(ValueError):
    pass


def canvas_from_manifest(manifest: dict) -> dict:
    try:
        if manifest.get("@type") != "sc:Manifest":
            raise ValueError("Expected a IIIF Presentation 2 sc:Manifest")
        sequences = manifest["sequences"]
        if not isinstance(sequences, list) or len(sequences) != 1:
            raise ValueError("Exactly one sequence is supported")
        canvases = sequences[0]["canvases"]
        if not isinstance(canvases, list) or len(canvases) != 1:
            raise ValueError("Exactly one canvas is supported")
        canvas = canvases[0]
        if not isinstance(canvas["@id"], str) or not canvas["@id"]:
            raise ValueError("Canvas ID is missing")
        for dimension in ["width", "height"]:
            if not isinstance(canvas[dimension], (int, float)) or not 0 < canvas[dimension] < 1e9:
                raise ValueError("Canvas dimensions must be positive")
        images = canvas["images"]
        if not isinstance(images, list) or len(images) != 1 or images[0]["on"] != canvas["@id"]:
            raise ValueError("Exactly one image painted on the full canvas is supported")
        service = images[0]["resource"]["service"]
        if not isinstance(service, dict) or urlsplit(service["@id"]).scheme not in {"http", "https"}:
            raise ValueError("An HTTP(S) IIIF image service is required")
        return canvas
    except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
        raise UnsupportedManifest(str(exc)) from exc


def enrich_manifest(manifest: dict, public_id: str, references: list[str], aliases: dict[str, str]) -> dict:
    """Pure transformation: preserve source content, alter only identity and managed list references."""
    result = deepcopy(manifest)
    canvas = canvas_from_manifest(result)
    existing = canvas.get("otherContent", [])
    if isinstance(existing, (dict, str)):
        existing = [existing]
    if not isinstance(existing, list):
        raise UnsupportedManifest("otherContent must contain annotation-list references")
    output, seen_managed = [], set()
    for entry in existing:
        identifier = entry.get("@id") if isinstance(entry, dict) else entry
        if not isinstance(identifier, str):
            raise UnsupportedManifest("An otherContent reference has no string ID")
        canonical = aliases.get(identifier, identifier)
        if canonical in references:
            if canonical in seen_managed:
                # Keep entries with additional properties rather than silently losing source data.
                previous = next(item for item in output if isinstance(item, dict) and item.get("@id") == canonical)
                if isinstance(entry, dict):
                    for key, value in entry.items():
                        if key != "@id" and key in previous and previous[key] != value:
                            raise UnsupportedManifest("Conflicting duplicate annotation-list references")
                        if key != "@id":
                            previous[key] = value
                continue
            entry = {**entry, "@id": canonical} if isinstance(entry, dict) else {
                "@id": canonical, "@type": "sc:AnnotationList"}
            seen_managed.add(canonical)
        output.append(entry)
    output.extend({"@id": ref, "@type": "sc:AnnotationList"} for ref in references if ref not in seen_managed)
    canvas["otherContent"] = output
    result["@id"] = public_id
    return result
