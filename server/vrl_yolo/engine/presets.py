"""Clinical workflow presets — one-click prefills for /predict.

Each preset names a (domain, task, intent) tuple plus the YOLO knobs
that produce a sensible default for that workflow. The frontend uses
them to populate the "Workflow" dropdown on the Predict page; picking
one prefills model + conf + (iou for detect) + optional class filter.

Presets are intentionally generic — they assume the user has either
the bundled COCO/ImageNet weights (P1/P2) or a freshly fine-tuned
checkpoint placed in `<storage_root>/models/`. The `default_model`
field is a hint; the UI falls back to the registry default for the
task if the named model isn't loaded.

Why presets live here instead of, say, a YAML config:
- The catalog is small (<20 entries) and tightly typed.
- Frontend can read it through one endpoint with no parser layer.
- New domains/tasks can be added by editing this file plus
  PHASE-STATUS as the binary version bumps.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Domain = Literal["histopathology", "hematology"]
Task = Literal["detect", "classify"]


@dataclass(frozen=True)
class Preset:
    id: str
    domain: Domain
    task: Task
    label: str
    description: str
    default_model: str
    conf: float
    iou: float | None = None  # detect only
    # Optional class-name filter: if set, the UI hides predictions whose
    # class_name isn't in this set. None means "no filter" — useful for
    # COCO/ImageNet bundled weights that have hundreds of classes.
    class_filter: tuple[str, ...] | None = None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "domain": self.domain,
            "task": self.task,
            "label": self.label,
            "description": self.description,
            "default_model": self.default_model,
            "conf": self.conf,
            "iou": self.iou,
            "class_filter": list(self.class_filter) if self.class_filter else None,
        }


# Catalog. Order matters — the UI renders them as listed, grouped by domain.
PRESETS: tuple[Preset, ...] = (
    # --- Histopathology · detection ---
    Preset(
        id="histo-mitosis",
        domain="histopathology",
        task="detect",
        label="Mitosis detection",
        description=(
            "Flag mitotic figures on H&E tissue patches. Pre-bundled weights only "
            "know the COCO classes — fine-tune on a mitosis dataset and pick the "
            "trained model here for a real workflow."
        ),
        default_model="yolo26n.pt",
        conf=0.35,
        iou=0.45,
    ),
    Preset(
        id="histo-nuclei",
        domain="histopathology",
        task="detect",
        label="Nuclei count",
        description=(
            "Count and localise cell nuclei in tissue patches. Confidence kept "
            "low (0.20) to catch faint nuclei; IoU raised (0.50) to merge "
            "overlapping detections of the same nucleus."
        ),
        default_model="yolo26n.pt",
        conf=0.20,
        iou=0.50,
    ),
    # --- Histopathology · classification ---
    Preset(
        id="histo-tumour-subtype",
        domain="histopathology",
        task="classify",
        label="Tumour subtype",
        description=(
            "Top-1 prediction over a tumour-subtype taxonomy (IDC / DCIS / "
            "Normal / …). The bundled ImageNet weights won't have these "
            "classes — point this preset at a fine-tuned classifier."
        ),
        default_model="yolo26n-cls.pt",
        conf=0.60,
    ),
    Preset(
        id="histo-gleason",
        domain="histopathology",
        task="classify",
        label="Gleason grade",
        description=(
            "Patch-level Gleason grading (G3 / G4 / G5 / benign). Requires a "
            "fine-tuned classifier; the bundled weights are a sanity check only."
        ),
        default_model="yolo26n-cls.pt",
        conf=0.55,
    ),
    # --- Hematology · detection ---
    Preset(
        id="hema-wbc-diff",
        domain="hematology",
        task="detect",
        label="WBC differential",
        description=(
            "Count and classify white blood cells in a peripheral smear. "
            "Confidence at 0.30 to catch low-conf neutrophil/lymphocyte "
            "overlap; IoU at 0.45 (Ultralytics' default)."
        ),
        default_model="yolo26n.pt",
        conf=0.30,
        iou=0.45,
    ),
    Preset(
        id="hema-bm-cells",
        domain="hematology",
        task="detect",
        label="Bone-marrow cell count",
        description=(
            "Per-class cell counts on a bone-marrow aspirate. Dense smears "
            "benefit from a slightly higher IoU (0.50) to keep adjacent "
            "cells from getting suppressed by NMS."
        ),
        default_model="yolo26n.pt",
        conf=0.30,
        iou=0.50,
    ),
    Preset(
        id="hema-malaria",
        domain="hematology",
        task="detect",
        label="Malaria screen",
        description=(
            "Flag patches with suspected malaria parasites. Conf kept low (0.20) "
            "so early-stage parasites aren't missed — false positives are "
            "preferable to false negatives in a screening workflow."
        ),
        default_model="yolo26n.pt",
        conf=0.20,
        iou=0.45,
    ),
    # --- Hematology · classification ---
    Preset(
        id="hema-smear-pathology",
        domain="hematology",
        task="classify",
        label="Blood-smear pathology",
        description=(
            "Per-patch label: Normal / Anaemia / Leukemia / … Requires a "
            "fine-tuned classifier — bundled ImageNet weights have no "
            "clinical classes."
        ),
        default_model="yolo26n-cls.pt",
        conf=0.55,
    ),
    Preset(
        id="hema-bm-pattern",
        domain="hematology",
        task="classify",
        label="Bone-marrow cellularity pattern",
        description=(
            "Patch-level marrow pattern (Normocellular / Hypocellular / "
            "Hypercellular)."
        ),
        default_model="yolo26n-cls.pt",
        conf=0.55,
    ),
)


def list_presets() -> list[Preset]:
    return list(PRESETS)


def get_preset(preset_id: str) -> Preset:
    for p in PRESETS:
        if p.id == preset_id:
            return p
    raise KeyError(preset_id)
