"""
Builds the data for "The Electric Heart" from one healthy-control record of
the PTB Diagnostic ECG Database (PhysioNet, ODC-By 1.0):

  Bousseljot R, Kreiseler D, Schnabel A. Nutzung der EKG-Signaldatenbank
  CARDIODAT der PTB über das Internet. Biomedizinische Technik 40(1), 1995.
  Goldberger A, et al. PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23), 2000.

The record holds the conventional 12 leads and the 3 Frank leads (X, Y, Z),
recorded simultaneously at 1 kHz. The Frank leads are close to orthogonal
components of the heart's electrical vector; plotted against each other they
trace the vectorcardiogram loop.

Expects .hea, .dat and .xyz in .cache/ptb/<patient>/ (see README).
Run:  python scripts/heart/generate_heart.py
Out:  public/data/heart/heart.json, public/data/heart/heart.bin
"""

import json
import re
from pathlib import Path

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.signal import butter, filtfilt, find_peaks

RECORD = "patient122/s0312lre"
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT.parent / ".cache" / "ptb"
OUT = ROOT / "public" / "data" / "heart"

FS = 1000
WINDOW_START_S = 12.0
WINDOW_S = 10.0
DISPLAY_FS = 500
LEADS = ["i", "ii", "iii", "avr", "avl", "avf", "v1", "v2", "v3", "v4", "v5", "v6"]


def read_header(path):
    signals = []
    for line in path.read_text().splitlines()[1:]:
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split()
        signals.append({
            "file": parts[0],
            "gain": float(re.match(r"[\d.]+", parts[2]).group()),
            "baseline": int(parts[4]),
            "checksum": int(parts[6]),
            "name": parts[8].lower(),
        })
    return signals


def read_signals(directory, name, signals):
    out = {}
    for file in sorted({s["file"] for s in signals}):
        members = [s for s in signals if s["file"] == file]
        raw = np.fromfile(directory / file, dtype="<i2")
        raw = raw[: len(raw) // len(members) * len(members)].reshape(-1, len(members))
        for column, signal in enumerate(members):
            adu = raw[:, column].astype(np.int64)
            checksum = int(adu.sum()) & 0xFFFF
            checksum = checksum - 0x10000 if checksum >= 0x8000 else checksum
            if checksum != signal["checksum"]:
                raise ValueError(f"{name}:{signal['name']} checksum {checksum} != {signal['checksum']}")
            out[signal["name"]] = (adu - signal["baseline"]) / signal["gain"]
    return out


def band(x, lo, hi):
    b, a = butter(2, [lo / (FS / 2), hi / (FS / 2)], btype="band")
    return filtfilt(b, a, x, axis=0)


def first_below(values, start, step, threshold, limit):
    i = start
    while 0 < i < len(values) - 1 and abs(i - start) < limit:
        if values[i] < threshold:
            return i
        i += step
    return i


def main():
    patient, name = RECORD.split("/")
    directory = CACHE / patient
    signals = read_header(directory / f"{name}.hea")
    raw = read_signals(directory, name, signals)

    # Diagnostic-band filter, then remove the remaining baseline with a cubic
    # spline through each beat's PR segment, the isoelectric reference. This
    # makes every loop start and end at the origin.
    filtered = {key: band(value, 0.05, 40.0) for key, value in raw.items()}
    xyz_probe = np.stack([filtered["vx"], filtered["vy"], filtered["vz"]], axis=1)
    magnitude_probe = np.linalg.norm(np.gradient(xyz_probe, axis=0), axis=1)
    peaks, _ = find_peaks(magnitude_probe, distance=int(0.4 * FS), height=np.percentile(magnitude_probe, 99) * 0.4)
    # Snap each detection to the maximum of |V| within ±40 ms (the R peak).
    magnitude_full = np.linalg.norm(xyz_probe, axis=1)
    peaks = np.array([p - 40 + int(np.argmax(magnitude_full[p - 40: p + 40])) for p in peaks if 40 < p < len(magnitude_full) - 40])
    knots = np.array([p - 65 for p in peaks if p > 100])
    for key, value in filtered.items():
        levels = np.array([value[k - 10: k + 10].mean() for k in knots])
        filtered[key] = value - CubicSpline(knots, levels)(np.arange(len(value)))
    xyz_full = np.stack([filtered["vx"], filtered["vy"], filtered["vz"]], axis=1)
    magnitude_full = np.linalg.norm(xyz_full, axis=1)

    # Median beat over the whole record, aligned on the R peak.
    pre, post = 360, 560
    aligned = np.array([xyz_full[p - pre: p + post] for p in peaks if p > pre and p + post < len(xyz_full)])
    median = np.median(aligned, axis=0)
    mag = np.linalg.norm(median, axis=1)
    velocity = np.linalg.norm(np.gradient(median, axis=0), axis=1) * FS  # mV/s
    r = pre

    # Wave boundaries on the median beat (estimates, used for labels and tint).
    qrs_peak_velocity = velocity[r - 80: r + 100].max()
    qrs_on = first_below(velocity, r - 10, -1, 0.12 * qrs_peak_velocity, 120)
    qrs_off = first_below(velocity, r + 10, 1, 0.12 * qrs_peak_velocity, 140)
    t_peak = qrs_off + 60 + int(np.argmax(mag[qrs_off + 60: qrs_off + 420]))
    t_end = first_below(mag, t_peak, 1, 0.2 * mag[t_peak], 260)
    p_peak = qrs_on - 260 + int(np.argmax(mag[qrs_on - 260: qrs_on - 30]))
    p_on = first_below(mag, p_peak, -1, 0.25 * mag[p_peak], 140)
    p_off = first_below(mag, p_peak, 1, 0.25 * mag[p_peak], 140)
    fiducials_ms = {k: int(v - r) for k, v in {
        "pOn": p_on, "pPeak": p_peak, "pOff": p_off, "qrsOn": qrs_on, "r": r,
        "qrsOff": qrs_off, "tPeak": t_peak, "tEnd": t_end,
    }.items()}

    start = int(WINDOW_START_S * FS)
    stop = start + int(WINDOW_S * FS)
    window_peaks = [int(p) for p in peaks if start + 400 <= p < stop - 600]

    step = FS // DISPLAY_FS
    twelve = np.stack([filtered[lead][start:stop:step] for lead in LEADS])
    xyz = xyz_full[start:stop]

    def micro(values):
        return np.clip(np.round(np.asarray(values) * 1000), -32767, 32767).astype("<i2")

    blobs, offset, layout = [], 0, {}

    def add(key, array):
        nonlocal offset
        data = micro(array).tobytes()
        layout[key] = {"offset": offset, "length": int(np.asarray(array).size)}
        blobs.append(data)
        offset += len(data)

    add("twelve", twelve)
    add("xyz", xyz)
    add("median", median)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "heart.bin").write_bytes(b"".join(blobs))

    rr = np.diff(peaks) / FS
    qrs_vector = median[r]
    manifest = {
        "source": {
            "database": "PTB Diagnostic ECG Database 1.0.0 (PhysioNet)",
            "license": "Open Data Commons Attribution License v1.0",
            "record": RECORD,
            "subject": "healthy control",
            "url": "https://physionet.org/content/ptbdb/1.0.0/",
        },
        "processing": {
            "filter": "zero-phase 2nd-order Butterworth band-pass 0.05-40 Hz; cubic-spline baseline through PR segments",
            "units": "microvolts (int16)",
            "fiducials": "estimated from the median beat's vector magnitude and spatial velocity",
        },
        "fs": FS,
        "displayFs": DISPLAY_FS,
        "windowStart": WINDOW_START_S,
        "duration": WINDOW_S,
        "leads": LEADS,
        "layout": layout,
        "beats": [p - start for p in window_peaks],
        "medianR": r,
        "medianLength": len(median),
        "fiducials": fiducials_ms,
        "heartRate": round(60 / float(np.mean(rr)), 1),
        "binary": "heart.bin",
    }
    (OUT / "heart.json").write_text(json.dumps(manifest, indent=1))

    print("checksums ok; beats in record:", len(peaks), "| in window:", len(window_peaks))
    print("heart rate %.1f bpm, RR sd %.3f s" % (60 / rr.mean(), rr.std()))
    print("fiducials (ms from R):", fiducials_ms)
    print("QRS peak vector (mV) x=%.2f y=%.2f z=%.2f" % tuple(qrs_vector))
    print("T peak vector   (mV) x=%.2f y=%.2f z=%.2f" % tuple(median[t_peak]))
    print("bin %.0f KiB" % (offset / 1024))


if __name__ == "__main__":
    main()
