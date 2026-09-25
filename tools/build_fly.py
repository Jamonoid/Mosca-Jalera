"""Convierte el modelo MuJoCo de flybody (TuragaLab, Apache-2.0) en assets para el navegador.

Salida:
  assets/fly.glb       mallas simplificadas con jerarquia de cuerpos (nodos "b_<nombre>")
  assets/fly_rig.json  cuerpos, articulaciones (eje, rango, pose de reposo) y materiales

Uso:
  py tools/build_fly.py <carpeta flybody/fruitfly/assets> [--tris 20000] [--skip black,bristle-brown,ocelli]
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets"


def floats(s, n=None):
    v = [float(x) for x in s.split()]
    return v if n is None else v[:n]


def parse_defaults(root):
    """Devuelve {clase: {tag: attrs}} con herencia ya resuelta."""
    classes = {}

    def walk(el, name, inherited):
        own = {k: dict(v) for k, v in inherited.items()}
        for child in el:
            if child.tag == "default":
                continue
            own.setdefault(child.tag, {}).update(child.attrib)
        classes[name] = own
        for child in el:
            if child.tag == "default":
                walk(child, child.get("class"), own)

    top = root.find("default")
    walk(top, "main", {})
    return classes


def attr(el, tag, key, cls, classes, fallback=None):
    if key in el.attrib:
        return el.get(key)
    return classes.get(cls, {}).get(tag, {}).get(key, fallback)


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def transform(pos, quat):
    m = np.eye(4)
    q = np.array(quat, dtype=float)
    m[:3, :3] = quat_to_mat(q / np.linalg.norm(q))
    m[:3, 3] = pos
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assets", type=Path)
    ap.add_argument("--tris", type=int, default=20_000, help="presupuesto total de triangulos")
    ap.add_argument("--skip", default="black,bristle-brown,ocelli",
                    help="materiales a omitir (pelos y ocelos: detalle que no se nota a esta escala)")
    args = ap.parse_args()

    tree = ET.parse(args.assets / "fruitfly.xml")
    root = tree.getroot()
    classes = parse_defaults(root)
    mesh_scale = floats(classes["main"]["mesh"]["scale"])

    asset = root.find("asset")
    mesh_files = {m.get("name"): m.get("file") for m in asset.findall("mesh")}
    materials = {}
    for m in asset.findall("material"):
        materials[m.get("name")] = {
            "rgba": floats(m.get("rgba", "1 1 1 1")),
            "shininess": float(m.get("shininess", "0.5")),
        }

    skip = set(filter(None, args.skip.split(",")))
    bodies = []  # orden padre-antes-que-hijo
    geoms = []   # (body, geom_name, mesh_name, material, matrix)

    def walk_body(el, parent, childclass):
        cls = el.get("childclass", childclass)
        name = el.get("name")
        pos = floats(el.get("pos", "0 0 0"))
        quat = floats(el.get("quat", "1 0 0 0"))
        joints = []
        for j in el.findall("joint"):
            jcls = j.get("class", cls)
            rng = attr(j, "joint", "range", jcls, classes)
            joints.append({
                "name": j.get("name"),
                "axis": floats(attr(j, "joint", "axis", jcls, classes, "0 0 1")),
                "range": floats(rng) if rng else None,
                "rest": float(attr(j, "joint", "springref", jcls, classes, "0")),
            })
        bodies.append({"name": name, "parent": parent, "pos": pos, "quat": quat, "joints": joints})
        for g in el.findall("geom"):
            gcls = g.get("class", cls)
            gtype = attr(g, "geom", "type", gcls, classes, "sphere")
            mesh = g.get("mesh")
            if gtype != "mesh" or not mesh:
                continue
            mat = attr(g, "geom", "material", gcls, classes, "body")
            if mat in skip:
                continue
            gpos = floats(g.get("pos", "0 0 0"))
            gquat = floats(g.get("quat", "1 0 0 0"))
            geoms.append((name, g.get("name"), mesh, mat, transform(gpos, gquat)))
        for child in el.findall("body"):
            walk_body(child, name, cls)

    walk_body(root.find("worldbody").find("body"), None, None)

    # Cargar mallas y repartir el presupuesto de triangulos
    loaded = {}
    for _, _, mesh, _, _ in geoms:
        if mesh in loaded:
            continue
        tm = trimesh.load(args.assets / mesh_files[mesh], force="mesh", process=False)
        tm.merge_vertices(merge_tex=True, merge_norm=True)  # el OBJ duplica vertices por cara
        tm.apply_scale(mesh_scale)
        loaded[mesh] = tm
    total = sum(len(m.faces) for m in loaded.values())
    ratio = min(1.0, args.tris / total)
    print(f"{len(loaded)} mallas, {total:,} triangulos -> ratio {ratio:.3f}")

    simplified = {}
    for name, tm in loaded.items():
        n = len(tm.faces)
        target = max(min(n, 60), int(n * ratio))
        if target < n:
            v, f = fast_simplification.simplify(
                np.asarray(tm.vertices, dtype=np.float32),
                np.asarray(tm.faces, dtype=np.int32),
                target_reduction=1 - target / n,
            )
            tm = trimesh.Trimesh(v, f, process=True)
        simplified[name] = tm

    scene = trimesh.Scene()
    for b in bodies:
        scene.graph.update(
            frame_from=f"b_{b['parent']}" if b["parent"] else scene.graph.base_frame,
            frame_to=f"b_{b['name']}",
            matrix=transform(b["pos"], b["quat"]),
        )
    rig_geoms = []
    for body, gname, mesh, mat, m in geoms:
        node = f"g_{gname}"
        scene.add_geometry(simplified[mesh], node_name=node, geom_name=f"mesh:{gname}",
                           parent_node_name=f"b_{body}", transform=m)
        rig_geoms.append({"node": node, "body": body, "material": mat})

    OUT_DIR.mkdir(exist_ok=True)
    glb = scene.export(file_type="glb")
    (OUT_DIR / "fly.glb").write_bytes(glb)
    rig = {"source": "flybody (TuragaLab), Apache-2.0", "units": "cm, Z arriba, X adelante",
           "bodies": bodies, "geoms": rig_geoms, "materials": materials}
    (OUT_DIR / "fly_rig.json").write_text(json.dumps(rig, indent=1))
    out_tris = sum(len(simplified[g[2]].faces) for g in geoms)
    print(f"fly.glb {len(glb) / 1e6:.2f} MB, {out_tris:,} triangulos, {len(bodies)} cuerpos, {len(geoms)} geoms")


if __name__ == "__main__":
    sys.exit(main())
