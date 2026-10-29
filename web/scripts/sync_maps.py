#!/usr/bin/env python3
"""Build-time radar asset synchronization for OpenReplay static GitHub Pages.

Downloads public upstream overview metadata and PNG radars into web/dist/maps.
Uploaded CS2 demos are never sent to this source. Requires Python 3.10+ only.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

MANIFEST = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json"
SOURCE_HOST = "raw.githubusercontent.com"
SOURCE_PREFIX = "/MurkyYT/cs2-map-icons/"
MAP_PATTERN = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
REQUIRED_MAPS = ("de_anubis", "de_mirage", "de_nuke")
MAX_PNG_BYTES = 24 * 1024 * 1024


def checked_source_url(value: str, *, manifest: bool = False) -> str:
    """Only accept explicitly allowlisted upstream source files."""
    if not isinstance(value, str):
        raise ValueError("Source URL must be a string")
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != SOURCE_HOST or parsed.username or parsed.password or parsed.port:
        raise ValueError(f"Untrusted source host or protocol: {value}")
    if not parsed.path.startswith(SOURCE_PREFIX) or parsed.query or parsed.fragment:
        raise ValueError(f"Untrusted source path: {value}")
    if not manifest and not (parsed.path.startswith(SOURCE_PREFIX + "main/images/radars/") and parsed.path.endswith(".png")):
        raise ValueError(f"Not a radar PNG asset: {value}")
    return value


def download(url: str, *, limit: int, attempts: int = 3) -> bytes:
    checked_source_url(url, manifest=(url == MANIFEST))
    last_error = None
    for attempt in range(attempts):
        try:
            req = Request(url, headers={"User-Agent": "OpenReplay-MapBuild/1.0", "Accept": "application/json,image/png,*/*"})
            with urlopen(req, timeout=35) as response:
                # Avoid a changed redirect directing the build to a different origin.
                target = response.geturl()
                checked_source_url(target, manifest=(url == MANIFEST))
                data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError(f"Source exceeded size limit ({limit} bytes): {url}")
            return data
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Cannot retrieve {url}: {last_error}")


def png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError("Source is not a valid PNG header")
    width, height = struct.unpack(">II", data[16:24])
    if not (128 <= width <= 8192 and 128 <= height <= 8192):
        raise ValueError(f"Unexpected radar PNG size {width}x{height}")
    return width, height


def choose_radar(paths: list[str], name: str, lower: bool) -> str | None:
    candidates = []
    for value in paths:
        try:
            value = checked_source_url(value)
        except ValueError:
            continue
        filename = urlparse(value).path.rsplit("/", 1)[-1]
        if not filename.startswith(name + "_"):
            continue
        is_lower = "_lower_" in filename
        if is_lower != lower:
            continue
        # Favor regular in-game radar images over old versioned/spectator variants.
        exact = [
            f"{name}{'_lower' if lower else ''}_radar_psd.png",
            f"{name}{'_lower' if lower else ''}_radar_tga.png",
            f"{name}{'_lower' if lower else ''}_radar.png",
        ]
        priority = exact.index(filename) if filename in exact else 3
        if "spectate" in filename or "_v" in filename:
            priority += 2
        candidates.append((priority, filename, value))
    return sorted(candidates)[0][2] if candidates else None


def number(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
        return parsed if abs(parsed) < 10**9 and parsed == parsed else None
    except (ValueError, TypeError, OverflowError):
        return None


def map_record(name: str, entry: dict) -> tuple[dict, str, str | None] | None:
    info = entry.get("radar_info")
    if not isinstance(info, dict):
        return None
    x, y, scale = (number(info.get(field)) for field in ("pos_x", "pos_y", "scale"))
    if x is None or y is None or scale is None or scale <= 0:
        return None
    paths = entry.get("radar_paths")
    if not isinstance(paths, list):
        return None
    upper = choose_radar(paths, name, lower=False)
    if upper is None:
        return None
    lower = choose_radar(paths, name, lower=True)
    meta = {
        "radar": True,
        "calibrated": True,
        "pos_x": x,
        "pos_y": y,
        "scale": scale,
        "image": f"./maps/{name}.png",
        "has_lower": False,
    }
    if lower:
        vertical = info.get("verticalsections") or {}
        default = vertical.get("default", {}) if isinstance(vertical, dict) else {}
        below = vertical.get("lower", {}) if isinstance(vertical, dict) else {}
        threshold = number(below.get("AltitudeMax")) if isinstance(below, dict) else None
        if threshold is None and isinstance(default, dict):
            threshold = number(default.get("AltitudeMin"))
        # Don't display an uncalibrated two-floor map. Higher/lower support
        # requires a recorded Z threshold; otherwise use the upper radar only.
        if threshold is not None:
            meta["has_lower"] = True
            meta["image_lower"] = f"./maps/{name}_lower.png"
            meta["lower_z_max"] = threshold
        else:
            lower = None
    return meta, upper, lower


def sync_maps(payload: dict, output: Path, fetch=download) -> dict:
    entries = payload.get("maps") if isinstance(payload, dict) else None
    if not isinstance(entries, dict) or not entries:
        raise ValueError("Invalid upstream manifest: maps object is missing")
    output.mkdir(parents=True, exist_ok=True)
    results, failures = [], []
    for name, entry in sorted(entries.items()):
        if not MAP_PATTERN.fullmatch(name) or not isinstance(entry, dict):
            continue
        definition = map_record(name, entry)
        if definition is None:
            continue  # No useful radar + calibration yet; use world-coordinate grid.
        meta, top_url, lower_url = definition
        try:
            top_data = fetch(top_url, limit=MAX_PNG_BYTES)
            top_size = png_dimensions(top_data)
            lower_data = None
            if lower_url:
                try:
                    lower_data = fetch(lower_url, limit=MAX_PNG_BYTES)
                    png_dimensions(lower_data)
                except (RuntimeError, ValueError) as exc:
                    # Better an upper-only map than a fake/uncalibrated lower floor.
                    print(f"WARN {name}: lower radar unavailable ({exc}); using upper radar only", file=sys.stderr)
                    lower_data = None
                    meta.pop("image_lower", None)
                    meta.pop("lower_z_max", None)
                    meta["has_lower"] = False
            # Write a map only after the data has passed all checks.
            (output / f"{name}.png").write_bytes(top_data)
            if lower_data:
                (output / f"{name}_lower.png").write_bytes(lower_data)
            (output / f"{name}.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            results.append({"name": name, "upper": top_url, "lower": lower_url if lower_data else None, "size": list(top_size)})
            print(f"OK {name}: {top_size[0]}x{top_size[1]}" + (" + lower" if lower_data else ""))
        except (ValueError, RuntimeError, OSError) as exc:
            failures.append(f"{name}: {exc}")
            print(f"WARN skipping {name}: {exc}", file=sys.stderr)
    completed = {row["name"] for row in results}
    missing_required = set(REQUIRED_MAPS) - completed
    if missing_required:
        raise RuntimeError(f"Missing core CS2 map(s) {sorted(missing_required)}. Stopping deployment rather than publishing incomplete assets")
    if len(results) < 5:
        raise RuntimeError(f"Only {len(results)} usable maps found; refusing incomplete radar bundle")
    index = {"source": MANIFEST, "maps": results, "skipped": failures,
             "notice": "CS2 radar images and source metadata are Valve Corporation property; check redistribution rights."}
    (output / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"Synchronized {len(results)} CS2 maps; {len(failures)} skipped; output={output}")
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Build output folder, usually web/dist/maps")
    args = parser.parse_args()
    manifest = json.loads(download(MANIFEST, limit=10 * 1024 * 1024).decode("utf-8"))
    sync_maps(manifest, args.output)


if __name__ == "__main__":
    main()
