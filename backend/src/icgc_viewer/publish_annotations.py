"""Prepare existing lists for a client-managed static host. Never writes to the source tree."""
import argparse
import json
import re
from copy import deepcopy
from pathlib import Path

from .settings import load_settings


def adapt_list(data: dict, public_id: str) -> dict:
    if not isinstance(data, dict) or data.get("@type") != "sc:AnnotationList" or not isinstance(data.get("resources"), list):
        raise ValueError("Expected sc:AnnotationList with resources")
    old_id = data.get("@id")
    if not isinstance(old_id, str) or "#" in old_id:
        raise ValueError("Expected a list ID without a fragment")
    result = deepcopy(data)
    result["@id"] = public_id
    for annotation in result["resources"]:
        if not isinstance(annotation, dict):
            raise TypeError("Expected annotation objects in resources")
        identifier = annotation.get("@id", "")
        if not isinstance(identifier, str) or not identifier.startswith(old_id + "#"):
            raise ValueError("Annotation ID must be a fragment of its original list ID")
        if not isinstance(annotation.get("on"), str) or "#xywh=" not in annotation["on"]:
            raise ValueError("Expected an original canvas target with #xywh")
        annotation["@id"] = public_id + identifier[len(old_id):]
    return result


def publish(source: Path, destination: Path, settings) -> int:
    source, destination = source.resolve(), destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Source and output must be separate, non-overlapping directories")
    if not source.is_dir():
        raise ValueError(f"Annotation source directory does not exist: {source}")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Output directory must be empty; publish into a new release directory")
    pending = []
    for file in sorted(source.glob("*/*/*.json")):
        if file.is_symlink() or source not in file.resolve().parents:
            raise ValueError(f"Source file escapes the annotation directory: {file}")
        collection, record_id, filename = file.relative_to(source).parts
        kind = file.stem
        if collection not in settings.allowed_collections or not re.fullmatch(r"[0-9]{1,12}", record_id):
            raise ValueError(f"Unexpected collection or record: {file}")
        if filename not in {"detections.json", "transcriptions.json"}:
            raise ValueError(f"Unexpected annotation filename: {file}")
        data = adapt_list(json.loads(file.read_text(encoding="utf-8")),
                          settings.annotation_url(collection, record_id, kind))
        relative = settings.annotation_path_template.format(collection=collection, id=record_id, kind=kind)
        pending.append((destination / relative.lstrip("/"), data))
    if not pending:
        raise ValueError("No annotation lists found under source/{collection}/{id}/*.json")
    # Validate the whole release before writing; prepared lists are held in memory.
    for path, data in pending:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(pending)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Defaults to annotation_dir in configuration")
    parser.add_argument("--output", type=Path, required=True, help="New static release directory")
    args = parser.parse_args()
    try:
        settings = load_settings()
        count = publish(args.source or settings.annotation_dir, args.output, settings)
    except (ValueError, TypeError, OSError) as exc:
        raise SystemExit(f"Annotation publication failed: {exc}") from exc
    print(f"Prepared {count} lists in {args.output}. Original canvas targets and source files are unchanged.")
