"""Empaqueta el connectome MaleCNS v1.0 completo para la simulacion LIF en el navegador.

Entradas (en <data>, descarga libre desde https://male-cns.janelia.org/download/):
  ann.feather, nt.feather, weights.feather   (ver build_brain.py)

Salida:
  assets/connectome.bin   uint32 N | uint32 E | uint32 nSoma | uint32 indptr[N+1] | uint32 indices[E] | int16 w[E] | uint8 ntClass[N]
                          CSR por neurona presinaptica. w = sinapsis con signo (+ ACh, - GABA/Glu/histamina).
                          Las primeras nSoma neuronas son las de brain_points.bin, en el mismo orden.
  assets/connectome_groups.json  indices de neuronas de entrada, salida y poblaciones

Conexiones con >= MIN_SYN sinapsis. Los transmisores moduladores (DA, 5-HT, OA) no se modelan
como sinapsis rapidas (su efecto lo representa el modelo de dopamina), ni las neuronas sin
transmisor predicho (signo desconocido).

Uso:
  py tools/build_connectome.py <data>      (ejecutar despues de build_brain.py)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.ipc as ipc

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
MIN_SYN = 5
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1, "histamine": -1}
NT_CLASS = {"acetylcholine": 0, "glutamate": 1, "gaba": 2, "dopamine": 3, "serotonin": 4, "octopamine": 5, "histamine": 6}
FOOD_GLOMERULI = ["DM1", "DM2", "DM4", "DM5", "VA2", "DP1m"]  # vinagre / fruta fermentada


def main():
    data = Path(sys.argv[1])
    ann = pd.read_feather(data / "ann.feather")
    ann = ann[ann.status == "Traced"].copy()
    ann["type"] = ann.type.fillna("")
    nt = pd.read_feather(data / "nt.feather", columns=["body", "consensus_nt", "predicted_nt"])
    nt["nt"] = nt.consensus_nt.where(nt.consensus_nt.isin(list(NT_CLASS)), nt.predicted_nt)
    ann = ann.merge(nt[["body", "nt"]], left_on="bodyId", right_on="body", how="left")
    # mismo orden que build_brain.py: primero las neuronas con soma (nube), luego el resto
    ann["hasSoma"] = ann.somaLocation.notna()
    ann = pd.concat([ann[ann.hasSoma], ann[~ann.hasSoma]]).reset_index(drop=True)
    n_soma = int(ann.hasSoma.sum())
    N = len(ann)
    index = pd.Series(np.arange(N, dtype=np.int64), index=ann.bodyId.values)
    sign = ann.nt.map(SIGN).fillna(0).to_numpy(dtype=np.int64, copy=True)  # sin transmisor predicho: no se modela (signo desconocido)
    moduladora = ann.nt.isin(["dopamine", "serotonin", "octopamine"]).values
    sign[moduladora] = 0

    ids = pa.array(ann.bodyId.values)
    reader = ipc.open_file(data / "weights.feather")
    pre_l, post_l, w_l = [], [], []
    for i in range(reader.num_record_batches):
        b = reader.get_batch(i)
        m = pc.and_(pc.and_(pc.is_in(b["body_pre"], ids), pc.is_in(b["body_post"], ids)), pc.greater_equal(b["weight"], MIN_SYN))
        f = b.filter(m)
        if f.num_rows:
            pre_l.append(index.loc[f["body_pre"].to_numpy()].values)
            post_l.append(index.loc[f["body_post"].to_numpy()].values)
            w_l.append(f["weight"].to_numpy())
    pre, post, w = np.concatenate(pre_l), np.concatenate(post_l), np.concatenate(w_l)
    sw = (w * sign[pre]).astype(np.int64)
    keep = (sw != 0) & (pre != post)
    pre, post, sw = pre[keep], post[keep], np.clip(sw[keep], -32767, 32767).astype(np.int16)
    order = np.argsort(pre, kind="stable")
    pre, post, sw = pre[order], post[order], sw[order]
    indptr = np.zeros(N + 1, np.uint32)
    np.add.at(indptr, pre + 1, 1)
    indptr = np.cumsum(indptr).astype(np.uint32)
    ntc = ann.nt.map(NT_CLASS).fillna(7).astype(np.uint8).values
    with open(OUT / "connectome.bin", "wb") as f:
        f.write(np.array([N, len(post), n_soma], np.uint32).tobytes())
        f.write(indptr.tobytes())
        f.write(post.astype(np.uint32).tobytes())
        f.write(sw.tobytes())
        f.write(ntc.tobytes())

    # ---- grupos de entrada / salida / poblaciones
    side = ann.somaSide.where(ann.somaSide.isin(["L", "R"]), ann.rootSide)
    cls, typ, sup = ann["class"].fillna(""), ann.type, ann.superclass.fillna("")
    def idx(mask):
        return np.nonzero(np.asarray(mask))[0].tolist()
    def lr(mask):
        return {"L": idx(mask & (side == "L")), "R": idx(mask & (side == "R"))}
    orn_food = (cls == "olfactory") & typ.str.replace("ORN_", "", regex=False).isin(FOOD_GLOMERULI)
    groups = {
        "inputs": {
            "sugar": lr((cls == "gustatory") & typ.str.match(r"^LB3[a-d]$")),
            "odor": lr(orn_food),
            "light": lr(typ == "R1-R6"),
            # T4/T5 por direccion preferida (Maisak et al. 2013): a adelante->atras, b atras->adelante, c arriba, d abajo
            "motion": lr(typ.str.match(r"^T[45][a-d]$")),
            "motionFtb": lr(typ.isin(["T4a", "T5a"])), "motionBtf": lr(typ.isin(["T4b", "T5b"])),
            "motionUp": lr(typ.isin(["T4c", "T5c"])),
            "loom": lr(typ.isin(["LPLC2", "LC4"])),
            "dFB": idx(typ.str.startswith("FB6")),
            "PAM": idx(typ.str.startswith("PAM")),
        },
        "outputs": {
            "DNa01": lr(typ == "DNa01"), "DNa02": lr(typ == "DNa02"), "GF": lr(typ == "DNp01"),
            "MDN": idx(typ == "MDN"), "MN9": idx(typ == "MN9"),
        },
        "pops": {
            "ORN": idx(cls == "olfactory"), "PN": idx(cls == "ALPN"), "KC": idx(cls == "Kenyon_Cell"),
            "PAM": idx(typ.str.startswith("PAM")), "PPL1": idx(typ.str.startswith("PPL1")), "MBON": idx(cls == "MBON"),
            "dFB": idx(typ.str.startswith("FB6")), "T4T5": idx(typ.str.match(r"^T[45][a-d]$")),
            "LPLC2": idx(typ == "LPLC2"), "GRN": idx((cls == "gustatory") & typ.str.match(r"^LB3[a-d]$")),
            "DN": idx(sup == "descending_neuron"), "VNC": idx(sup == "vnc_intrinsic"),
        },
        "bodyIndex": {},
    }
    # indices de las 70 celulas del circuito del panel
    circuit = json.loads((OUT / "brain_circuit.json").read_text(encoding="utf-8"))
    for c in circuit["cells"]:
        c["idx"] = int(index.get(int(c["id"]), -1))
    (OUT / "brain_circuit.json").write_text(json.dumps(circuit, ensure_ascii=False), encoding="utf-8")
    groups["meta"] = {"neurons": N, "edges": int(len(post)), "synapses": int(np.abs(sw.astype(np.int64)).sum()), "minSyn": MIN_SYN, "somata": n_soma}
    (OUT / "connectome_groups.json").write_text(json.dumps(groups), encoding="utf-8")
    sizes = {k: (len(v) if isinstance(v, list) else {s: len(x) for s, x in v.items()}) for k, v in {**groups["inputs"], **groups["outputs"]}.items()}
    print(f"{N:,} neuronas | {len(post):,} conexiones (>= {MIN_SYN} sinapsis) | {groups['meta']['synapses']:,} sinapsis | {(OUT / 'connectome.bin').stat().st_size / 1e6:.1f} MB")
    print(sizes)


if __name__ == "__main__":
    main()
