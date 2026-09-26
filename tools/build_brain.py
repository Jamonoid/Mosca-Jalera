"""Extrae del connectome MaleCNS v1.0 (Janelia / Google, Cell 2026; CC-BY 4.0) la nube de somas
del sistema nervioso central completo (cerebro + cordon nervioso) y un circuito real para el panel.

Entradas (en <data>, descarga libre desde https://male-cns.janelia.org/download/):
  ann.feather      body-annotations-male-cns-v1.0-minconf-0.5.feather
  nt.feather       body-neurotransmitters-male-cns-v1.0.feather
  weights.feather  connectome-weights-male-cns-v1.0-minconf-0.5.feather

Salida:
  assets/brain_points.bin   uint32 N | int16 xyz*N (decimas de um) | uint8 clase*N | uint8 region*N | uint8 nt*N | uint8 lado*N
  assets/brain_circuit.json celulas del circuito, aristas con sinapsis y metadatos

Uso:
  py tools/build_brain.py <data>
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.ipc as ipc

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
VOXEL_UM = 0.008  # 8 nm isotropico
SWC_URL = "https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/{}.swc"

CLASSES = [
    ("optic", "lóbulo óptico", ["ol_intrinsic", "visual_projection", "visual_centrifugal", "ol_sensory"]),
    ("central", "cerebro central", ["cb_intrinsic", "cb_endocrine", "cb_efferent"]),
    ("descending", "descendentes", ["descending_neuron"]),
    ("ascending", "ascendentes", ["ascending_neuron", "sensory_ascending", "efferent_ascending"]),
    ("sensory", "sensoriales", ["cb_sensory", "vnc_sensory"]),
    ("motor", "motoras", ["cb_motor", "vnc_motor", "vnc_efferent"]),
    ("vnc", "cordón nervioso", ["vnc_intrinsic", "vnc_endocrine"]),
]
REGIONS = ["otras", "lóbulo óptico", "células de Kenyon", "dopaminérgicas", "lóbulo antenal", "complejo central",
           "descendentes", "MBON", "cordón nervioso"]
NTS = ["acetylcholine", "glutamate", "gaba", "dopamine", "serotonin", "octopamine"]
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}

# (grupo, n, filtro, grupos contra los que se puntua la conectividad)
GROUPS = [
    ("DN", None, lambda a: a.type.isin(["DNp01", "DNa01", "DNa02", "MDN"]), []),
    ("PPL1", 4, lambda a: a.type.str.startswith("PPL1"), ["MBON", "KC"]),
    ("MBON", 8, lambda a: a["class"] == "MBON", ["PAM", "PPL1", "KC"]),
    ("PAM", 8, lambda a: a.type.str.startswith("PAM"), ["MBON", "KC"]),
    ("KC", 10, lambda a: a["class"] == "Kenyon_Cell", ["MBON", "PAM", "PPL1"]),
    ("PN", 5, lambda a: (a["class"] == "ALPN") & a.type.str.match(r"^(D|V[ACLM])[A-Z0-9+]*_[a-z]*PN$"), ["KC"]),
    ("ORN", 5, lambda a: a["class"] == "olfactory", ["PN"]),
    ("LPLC2", 4, lambda a: a.type == "LPLC2", ["DN"]),
    ("T4T5", 6, lambda a: a.type.str.match(r"^T[45][a-d]$"), ["LPLC2"]),
    ("dFB", 4, lambda a: a.type.str.startswith("FB6"), ["MBON", "PAM", "PPL1"]),
    ("GRN", 6, lambda a: (a["class"] == "gustatory") & a.type.str.startswith("LB3"), ["PAM", "MBON", "DN"]),
]


def swc_centroid(body):
    """Centro del arbor (um) a partir del esqueleto publico, para neuronas sin soma en el SNC."""
    with urllib.request.urlopen(SWC_URL.format(body), timeout=60) as r:
        pts = [list(map(float, ln.split()[2:5])) for ln in r.read().decode().splitlines() if ln and not ln.startswith("#")]
    return np.mean(pts, axis=0) * VOXEL_UM


def main():
    data = Path(sys.argv[1])
    ann = pd.read_feather(data / "ann.feather")
    ann = ann[ann.status == "Traced"].copy()
    ann["type"] = ann.type.fillna("")
    nt = pd.read_feather(data / "nt.feather", columns=["body", "consensus_nt", "predicted_nt"])
    nt["nt"] = nt.consensus_nt.where(nt.consensus_nt.isin(NTS), nt.predicted_nt)
    ann = ann.merge(nt[["body", "nt"]], left_on="bodyId", right_on="body", how="left")

    # ---- nube de somas
    som = ann[ann.somaLocation.notna()].reset_index(drop=True)
    xyz = np.stack(som.somaLocation.values).astype(np.float64) * VOXEL_UM
    center = (xyz.min(0) + xyz.max(0)) / 2
    cls = np.full(len(som), 1, np.uint8)
    for i, (_, _, supers) in enumerate(CLASSES):
        cls[som.superclass.isin(supers).values] = i
    region = np.zeros(len(som), np.uint8)
    sc, cc = som.superclass.fillna(""), som["class"].fillna("")
    region[sc.isin(CLASSES[0][2]).values] = 1
    region[(cc == "Kenyon_Cell").values] = 2
    region[(cc == "DAN").values] = 3
    region[cc.isin(["olfactory", "ALPN", "ALLN", "ALIN", "ALON"]).values] = 4
    region[(cc == "CX").values] = 5
    region[(sc == "descending_neuron").values] = 6
    region[(cc == "MBON").values] = 7
    region[sc.isin(["vnc_intrinsic", "vnc_motor", "vnc_efferent"]).values] = 8
    ntc = som.nt.map({n: i for i, n in enumerate(NTS)}).fillna(len(NTS)).astype(np.uint8).values
    side = som.somaSide.map({"L": 0, "R": 1}).fillna(2).astype(np.uint8).values
    q = np.round((xyz - center) * 10).astype(np.int16)
    OUT.mkdir(exist_ok=True)
    with open(OUT / "brain_points.bin", "wb") as f:
        for arr in (np.uint32(len(q)), q, cls, region, ntc, side):
            f.write(arr.tobytes())

    # ---- conectividad entre candidatas (lectura por bloques del archivo de 1 GB)
    pools = {g: ann[flt(ann)] for g, _, flt, _ in GROUPS}
    union = pa.array(pd.concat(pools.values()).bodyId.unique())
    reader = ipc.open_file(data / "weights.feather")
    parts = []
    for i in range(reader.num_record_batches):
        b = reader.get_batch(i)
        m = pc.and_(pc.is_in(b["body_pre"], union), pc.is_in(b["body_post"], union))
        if pc.any(m).as_py():
            parts.append(b.filter(m).to_pandas())
    sub = pd.concat(parts, ignore_index=True)
    print(f"{len(sub):,} conexiones entre {len(union):,} candidatas")

    chosen = {}
    for g, n, _, against in GROUPS:
        pool = pools[g]
        if n is None:
            chosen[g] = pool
            continue
        targets = set()
        for h in against:
            targets |= set((chosen[h] if h in chosen else pools[h]).bodyId)
        out_s = sub[sub.body_post.isin(targets)].groupby("body_pre").weight.sum()
        in_s = sub[sub.body_pre.isin(targets)].groupby("body_post").weight.sum()
        score = pool.bodyId.map(out_s).fillna(0) + pool.bodyId.map(in_s).fillna(0)
        pool = pool.assign(score=score.values).sort_values("score", ascending=False)
        left, right = pool[pool.somaSide == "L"], pool[pool.somaSide != "L"]
        picked = pd.concat([left.head((n + 1) // 2), right.head(n // 2)])
        if len(picked) < n:
            picked = pd.concat([picked, pool[~pool.bodyId.isin(picked.bodyId)].head(n - len(picked))])
        chosen[g] = picked

    cells = []
    for g, *_ in GROUPS:
        for _, r in chosen[g].iterrows():
            pos = np.asarray(r.somaLocation, float) * VOXEL_UM if r.somaLocation is not None and not (isinstance(r.somaLocation, float)) else swc_centroid(int(r.bodyId))
            ntn = r.nt if isinstance(r.nt, str) else ""
            cells.append({
                "id": str(int(r.bodyId)), "group": g, "type": r.type or g,
                "side": {"L": "left", "R": "right"}.get(r.somaSide, ""), "nt": ntn, "sign": SIGN.get(ntn, 0),
                "pos": [round(float(v), 1) for v in (pos - center)],
            })
    idx = {int(c["id"]): k for k, c in enumerate(cells)}
    e = sub[sub.body_pre.isin(idx) & sub.body_post.isin(idx) & (sub.weight >= 3)]
    sign_of = {int(c["id"]): c["sign"] for c in cells}
    edges = [[idx[a], idx[b], int(w), sign_of[a] or 1] for a, b, w in e[["body_pre", "body_post", "weight"]].itertuples(index=False)]

    meta = {
        "dataset": "MaleCNS v1.0",
        "sources": ["Janelia FlyEM / Google Research, male CNS connectome v1.0 (Cell 2026), CC-BY 4.0"],
        "neurons": int(len(ann)), "somata": int(len(som)),
        "classes": [[k, label] for k, label, _ in CLASSES],
        "regions": REGIONS, "nts": NTS,
        "regionCounts": np.bincount(region, minlength=len(REGIONS)).tolist(),
        "ntCounts": np.bincount(ntc, minlength=len(NTS) + 1).tolist(),
        "cells": cells, "edges": edges,
        "synapses": int(sum(x[2] for x in edges)),
    }
    (OUT / "brain_circuit.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    by_group = {g: len(chosen[g]) for g, *_ in GROUPS}
    print(f"{len(q):,} somas | {len(cells)} celulas {by_group} | {len(edges)} aristas | {meta['synapses']:,} sinapsis")


if __name__ == "__main__":
    main()
