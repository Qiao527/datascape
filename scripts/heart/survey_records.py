"""
Ranks healthy-control records of the PTB Diagnostic ECG Database by the
quality of their Frank XYZ leads, to choose the record used in
"The Electric Heart".

Expects the .hea and .xyz files of the controls in .cache/ptb/ (see README).
Run: python scripts/heart/survey_records.py
"""

from pathlib import Path

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

CACHE = Path(__file__).resolve().parents[3] / ".cache" / "ptb"
FS = 1000
GAIN = 2000.0  # adu per mV, from the headers


def band(signal, lo, hi):
    b, a = butter(2, [lo / (FS / 2), hi / (FS / 2)], btype="band")
    return filtfilt(b, a, signal, axis=0)


def read_xyz(path):
    raw = np.fromfile(path, dtype="<i2")
    return raw[: len(raw) // 3 * 3].reshape(-1, 3) / GAIN


rows = []
for path in sorted(CACHE.glob("*/*.xyz")):
    xyz = read_xyz(path)
    if len(xyz) < 30 * FS:
        continue
    xyz = xyz[: 60 * FS]
    clean = band(xyz, 0.5, 40)
    noise = xyz - band(xyz, 0.05, 40)
    wander = band(xyz, 0.05, 0.5)
    magnitude = np.linalg.norm(clean, axis=1)
    peaks, _ = find_peaks(magnitude, distance=int(0.35 * FS), height=np.percentile(magnitude, 98) * 0.5)
    rr = np.diff(peaks) / FS
    beats = np.array([clean[p - 300: p + 550] for p in peaks[1:-1] if p > 300 and p + 550 < len(clean)])
    template = np.median(beats, axis=0)
    corr = np.mean([np.corrcoef(b.ravel(), template.ravel())[0, 1] for b in beats])
    amplitude = np.percentile(magnitude, 99)
    score = corr - 2 * np.std(noise) / amplitude - 1.5 * np.std(wander) / amplitude - np.std(rr)
    record = f"{path.parent.name}/{path.stem}"
    rows.append((score, record, corr, np.std(noise) / amplitude, np.std(wander) / amplitude, 60 / np.mean(rr), np.std(rr), amplitude))

rows.sort(reverse=True)
print(f"{'record':22s} score  corr   noise  wander  bpm   rrSD   amp(mV)")
for score, name, corr, noise, wander, bpm, rr_sd, amp in rows:
    print(f"{name:22s} {score:.3f} {corr:.3f} {noise:.3f} {wander:.3f} {bpm:5.1f} {rr_sd:.3f} {amp:.2f}")
