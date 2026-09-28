import json
from copy import deepcopy
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from icgc_viewer.app import create_app
from icgc_viewer.enrichment import UnsupportedManifest, enrich_manifest
from icgc_viewer.publish_annotations import adapt_list, publish
from icgc_viewer.settings import Settings, load_settings

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def original():
    return json.loads((FIXTURES / "manifests/fonscec_1021.json").read_text(encoding="utf-8"))


def test_preservation_and_idempotence():
    source = original()
    saved = deepcopy(source)
    canvas = source["sequences"][0]["canvases"][0]
    canvas["otherContent"] = [{"@id": "https://other.example/list", "label": "Original"},
                              {"@id": "https://old.example/d", "label": "Deteccions"}]
    saved = deepcopy(source)
    result = enrich_manifest(source, "https://new.example/manifest.json", ["https://new.example/d", "https://new.example/t"],
                             {"https://old.example/d": "https://new.example/d"})
    assert source == saved
    assert enrich_manifest(result, result["@id"], ["https://new.example/d", "https://new.example/t"], {}) == result
    patched_canvas = result["sequences"][0]["canvases"][0]
    assert len(patched_canvas["otherContent"]) == 3
    assert patched_canvas["otherContent"][1]["label"] == "Deteccions"
    result["@id"] = saved["@id"]
    patched_canvas["otherContent"] = saved["sequences"][0]["canvases"][0]["otherContent"]
    assert result == saved  # All metadata, service objects, canvas/range/sequence IDs and fields preserved.


def test_duplicate_string_and_object_references():
    source = original()
    source["sequences"][0]["canvases"][0]["otherContent"] = ["https://a/d", {"@id": "https://a/d", "label": "D"}]
    result = enrich_manifest(source, "https://a/m", ["https://a/d", "https://a/t"], {})
    assert result["sequences"][0]["canvases"][0]["otherContent"] == [
        {"@id": "https://a/d", "@type": "sc:AnnotationList", "label": "D"},
        {"@id": "https://a/t", "@type": "sc:AnnotationList"}]


@pytest.mark.parametrize("change", ["multi", "v3", "bad_other", "cropped", "bad_service"])
def test_unsupported(change):
    source = original()
    canvas = source["sequences"][0]["canvases"][0]
    if change == "multi":
        source["sequences"][0]["canvases"].append(deepcopy(canvas))
    elif change == "v3":
        source = {"type": "Manifest", "items": []}
    elif change == "bad_other":
        canvas["otherContent"] = 42
    elif change == "cropped":
        canvas["images"][0]["on"] += "#xywh=0,0,100,100"
    else:
        canvas["images"][0]["resource"]["service"] = {}
    with pytest.raises(UnsupportedManifest):
        enrich_manifest(source, "https://a/m", ["https://a/d"], {})


@pytest.mark.parametrize("prefix,mode,internal", [("", "preserve", ""), ("/maps", "preserve", "/maps"),
                                                 ("/maps", "strip", "")])
def test_routes_runtime_config_and_cache(prefix, mode, internal):
    requests = []

    def upstream(request):
        requests.append(str(request.url))
        return httpx.Response(200, json=original())

    settings = Settings(public_base_url="https://viewer.example" + prefix, prefix_mode=mode,
                        annotation_base_url="https://static.example/archive")
    with TestClient(create_app(settings, httpx.MockTransport(upstream))) as client:
        url = internal + "/iiif/info/fonscec/1021/manifest.json"
        response = client.get(url)
        assert response.status_code == 200
        assert response.json()["@id"] == "https://viewer.example" + prefix + "/iiif/info/fonscec/1021/manifest.json"
        refs = response.json()["sequences"][0]["canvases"][0]["otherContent"]
        assert refs[0]["@id"] == "https://static.example/archive/iiif/annotations/fonscec/1021/detections.json"
        assert client.get(url).json() == response.json()
        assert requests == ["https://cartotecadigital.icgc.cat/iiif/info/fonscec/1021/manifest.json"]
        config = client.get(internal + "/config.json")
        assert config.json()["manifestTemplate"].startswith("https://viewer.example" + prefix + "/iiif/")
        assert "upstream_base_url" not in config.json()
        assert config.headers["cache-control"] == "no-store"
        assert client.get(internal + "/viewer/").status_code == 404
        assert client.get(internal + "/viewer/asset.js").status_code == 404
        assert client.get(internal + "/health/ready").status_code == 200
        assert client.get(internal + "/iiif/info/other/1/manifest.json").status_code == 404
        assert client.get(internal + "/iiif/info/fonscec/abc/manifest.json").status_code == 400
        assert len(requests) == 1  # No annotation host requests or arbitrary proxying.


@pytest.mark.parametrize("status,body,expected", [(404, {}, 404), (503, {}, 502), (302, {}, 502),
                                                (200, [], 502), (200, {"items": []}, 422)])
def test_upstream_failures(status, body, expected):
    transport = httpx.MockTransport(lambda _: httpx.Response(status, json=body))
    with TestClient(create_app(Settings(), transport)) as client:
        assert client.get("/iiif/info/fonscec/308/manifest.json").status_code == expected


def test_timeout_and_response_limit():
    def timeout(_):
        raise httpx.ReadTimeout("timeout")
    for transport, expected in [(httpx.MockTransport(timeout), 504),
                                (httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * 2048)), 502)]:
        with TestClient(create_app(Settings(upstream_max_bytes=1024), transport)) as client:
            assert client.get("/iiif/info/fonscec/308/manifest.json").status_code == expected


def test_same_origin_redirect_chain_is_bounded():
    requests = []

    def upstream(request):
        requests.append(str(request.url))
        if len(requests) < 3:
            return httpx.Response(302, headers={"location": f"/canonical-{len(requests)}"})
        return httpx.Response(200, json=original())

    with TestClient(create_app(Settings(), httpx.MockTransport(upstream))) as client:
        assert client.get("/iiif/info/fonscec/1021/manifest.json").status_code == 200
        assert len(requests) == 3
    loop = httpx.MockTransport(lambda _: httpx.Response(301, headers={"location": "/loop"}))
    with TestClient(create_app(Settings(upstream_max_redirects=1), loop)) as client:
        assert client.get("/iiif/info/fonscec/1021/manifest.json").json()["detail"]["code"] == "upstream_redirect_rejected"


@pytest.mark.parametrize("target", ["https://other.example/file", "http://cartotecadigital.icgc.cat/file",
                                    "https://cartotecadigital.icgc.cat:8443/file",
                                    "https://user:password@cartotecadigital.icgc.cat/file"])
def test_redirect_cannot_escape_upstream(target):
    requests = []

    def upstream(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"location": target})

    with TestClient(create_app(Settings(), httpx.MockTransport(upstream))) as client:
        assert client.get("/iiif/info/fonscec/1021/manifest.json").status_code == 502
        assert len(requests) == 1


@pytest.mark.parametrize("settings", [
    {"upstream_base_url": "file:///etc"}, {"annotation_base_url": "https://a/../b"},
    {"manifest_path_template": "/health/{collection}/{id}"}, {"annotation_path_template": "/{collection}/{id}.json"},
    {"cors_origins": ["https://a; script-src *"]}, {"port": 0},
    {"upstream_manifest_template": "//evil/{collection}/{id}"},
    {"annotation_base_url": "https://static.example:wrong"},
    {"public_base_url": "https://api.example:99999"},
])
def test_invalid_configuration(settings):
    with pytest.raises(ValueError):
        Settings(**settings)


def test_static_publication_preserves_original_targets_and_text(tmp_path):
    source = json.loads((FIXTURES / "annotations/catalunya/1037/transcriptions.json").read_text(encoding="utf-8"))
    result = adapt_list(source, "https://static.example/maps/transcriptions.json")
    assert result["resources"][0]["@id"].startswith("https://static.example/maps/transcriptions.json#")
    for before, after in zip(source["resources"], result["resources"]):
        assert after["on"] == before["on"]
        assert after["resource"] == before["resource"]
    assert source["@id"].startswith("https://icgc.latempesta.cc")
    settings = Settings(annotation_base_url="https://static.example/prefix")
    assert publish(FIXTURES / "annotations", tmp_path / "release", settings) == 8
    empty = json.loads((tmp_path / "release/iiif/annotations/fonscec/1019/detections.json").read_text())
    assert empty["resources"] == []
    assert empty["@id"] == "https://static.example/prefix/iiif/annotations/fonscec/1019/detections.json"
    with pytest.raises(ValueError, match="empty"):
        publish(FIXTURES / "annotations", tmp_path / "release", settings)
    with pytest.raises(ValueError, match="non-overlapping"):
        publish(FIXTURES / "annotations", FIXTURES / "annotations/output", settings)


def test_cross_host_configuration_and_manifest_cors():
    settings = Settings(cors_origins=["https://website.example/"])
    with TestClient(create_app(settings)) as client:
        response = client.get("/config.json", headers={"Origin": "https://website.example"})
        assert response.headers["access-control-allow-origin"] == "https://website.example"
        assert "access-control-allow-origin" not in client.get("/config.json", headers={"Origin": "https://other.example"}).headers


def test_configuration_file_and_environment_precedence(tmp_path, monkeypatch):
    config = tmp_path / "config.toml"
    config.write_text('annotation_base_url = "https://static.example/files"\nport = 8000\n', encoding="utf-8")
    monkeypatch.setenv("ICGC_CONFIG", str(config))
    monkeypatch.setenv("ICGC_PORT", "8002")
    monkeypatch.setenv("ICGC_CORS_ORIGINS", '["https://viewer.example/"]')
    settings = load_settings()
    assert settings.port == 8002
    assert settings.cors_origins == ["https://viewer.example"]
    assert settings.annotation_base_url == "https://static.example/files"
    config.write_text('unknown_option = "typo"\n', encoding="utf-8")
    with pytest.raises(ValueError):
        load_settings()


@pytest.mark.parametrize("malformed", [None, [], {"@type": "sc:AnnotationList", "@id": "https://a/list",
                                              "resources": [None]}])
def test_publication_rejects_malformed_lists_before_writing(tmp_path, malformed):
    source = tmp_path / "source"
    record = source / "fonscec/1021"
    record.mkdir(parents=True)
    valid = json.loads((FIXTURES / "annotations/fonscec/1021/detections.json").read_text(encoding="utf-8"))
    (record / "detections.json").write_text(json.dumps(valid), encoding="utf-8")
    (record / "transcriptions.json").write_text(json.dumps(malformed), encoding="utf-8")
    destination = tmp_path / "release"
    with pytest.raises((ValueError, TypeError)):
        publish(source, destination, Settings())
    assert not destination.exists()
