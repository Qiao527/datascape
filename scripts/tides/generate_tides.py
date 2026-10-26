"""
Builds the data for "Between Tides".

  Water level: NOAA CO-OPS station 8410140, Eastport, Maine. Verified 6-minute
               observations and harmonic predictions, both in NAVD88 meters.
  Terrain:     NOAA NCEI Continuously Updated DEM (CUDEM), 1/9 arc-second
               topobathy, tiles ncei19_n45x00_w067x25 / w067x00 (2021v1),
               NAVD88 meters. Cropped to the flats at South Lubec, about 8 km
               south of the gauge.

Both are on NAVD88, so the water surface is simply the measured level and the
ground is simply the surveyed elevation; no datum shift is needed.

Expects the two CUDEM GeoTIFFs in .cache/dem/ (see README). Downloads the
water levels from the CO-OPS API.
Run:  python scripts/tides/generate_tides.py
Out:  public/data/tides/tides.json, public/data/tides/tides.bin
"""

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import tifffile
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT.parent / ".cache"
OUT = ROOT / "public" / "data" / "tides"

STATION = "8410140"
BEGIN, END = "20240903", "20241002 23:54"
API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
MDAPI = f"https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{STATION}"

CENTER = (44.8345, -66.9905)  # lat, lon of the crop
SIZE_M = (2800.0, 2000.0)      # east-west, north-south
CELL_M = 5.0
Z_RANGE = (-16.0, 52.0)        # quantization range of the terrain, m


def fetch(product):
    query = (f"{API}?application=hidden_dimension&station={STATION}&begin_date={BEGIN}&end_date={END.replace(' ', '%20')}"
             f"&product={product}&datum=NAVD&time_zone=gmt&units=metric&format=json" + ("&interval=6" if product == "predictions" else ""))
    data = json.load(urllib.request.urlopen(query))
    rows = data["data"] if product == "water_level" else data["predictions"]
    times = [datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc) for r in rows]
    values = [float(r["v"]) if r["v"] != "" else np.nan for r in rows]
    return times, np.array(values), data.get("metadata")


def datums_navd88():
    data = json.load(urllib.request.urlopen(f"{MDAPI}/datums.json?units=metric"))
    by_name = {d["name"]: d["value"] for d in data["datums"]}
    navd = by_name["NAVD88"]
    return {name: round(by_name[name] - navd, 3) for name in ("MHHW", "MHW", "MSL", "MLW", "MLLW")}, data.get("epoch")


def load_dem():
    def read(name):
        tif = tifffile.TiffFile(CACHE / "dem" / f"{name}.tif")
        geo = tif.geotiff_metadata
        return tif.pages[0].asarray(), geo["ModelTiepoint"][3], geo["ModelTiepoint"][4], geo["ModelPixelScale"][0]

    west, lon0, lat0, step = read("n45x00_w067x25")
    east, lon1, _, _ = read("n45x00_w067x00")
    columns = int(round((lon1 - lon0) / step))
    return np.concatenate([west[:, :columns], east], axis=1), lon0, lat0, step


def crop_terrain():
    dem, lon0, lat0, step = load_dem()
    lat_c, lon_c = CENTER
    m_lat = 111132.954 - 559.822 * np.cos(2 * np.radians(lat_c))
    m_lon = 111412.84 * np.cos(np.radians(lat_c)) - 93.5 * np.cos(3 * np.radians(lat_c))
    nx, nz = int(SIZE_M[0] / CELL_M) + 1, int(SIZE_M[1] / CELL_M) + 1
    xs = (np.arange(nx) - (nx - 1) / 2) * CELL_M  # east
    zs = (np.arange(nz) - (nz - 1) / 2) * CELL_M  # south (row 0 is the north edge)
    lon = lon_c + xs / m_lon
    lat = lat_c - zs / m_lat
    # Pixel centers: the tiepoint is the corner of pixel (0, 0).
    cols = (lon[None, :] - lon0) / step - 0.5
    rows = (lat0 - lat[:, None]) / step - 0.5
    grid = map_coordinates(dem, [np.broadcast_to(rows, (nz, nx)), np.broadcast_to(cols, (nz, nx))], order=1)
    return grid.astype(np.float32), nx, nz, (lat[0], lon[0], lat[-1], lon[-1])


def waterline_shift(grid, high, low):
    """Largest east-west distance, along any row, between where the ground
    meets the high-water level and where it meets the low-water level."""
    best = 0.0
    for row in grid:
        wet_high = np.where(row < high)[0]
        dry_low = np.where(row > low)[0]
        if not len(wet_high) or not len(dry_low):
            continue
        # Walk east from land: first wet cell at high water, first wet cell at low water.
        x_high = np.argmax(row < high)
        x_low = np.argmax(row < low) if (row < low).any() else None
        if x_low is not None and x_low > x_high:
            best = max(best, (x_low - x_high) * CELL_M)
    return best


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    times, observed, meta = fetch("water_level")
    ptimes, predicted, _ = fetch("predictions")
    assert times == ptimes, "observation and prediction times differ"
    datums, epoch = datums_navd88()
    grid, nx, nz, bounds = crop_terrain()

    t0 = times[0]
    hours = np.array([(t - t0).total_seconds() / 3600 for t in times])
    i_max, i_min = int(np.nanargmax(observed)), int(np.nanargmin(observed))
    residual = observed - predicted

    # Highs and lows (local extrema of the predictions, 6 h apart at most).
    extrema = []
    for i in range(1, len(predicted) - 1):
        window = predicted[max(0, i - 25): i + 26]
        if predicted[i] == window.max() or predicted[i] == window.min():
            kind = "high" if predicted[i] == window.max() else "low"
            if not extrema or i - extrema[-1]["i"] > 20:
                extrema.append({"i": i, "kind": kind, "obs": float(observed[i]), "pred": float(predicted[i])})
    ranges = [abs(a["obs"] - b["obs"]) for a, b in zip(extrema, extrema[1:])]

    quantized = np.clip(np.round((grid - Z_RANGE[0]) / (Z_RANGE[1] - Z_RANGE[0]) * 65535), 0, 65535).astype("<u2")
    level_mm = lambda a: np.round(np.nan_to_num(a, nan=-9999) * 1000).astype("<i2")

    blobs, layout, offset = [], {}, 0
    for key, array in (("terrain", quantized), ("observed", level_mm(observed)), ("predicted", level_mm(predicted))):
        data = array.tobytes()
        layout[key] = {"offset": offset, "length": int(array.size), "type": str(array.dtype)}
        blobs.append(data)
        offset += len(data)
    (OUT / "tides.bin").write_bytes(b"".join(blobs))

    manifest = {
        "station": {"id": STATION, "name": "Eastport, Maine", "lat": float(meta["lat"]), "lon": float(meta["lon"])},
        "site": {"name": "South Lubec, Maine", "center": CENTER, "bounds": [float(b) for b in bounds], "distanceToGaugeKm": 7.8},
        "sources": {
            "water": "NOAA CO-OPS 8410140 Eastport, ME: verified 6-minute water level and harmonic predictions, NAVD88, meters",
            "terrain": "NOAA NCEI CUDEM 1/9 arc-second topobathy, ncei19_n45x00_w067x25 and ncei19_n45x00_w067x00 (2021v1), NAVD88, meters",
            "datumsEpoch": epoch,
        },
        "datum": "NAVD88",
        "start": t0.isoformat(),
        "intervalMinutes": 6,
        "count": len(times),
        "datums": datums,
        "observedMax": {"hour": float(hours[i_max]), "value": float(observed[i_max])},
        "observedMin": {"hour": float(hours[i_min]), "value": float(observed[i_min])},
        "residual": {"max": float(np.nanmax(residual)), "min": float(np.nanmin(residual)), "rms": float(np.sqrt(np.nanmean(residual**2)))},
        "extrema": [{"hour": float(hours[e["i"]]), "kind": e["kind"], "value": e["obs"]} for e in extrema],
        "rangeMax": float(max(ranges)),
        "rangeMin": float(min(ranges)),
        "terrain": {
            "nx": nx, "nz": nz, "cell": CELL_M, "zRange": Z_RANGE,
            "min": float(grid.min()), "max": float(grid.max()),
            "waterlineShiftM": waterline_shift(grid, float(observed[i_max]), float(observed[i_min])),
        },
        "layout": layout,
        "binary": "tides.bin",
    }
    (OUT / "tides.json").write_text(json.dumps(manifest, indent=1))

    print("observations:", len(times), "missing:", int(np.isnan(observed).sum()))
    print("datums NAVD88 (m):", datums)
    print("max %.3f m at %s | min %.3f m at %s" % (observed[i_max], times[i_max], observed[i_min], times[i_min]))
    print("range per half-cycle: %.2f .. %.2f m" % (min(ranges), max(ranges)))
    print("residual (obs - pred): %.3f .. %.3f m, rms %.3f" % (np.nanmin(residual), np.nanmax(residual), manifest["residual"]["rms"]))
    print("terrain %dx%d, %.1f .. %.1f m; waterline shift between month max/min: %.0f m" % (nx, nz, grid.min(), grid.max(), manifest["terrain"]["waterlineShiftM"]))
    print("bin %.0f KiB" % (offset / 1024))


if __name__ == "__main__":
    main()
