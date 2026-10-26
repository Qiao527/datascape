"""Storm Chamber: one NEXRAD volume scan, as sweeps and as a gridded box.

Source: NOAA NEXRAD Level II, radar KDDC (Dodge City, Kansas), the volume
scan that began 2013-05-19 00:04:56 UTC (7:04:56 p.m. CDT on May 18). The
supercell that produced the Rozel tornado stood about 60 km northeast of the
radar; the tornado touched down at 00:18 UTC. Data from the public archive on
AWS (s3://unidata-nexrad-level2).

What it writes to public/data/storm/:
  storm.json  manifest: sweeps, scan times, grid, places, tornado, facts
  storm.bin   zlib-compressed bytes:
                volume  uint8 [nz][ny][nx]        the gridded box
                low     uint8 [720][600]          lowest sweep, 0.5 deg x 0.25 km
                upper   uint8 [13][360][300]      other sweeps, 1 deg x 0.5 km

Every array uses the same code: 0 is no echo (or nothing measured), 1..255
is dBZ = DBZ_MIN + (code - 1) * DBZ_STEP. Sweeps keep echoes of 10 dBZ and
up; the box keeps 10 dBZ and up after gridding.

Quality control: gates the dual-polarization correlation coefficient marks as
not weather (rho_hv < 0.8, unless the echo is 40 dBZ or more) are dropped.
Small isolated patches of echo are removed, in each sweep and in the box.

Gridding: every voxel center is converted to the radar's coordinates (slant
range, azimuth, elevation angle) with the 4/3-Earth beam model. Each sweep is
sampled at the nearest gate and ray; between the two sweeps that bracket the
voxel's elevation angle the value is interpolated linearly in dBZ. Above the
highest sweep that reaches the voxel's range, and below the lowest beam,
nothing is measured and the box is empty. A light Gaussian (0.3-0.35 km)
softens nearest-gate steps.
"""
import json
import urllib.request
import zlib
from pathlib import Path

import numpy as np
from metpy.io import Level2File
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT.parent / '.cache' / 'storm'
OUT = ROOT / 'public' / 'data' / 'storm'
KEY = '2013/05/19/KDDC/KDDC20130519_000455_V06.gz'
BUCKET = 'https://unidata-nexrad-level2.s3.amazonaws.com'

RE = 6371.0 * 4 / 3           # effective Earth radius, km
BEAM_WIDTH = 0.95             # degrees, WSR-88D
DBZ_MIN, DBZ_STEP = 5.0, 0.3  # code 1..255 -> 5.0 .. 81.2 dBZ
KEEP_DBZ = 10.0               # weakest echo kept
NO_ECHO = -20.0               # what "below the noise" counts as when interpolating

# The box, in km east and north of the radar, and km above sea level.
BOX_CENTER = (46.0, 54.0)
BOX_HALF = 40.0
CELL = 0.5
Z_TOP = 20.0
# Sweeps are exported out to this range.
MAX_RANGE = 150.0
# Where the storm is, for the per-sweep statistics.
CORE = (42.5, 46.0)
CORE_RADIUS = 30.0

PLACES = [
    ('Dodge City', 37.7528, -100.0171),
    ('Rozel', 38.1959, -99.4029),
    ('Larned', 38.1806, -99.0987),
    ('Kinsley', 37.9231, -99.4096),
    ('Jetmore', 38.0845, -99.8932),
    ('Great Bend', 38.3645, -98.7648),
]

# NOAA NCEI Storm Events Database, event 457695 (Pawnee County, Kansas).
# Times there are CST (UTC-6): 18:18-18:47 CST is 00:18-00:47 UTC.
TORNADO = {
    'event': 457695, 'rating': 'EF4', 'startUtc': '2013-05-19T00:18:00Z', 'endUtc': '2013-05-19T00:47:00Z',
    'begin': (38.1429, -99.4706), 'end': (38.2310, -99.4301), 'lengthMiles': 7, 'widthYards': 1100,
    'injuries': 0, 'deaths': 0,
}
# Ground elevation (m), Copernicus GLO-90 DEM via the Open-Meteo elevation API.
GROUND_AT_TOUCHDOWN_M = 653.0

# NWS reflectivity colors, 5 dBZ steps from 5 dBZ (MetPy 'NWSReflectivity').
NWS_COLORS = ['#00ecec', '#01a0f6', '#0000f6', '#00ff00', '#00c800', '#009000', '#ffff00', '#e7c000',
              '#ff9000', '#ff0000', '#d60000', '#c00000', '#ff00ff', '#9955c9', '#ffffff']


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / Path(KEY).name
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(f'{BUCKET}/{KEY}').read())
    return path


def read_sweeps(f):
    """One sweep per elevation (the long-range surveillance cut), with the
    correlation-coefficient check applied. Rays stay in scan order."""
    sweeps = []
    for sweep in f.sweeps:
        if not sweep or b'REF' not in sweep[0][4] or b'RHO' not in sweep[0][4]:
            continue
        hdr = sweep[0][4][b'REF'][0]
        az = np.array([ray[0].az_angle for ray in sweep])
        ref = np.array([ray[4][b'REF'][1] for ray in sweep], dtype=float)
        rho_hdr = sweep[0][4][b'RHO'][0]
        rho = np.array([ray[4][b'RHO'][1] for ray in sweep], dtype=float)
        gates = hdr.first_gate + np.arange(hdr.num_gates) * hdr.gate_width
        rho_gates = rho_hdr.first_gate + np.arange(rho_hdr.num_gates) * rho_hdr.gate_width
        idx = np.clip(np.round((gates - rho_gates[0]) / rho_hdr.gate_width).astype(int), 0, len(rho_gates) - 1)
        rho_on_ref = rho[:, idx]
        rho_on_ref[:, gates > rho_gates[-1]] = np.nan
        nonmet = (rho_on_ref < 0.8) & ~(ref >= 40)
        ref[nonmet] = np.nan
        times = np.array([ray[0].time_ms for ray in sweep]) / 1000.0
        sweeps.append({
            'el': float(np.mean([ray[0].el_angle for ray in sweep])),
            'az': az, 'ref': ref, 'gate0': float(hdr.first_gate), 'gw': float(hdr.gate_width),
            'ngates': int(hdr.num_gates), 'rmax': float(gates[-1]),
            't0': float(times.min()), 't1': float(times.max()), 'az0': float(az[np.argmin(times)]),
            'times': times,
        })
    sweeps.sort(key=lambda s: s['el'])
    unique = []
    for s in sweeps:
        if unique and abs(s['el'] - unique[-1]['el']) < 0.25:
            continue
        unique.append(s)
    return unique


def beam(r, el_deg):
    """Slant range -> (ground range, height above the antenna), 4/3 Earth."""
    el = np.radians(el_deg)
    h = np.sqrt(r * r + RE * RE + 2 * r * RE * np.sin(el)) - RE
    s = RE * np.arcsin(r * np.cos(el) / (RE + h))
    return s, h


def slant_for_ground(s, el_deg):
    """Ground range -> slant range along a beam (a few fixed-point steps)."""
    r = s / np.cos(np.radians(el_deg))
    for _ in range(4):
        s_r, _ = beam(r, el_deg)
        r = r * s / np.maximum(s_r, 1e-9)
    return r


def to_radar(x, y, z_arl):
    """Ground position (km E, N of radar) and height above the antenna ->
    slant range, azimuth, elevation angle (4/3 Earth)."""
    s = np.hypot(x, y)
    az = (np.degrees(np.arctan2(x, y)) + 360.0) % 360.0
    phi = s / RE
    dx = (RE + z_arl) * np.sin(phi)
    dy = (RE + z_arl) * np.cos(phi) - RE
    return np.hypot(dx, dy), az, np.degrees(np.arctan2(dy, dx))


def sample(sweep, r, az):
    """Nearest ray and gate. NaN outside the sweep's range; NO_ECHO where the
    radar heard nothing."""
    order = np.argsort(sweep['az'])
    a = sweep['az'][order]
    k = np.searchsorted(a, az) % len(a)
    km = (k - 1) % len(a)
    nearer = np.abs((a[k] - az + 180) % 360 - 180) < np.abs((a[km] - az + 180) % 360 - 180)
    ray = np.where(nearer, order[k], order[km])
    g = np.round((r - sweep['gate0']) / sweep['gw']).astype(int)
    inside = (g >= 0) & (g < sweep['ngates'])
    out = np.full(np.shape(r), np.nan)
    v = sweep['ref'][ray[inside], g[inside]]
    out[inside] = np.where(np.isnan(v), NO_ECHO, v)
    return out


def grid_volume(sweeps, x, y, z_arl):
    r, az, theta = to_radar(x, y, z_arl)
    els = np.array([s['el'] for s in sweeps])
    values = np.stack([sample(s, r, az) for s in sweeps])  # NaN = out of range
    out = np.full(x.shape, np.nan)
    half = BEAM_WIDTH / 2
    valid = ~np.isnan(values)
    top = np.where(valid.any(0), len(els) - 1 - np.argmax(valid[::-1], 0), -1)
    i = np.clip(np.searchsorted(els, theta), 1, len(els) - 1)
    lo, hi = i - 1, i
    w = np.clip((theta - els[lo]) / (els[hi] - els[lo]), 0, 1)
    vlo = np.take_along_axis(values, lo[None], 0)[0]
    vhi = np.take_along_axis(values, hi[None], 0)[0]
    between = (theta >= els[0] - half) & (hi <= top) & ~np.isnan(vlo) & ~np.isnan(vhi)
    out[between] = (vlo * (1 - w) + vhi * w)[between]
    top_el = np.where(top >= 0, els[np.clip(top, 0, None)], -90)
    cap = (top >= 0) & (theta > top_el) & (theta <= top_el + half)
    vtop = np.take_along_axis(values, np.clip(top, 0, None)[None], 0)[0]
    out[cap] = vtop[cap]
    return out


def encode(dbz):
    q = np.round((dbz - DBZ_MIN) / DBZ_STEP) + 1
    q = np.where(np.isnan(dbz) | (dbz < KEEP_DBZ), 0, np.clip(q, 1, 255))
    return q.astype(np.uint8)


def drop_specks(dbz, min_size, structure=None):
    """Remove connected patches of echo smaller than min_size cells."""
    echo = np.nan_to_num(dbz, nan=-99) >= KEEP_DBZ
    labels, n = ndimage.label(echo, structure=structure)
    if n == 0:
        return dbz
    sizes = ndimage.sum(echo, labels, range(1, n + 1))
    small = np.isin(labels, np.where(sizes < min_size)[0] + 1)
    out = dbz.copy()
    out[small] = np.nan
    return out


def polar(sweep, n_az, gate_km, max_km=MAX_RANGE):
    """Resample a sweep onto a regular azimuth x range grid: the nearest ray
    for each azimuth bin, gates averaged in linear Z within each range bin."""
    n_gates = int(round(max_km / gate_km))
    centers = (np.arange(n_az) + 0.5) * 360.0 / n_az
    d = np.abs((sweep['az'][None, :] - centers[:, None] + 180) % 360 - 180)
    rays = np.argmin(d, 1)
    src_r = sweep['gate0'] + np.arange(sweep['ngates']) * sweep['gw']
    bins = np.floor(src_r / gate_km).astype(int)
    keep = (bins >= 0) & (bins < n_gates)
    out = np.full((n_az, n_gates), np.nan)
    for i, ray in enumerate(rays):
        v = sweep['ref'][ray]
        ok = keep & np.isfinite(v)
        z = np.zeros(n_gates)
        c = np.zeros(n_gates)
        np.add.at(z, bins[ok], 10 ** (v[ok] / 10))
        np.add.at(c, bins[ok], 1)
        # A bin counts as measured if any of its gates holds echo.
        has = c > 0
        total = np.zeros(n_gates)
        np.add.at(total, bins[keep], 1)
        mean = np.where(has, z / np.maximum(total, 1), 0)
        out[i, has] = 10 * np.log10(mean[has])
    out[:, (np.arange(n_gates) + 0.5) * gate_km > sweep['rmax']] = np.nan
    return out


def solar_position(lat, lon, year, month, day, hour_utc):
    """Sun azimuth and elevation (degrees) from the NOAA solar equations."""
    n = (np.datetime64(f'{year:04d}-{month:02d}-{day:02d}') - np.datetime64(f'{year:04d}-01-01')).astype(int)
    g = 2 * np.pi / 365 * (n + (hour_utc - 12) / 24)
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
            + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    tst = hour_utc * 60 + eqtime + 4 * lon
    ha = np.radians(tst / 4 - 180)
    phi = np.radians(lat)
    cos_zen = np.sin(phi) * np.sin(decl) + np.cos(phi) * np.cos(decl) * np.cos(ha)
    zen = np.arccos(cos_zen)
    az = np.degrees(np.arctan2(np.sin(ha), np.cos(ha) * np.sin(phi) - np.tan(decl) * np.cos(phi))) + 180
    return {'azimuth': round(float(az % 360), 1), 'elevation': round(float(90 - np.degrees(zen)), 1)}


def storm_stats(sweep, antenna_km):
    """What one sweep measured over the storm: its strongest echo and the
    highest beam centre that still held echo of 18, 30, 40 and 50 dBZ."""
    r = sweep['gate0'] + np.arange(sweep['ngates']) * sweep['gw']
    s, h = beam(r, sweep['el'])
    a = np.radians(sweep['az'])[:, None]
    x = s[None, :] * np.sin(a)
    y = s[None, :] * np.cos(a)
    near = np.hypot(x - CORE[0], y - CORE[1]) < CORE_RADIUS
    ref = np.where(near, sweep['ref'], np.nan)
    hm = np.broadcast_to(h[None, :] + antenna_km, ref.shape)
    stats = {'max': None, 'maxKm': None, 'maxXY': None, 'tops': {}, 'topXY': {}}
    if np.isfinite(ref).any():
        k = np.nanargmax(ref)
        stats['max'] = round(float(ref.flat[k]), 1)
        stats['maxKm'] = round(float(hm.flat[k]), 2)
        stats['maxXY'] = [round(float(x.flat[k]), 2), round(float(y.flat[k]), 2)]
    for th in (18, 30, 40, 50):
        m = ref >= th
        if m.any():
            k = np.argmax(np.where(m, hm, -1))
            stats['tops'][str(th)] = round(float(hm.flat[k]), 2)
            stats['topXY'][str(th)] = [round(float(x.flat[k]), 2), round(float(y.flat[k]), 2)]
        else:
            stats['tops'][str(th)] = None
            stats['topXY'][str(th)] = None
    core_r = slant_for_ground(np.hypot(*CORE), sweep['el'])
    stats['beamAtCoreKm'] = round(float(beam(core_r, sweep['el'])[1] + antenna_km), 2) if core_r <= sweep['rmax'] else None
    return stats


def main():
    f = Level2File(str(fetch()))
    const = f.sweeps[0][0][1]
    radar_lat, radar_lon = float(const.lat), float(const.lon)
    site_km = float(const.site_amsl) / 1000.0
    antenna_km = site_km + float(const.feedhorn_agl) / 1000.0
    sweeps = read_sweeps(f)
    t_start = sweeps[0]['t0']
    print('sweeps', [round(s['el'], 2) for s in sweeps])

    def lonlat_to_xy(lat, lon):
        return ((lon - radar_lon) * 111.320 * np.cos(np.radians(radar_lat)), (lat - radar_lat) * 110.574)

    # ---- the sweeps, each on its own polar grid
    low = drop_specks(polar(sweeps[0], 720, 0.25), 24)
    upper = np.stack([drop_specks(polar(s, 360, 0.5), 10) for s in sweeps[1:]])
    low_bytes = encode(low)
    upper_bytes = encode(upper)

    # ---- the box
    cx, cy = BOX_CENTER
    xs = cx + np.arange(-BOX_HALF, BOX_HALF + 1e-6, CELL)
    ys = cy + np.arange(-BOX_HALF, BOX_HALF + 1e-6, CELL)
    zs = np.arange(0.0, Z_TOP + 1e-6, CELL)  # km above sea level
    Z, Y, X = np.meshgrid(zs, ys, xs, indexing='ij')
    vol = grid_volume(sweeps, X, Y, Z - antenna_km)
    vol[Z < site_km] = np.nan
    echo = vol >= 15
    labels, n = ndimage.label(echo)
    sizes = ndimage.sum(echo, labels, range(1, n + 1))
    vol[np.isin(labels, np.where(sizes < 40)[0] + 1)] = NO_ECHO
    filled = np.where(np.isnan(vol), NO_ECHO, vol)
    smooth = ndimage.gaussian_filter(filled, sigma=(0.6, 0.7, 0.7))
    smooth[np.isnan(vol)] = np.nan
    volume = encode(smooth)

    # ---- facts, from the sweeps themselves
    stats = [storm_stats(s, antenna_km) for s in sweeps]
    best = max((st for st in stats if st['max'] is not None), key=lambda st: st['max'])
    best_el = sweeps[stats.index(best)]['el']

    def highest(th):
        cands = [(st['tops'][str(th)], s['el'], st['topXY'][str(th)]) for st, s in zip(stats, sweeps) if st['tops'][str(th)] is not None]
        return max(cands) if cands else (None, None, None)

    top18, top18_el, top18_xy = highest(18)
    top50, top50_el, top50_xy = highest(50)
    tx, ty = lonlat_to_xy(*TORNADO['begin'])
    ex, ey = lonlat_to_xy(*TORNADO['end'])
    touch_s = float(np.hypot(tx, ty))
    r_touch = slant_for_ground(touch_s, sweeps[0]['el'])
    h_touch = float(beam(r_touch, sweeps[0]['el'])[1]) + antenna_km
    h_touch_low = float(beam(r_touch, sweeps[0]['el'] - BEAM_WIDTH / 2)[1]) + antenna_km
    facts = {
        'maxDbz': best['max'], 'maxDbzKm': best['maxKm'], 'maxDbzEl': round(best_el, 2), 'maxDbzXY': best['maxXY'],
        'top18Km': top18, 'top18El': round(top18_el, 2), 'top18XY': top18_xy,
        'top50Km': top50, 'top50El': round(top50_el, 2), 'top50XY': top50_xy,
        # The bounded weak-echo region seen in the 3.2-5.2 deg sweeps (about 3.5-6.5 km up).
        'vault': {'x': 43.6, 'y': 37.2, 'fromKm': 3.5, 'toKm': 6.5},
        'scanSeconds': round(sweeps[-1]['t1'] - t_start, 1),
        'lowestBeamAtTouchdown': {'rangeKm': round(touch_s, 1), 'centerAboveGroundM': round(h_touch * 1000 - GROUND_AT_TOUCHDOWN_M),
                                  'lowerEdgeAboveGroundM': round(h_touch_low * 1000 - GROUND_AT_TOUCHDOWN_M),
                                  'groundM': GROUND_AT_TOUCHDOWN_M},
        # The volume starts t_start seconds after 00:00 UTC; touchdown was 00:18 UTC.
        'minutesBeforeTouchdown': round((18 * 60 - t_start) / 60.0, 1),
        'boxVolumeKm3Above18': round(float(np.sum(volume >= np.round((18 - DBZ_MIN) / DBZ_STEP) + 1) * CELL ** 3)),
    }

    places = []
    for name, lat, lon in PLACES:
        px, py = lonlat_to_xy(lat, lon)
        places.append({'name': name, 'x': round(float(px), 2), 'y': round(float(py), 2)})

    OUT.mkdir(parents=True, exist_ok=True)
    blobs = [volume.tobytes(), low_bytes.tobytes(), upper_bytes.tobytes()]
    layout, offset = {}, 0
    for name, blob in zip(('volume', 'low', 'upper'), blobs):
        layout[name] = {'offset': offset, 'length': len(blob)}
        offset += len(blob)
    (OUT / 'storm.bin').write_bytes(zlib.compress(b''.join(blobs), 9))
    old = OUT / 'storm.vol'
    if old.exists():
        old.unlink()

    manifest = {
        'radar': {'id': 'KDDC', 'name': 'Dodge City, Kansas', 'lat': radar_lat, 'lon': radar_lon,
                  'siteKm': site_km, 'antennaKm': antenna_km, 'vcp': int(const.vcp), 'beamWidth': BEAM_WIDTH},
        'source': 'NOAA NEXRAD Level II, ' + KEY,
        'startUtc': '2013-05-19T00:00:00Z',
        'startSeconds': round(t_start, 2),
        'utcOffsetHours': -5,
        'zone': 'CDT',
        'earthRadiusKm': RE,
        # The scene's ground plane, km above sea level (the touchdown point).
        'groundKm': GROUND_AT_TOUCHDOWN_M / 1000.0,
        'encoding': {'min': DBZ_MIN, 'step': DBZ_STEP, 'keep': KEEP_DBZ},
        'sweeps': [{
            'el': round(s['el'], 3), 'rmax': round(min(s['rmax'], MAX_RANGE), 2),
            't0': round(s['t0'] - t_start, 2), 't1': round(s['t1'] - t_start, 2), 'az0': round(s['az0'], 2),
            'storm': st,
        } for s, st in zip(sweeps, stats)],
        'polar': {
            'low': {'naz': 720, 'ngates': low.shape[1], 'gate': 0.25},
            'upper': {'naz': 360, 'ngates': upper.shape[2], 'gate': 0.5, 'layers': upper.shape[0]},
        },
        'box': {'x0': float(xs[0]), 'y0': float(ys[0]), 'z0': float(zs[0]), 'cell': CELL,
                'nx': len(xs), 'ny': len(ys), 'nz': len(zs)},
        'layout': layout,
        'places': places,
        'tornado': TORNADO | {'beginXY': [round(float(tx), 2), round(float(ty), 2)], 'endXY': [round(float(ex), 2), round(float(ey), 2)]},
        'sun': solar_position(38.15, -99.45, 2013, 5, 19, t_start / 3600.0),
        'core': list(CORE),
        'palette': {'nws': NWS_COLORS, 'from': 5, 'step': 5},
        'facts': facts,
    }
    (OUT / 'storm.json').write_text(json.dumps(manifest, indent=1))
    print(json.dumps(facts, indent=1))
    print('sun', manifest['sun'])
    print('bin %.0f KiB compressed (%.0f KiB raw)' % ((OUT / 'storm.bin').stat().st_size / 1024, offset / 1024))


if __name__ == '__main__':
    main()
