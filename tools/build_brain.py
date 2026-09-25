"""Extrae de FlyWire (FAFB v783) la nube de somas y un circuito real para el panel del cerebro.

Entradas (en <data>):
  ann.tsv                   flyconnectome/flywire_annotations: supplemental_files/Supplemental_file1_neuron_annotations.tsv
  Connectivity_783.parquet  philshiu/Drosophila_brain_model (sinapsis por par de neuronas, signo por neurotransmisor)

Salida:
  assets/brain_points.bin   uint32 N | int16 xyz*N (decimas de um) | uint8 clase*N | uint8 region*N | uint8 nt*N | uint8 lado*N
  assets/brain_circuit.json celulas del circuito, aristas con sinapsis y metadatos

Uso:
  py tools/build_brain.py <data>
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
VOXEL = np.array([4.0, 4.0, 40.0]) / 1000.0  # nm por voxel -> um

CLASSES = [
    ("optic", "lóbulo óptico", ["optic", "visual_projection", "visual_centrifugal"]),
    ("central", "cerebro central", ["central", "endocrine"]),
    ("descending", "descendentes", ["descending"]),
    ("ascending", "ascendentes", ["ascending"]),
    ("sensory", "sensoriales", ["sensory", "sensory_ascending"]),
    ("motor", "motoras", ["motor"]),
]

# Neuronas de azucar usadas por Shiu et al. (Nature 2024) para activar la extension de proboscide
SUGAR_GRN = [
    720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768,
    720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691,
    720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543,
    720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
    720575940611875570,
]

# (grupo, n, filtro, grupos contra los que se puntua la conectividad)
GROUPS = [
    ("DN", None, lambda a: a.cell_type.isin(["DNp01", "DNa01", "DNa02", "MDN"]), []),
    ("PPL1", 4, lambda a: a.cell_type.fillna("").str.startswith("PPL1"), ["MBON", "KC"]),
    ("MBON", 8, lambda a: a.cell_class == "MBON", ["PAM", "PPL1", "KC"]),
    ("PAM", 8, lambda a: a.cell_type.fillna("").str.startswith("PAM"), ["MBON", "KC"]),
    ("KC", 10, lambda a: a.cell_class == "Kenyon_Cell", ["MBON", "PAM", "PPL1"]),
    ("PN", 5, lambda a: (a.cell_class == "ALPN") & a.cell_type.fillna("").str.match(r"^(D|V[ACLM])[A-Z0-9+]*_[a-z]*PN$"), ["KC"]),  # uniglomerulares olfativas
    ("ORN", 5, lambda a: a.cell_class == "olfactory", ["PN"]),
    ("LPLC2", 4, lambda a: a.cell_type == "LPLC2", ["DN"]),
    ("T4T5", 6, lambda a: a.cell_type.fillna("").str.match(r"^T[45][a-d]$"), ["LPLC2"]),
    ("dFB", 4, lambda a: a.cell_type.fillna("").str.startswith("FB6"), ["MBON", "PAM", "PPL1"]),
    ("GRN", 6, lambda a: a.root_id.isin(SUGAR_GRN), ["PAM", "MBON", "DN"]),
]

SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}
REGIONS = ["otras", "lóbulo óptico", "células de Kenyon", "dopaminérgicas", "lóbulo antenal", "complejo central", "descendentes", "MBON"]
NTS = ["acetylcholine", "glutamate", "gaba", "dopamine", "serotonin", "octopamine"]


def main():
    data = Path(sys.argv[1])
    ann = pd.read_csv(data / "ann.tsv", sep="\t", low_memory=False)
    conn = pd.read_parquet(data / "Connectivity_783.parquet",
                           columns=["Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory"])

    # ---- nube de somas (o un punto del arbor si no hay soma)
    has_soma = ann.soma_x.notna()
    xyz = np.where(has_soma.values[:, None],
                   ann[["soma_x", "soma_y", "soma_z"]].values,
                   ann[["pos_x", "pos_y", "pos_z"]].values).astype(np.float64) * VOXEL
    cls = np.full(len(ann), 1, np.uint8)
    for i, (_, _, supers) in enumerate(CLASSES):
        cls[ann.super_class.isin(supers).values] = i
    # Region funcional (para mostrar efectos por zona): ver REGIONS
    region = np.zeros(len(ann), np.uint8)
    cc, sc = ann.cell_class.fillna(""), ann.super_class.fillna("")
    region[sc.isin(["optic", "visual_projection", "visual_centrifugal"]).values] = 1
    region[(cc == "Kenyon_Cell").values] = 2
    region[(cc == "DAN").values] = 3
    region[cc.isin(["olfactory", "ALPN", "ALLN", "ALIN", "ALON"]).values] = 4
    region[(cc == "CX").values] = 5
    region[(sc == "descending").values] = 6
    region[(cc == "MBON").values] = 7
    nt = ann.top_nt.map({n: i for i, n in enumerate(NTS)}).fillna(len(NTS)).astype(np.uint8).values
    side = ann.side.map({"left": 0, "right": 1}).fillna(2).astype(np.uint8).values
    center = (xyz.min(0) + xyz.max(0)) / 2
    q = np.round((xyz - center) * 10).astype(np.int16)
    OUT.mkdir(exist_ok=True)
    with open(OUT / "brain_points.bin", "wb") as f:
        f.write(np.uint32(len(q)).tobytes())
        f.write(q.tobytes())
        f.write(cls.tobytes())
        f.write(region.tobytes())
        f.write(nt.tobytes())
        f.write(side.tobytes())

    # ---- circuito: por grupo, las celulas mas conectadas con los grupos vecinos ya elegidos
    pools = {g: ann[flt(ann)] for g, _, flt, _ in GROUPS}
    union = pd.concat(pools.values()).root_id.unique()
    sub = conn[conn.Presynaptic_ID.isin(union) & conn.Postsynaptic_ID.isin(union)]
    print(f"{len(sub):,} conexiones entre {len(union):,} candidatas")

    chosen = {}
    for g, n, _, against in GROUPS:
        pool = pools[g]
        if n is None:
            chosen[g] = pool
            continue
        targets = set()
        for h in against:
            targets |= set((chosen[h] if h in chosen else pools[h]).root_id)
        out_s = sub[sub.Postsynaptic_ID.isin(targets)].groupby("Presynaptic_ID").Connectivity.sum()
        in_s = sub[sub.Presynaptic_ID.isin(targets)].groupby("Postsynaptic_ID").Connectivity.sum()
        score = pool.root_id.map(out_s).fillna(0) + pool.root_id.map(in_s).fillna(0)
        pool = pool.assign(score=score.values).sort_values("score", ascending=False)
        # alternar hemisferios para un circuito bilateral
        left = pool[pool.side == "left"].head(n)
        right = pool[pool.side != "left"].head(n)
        picked = pd.concat([left.head((n + 1) // 2), right.head(n // 2)])
        if len(picked) < n:
            picked = pd.concat([picked, pool[~pool.root_id.isin(picked.root_id)].head(n - len(picked))])
        chosen[g] = picked

    # neurotransmisor: el conocido experimentalmente si existe, si no la prediccion de Eckstein et al. 2024
    ann["nt"] = ann.known_nt.where(ann.known_nt.isin(list(SIGN) + ["dopamine", "serotonin", "octopamine"]), ann.top_nt)
    cells = []
    for g, _, _, _ in GROUPS:
        for _, r in chosen[g].iterrows():
            i = ann.index.get_loc(r.name)
            cells.append({
                "id": str(r.root_id), "group": g, "type": r.cell_type if isinstance(r.cell_type, str) else g,
                "side": r.side if isinstance(r.side, str) else "", "nt": ann.at[r.name, "nt"] if isinstance(ann.at[r.name, "nt"], str) else "",
                "sign": SIGN.get(ann.at[r.name, "nt"], 0), "pos": [round(float(v), 1) for v in (xyz[i] - center)],
            })
    idx = {int(c["id"]): k for k, c in enumerate(cells)}
    e = sub[sub.Presynaptic_ID.isin(idx) & sub.Postsynaptic_ID.isin(idx) & (sub.Connectivity >= 3)]
    edges = [[idx[a], idx[b], int(s), int(x)] for a, b, s, x in
             e[["Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory"]].itertuples(index=False)]

    meta = {
        "dataset": "FlyWire FAFB v783",
        "sources": ["flyconnectome/flywire_annotations (Schlegel et al., Nature 2024)",
                    "philshiu/Drosophila_brain_model (Shiu et al., Nature 2024)"],
        "neurons": int(len(ann)), "somata": int(has_soma.sum()),
        "classes": [[k, label] for k, label, _ in CLASSES],
        "regions": REGIONS, "nts": NTS,
        "regionCounts": np.bincount(region, minlength=len(REGIONS)).tolist(),
        "ntCounts": np.bincount(nt, minlength=len(NTS) + 1).tolist(),
        "cells": cells, "edges": edges,
        "synapses": int(sum(x[2] for x in edges)),
    }
    (OUT / "brain_circuit.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    by_group = {g: len(chosen[g]) for g, *_ in GROUPS}
    print(f"{len(q):,} puntos | {len(cells)} celulas {by_group} | {len(edges)} aristas | {meta['synapses']:,} sinapsis")


if __name__ == "__main__":
    main()
