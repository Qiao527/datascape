"""
Generates the data for "The Shadow of Water".

The object is the equilibrium surface of H2O: for every temperature T and
pressure P in the plotted range, the density rho of the stable phase.
Plotted coordinates are (T, log10 P, log10 rho). Where two phases coexist,
the surface becomes a vertical wall (a "curtain") between the two densities.

  Fluid (liquid, vapor, supercritical): IAPWS-95 via CoolProp
  Ice Ih:                               IAPWS R10-06(2009) via iapws
  Sublimation and melting curves:       IAPWS R14-08(2011) via iapws

Run:  python scripts/water/generate_surface.py
Out:  public/data/water/surface.json  (manifest, curves, processes)
      public/data/water/surface.bin   (little-endian float32 vertex data)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import CoolProp
import CoolProp.CoolProp as CP
import iapws
import numpy as np
from iapws._iapws import _Ice, _Melting_Pressure, _Sublimation_Pressure

FLUID = "Water"
AS = CP.AbstractState("HEOS", FLUID)

T_TRIPLE = 273.16
P_TRIPLE = CP.PropsSI("ptriple", FLUID)
T_CRIT = CP.PropsSI("Tcrit", FLUID)
P_CRIT = CP.PropsSI("pcrit", FLUID)
RHO_CRIT = CP.PropsSI("rhocrit", FLUID)
R_SPECIFIC = 461.51805  # J/(kg K), IAPWS-95

T_MIN, T_MAX = 200.0, 800.0
LOGP_MIN, LOGP_MAX = 0.0, 8.0  # 1 Pa .. 100 MPa
P_MIN, P_MAX = 10**LOGP_MIN, 10**LOGP_MAX

OUT_DIR = Path(__file__).resolve().parents[2] / "public" / "data" / "water"


# ---------------------------------------------------------------------------
# Phase boundaries (pressures in Pa)

def p_sub(T: float) -> float:
    return _Sublimation_Pressure(T) * 1e6


def p_melt(T: float) -> float:
    return _Melting_Pressure(T, ice="Ih") * 1e6


def p_sat(T: float) -> float:
    if T >= T_CRIT:
        return P_CRIT
    return CP.PropsSI("P", "T", T, "Q", 0, FLUID)


def p_isochore(T: float) -> float:
    """Critical isochore: continues the boiling curve past the critical point.
    It is only used to lay out the mesh; the surface is smooth across it."""
    return CP.PropsSI("P", "T", T, "D", RHO_CRIT, FLUID)


def bisect(f, lo: float, hi: float, iterations: int = 80) -> float:
    flo = f(lo)
    for _ in range(iterations):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def t_melt(P: float) -> float:
    """Inverse of the Ih melting curve (melting temperature falls with pressure)."""
    if P <= P_TRIPLE:
        return T_TRIPLE
    return bisect(lambda T: p_melt(T) - P, 251.2, T_TRIPLE)


def t_sub(P: float) -> float:
    return bisect(lambda T: p_sub(T) - P, 150.0, T_TRIPLE)


def t_sat(P: float) -> float:
    return CP.PropsSI("T", "P", P, "Q", 0, FLUID)


T_SUB_AT_PMIN = t_sub(P_MIN)  # where the sublimation curve leaves the plot
T_MELT_AT_PMAX = t_melt(P_MAX)


# ---------------------------------------------------------------------------
# Densities (kg/m3)

def rho_vapor(T: float, P: float) -> float:
    """Vapor density. Below the triple point CoolProp refuses (T, P) input, so
    solve the IAPWS-95 equation in density directly (Newton from ideal gas)."""
    if T >= T_TRIPLE:
        try:
            return CP.PropsSI("D", "T", T, "P|gas", P, FLUID)
        except ValueError:
            pass
    rho = P / (R_SPECIFIC * T)
    for _ in range(40):
        AS.update(CP.DmassT_INPUTS, rho, T)
        step = (AS.p() - P) / AS.first_partial_deriv(CP.iP, CP.iDmass, CP.iT)
        rho -= step
        if abs(step) < 1e-13 * rho:
            break
    return rho


def rho_liquid(T: float, P: float) -> float:
    return CP.PropsSI("D", "T", T, "P|liquid", P, FLUID)


def rho_fluid(T: float, P: float) -> float:
    """Single-phase fluid at or above the critical temperature."""
    return CP.PropsSI("D", "T", T, "P", P, FLUID)


def rho_ice(T: float, P: float) -> float:
    return _Ice(T, P / 1e6)["rho"]


def rho_sat(T: float, quality: int) -> float:
    if T >= T_CRIT:
        return RHO_CRIT
    return CP.PropsSI("D", "T", T, "Q", quality, FLUID)


# ---------------------------------------------------------------------------
# Sampling helpers

def concat_unique(*parts):
    out = []
    for part in parts:
        for value in part:
            if not out or abs(value - out[-1]) > 1e-9:
                out.append(float(value))
    return out


def columns() -> list[float]:
    """Temperatures of the mesh columns: denser towards the triple and critical
    points, with both points sampled exactly."""
    s = np.linspace(0, 1, 37)
    sub = T_SUB_AT_PMIN + (T_TRIPLE - T_SUB_AT_PMIN) * (1 - (1 - s) ** 1.4)
    s = np.linspace(0, 1, 131)
    boil = T_CRIT - (T_CRIT - T_TRIPLE) * (1 - s) ** 2.0
    s = np.linspace(0, 1, 81)
    hot = T_CRIT + (T_MAX - T_CRIT) * s**2.0
    return concat_unique(sub, boil, hot)


def upper_edge_logp(T: float) -> float:
    """Top boundary of the vapor region, as log10 P."""
    if T < T_TRIPLE:
        return math.log10(max(P_MIN, p_sub(T)))
    if T < T_CRIT:
        return math.log10(p_sat(T))
    return math.log10(p_isochore(T))


def coons(bottom, top, left, right, us, ws):
    """Transfinite (Coons) patch over (T, logP) from four boundary curves.
    bottom/top are sampled at us, left/right at ws; all are (T, logP) arrays."""
    bottom, top, left, right = (np.asarray(a, dtype=float) for a in (bottom, top, left, right))
    nu, nw = len(us), len(ws)
    grid = np.zeros((nw, nu, 2))
    b0, b1, t0, t1 = bottom[0], bottom[-1], top[0], top[-1]
    for i, w in enumerate(ws):
        for j, u in enumerate(us):
            grid[i, j] = (
                (1 - w) * bottom[j] + w * top[j]
                + (1 - u) * left[i] + u * right[i]
                - ((1 - u) * (1 - w) * b0 + u * (1 - w) * b1 + (1 - u) * w * t0 + u * w * t1)
            )
    return grid


# ---------------------------------------------------------------------------
# Build patches

def build():
    cols = columns()
    j_triple = next(j for j, T in enumerate(cols) if abs(T - T_TRIPLE) < 1e-9)
    j_crit = next(j for j, T in enumerate(cols) if abs(T - T_CRIT) < 1e-9)
    top_logp = [upper_edge_logp(T) for T in cols]

    # Vapor (and low-density supercritical) patch: P from 1 Pa up to the
    # sublimation / boiling curve / critical isochore. Rows crowd the top edge.
    s = np.linspace(0, 1, 73)
    vapor_ws = 1 - (1 - s) ** 2.0
    vapor = {"name": "vapor", "cols": len(cols), "rows": len(vapor_ws), "T": [], "logP": [], "logRho": []}
    for w in vapor_ws:
        for j, T in enumerate(cols):
            logp = LOGP_MIN + w * (top_logp[j] - LOGP_MIN)
            on_edge = w >= 1 - 1e-12
            if on_edge and T < T_TRIPLE:
                rho = rho_vapor(T, 10**logp)
            elif on_edge and T < T_CRIT:
                rho = rho_sat(T, 1)
            elif on_edge:
                rho = RHO_CRIT
            elif T < T_CRIT:
                rho = rho_vapor(T, 10**logp)
            else:
                rho = rho_fluid(T, 10**logp)
            vapor["T"].append(T)
            vapor["logP"].append(logp)
            vapor["logRho"].append(math.log10(rho))

    # Shared rows for the liquid and ice patches (the melting curtain joins them).
    s = np.linspace(0, 1, 61)
    dense_ws = s**1.7
    melt_logp = [math.log10(P_TRIPLE) + w * (LOGP_MAX - math.log10(P_TRIPLE)) for w in dense_ws]
    melt_T = [t_melt(10**lp) for lp in melt_logp]
    melt_T[0] = T_TRIPLE

    # Liquid (and high-density supercritical) patch.
    liquid_cols = cols[j_triple:]
    us = [(T - T_TRIPLE) / (T_MAX - T_TRIPLE) for T in liquid_cols]
    bottom = [(T, top_logp[j_triple + k]) for k, T in enumerate(liquid_cols)]
    top = [(T_MELT_AT_PMAX + u * (T_MAX - T_MELT_AT_PMAX), LOGP_MAX) for u in us]
    left = list(zip(melt_T, melt_logp))
    right_lo = top_logp[-1]
    right = [(T_MAX, right_lo + w * (LOGP_MAX - right_lo)) for w in dense_ws]
    grid = coons(bottom, top, left, right, us, dense_ws)
    liquid = {"name": "liquid", "cols": len(us), "rows": len(dense_ws), "T": [], "logP": [], "logRho": []}
    for i in range(len(dense_ws)):
        for j in range(len(us)):
            T, logp = grid[i, j]
            if i == 0:
                T, logp = bottom[j]
                rho = rho_sat(T, 0) if T < T_CRIT else RHO_CRIT
            elif j == 0:
                T, logp = left[i]
                rho = rho_liquid(T, 10**logp)
            elif T < T_CRIT:
                rho = rho_liquid(T, 10**logp)
            else:
                rho = rho_fluid(T, 10**logp)
            liquid["T"].append(float(T))
            liquid["logP"].append(float(logp))
            liquid["logRho"].append(math.log10(rho))

    # Ice Ih patch: below by the 1 Pa axis then the sublimation curve, on the
    # right by the melting curve.
    cold = list(np.linspace(T_MIN, T_SUB_AT_PMIN, 25))
    ice_bottom_T = concat_unique(cold, cols[: j_triple + 1])
    us = [(T - T_MIN) / (T_TRIPLE - T_MIN) for T in ice_bottom_T]
    bottom = [(T, math.log10(max(P_MIN, p_sub(T)))) for T in ice_bottom_T]
    bottom[-1] = (T_TRIPLE, math.log10(P_TRIPLE))
    top = [(T_MIN + u * (T_MELT_AT_PMAX - T_MIN), LOGP_MAX) for u in us]
    left = [(T_MIN, LOGP_MIN + w * (LOGP_MAX - LOGP_MIN)) for w in dense_ws]
    right = list(zip(melt_T, melt_logp))
    grid = coons(bottom, top, left, right, us, dense_ws)
    ice = {"name": "ice", "cols": len(us), "rows": len(dense_ws), "T": [], "logP": [], "logRho": []}
    for i in range(len(dense_ws)):
        for j in range(len(us)):
            T, logp = grid[i, j]
            if i == 0:
                T, logp = bottom[j]
            if j == len(us) - 1:
                T, logp = right[i]
            ice["T"].append(float(T))
            ice["logP"].append(float(logp))
            ice["logRho"].append(math.log10(rho_ice(min(T, T_TRIPLE), 10**logp)))

    # Coexistence curtains: pairs of (T, logP) with a low and a high density.
    def curtain(name, samples):
        return {
            "name": name,
            "count": len(samples),
            "T": [s[0] for s in samples],
            "logP": [s[1] for s in samples],
            "logRhoLow": [s[2] for s in samples],
            "logRhoHigh": [s[3] for s in samples],
        }

    vapor_top = lambda j: vapor["logRho"][(vapor["rows"] - 1) * vapor["cols"] + j]
    boiling = curtain("boiling", [
        (cols[j], top_logp[j], vapor_top(j), math.log10(rho_sat(cols[j], 0)) if cols[j] < T_CRIT else math.log10(RHO_CRIT))
        for j in range(j_triple, j_crit + 1)
    ])
    sublimation = curtain("sublimation", [
        (cols[j], top_logp[j], vapor_top(j), math.log10(rho_ice(cols[j], 10 ** top_logp[j])))
        for j in range(0, j_triple + 1)
    ])
    ice_right = lambda i: ice["logRho"][i * ice["cols"] + ice["cols"] - 1]
    liquid_left = lambda i: liquid["logRho"][i * liquid["cols"]]
    melting = curtain("melting", [
        (melt_T[i], melt_logp[i], ice_right(i), liquid_left(i)) for i in range(len(dense_ws))
    ])

    return {
        "cols": cols,
        "jTriple": j_triple,
        "jCrit": j_crit,
        "patches": [vapor, liquid, ice],
        "curtains": [boiling, sublimation, melting],
    }


# ---------------------------------------------------------------------------
# Floor diagrams

def pt_diagram():
    sub = [(T, math.log10(p_sub(T))) for T in np.linspace(T_SUB_AT_PMIN, T_TRIPLE, 120)]
    sub[0] = (T_SUB_AT_PMIN, LOGP_MIN)
    s = np.linspace(0, 1, 240)
    boil_T = T_CRIT - (T_CRIT - T_TRIPLE) * (1 - s) ** 1.5
    boil = [(float(T), math.log10(p_sat(T))) for T in boil_T]
    melt = [(t_melt(10**lp), float(lp)) for lp in np.linspace(math.log10(P_TRIPLE), LOGP_MAX, 160)]
    melt[0] = (T_TRIPLE, math.log10(P_TRIPLE))
    return {"sublimation": sub, "boiling": boil, "melting": melt}


def isotherm(T: float, samples: int = 140):
    """Section of the surface at constant T, as (log10 v, log10 P) points.
    The coexistence part is the horizontal tie line of the P-v diagram."""
    pts = []
    logps = np.linspace(LOGP_MIN, LOGP_MAX, samples)
    if T < T_TRIPLE:
        ps = p_sub(T)
        lps = math.log10(ps)
        pm = p_melt(T) if T >= 251.165 else math.inf
        for lp in logps[logps < lps]:
            pts.append((-math.log10(rho_vapor(T, 10**lp)), float(lp)))
        pts.append((-math.log10(rho_vapor(T, ps)), lps))
        ice_hi = min(LOGP_MAX, math.log10(pm)) if pm < math.inf else LOGP_MAX
        for lp in [lps] + [float(x) for x in logps if lps < x <= ice_hi]:
            pts.append((-math.log10(rho_ice(T, 10**lp)), lp))
        if pm < P_MAX:
            lpm = math.log10(pm)
            pts.append((-math.log10(rho_liquid(T, pm)), lpm))
            for lp in logps[logps > lpm]:
                pts.append((-math.log10(rho_liquid(T, 10**lp)), float(lp)))
    elif T < T_CRIT:
        ps = p_sat(T)
        lps = math.log10(ps)
        for lp in logps[logps < lps]:
            pts.append((-math.log10(rho_vapor(T, 10**lp)), float(lp)))
        pts.append((-math.log10(rho_sat(T, 1)), lps))
        pts.append((-math.log10(rho_sat(T, 0)), lps))
        for lp in logps[logps > lps]:
            pts.append((-math.log10(rho_liquid(T, 10**lp)), float(lp)))
    else:
        dense = np.unique(np.concatenate([logps, np.linspace(7.0, 7.8, 120)]))
        for lp in dense:
            pts.append((-math.log10(rho_fluid(T, 10**lp)), float(lp)))
    return pts


def pv_diagram():
    s = np.linspace(0, 1, 260)
    T = T_CRIT - (T_CRIT - T_TRIPLE) * (1 - s) ** 2.2
    sat_liquid = [(-math.log10(rho_sat(t, 0)), math.log10(p_sat(t))) for t in T[:-1]]
    sat_vapor = [(-math.log10(rho_sat(t, 1)), math.log10(p_sat(t))) for t in T[:-1]]
    crit = (-math.log10(RHO_CRIT), math.log10(P_CRIT))
    sat_liquid.append(crit)
    sat_vapor.append(crit)

    sub_T = np.linspace(T_SUB_AT_PMIN, T_TRIPLE, 100)
    sub_ice = [(-math.log10(rho_ice(t, max(P_MIN, p_sub(t)))), math.log10(max(P_MIN, p_sub(t)))) for t in sub_T]
    sub_vapor = [(-math.log10(rho_vapor(t, max(P_MIN, p_sub(t)))), math.log10(max(P_MIN, p_sub(t)))) for t in sub_T]

    melt_lp = np.linspace(math.log10(P_TRIPLE), LOGP_MAX, 100)
    melt_ice = [(-math.log10(rho_ice(t_melt(10**lp), 10**lp)), float(lp)) for lp in melt_lp]
    melt_liquid = [(-math.log10(rho_liquid(t_melt(10**lp), 10**lp)), float(lp)) for lp in melt_lp]

    isotherms = []
    for T in [250, 300, 350, 400, 450, 500, 550, 600, T_CRIT, 700, 800]:
        isotherms.append({"T": T, "points": isotherm(T)})

    return {
        "satLiquid": sat_liquid,
        "satVapor": sat_vapor,
        "subIce": sub_ice,
        "subVapor": sub_vapor,
        "meltIce": melt_ice,
        "meltLiquid": melt_liquid,
        "isotherms": isotherms,
    }


# ---------------------------------------------------------------------------
# Processes the visitor can follow. Each leg is sampled so that equal steps
# of the animation correspond to equal steps of the controlled variable
# (temperature, pressure, or vapor fraction while boiling).

def state(T, P, phase, rho, quality=None):
    return {
        "T": T,
        "logP": math.log10(P),
        "logRho": math.log10(rho),
        "phase": phase,
        "x": quality,
    }


def phase_of(T, P, hint):
    if T >= T_CRIT and P >= P_CRIT:
        return "supercritical"
    if T >= T_CRIT:
        return "gas"
    return hint


def heat_leg(P, T0, T1, phase, n=60):
    out = []
    for T in np.linspace(T0, T1, n):
        T = float(T)
        if phase == "ice":
            rho = rho_ice(T, P)
        elif phase == "liquid" and T < T_CRIT:
            rho = rho_liquid(T, P)
        elif phase == "vapor" and T < T_CRIT:
            rho = rho_vapor(T, P)
        else:
            rho = rho_fluid(T, P)
        out.append(state(T, P, phase_of(T, P, phase), rho))
    return out


def coexist_leg(T, P, rho_from, rho_to, phase, n=90):
    out = []
    for x in np.linspace(0, 1, n):
        rho = 1 / ((1 - x) / rho_from + x / rho_to)
        out.append(state(T, P, phase, rho, float(x)))
    return out


def pressure_leg(T, P0, P1, phase, n=80):
    out = []
    for lp in np.linspace(math.log10(P0), math.log10(P1), n):
        P = 10 ** float(lp)
        rho = rho_fluid(T, P) if T >= T_CRIT else (rho_vapor(T, P) if phase == "vapor" else rho_liquid(T, P))
        out.append(state(T, P, phase_of(T, P, phase), rho))
    return out


def boiling_process(key, title, subtitle, P, T_start, T_end):
    Ts = t_sat(P)
    legs = [
        {"kind": "heat", "label": "Heating the water", "states": heat_leg(P, T_start, Ts, "liquid")},
        {"kind": "boil", "label": "Boiling", "states": coexist_leg(Ts, P, rho_sat(Ts, 0), rho_sat(Ts, 1), "boiling")},
        {"kind": "heat", "label": "Heating the steam", "states": heat_leg(P, Ts, T_end, "vapor")},
    ]
    return {"key": key, "title": title, "subtitle": subtitle, "legs": legs, "transitionT": Ts}


def processes():
    out = [
        boiling_process("kettle", "Kettle at sea level", "1 atm · boils at 100 °C", 101325.0, 293.15, 413.15),
        boiling_process("everest", "Summit of Everest", "33.7 kPa · boils near 71 °C", 33700.0, 293.15, 393.15),
        boiling_process("cooker", "Pressure cooker", "2 atm · boils near 120 °C", 202650.0, 293.15, 433.15),
    ]

    P = 10.0
    Ts = t_sub(P)
    out.append({
        "key": "freeze-dry",
        "title": "Freeze-drying",
        "subtitle": f"10 Pa · ice turns straight to vapor at {Ts - 273.15:.0f} °C",
        "transitionT": Ts,
        "legs": [
            {"kind": "heat", "label": "Warming the ice", "states": heat_leg(P, 213.15, Ts, "ice")},
            {"kind": "boil", "label": "Subliming", "states": coexist_leg(Ts, P, rho_ice(Ts, P), rho_vapor(Ts, P), "subliming")},
            {"kind": "heat", "label": "Warming the vapor", "states": heat_leg(P, Ts, 293.15, "vapor")},
        ],
    })

    T_hot, P_hi, P_lo = 723.15, 25e6, 0.5e6
    out.append({
        "key": "around-critical",
        "title": "Around the critical point",
        "subtitle": "Liquid to vapor without boiling",
        "transitionT": None,
        "legs": [
            {"kind": "heat", "label": "Heating at 250 bar", "states": heat_leg(P_hi, 573.15, T_hot, "liquid", n=90)},
            {"kind": "expand", "label": "Releasing the pressure", "states": pressure_leg(T_hot, P_hi, P_lo, "vapor", n=90)},
        ],
    })
    return out


# ---------------------------------------------------------------------------

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    surface = build()

    blobs = []
    offset = 0

    def add(values):
        nonlocal offset
        array = np.asarray(values, dtype="<f4")
        entry = {"offset": offset, "length": int(array.size)}
        blobs.append(array.tobytes())
        offset += array.nbytes
        return entry

    patches = []
    for patch in surface["patches"]:
        patches.append({
            "name": patch["name"],
            "cols": patch["cols"],
            "rows": patch["rows"],
            "T": add(patch["T"]),
            "logP": add(patch["logP"]),
            "logRho": add(patch["logRho"]),
        })
    curtains = []
    for c in surface["curtains"]:
        curtains.append({
            "name": c["name"],
            "count": c["count"],
            "T": add(c["T"]),
            "logP": add(c["logP"]),
            "logRhoLow": add(c["logRhoLow"]),
            "logRhoHigh": add(c["logRhoHigh"]),
        })

    all_log_rho = np.concatenate([np.asarray(p["logRho"]) for p in surface["patches"]])
    rho_l_triple = CP.PropsSI("D", "T", T_TRIPLE, "Q", 0, FLUID)
    rho_v_triple = CP.PropsSI("D", "T", T_TRIPLE, "Q", 1, FLUID)

    manifest = {
        "generator": {
            "script": "scripts/water/generate_surface.py",
            "CoolProp": CoolProp.__version__,
            "iapws": iapws.__version__,
        },
        "sources": [
            "IAPWS-95 (fluid water and steam), evaluated with CoolProp",
            "IAPWS R10-06(2009), ice Ih, evaluated with the iapws package",
            "IAPWS R14-08(2011), sublimation and melting pressure of ice Ih",
        ],
        "domain": {
            "T": [T_MIN, T_MAX],
            "logP": [LOGP_MIN, LOGP_MAX],
            "logRho": [float(all_log_rho.min()), float(all_log_rho.max())],
        },
        "points": {
            "triple": {
                "T": T_TRIPLE,
                "logP": math.log10(P_TRIPLE),
                "logRhoVapor": math.log10(rho_v_triple),
                "logRhoIce": math.log10(rho_ice(T_TRIPLE, P_TRIPLE)),
                "logRhoLiquid": math.log10(rho_l_triple),
            },
            "critical": {"T": T_CRIT, "logP": math.log10(P_CRIT), "logRho": math.log10(RHO_CRIT)},
            "oneAtm": {"logP": math.log10(101325.0), "Tsat": t_sat(101325.0)},
        },
        "split": {"jTriple": surface["jTriple"], "jCrit": surface["jCrit"]},
        "patches": patches,
        "curtains": curtains,
        "diagrams": {"pt": pt_diagram(), "pv": pv_diagram()},
        "processes": processes(),
        "binary": "surface.bin",
    }

    (OUT_DIR / "surface.bin").write_bytes(b"".join(blobs))

    def rounded(value):
        if isinstance(value, float):
            return round(value, 5)
        if isinstance(value, (list, tuple)):
            return [rounded(v) for v in value]
        if isinstance(value, dict):
            return {k: rounded(v) for k, v in value.items()}
        return value

    (OUT_DIR / "surface.json").write_text(json.dumps(rounded(manifest), separators=(",", ":")))

    vertex_count = sum(p["cols"] * p["rows"] for p in patches)
    print(f"patches: {[(p['name'], p['cols'], p['rows']) for p in patches]}  vertices: {vertex_count}")
    print(f"curtains: {[(c['name'], c['count']) for c in curtains]}")
    print(f"logRho range: {manifest['domain']['logRho']}")
    print(f"binary: {offset / 1024:.0f} KiB, json: {(OUT_DIR / 'surface.json').stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
