#!/usr/bin/env python3
"""Servidor local de TRB con descarga/caché de KMZ y geometría JSON para el mapa.

Uso recomendado:
    python serve_trb.py --prepare --open

Uso rápido después de la primera preparación:
    python serve_trb.py --open
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import posixpath
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import unicodedata
import webbrowser
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load_local_environment() -> None:
    """Carga .env.local/.env para que el usuario solo tenga que pegar su clave una vez."""
    for env_path in (ROOT / '.env.local', ROOT / '.env'):
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding='utf-8-sig').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip().strip('\"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

load_local_environment()
CATALOG_PATH = ROOT / "data" / "trb_catalogo_rutas.json"
KMZ_ROOT = ROOT / "kmz"
GEOMETRY_ROOT = ROOT / "route_geometry"
GEOJSON_ROOT = ROOT / "data" / "geojson"
ROUTING_CACHE_ROOT = ROOT / "routing_cache"
GEOCODER_CACHE_ROOT = ROOT / "geocoder_cache"
PHOTON_URL = os.environ.get("TRB_PHOTON_URL", "https://photon.komoot.io/api/").strip()
OVERPASS_URL = os.environ.get("TRB_OVERPASS_URL", "https://overpass-api.de/api/interpreter").strip()
GOOGLE_PLACES_API_KEY = os.environ.get("TRB_GOOGLE_PLACES_API_KEY", "").strip()
GOOGLE_GEOCODING_API_KEY = os.environ.get("TRB_GOOGLE_GEOCODING_API_KEY", GOOGLE_PLACES_API_KEY).strip()
DRIVER_TOKEN = os.environ.get("TRB_DRIVER_TOKEN", "").strip()
LIVE_VEHICLES_PATH = ROOT / "data" / "live_vehicles.json"
LIVE_VEHICLES_LOCK = threading.Lock()
GEOCODER_CACHE_TTL = int(os.environ.get("TRB_GEOCODER_CACHE_TTL", str(30 * 24 * 60 * 60)))
USER_AGENT = os.environ.get("TRB_USER_AGENT", "TRB-Movilidad/26.0 (Barranquilla public transport planner)")
DOWNLOAD_WORKERS = 8


def load_catalog_data() -> tuple[dict[str, str], dict[str, dict]]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    routes: dict[str, str] = {}
    by_id: dict[str, dict] = {}
    for route in data.get("rutas", []):
        relative = str(route.get("kmz", "")).replace("\\", "/").lstrip("/")
        official = str(route.get("url_oficial", "")).strip()
        route_id = str(route.get("id", "")).strip()
        if relative and official:
            routes[relative] = official
        if route_id:
            by_id[route_id] = route
    if len(routes) != 93:
        raise RuntimeError(f"Se esperaban 93 rutas en el catálogo y se encontraron {len(routes)}")
    return routes, by_id


ROUTE_URLS, ROUTES_BY_ID = load_catalog_data()
PREFETCH_LOCK = threading.Lock()
GEOMETRY_LOCKS: dict[str, threading.Lock] = {}
PREFETCH_STATE = {
    "running": False,
    "completed": 0,
    "total": len(ROUTE_URLS),
    "success": 0,
    "errors": [],
    "started_at": None,
    "finished_at": None,
}


ROUTING_PROFILES = {
    "walk": [
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/{coordinates}",
    ],
    "bike": [
        "https://routing.openstreetmap.de/routed-bike/route/v1/driving/{coordinates}",
    ],
    "car": [
        "https://routing.openstreetmap.de/routed-car/route/v1/driving/{coordinates}",
        "https://router.project-osrm.org/route/v1/driving/{coordinates}",
    ],
}


def parse_routing_points(raw: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for item in str(raw or "").split(";"):
        if not item.strip():
            continue
        parts = item.split(",")
        if len(parts) != 2:
            raise ValueError("formato de puntos inválido")
        lng, lat = map(float, parts)
        if not (-75.25 <= lng <= -74.40 and 10.60 <= lat <= 11.35):
            raise ValueError("punto fuera del área metropolitana de Barranquilla")
        points.append((lng, lat))
    if len(points) < 2:
        raise ValueError("se requieren al menos dos puntos")
    if len(points) > 30:
        raise ValueError("demasiados puntos de enrutamiento")
    return points


def network_route(mode: str, raw_points: str) -> dict:
    mode = str(mode or "").lower().strip()
    if mode not in ROUTING_PROFILES:
        raise ValueError("modo de enrutamiento no válido")
    points = parse_routing_points(raw_points)
    coordinate_text = ";".join(f"{lng:.6f},{lat:.6f}" for lng, lat in points)
    cache_key = hashlib.sha256(f"{mode}|{coordinate_text}".encode("utf-8")).hexdigest()
    cache_path = ROUTING_CACHE_ROOT / f"{cache_key}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("ok") and cached.get("geometry"):
                cached["cached"] = True
                return cached
        except Exception:
            cache_path.unlink(missing_ok=True)

    params = urllib.parse.urlencode({"overview": "full", "geometries": "geojson", "steps": "false"})
    last_error: Exception | None = None
    for template in ROUTING_PROFILES[mode]:
        url = f"{template.format(coordinates=coordinate_text)}?{params}"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=22) as response:
                payload = json.loads(response.read().decode("utf-8"))
            routes = payload.get("routes") or []
            if not routes:
                raise RuntimeError("el enrutador no devolvió rutas")
            route = routes[0]
            coordinates = ((route.get("geometry") or {}).get("coordinates") or [])
            geometry = [[float(lat), float(lng)] for lng, lat in coordinates if isinstance(lng, (int, float)) and isinstance(lat, (int, float))]
            if len(geometry) < 2:
                raise RuntimeError("geometría vacía")
            result = {
                "ok": True,
                "mode": mode,
                "distance": float(route.get("distance") or 0),
                "duration": float(route.get("duration") or 0),
                "geometry": geometry,
                "source": urllib.parse.urlsplit(url).netloc,
                "cached": False,
            }
            ROUTING_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
            temporary = cache_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, cache_path)
            return result
        except Exception as error:
            last_error = error
    raise RuntimeError(f"no se pudo ajustar el trayecto a la red vial: {last_error}")



def normalize_place_text(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", normalized.lower()).strip()


def normalize_colombian_address(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    substitutions = [
        (r"\bcarreara\b|\bkarrera\b", "Carrera"),
        (r"\b(?:cra|cr|kr)\.?\s*(?=\d)", "Carrera "),
        (r"\b(?:cl|cll)\.?\s*(?=\d)", "Calle "),
        (r"\bdiag\.?\s*(?=\d)", "Diagonal "),
        (r"\btransv?\.?\s*(?=\d)", "Transversal "),
        (r"\b(?:no|nro|numero|número|num|núm)\.?\s*", "# "),
    ]
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"\s*#\s*", " # ", text)
    text = re.sub(r"\s*-\s*", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def colombian_address_parts(value: str) -> dict | None:
    clean = normalize_colombian_address(value)
    match = re.search(
        r"\b(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\s*#\s*([0-9]+[A-Za-z]?)-([0-9]+[A-Za-z]?)\b",
        clean,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    road_type = match.group(1).title()
    road_number, cross_number, property_number = match.group(2).upper(), match.group(3).upper(), match.group(4).upper()
    cross_type = "Carrera" if road_type.lower() == "calle" else "Calle"
    canonical = f"{road_type} {road_number} # {cross_number}-{property_number}"
    intersection = f"{road_type} {road_number} con {cross_type} {cross_number}"
    return {
        "canonical": canonical,
        "intersection": intersection,
        "road": f"{road_type} {road_number}",
        "cross": f"{cross_type} {cross_number}",
    }


def colombian_intersection_parts(value: str) -> dict | None:
    """Reconoce cruces escritos como “Calle 27C con Carrera 41”."""
    clean = normalize_colombian_address(value)
    clean = re.sub(r"\b(?:esquina|cruce)(?:\s+de)?(?:\s+la)?\s+(?:con|entre)?\s*", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s*(?:&|/|\by\b|\bcon\b)\s*", " con ", clean, flags=re.IGNORECASE)
    match = re.search(
        r"\b(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\s+con\s+"
        r"(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\b",
        clean,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    first_type, first_number = match.group(1).title(), match.group(2).upper()
    second_type, second_number = match.group(3).title(), match.group(4).upper()
    if first_type == second_type and first_number == second_number:
        return None
    first = f"{first_type} {first_number}"
    second = f"{second_type} {second_number}"
    return {
        "canonical": f"{first} con {second}",
        "intersection": f"{first} con {second}",
        "road": first,
        "cross": second,
        "first_type": first_type,
        "first_number": first_number,
        "second_type": second_type,
        "second_number": second_number,
    }


def address_query_variants(value: str) -> list[tuple[str, bool]]:
    clean = normalize_colombian_address(value)
    address_parts = colombian_address_parts(clean)
    intersection_parts = colombian_intersection_parts(clean)
    variants: list[tuple[str, bool]] = []
    for query in (
        clean,
        f"{clean}, Barranquilla, Atlántico, Colombia",
        f"{clean}, Atlántico, Colombia",
    ):
        variants.append((query, False))
    if address_parts:
        variants.extend([
            (f"{address_parts['canonical']}, Barranquilla, Atlántico, Colombia", False),
            (f"{address_parts['intersection']}, Barranquilla, Atlántico, Colombia", True),
            (f"{address_parts['road']}, {address_parts['cross']}, Barranquilla, Atlántico, Colombia", True),
        ])
    if intersection_parts:
        road, cross = intersection_parts['road'], intersection_parts['cross']
        variants.extend([
            (f"{road} con {cross}, Barranquilla, Atlántico, Colombia", False),
            (f"{road} y {cross}, Barranquilla, Atlántico, Colombia", False),
            (f"{road} & {cross}, Barranquilla, Atlántico, Colombia", False),
            (f"{road}, {cross}, Barranquilla, Atlántico, Colombia", True),
            (f"intersección {road} {cross}, Barranquilla, Atlántico, Colombia", True),
        ])
    seen: set[str] = set()
    result: list[tuple[str, bool]] = []
    for query, approximate in variants:
        key = normalize_place_text(query)
        if key in seen:
            continue
        seen.add(key)
        result.append((query, approximate))
    return result


def _road_alias_pattern(road_type: str) -> str:
    aliases = {
        "calle": r"(calle|cll|cl)",
        "carrera": r"(carrera|cra|cr|kr)",
        "diagonal": r"(diagonal|diag)",
        "transversal": r"(transversal|transv|trans|tv)",
    }
    return aliases.get(normalize_place_text(road_type), re.escape(road_type))


def _road_overpass_regex(road_type: str, road_number: str) -> str:
    number = str(road_number or "").upper()
    digits = "".join(char for char in number if char.isdigit()).lstrip("0") or "0"
    suffix = "".join(char for char in number if char.isalpha())
    suffix_pattern = r"[[:space:]]*" + re.escape(suffix) if suffix else ""
    return rf"{_road_alias_pattern(road_type)}[.]?[[:space:]]*0*{re.escape(digits)}{suffix_pattern}"


def _road_name_matches(name: str, road_type: str, road_number: str) -> bool:
    compact = normalize_place_text(name).replace(" ", "")
    number = normalize_place_text(road_number).replace(" ", "").lstrip("0") or "0"
    aliases = {
        "calle": ("calle", "cll", "cl"),
        "carrera": ("carrera", "cra", "cr", "kr"),
        "diagonal": ("diagonal", "diag"),
        "transversal": ("transversal", "transv", "tv"),
    }.get(normalize_place_text(road_type), (normalize_place_text(road_type),))
    return any(compact.startswith(alias) and compact[len(alias):].lstrip("0") == number for alias in aliases)


def _segment_intersection(a1: tuple[float, float], a2: tuple[float, float], b1: tuple[float, float], b2: tuple[float, float]) -> tuple[float, float] | None:
    """Devuelve lat/lng del cruce geométrico de dos segmentos."""
    x1, y1 = a1[1], a1[0]; x2, y2 = a2[1], a2[0]
    x3, y3 = b1[1], b1[0]; x4, y4 = b2[1], b2[0]
    denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denominator) < 1e-14:
        return None
    px = ((x1*y2 - y1*x2)*(x3 - x4) - (x1 - x2)*(x3*y4 - y3*x4)) / denominator
    py = ((x1*y2 - y1*x2)*(y3 - y4) - (y1 - y2)*(x3*y4 - y3*x4)) / denominator
    tolerance = 1e-8
    if not (min(x1,x2)-tolerance <= px <= max(x1,x2)+tolerance and min(y1,y2)-tolerance <= py <= max(y1,y2)+tolerance):
        return None
    if not (min(x3,x4)-tolerance <= px <= max(x3,x4)+tolerance and min(y3,y4)-tolerance <= py <= max(y3,y4)+tolerance):
        return None
    return (py, px)


def _way_points(element: dict) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for point in element.get("geometry") or []:
        try:
            lat, lng = float(point.get("lat")), float(point.get("lon"))
        except (TypeError, ValueError):
            continue
        if 10.70 <= lat <= 11.25 and -75.15 <= lng <= -74.50:
            points.append((lat, lng))
    return points


def overpass_intersection_suggestion(query: str) -> dict | None:
    """Calcula un cruce usando las geometrías viales que también alimentan el mapa OSM."""
    parts = colombian_intersection_parts(query)
    if not parts or not OVERPASS_URL:
        return None
    cache_key = hashlib.sha256(f"v31-intersection|{normalize_place_text(parts['canonical'])}|{OVERPASS_URL}".encode("utf-8")).hexdigest()
    cache_path = GEOCODER_CACHE_ROOT / f"intersection-{cache_key}.json"
    if cache_path.exists() and time.time() - cache_path.stat().st_mtime <= GEOCODER_CACHE_TTL:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            return cached.get("item")
        except Exception:
            cache_path.unlink(missing_ok=True)

    regex_a = _road_overpass_regex(parts['first_type'], parts['first_number'])
    regex_b = _road_overpass_regex(parts['second_type'], parts['second_number'])
    bbox = "10.70,-75.15,11.25,-74.50"
    overpass_query = (
        "[out:json][timeout:20];(" 
        f'way["highway"]["name"~{json.dumps(regex_a)},i]({bbox});'
        f'way["highway"]["name"~{json.dumps(regex_b)},i]({bbox});'
        ");out tags geom;"
    )
    request = urllib.request.Request(
        OVERPASS_URL,
        data=urllib.parse.urlencode({"data": overpass_query}).encode("utf-8"),
        method="POST",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=24) as response:
        payload = json.loads(response.read().decode("utf-8"))

    first_ways: list[list[tuple[float, float]]] = []
    second_ways: list[list[tuple[float, float]]] = []
    for element in payload.get("elements") or []:
        name = str((element.get("tags") or {}).get("name") or "")
        points = _way_points(element)
        if len(points) < 2:
            continue
        if _road_name_matches(name, parts['first_type'], parts['first_number']):
            first_ways.append(points)
        if _road_name_matches(name, parts['second_type'], parts['second_number']):
            second_ways.append(points)

    best: tuple[float, float] | None = None
    approximate = False
    for first in first_ways:
        for second in second_ways:
            # Los nodos compartidos son el indicador más fiable de una intersección transitable.
            second_nodes = {(round(lat, 7), round(lng, 7)): (lat, lng) for lat, lng in second}
            shared = next((second_nodes[(round(lat, 7), round(lng, 7))] for lat, lng in first if (round(lat, 7), round(lng, 7)) in second_nodes), None)
            if shared:
                best = shared
                break
            for a1, a2 in zip(first, first[1:]):
                for b1, b2 in zip(second, second[1:]):
                    crossing = _segment_intersection(a1, a2, b1, b2)
                    if crossing:
                        best = crossing
                        approximate = True
                        break
                if best:
                    break
            if best:
                break
        if best:
            break

    if not best and first_ways and second_ways:
        nearest: tuple[float, tuple[float,float], tuple[float,float]] | None = None
        for first in first_ways:
            for second in second_ways:
                for a in first:
                    for b in second:
                        distance = math.hypot((a[0]-b[0]) * 111_000, (a[1]-b[1]) * 109_000)
                        if nearest is None or distance < nearest[0]:
                            nearest = (distance, a, b)
        if nearest and nearest[0] <= 85:
            best = ((nearest[1][0]+nearest[2][0])/2, (nearest[1][1]+nearest[2][1])/2)
            approximate = True

    if not best:
        return None
    item = {
        "label": parts['canonical'],
        "detail": "Cruce aproximado sobre la red vial" if approximate else "Cruce localizado sobre la red vial",
        "type": "Intersección",
        "icon": "⌖",
        "lat": best[0], "lng": best[1],
        "score": 640 if not approximate else 560,
        "source": "OpenStreetMap · cruce de vías",
        "accuracy": "intersección aproximada" if approximate else "intersección vial",
        "approximate": approximate,
    }
    GEOCODER_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"item": item}, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, cache_path)
    return item


def geocode_accuracy_label(location_type: str) -> str:
    return {
        "ROOFTOP": "dirección exacta",
        "RANGE_INTERPOLATED": "número interpolado",
        "GEOMETRIC_CENTER": "centro de la vía",
        "APPROXIMATE": "aproximada",
    }.get(str(location_type or "").upper(), "")

def place_type(properties: dict) -> tuple[str, str]:
    key = normalize_place_text(properties.get("osm_key"))
    value = normalize_place_text(properties.get("osm_value"))
    combined = f"{key}:{value}"
    mapping = {
        "amenity:university": ("Universidad", "▤"),
        "amenity:college": ("Institución educativa", "▤"),
        "amenity:school": ("Colegio o escuela", "▤"),
        "amenity:kindergarten": ("Jardín infantil", "▤"),
        "amenity:hospital": ("Hospital", "✚"),
        "amenity:clinic": ("Clínica", "✚"),
        "amenity:doctors": ("Centro médico", "✚"),
        "shop:mall": ("Centro comercial", "▦"),
        "shop:department_store": ("Centro comercial", "▦"),
        "tourism:attraction": ("Atracción", "◆"),
        "tourism:museum": ("Museo", "◆"),
        "leisure:park": ("Parque", "◆"),
        "natural:beach": ("Playa", "◆"),
        "aeroway:aerodrome": ("Aeropuerto", "✈"),
        "public_transport:station": ("Estación", "▣"),
        "highway:bus_stop": ("Paradero", "●"),
        "railway:station": ("Estación", "▣"),
        "place:neighbourhood": ("Barrio", "⌂"),
        "place:suburb": ("Barrio o sector", "⌂"),
        "place:quarter": ("Barrio o sector", "⌂"),
        "place:locality": ("Sector", "⌂"),
    }
    if combined in mapping:
        return mapping[combined]
    if key == "amenity":
        return ("Lugar de servicio", "⌖")
    if key == "shop":
        return ("Comercio", "▦")
    if key == "place":
        return ("Lugar", "⌂")
    if key in {"tourism", "leisure", "natural"}:
        return ("Lugar de interés", "◆")
    return ("Lugar", "⌖")


def photon_feature_to_item(feature: dict, query: str) -> dict | None:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        return None
    try:
        lng, lat = float(coordinates[0]), float(coordinates[1])
    except (TypeError, ValueError):
        return None
    if not (-75.15 <= lng <= -74.50 and 10.70 <= lat <= 11.25):
        return None

    properties = feature.get("properties") or {}
    name = str(properties.get("name") or properties.get("street") or properties.get("city") or "").strip()
    if not name:
        return None
    place_kind, icon = place_type(properties)

    street = str(properties.get("street") or "").strip()
    number = str(properties.get("housenumber") or "").strip()
    address_line = " ".join(part for part in (street, number) if part).strip()
    locality = str(properties.get("district") or properties.get("locality") or properties.get("city") or properties.get("county") or "").strip()
    city = str(properties.get("city") or properties.get("county") or "").strip()
    state = str(properties.get("state") or "").strip()
    detail_parts: list[str] = []
    for part in (address_line, locality, city, state):
        if part and normalize_place_text(part) != normalize_place_text(name) and part not in detail_parts:
            detail_parts.append(part)
    detail = ", ".join(detail_parts[:3])

    q = normalize_place_text(query)
    label = normalize_place_text(name)
    score = 20
    if label == q:
        score += 180
    elif label.startswith(q):
        score += 130
    elif q in label:
        score += 100
    tokens = [token for token in q.split() if len(token) > 1]
    score += sum(24 for token in tokens if token in label or token in normalize_place_text(detail))
    if place_kind in {"Universidad", "Institución educativa", "Colegio o escuela", "Hospital", "Clínica", "Centro comercial", "Barrio", "Barrio o sector"}:
        score += 28
    if normalize_place_text(properties.get("osm_value")) in {"state", "county", "country"}:
        score -= 100

    return {
        "label": name,
        "detail": detail,
        "type": place_kind,
        "icon": icon,
        "lat": lat,
        "lng": lng,
        "score": score,
        "source": "Photon · OpenStreetMap",
    }


def google_place_type(primary_type: str) -> tuple[str, str]:
    value = normalize_place_text(primary_type).replace("_", " ")
    if any(token in value for token in ("university", "school", "college")):
        return ("Institución educativa", "▤")
    if any(token in value for token in ("hospital", "doctor", "medical", "clinic")):
        return ("Centro de salud", "✚")
    if any(token in value for token in ("shopping mall", "store", "market")):
        return ("Comercio", "▦")
    if any(token in value for token in ("bus station", "transit station", "train station")):
        return ("Estación", "▣")
    if any(token in value for token in ("park", "tourist attraction", "museum", "beach")):
        return ("Lugar de interés", "◆")
    if any(token in value for token in ("neighborhood", "locality", "administrative area")):
        return ("Barrio o sector", "⌂")
    return ("Lugar", "⌖")


def google_geocode_suggestions(query: str, limit: int = 10) -> list[dict]:
    if not GOOGLE_GEOCODING_API_KEY:
        return []
    items: list[dict] = []
    for variant, fallback_approximate in address_query_variants(query):
        params = urllib.parse.urlencode({
            "address": variant,
            "components": "country:CO",
            "bounds": "10.70,-75.15|11.25,-74.50",
            "region": "co",
            "language": "es",
            "key": GOOGLE_GEOCODING_API_KEY,
        })
        request = urllib.request.Request(
            f"https://maps.googleapis.com/maps/api/geocode/json?{params}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
        status = str(payload.get("status") or "")
        if status not in {"OK", "ZERO_RESULTS"}:
            raise RuntimeError(f"Google Geocoding respondió {status}")
        for index, result in enumerate(payload.get("results") or []):
            geometry = result.get("geometry") or {}
            location = geometry.get("location") or {}
            try:
                lat = float(location.get("lat")); lng = float(location.get("lng"))
            except (TypeError, ValueError):
                continue
            if not (-75.15 <= lng <= -74.50 and 10.70 <= lat <= 11.25):
                continue
            location_type = str(geometry.get("location_type") or "")
            approximate = bool(fallback_approximate or result.get("partial_match") or location_type in {"APPROXIMATE", "GEOMETRIC_CENTER"})
            score = 390 - index * 5
            if location_type == "ROOFTOP": score += 90
            elif location_type == "RANGE_INTERPOLATED": score += 65
            elif location_type == "GEOMETRIC_CENTER": score += 25
            if fallback_approximate: score -= 70
            label = str(result.get("formatted_address") or normalize_colombian_address(query)).strip()
            items.append({
                "label": label,
                "detail": "Intersección cercana" if fallback_approximate else "Dirección encontrada",
                "type": "Dirección",
                "icon": "⌖",
                "lat": lat,
                "lng": lng,
                "score": score,
                "source": "Google Geocoding",
                "providerId": result.get("place_id"),
                "accuracy": geocode_accuracy_label(location_type),
                "approximate": approximate,
            })
        if any(not item.get("approximate") for item in items):
            break
    return items[:limit]


def nominatim_geocode_suggestions(query: str, limit: int = 10) -> list[dict]:
    items: list[dict] = []
    for variant, fallback_approximate in address_query_variants(query):
        params = urllib.parse.urlencode({
            "format": "jsonv2", "q": variant, "limit": min(limit, 8), "countrycodes": "co",
            "addressdetails": "1", "accept-language": "es", "viewbox": "-75.15,11.25,-74.50,10.70", "bounded": "1",
        })
        request = urllib.request.Request(
            f"https://nominatim.openstreetmap.org/search?{params}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for index, result in enumerate(payload or []):
            try:
                lat = float(result.get("lat")); lng = float(result.get("lon"))
            except (TypeError, ValueError):
                continue
            if not (-75.15 <= lng <= -74.50 and 10.70 <= lat <= 11.25):
                continue
            result_type = normalize_place_text(result.get("type"))
            exact = result_type in {"house", "building", "residential"} and not fallback_approximate
            score = 250 - index * 4 + (55 if exact else 0) - (60 if fallback_approximate else 0)
            items.append({
                "label": str(result.get("display_name") or variant).split(",")[0:4],
                "detail": "Intersección cercana" if fallback_approximate else str(result.get("display_name") or ""),
                "type": "Dirección" if exact else "Calle o sector",
                "icon": "⌖",
                "lat": lat, "lng": lng, "score": score,
                "source": "Nominatim · OpenStreetMap",
                "accuracy": "dirección exacta" if exact else "aproximada",
                "approximate": not exact,
            })
        if items:
            break
    for item in items:
        if isinstance(item.get("label"), list):
            item["label"] = ", ".join(str(part).strip() for part in item["label"] if str(part).strip())
    return items[:limit]

def google_place_suggestions(query: str, limit: int) -> list[dict]:
    if not GOOGLE_PLACES_API_KEY:
        return []
    body = {
        "textQuery": f"{normalize_colombian_address(query)}, Barranquilla, Atlántico, Colombia",
        "languageCode": "es",
        "regionCode": "CO",
        "pageSize": max(1, min(limit, 20)),
        "locationBias": {
            "rectangle": {
                "low": {"latitude": 10.70, "longitude": -75.15},
                "high": {"latitude": 11.25, "longitude": -74.50},
            }
        },
    }
    request = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.primaryTypeDisplayName",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    items: list[dict] = []
    for index, place in enumerate(payload.get("places") or []):
        location = place.get("location") or {}
        lat = location.get("latitude")
        lng = location.get("longitude")
        try:
            lat = float(lat)
            lng = float(lng)
        except (TypeError, ValueError):
            continue
        if not (-75.15 <= lng <= -74.50 and 10.70 <= lat <= 11.25):
            continue
        display = place.get("displayName") or {}
        name = str(display.get("text") or "").strip()
        if not name:
            continue
        kind, icon = google_place_type(str(place.get("primaryType") or ""))
        items.append({
            "label": name,
            "detail": str(place.get("formattedAddress") or "").strip(),
            "type": kind,
            "icon": icon,
            "lat": lat,
            "lng": lng,
            "score": 260 - index * 3,
            "source": "Google Places",
            "providerId": place.get("id"),
        })
    return items


def photon_place_suggestions(clean: str, limit: int) -> list[dict]:
    clean = normalize_colombian_address(clean)
    params = urllib.parse.urlencode({
        "q": clean,
        "limit": max(limit * 2, 20),
        "lang": "es",
        "countrycode": "CO",
        "bbox": "-75.15,10.70,-74.50,11.25",
        "lat": "10.9878",
        "lon": "-74.7889",
        "zoom": "10",
        "location_bias_scale": "0.08",
        "dedupe": "1",
    })
    separator = "&" if "?" in PHOTON_URL else "?"
    url = f"{PHOTON_URL}{separator}{params}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json"})
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    items = []
    for feature in payload.get("features") or []:
        item = photon_feature_to_item(feature, clean)
        if item:
            items.append(item)
    return items


def place_suggestions(query: str, limit: int = 18) -> dict:
    clean = normalize_colombian_address(query)
    if len(clean) < 2:
        return {"ok": True, "items": [], "source": "none"}
    if len(clean) > 120:
        raise ValueError("la búsqueda es demasiado larga")
    limit = max(1, min(int(limit or 18), 20))
    provider_signature = f"google:{bool(GOOGLE_PLACES_API_KEY)}|geocode:{bool(GOOGLE_GEOCODING_API_KEY)}|photon:{PHOTON_URL}"
    cache_key = hashlib.sha256(f"v31|{normalize_place_text(clean)}|{limit}|{provider_signature}|overpass:{bool(OVERPASS_URL)}".encode("utf-8")).hexdigest()
    cache_path = GEOCODER_CACHE_ROOT / f"{cache_key}.json"
    if cache_path.exists() and time.time() - cache_path.stat().st_mtime <= GEOCODER_CACHE_TTL:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            cached["cached"] = True
            return cached
        except Exception:
            cache_path.unlink(missing_ok=True)

    all_items: list[dict] = []
    sources: list[str] = []
    warnings: list[str] = []
    if colombian_intersection_parts(clean):
        try:
            intersection_item = overpass_intersection_suggestion(clean)
            if intersection_item:
                all_items.append(intersection_item)
                sources.append("osm-intersection")
        except Exception as error:
            warnings.append(f"Cruce OSM: {error}")
    if (colombian_address_parts(clean) or colombian_intersection_parts(clean)) and GOOGLE_GEOCODING_API_KEY:
        try:
            geocode_items = google_geocode_suggestions(clean, min(limit, 10))
            all_items.extend(geocode_items)
            if geocode_items:
                sources.append("google-geocoding")
        except Exception as error:
            warnings.append(f"Google Geocoding: {error}")
    if GOOGLE_PLACES_API_KEY:
        try:
            google_items = google_place_suggestions(clean, limit)
            all_items.extend(google_items)
            if google_items:
                sources.append("google")
        except Exception as error:
            warnings.append(f"Google Places: {error}")
    try:
        photon_items: list[dict] = []
        structured_address = (colombian_address_parts(clean) is not None or colombian_intersection_parts(clean) is not None)
        variants = address_query_variants(clean) if structured_address else [(clean, False)]
        for variant, approximate in variants[:6]:
            batch = photon_place_suggestions(variant, limit)
            for item in batch:
                if approximate:
                    item = {**item, "approximate": True, "accuracy": "intersección cercana", "score": float(item.get("score") or 0) - 55}
                photon_items.append(item)
            if batch and not structured_address:
                break
        all_items.extend(photon_items)
        if photon_items:
            sources.append("photon")
    except Exception as error:
        warnings.append(f"Photon: {error}")

    seen = set()
    unique: list[dict] = []
    for item in sorted(all_items, key=lambda value: (-float(value.get("score") or 0), normalize_place_text(value.get("label")))):
        key = (normalize_place_text(item.get("label")), round(float(item.get("lat") or 0), 5), round(float(item.get("lng") or 0), 5))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    result = {
        "ok": True,
        "items": unique[:limit],
        "source": "+".join(sources) or "unavailable",
        "sources": sources,
        "googleConfigured": bool(GOOGLE_PLACES_API_KEY),
        "googleGeocodingConfigured": bool(GOOGLE_GEOCODING_API_KEY),
        "cached": False,
    }
    if warnings:
        result["warnings"] = warnings
    GEOCODER_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, cache_path)
    return result


def precise_geocode(query: str, limit: int = 12) -> dict:
    clean = normalize_colombian_address(query)
    if len(clean) < 2:
        return {"ok": True, "items": [], "source": "none"}
    limit = max(1, min(int(limit or 12), 20))
    signature = f"v31-geocode|overpass:{bool(OVERPASS_URL)}|google:{bool(GOOGLE_GEOCODING_API_KEY)}|places:{bool(GOOGLE_PLACES_API_KEY)}|photon:{PHOTON_URL}"
    cache_key = hashlib.sha256(f"{signature}|{normalize_place_text(clean)}|{limit}".encode("utf-8")).hexdigest()
    cache_path = GEOCODER_CACHE_ROOT / f"{cache_key}.json"
    if cache_path.exists() and time.time() - cache_path.stat().st_mtime <= GEOCODER_CACHE_TTL:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8")); cached["cached"] = True; return cached
        except Exception:
            cache_path.unlink(missing_ok=True)
    items: list[dict] = []
    sources: list[str] = []
    warnings: list[str] = []
    if colombian_intersection_parts(clean):
        try:
            intersection_item = overpass_intersection_suggestion(clean)
            if intersection_item:
                items.append(intersection_item)
                sources.append("osm-intersection")
        except Exception as error:
            warnings.append(f"Cruce OSM: {error}")
    if GOOGLE_GEOCODING_API_KEY:
        try:
            batch = google_geocode_suggestions(clean, limit)
            items.extend(batch)
            if batch: sources.append("google-geocoding")
        except Exception as error:
            warnings.append(f"Google Geocoding: {error}")
    if GOOGLE_PLACES_API_KEY:
        try:
            batch = google_place_suggestions(clean, limit)
            items.extend(batch)
            if batch: sources.append("google-places")
        except Exception as error:
            warnings.append(f"Google Places: {error}")
    try:
        batch = photon_place_suggestions(clean, limit)
        items.extend(batch)
        if batch: sources.append("photon")
    except Exception as error:
        warnings.append(f"Photon: {error}")
    try:
        batch = nominatim_geocode_suggestions(clean, limit)
        items.extend(batch)
        if batch: sources.append("nominatim")
    except Exception as error:
        warnings.append(f"Nominatim: {error}")
    seen: set[tuple] = set(); unique: list[dict] = []
    for item in sorted(items, key=lambda value: (-float(value.get("score") or 0), bool(value.get("approximate")), normalize_place_text(value.get("label")))):
        key = (round(float(item.get("lat") or 0), 5), round(float(item.get("lng") or 0), 5), normalize_place_text(item.get("label")))
        if key in seen: continue
        seen.add(key); unique.append(item)
    result = {
        "ok": True, "items": unique[:limit], "sources": sources, "source": "+".join(sources) or "unavailable",
        "googleConfigured": bool(GOOGLE_PLACES_API_KEY), "googleGeocodingConfigured": bool(GOOGLE_GEOCODING_API_KEY), "cached": False,
    }
    if warnings: result["warnings"] = warnings
    GEOCODER_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix('.tmp'); temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8'); os.replace(temporary, cache_path)
    return result


def load_live_vehicles(active_seconds: int = 180) -> list[dict]:
    active_seconds = max(15, min(int(active_seconds or 180), 3600))
    now = time.time()
    with LIVE_VEHICLES_LOCK:
        try:
            data = json.loads(LIVE_VEHICLES_PATH.read_text(encoding="utf-8")) if LIVE_VEHICLES_PATH.exists() else {}
        except Exception:
            data = {}
        vehicles = []
        for vehicle in data.values() if isinstance(data, dict) else []:
            updated = float(vehicle.get("updatedAt") or 0)
            if now - updated <= active_seconds:
                vehicles.append(vehicle)
        vehicles.sort(key=lambda vehicle: str(vehicle.get("routeCode") or ""))
        return vehicles


def save_live_vehicle(payload: dict) -> dict:
    vehicle_id = re.sub(r"[^A-Za-z0-9_.:-]", "", str(payload.get("vehicleId") or payload.get("driverId") or ""))[:80]
    route_code = re.sub(r"[^A-Za-z0-9_.:-]", "", str(payload.get("routeCode") or payload.get("route_id") or ""))[:40]
    if not vehicle_id:
        raise ValueError("falta vehicleId")
    if not route_code:
        raise ValueError("falta routeCode")
    try:
        lat = float(payload.get("lat"))
        lng = float(payload.get("lng"))
    except (TypeError, ValueError):
        raise ValueError("latitud o longitud inválida")
    if not (-75.15 <= lng <= -74.50 and 10.70 <= lat <= 11.25):
        raise ValueError("ubicación fuera del área metropolitana")
    vehicle = {
        "vehicleId": vehicle_id,
        "driverId": str(payload.get("driverId") or "")[:80],
        "routeCode": route_code,
        "lat": lat,
        "lng": lng,
        "bearing": float(payload.get("bearing") or 0),
        "speed": float(payload.get("speed") or 0),
        "accuracy": float(payload.get("accuracy") or 0),
        "updatedAt": time.time(),
    }
    with LIVE_VEHICLES_LOCK:
        try:
            data = json.loads(LIVE_VEHICLES_PATH.read_text(encoding="utf-8")) if LIVE_VEHICLES_PATH.exists() else {}
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        data[vehicle_id] = vehicle
        LIVE_VEHICLES_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = LIVE_VEHICLES_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, LIVE_VEHICLES_PATH)
    return vehicle


def driver_request_authorized(handler) -> bool:
    if not DRIVER_TOKEN:
        return handler.client_address[0] in {"127.0.0.1", "::1"}
    authorization = str(handler.headers.get("Authorization") or "")
    supplied = str(handler.headers.get("X-TRB-Driver-Token") or "")
    if authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    return supplied == DRIVER_TOKEN

def encoded_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/%:@")
    query = urllib.parse.quote_plus(urllib.parse.unquote_plus(parts.query), safe="=&%")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def validate_kmz(path: Path) -> None:
    if not path.exists() or path.stat().st_size < 4:
        raise ValueError("archivo vacío")
    with path.open("rb") as stream:
        if stream.read(2) != b"PK":
            raise ValueError("la respuesta no es un ZIP/KMZ")
    with zipfile.ZipFile(path) as archive:
        kml_files = [name for name in archive.namelist() if name.lower().endswith(".kml")]
        if not kml_files:
            raise ValueError("el KMZ no contiene KML")
        if all(archive.getinfo(name).file_size == 0 for name in kml_files):
            raise ValueError("el KML está vacío")


def download_route(relative: str, force: bool = False, retries: int = 3) -> Path:
    if relative not in ROUTE_URLS:
        raise KeyError("ruta KMZ no permitida")
    destination = (KMZ_ROOT / Path(relative)).resolve()
    if KMZ_ROOT.resolve() not in destination.parents:
        raise ValueError("ruta local no válida")
    if destination.exists() and not force:
        try:
            validate_kmz(destination)
            return destination
        except Exception:
            destination.unlink(missing_ok=True)

    destination.parent.mkdir(parents=True, exist_ok=True)
    url = encoded_url(ROUTE_URLS[relative])
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        temporary: Path | None = None
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Referer": "https://www.ambq.gov.co/transporte/",
                    "Accept": "application/vnd.google-earth.kmz, application/zip, application/octet-stream;q=0.9, */*;q=0.5",
                    "Accept-Encoding": "identity",
                    "Connection": "close",
                },
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                status = getattr(response, "status", 200)
                if status != 200:
                    raise RuntimeError(f"HTTP {status}")
                with tempfile.NamedTemporaryFile(delete=False, dir=destination.parent, suffix=".download") as output:
                    temporary = Path(output.name)
                    shutil.copyfileobj(response, output)
            validate_kmz(temporary)
            os.replace(temporary, destination)
            return destination
        except Exception as error:
            last_error = error
            if temporary and temporary.exists():
                temporary.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(0.8 * attempt)
    raise RuntimeError(f"No se pudo descargar {relative}: {last_error}")


def direction_from_name(name: str) -> str:
    value = name.lower()
    if any(word in value for word in ("regreso", "retorno", "vuelta")):
        return "regreso"
    if any(word in value for word in ("ida", "salida")):
        return "ida"
    return "recorrido"


def parse_coordinate_block(text: str) -> list[list[float]]:
    points: list[list[float]] = []
    for item in re.split(r"\s+", text.strip()):
        if not item:
            continue
        values = item.split(",")
        if len(values) < 2:
            continue
        try:
            lng, lat = float(values[0]), float(values[1])
        except ValueError:
            continue
        if math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180:
            points.append([lng, lat])
    return points


def parse_gx_coord_blocks(texts: list[str]) -> list[list[float]]:
    points: list[list[float]] = []
    for text in texts:
        values = re.split(r"\s+", text.strip())
        if len(values) < 2:
            continue
        try:
            lng, lat = float(values[0]), float(values[1])
        except ValueError:
            continue
        if math.isfinite(lat) and math.isfinite(lng):
            points.append([lng, lat])
    return points


def line_distance_meters(points: list[list[float]]) -> float:
    total = 0.0
    radius = 6_371_000.0
    for first, second in zip(points, points[1:]):
        lng1, lat1 = first
        lng2, lat2 = second
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lng2 - lng1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        total += radius * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
    return total


def extract_geometry(kmz_path: Path, route: dict) -> dict:
    validate_kmz(kmz_path)
    with zipfile.ZipFile(kmz_path) as archive:
        kml_name = next(name for name in archive.namelist() if name.lower().endswith(".kml"))
        kml_text = archive.read(kml_name).decode("utf-8", errors="replace")

    paths: list[dict] = []
    # Extrae por Placemark para conservar un nombre/dirección aproximados.
    placemarks = re.findall(r"<(?:\w+:)?Placemark\b[^>]*>(.*?)</(?:\w+:)?Placemark>", kml_text, flags=re.I | re.S)
    for index, placemark in enumerate(placemarks):
        name_match = re.search(r"<(?:\w+:)?name\b[^>]*>(.*?)</(?:\w+:)?name>", placemark, flags=re.I | re.S)
        name = re.sub(r"<[^>]+>", "", name_match.group(1)).strip() if name_match else f"Tramo {index + 1}"
        coordinate_blocks = re.findall(r"<(?:\w+:)?coordinates\b[^>]*>(.*?)</(?:\w+:)?coordinates>", placemark, flags=re.I | re.S)
        for block_index, block in enumerate(coordinate_blocks):
            points = parse_coordinate_block(block)
            if len(points) >= 2:
                paths.append({
                    "name": name if len(coordinate_blocks) == 1 else f"{name} · {block_index + 1}",
                    "direction": direction_from_name(name),
                    "coordinates": points,
                })
        gx_coords = re.findall(r"<(?:gx:)?coord\b[^>]*>(.*?)</(?:gx:)?coord>", placemark, flags=re.I | re.S)
        gx_points = parse_gx_coord_blocks(gx_coords)
        if len(gx_points) >= 2:
            paths.append({"name": name, "direction": direction_from_name(name), "coordinates": gx_points})

    if not paths:
        for index, block in enumerate(re.findall(r"<(?:\w+:)?coordinates\b[^>]*>(.*?)</(?:\w+:)?coordinates>", kml_text, flags=re.I | re.S)):
            points = parse_coordinate_block(block)
            if len(points) >= 2:
                paths.append({"name": f"Recorrido {index + 1}", "direction": "recorrido", "coordinates": points})

    paths = [path for path in paths if line_distance_meters(path["coordinates"]) >= 80]
    if not paths:
        raise ValueError("el KML no contiene líneas de recorrido válidas")

    # Elimina duplicados exactos y ordena de mayor a menor recorrido.
    unique: list[dict] = []
    signatures: set[tuple] = set()
    for path in paths:
        coords = path["coordinates"]
        signature = (len(coords), tuple(round(value, 6) for value in coords[0]), tuple(round(value, 6) for value in coords[-1]))
        if signature in signatures:
            continue
        signatures.add(signature)
        distance = round(line_distance_meters(coords))
        unique.append({**path, "distanceMeters": distance, "durationMinutes": max(1, math.ceil(distance / 330))})
    unique.sort(key=lambda item: item["distanceMeters"], reverse=True)

    all_points = [point for path in unique for point in path["coordinates"]]
    lats = [point[1] for point in all_points]
    lngs = [point[0] for point in all_points]
    route_info = {
        "id": route.get("id"),
        "empresa": route.get("empresa"),
        "codigo": route.get("ruta"),
        "nombre": route.get("nombre"),
        "kmz": route.get("kmz"),
    }
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    **route_info,
                    "name": path.get("name"),
                    "direction": path.get("direction"),
                    "distanceMeters": path.get("distanceMeters"),
                    "durationMinutes": path.get("durationMinutes"),
                    "priority": index,
                },
                "geometry": {"type": "LineString", "coordinates": path["coordinates"]},
            }
            for index, path in enumerate(unique)
        ],
    }
    return {
        "ok": True,
        "route": route_info,
        "paths": unique,
        "geojson": geojson,
        "bounds": [[min(lngs), min(lats)], [max(lngs), max(lats)]],
        "source": f"kmz/{route.get('kmz')}",
        "generatedAt": time.time(),
    }


def geometry_cache_path(route: dict) -> Path:
    return GEOMETRY_ROOT / Path(str(route["kmz"])).with_suffix(".json")


def geojson_cache_path(route: dict) -> Path:
    return GEOJSON_ROOT / Path(str(route["kmz"])).with_suffix(".geojson")


def route_geometry(route_id: str, force: bool = False) -> dict:
    route = ROUTES_BY_ID.get(route_id)
    if not route:
        raise KeyError("ruta no registrada")
    relative = str(route["kmz"]).replace("\\", "/").lstrip("/")
    cache_path = geometry_cache_path(route)
    lock = GEOMETRY_LOCKS.setdefault(route_id, threading.Lock())
    with lock:
        kmz_path = download_route(relative, force=force)
        if cache_path.exists() and not force and cache_path.stat().st_mtime >= kmz_path.stat().st_mtime:
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                if cached.get("paths"):
                    if not cached.get("geojson"):
                        cached["geojson"] = {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {**cached.get("route", {}), "name": path.get("name"), "direction": path.get("direction"), "distanceMeters": path.get("distanceMeters"), "durationMinutes": path.get("durationMinutes"), "priority": index},
                                    "geometry": {"type": "LineString", "coordinates": path.get("coordinates", [])},
                                }
                                for index, path in enumerate(cached.get("paths", []))
                            ],
                        }
                    return cached
            except Exception:
                cache_path.unlink(missing_ok=True)
        geometry = extract_geometry(kmz_path, route)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(geometry, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, cache_path)
        geojson_path = geojson_cache_path(route)
        geojson_path.parent.mkdir(parents=True, exist_ok=True)
        geojson_temporary = geojson_path.with_suffix(geojson_path.suffix + ".tmp")
        geojson_temporary.write_text(json.dumps(geometry["geojson"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(geojson_temporary, geojson_path)
        return geometry


def current_status() -> dict:
    available: list[str] = []
    damaged: list[dict[str, str]] = []
    geometries = 0
    for route in ROUTES_BY_ID.values():
        relative = str(route.get("kmz", ""))
        path = KMZ_ROOT / relative
        if path.exists():
            try:
                validate_kmz(path)
                available.append(relative)
            except Exception as error:
                damaged.append({"kmz": relative, "error": str(error)})
        if geometry_cache_path(route).exists():
            geometries += 1
    with PREFETCH_LOCK:
        prefetch = dict(PREFETCH_STATE)
    return {
        "total": len(ROUTE_URLS),
        "available": len(available),
        "geometryReady": geometries,
        "missing": len(ROUTE_URLS) - len(available) - len(damaged),
        "damaged": damaged,
        "prefetch": prefetch,
    }


def prefetch_all(force: bool = False, quiet: bool = False) -> int:
    with PREFETCH_LOCK:
        if PREFETCH_STATE["running"]:
            return 0
        PREFETCH_STATE.update({"running": True, "completed": 0, "success": 0, "errors": [], "started_at": time.time(), "finished_at": None})

    errors: list[tuple[str, str]] = []
    success = 0
    route_ids = list(ROUTES_BY_ID)
    total = len(route_ids)

    def worker(route_id: str) -> tuple[str, bool, str]:
        route = ROUTES_BY_ID[route_id]
        try:
            geometry = route_geometry(route_id, force=force)
            points = sum(len(path["coordinates"]) for path in geometry["paths"])
            return str(route["kmz"]), True, f"{len(geometry['paths'])} trazados · {points} puntos"
        except Exception as error:
            return str(route["kmz"]), False, str(error)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
            futures = {executor.submit(worker, route_id): route_id for route_id in route_ids}
            for future in concurrent.futures.as_completed(futures):
                relative, ok, detail = future.result()
                if ok:
                    success += 1
                else:
                    errors.append((relative, detail))
                with PREFETCH_LOCK:
                    PREFETCH_STATE["completed"] += 1
                    PREFETCH_STATE["success"] = success
                    PREFETCH_STATE["errors"] = [{"kmz": item, "error": message} for item, message in errors]
                    completed = PREFETCH_STATE["completed"]
                if not quiet:
                    print(f"[{completed:02d}/{total}] {'OK' if ok else 'ERROR'} {relative} ({detail})", file=sys.stdout if ok else sys.stderr, flush=True)
    finally:
        with PREFETCH_LOCK:
            PREFETCH_STATE["running"] = False
            PREFETCH_STATE["finished_at"] = time.time()

    error_path = ROOT / "kmz_errors.json"
    if errors:
        error_path.write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        error_path.unlink(missing_ok=True)
    if not quiet:
        print(f"\nResultado: {success}/{total} rutas preparadas. Errores: {len(errors)}", flush=True)
    return 0 if success else 1


def start_background_prefetch(force: bool = False) -> bool:
    with PREFETCH_LOCK:
        if PREFETCH_STATE["running"]:
            return False
    threading.Thread(target=prefetch_all, kwargs={"force": force, "quiet": True}, daemon=True).start()
    return True


class TRBHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".kmz": "application/vnd.google-earth.kmz",
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(self)")
        parsed_path = urllib.parse.urlparse(self.path).path
        if parsed_path.startswith("/api/") or parsed_path == "/healthz":
            self.send_header("Cache-Control", "no-store")
        elif parsed_path in {"/", "/index.html", "/service-worker.js"}:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        decoded_path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)

        if decoded_path in {"/healthz", "/api/health", "/api/kmz-status"}:
            self.send_json({"ok": True, **current_status()})
            return
        if decoded_path == "/api/prefetch":
            started = start_background_prefetch(force=False)
            self.send_json({"ok": True, "started": started, **current_status()})
            return
        if decoded_path == "/api/route-geometry":
            route_id = (query.get("route_id") or query.get("id") or [""])[0]
            if not route_id:
                self.send_json({"ok": False, "error": "falta route_id"}, 400)
                return
            try:
                self.send_json(route_geometry(route_id, force=(query.get("force") == ["1"])))
            except KeyError as error:
                self.send_json({"ok": False, "error": str(error)}, 404)
            except Exception as error:
                self.log_error("No se pudo preparar geometría %s: %s", route_id, error)
                self.send_json({"ok": False, "error": str(error)}, 502)
            return
        if decoded_path == "/api/network-route":
            mode = (query.get("mode") or [""])[0]
            points = (query.get("points") or [""])[0]
            try:
                self.send_json(network_route(mode, points))
            except ValueError as error:
                self.send_json({"ok": False, "error": str(error)}, 400)
            except Exception as error:
                self.log_error("No se pudo calcular ruta vial %s: %s", mode, error)
                self.send_json({"ok": False, "error": str(error)}, 502)
            return
        if decoded_path == "/api/vehicles":
            raw_active = (query.get("active_seconds") or ["180"])[0]
            try:
                vehicles = load_live_vehicles(int(raw_active))
                self.send_json({"ok": True, "vehicles": vehicles, "count": len(vehicles), "serverTime": time.time()})
            except Exception as error:
                self.send_json({"ok": False, "error": str(error)}, 400)
            return
        if decoded_path == "/api/geocode":
            search_text = (query.get("q") or [""])[0]
            raw_limit = (query.get("limit") or ["12"])[0]
            try:
                self.send_json(precise_geocode(search_text, int(raw_limit)))
            except ValueError as error:
                self.send_json({"ok": False, "error": str(error)}, 400)
            except Exception as error:
                self.log_error("No se pudo geocodificar %s: %s", search_text, error)
                self.send_json({"ok": True, "items": [], "source": "unavailable", "warning": str(error)})
            return
        if decoded_path == "/api/search-status":
            self.send_json({
                "ok": True,
                "googlePlaces": bool(GOOGLE_PLACES_API_KEY),
                "googleGeocoding": bool(GOOGLE_GEOCODING_API_KEY),
                "photon": bool(PHOTON_URL),
                "mode": "Google + OpenStreetMap" if GOOGLE_PLACES_API_KEY or GOOGLE_GEOCODING_API_KEY else "OpenStreetMap gratuito",
            })
            return
        if decoded_path == "/api/place-suggestions":
            search_text = (query.get("q") or [""])[0]
            raw_limit = (query.get("limit") or ["10"])[0]
            try:
                self.send_json(place_suggestions(search_text, int(raw_limit)))
            except ValueError as error:
                self.send_json({"ok": False, "error": str(error)}, 400)
            except Exception as error:
                self.log_error("No se pudo buscar lugares %s: %s", search_text, error)
                self.send_json({"ok": True, "items": [], "source": "unavailable", "warning": str(error)})
            return

        if decoded_path.startswith("/kmz/"):
            relative = posixpath.normpath(decoded_path[len("/kmz/"):]).lstrip("/")
            if relative.startswith("../") or relative not in ROUTE_URLS:
                self.send_error(404, "KMZ no registrado")
                return
            try:
                download_route(relative)
            except Exception as error:
                self.log_error("No se pudo obtener %s: %s", relative, error)
                self.send_error(502, f"No se pudo obtener el KMZ oficial: {error}")
                return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        decoded_path = urllib.parse.unquote(parsed.path)
        if decoded_path != "/api/vehicles/location":
            self.send_json({"ok": False, "error": "endpoint no encontrado"}, 404)
            return
        if not driver_request_authorized(self):
            self.send_json({"ok": False, "error": "token de conductor inválido o no configurado"}, 401)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 65536:
                raise ValueError("cuerpo de solicitud inválido")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            vehicle = save_live_vehicle(payload)
            self.send_json({"ok": True, "vehicle": vehicle})
        except ValueError as error:
            self.send_json({"ok": False, "error": str(error)}, 400)
        except Exception as error:
            self.log_error("No se pudo guardar GPS: %s", error)
            self.send_json({"ok": False, "error": str(error)}, 500)

    def send_json(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        print(f"[TRB] {self.address_string()} - {format % args}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Servidor local TRB con caché de KMZ, geometría y buscador de lugares")
    default_host = os.environ.get("TRB_HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    default_port = int(os.environ.get("PORT", "8080"))
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=default_port)
    parser.add_argument("--prefetch", action="store_true", help="Descarga, valida y convierte las 93 rutas antes de salir")
    parser.add_argument("--prepare", action="store_true", help="Prepara las rutas y después inicia el servidor")
    parser.add_argument("--auto-prefetch", action="store_true", help="Prepara faltantes en segundo plano")
    parser.add_argument("--force", action="store_true", help="Vuelve a descargar y convertir archivos existentes")
    parser.add_argument("--open", action="store_true", help="Abre TRB automáticamente en el navegador")
    args = parser.parse_args()

    KMZ_ROOT.mkdir(parents=True, exist_ok=True)
    GEOMETRY_ROOT.mkdir(parents=True, exist_ok=True)
    GEOJSON_ROOT.mkdir(parents=True, exist_ok=True)
    ROUTING_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    GEOCODER_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    if args.prefetch and not args.prepare:
        return prefetch_all(force=args.force)
    if args.prepare:
        print("Preparando recorridos y geometrías oficiales…", flush=True)
        prefetch_all(force=args.force)

    server = ThreadingHTTPServer((args.host, args.port), TRBHandler)
    browser_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    url = f"http://{browser_host}:{args.port}/?v=33"
    print(f"\nTRB disponible en {url}", flush=True)
    print("El mapa usa /api/route-geometry para mostrar los recorridos sin problemas de CORS.", flush=True)
    print("No cierres esta ventana mientras uses la aplicación.", flush=True)
    auto_prefetch = args.auto_prefetch or os.environ.get("TRB_AUTO_PREFETCH", "").lower() in {"1", "true", "yes"}
    if auto_prefetch and not args.prepare:
        start_background_prefetch(force=args.force)
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
