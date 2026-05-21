"""Model registry — discover, cache, and serve YOLO checkpoints.

Scans two roots:
- **Bundled**: weights shipped inside the binary (`models/{detect,classify}/`).
- **User**: weights the user imported or trained locally
  (`<storage_root>/models/{detect,classify,...}/`).

Each `.pt` is inspected once at startup (or on first request when in lazy
mode) to read `task`, `names`, and parameter count. A small LRU keeps
fully-loaded YOLO instances warm so back-to-back inference calls don't
re-read the checkpoint from disk.

Defaults-per-task are persisted to `<storage_root>/models/defaults.json`
so the user's "Set as default" choice survives a restart. The shipped
defaults are `yolo26n.pt` (detect) and `yolo26n-cls.pt` (classify)
per PLAN.md §7.
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TYPE_CHECKING

if TYPE_CHECKING:
    from ultralytics import YOLO

Task = Literal["detect", "classify"]
Source = Literal["bundled", "user", "trained"]

SHIPPED_DEFAULTS: dict[Task, str] = {
    "detect": "yolo26n.pt",
    "classify": "yolo26n-cls.pt",
}

# Tasks beyond detect/classify are out of scope for v1 (PLAN.md §1).
_SUPPORTED_TASKS: frozenset[str] = frozenset({"detect", "classify"})


@dataclass(frozen=True)
class ModelRecord:
    """Frontend-facing model description."""

    name: str
    task: Task
    source: Source
    path: Path
    classes: dict[int, str]
    num_classes: int
    params: int
    size_mb: float

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "task": self.task,
            "source": self.source,
            "path": str(self.path),
            "classes": self.classes,
            "num_classes": self.num_classes,
            "params": self.params,
            "size_mb": round(self.size_mb, 2),
        }


class ModelLoadError(Exception):
    """Raised when a .pt file can't be inspected or its task is unsupported."""


class ModelRegistry:
    """Discovery + LRU caching for the model library.

    Thread-safe: a single instance lives for the FastAPI app's lifetime
    and is hit from multiple request workers. Disk scans and YOLO-load
    operations are guarded by a re-entrant lock; the LRU itself is a
    plain OrderedDict because Python's dict ops are already atomic
    enough for our access pattern.
    """

    def __init__(
        self,
        *,
        bundled_dir: Path,
        user_dir: Path,
        cache_size: int = 4,
    ) -> None:
        self._bundled_dir = bundled_dir
        self._user_dir = user_dir
        self._cache_size = cache_size
        self._lock = threading.RLock()
        self._records: dict[str, ModelRecord] = {}
        self._yolo_cache: "OrderedDict[str, YOLO]" = OrderedDict()
        self._defaults_path = user_dir / "defaults.json"

    # ---- discovery -------------------------------------------------------

    def scan(self) -> list[ModelRecord]:
        """Re-scan both roots and refresh the in-memory registry.

        Called once at app startup; safe to call again to pick up a newly
        imported / trained model without restarting the server.
        """
        with self._lock:
            self._records.clear()
            for source, root in (
                ("bundled", self._bundled_dir),
                ("user", self._user_dir),
            ):
                if not root.is_dir():
                    continue
                for task_dir in root.iterdir():
                    if not task_dir.is_dir():
                        continue
                    if task_dir.name not in _SUPPORTED_TASKS:
                        continue
                    for pt in sorted(task_dir.glob("*.pt")):
                        try:
                            record = self._inspect(pt, source=source)  # type: ignore[arg-type]
                        except ModelLoadError:
                            continue
                        # User-imported weight that shadows a bundled name wins —
                        # rare in practice, but matches the "user always overrides"
                        # default behaviour for both source layers.
                        self._records[record.name] = record
            return list(self._records.values())

    def list(self) -> list[ModelRecord]:
        with self._lock:
            if not self._records:
                self.scan()
            return list(self._records.values())

    def get(self, name: str) -> ModelRecord:
        with self._lock:
            if not self._records:
                self.scan()
            if name not in self._records:
                raise KeyError(name)
            return self._records[name]

    # ---- loading + caching -----------------------------------------------

    def load(self, name: str) -> "YOLO":
        """Return a warm ultralytics.YOLO instance, evicting the LRU tail if full."""
        with self._lock:
            if name in self._yolo_cache:
                self._yolo_cache.move_to_end(name)
                return self._yolo_cache[name]

            record = self.get(name)
            from ultralytics import YOLO  # heavy import, deferred until needed

            yolo = YOLO(str(record.path))
            self._yolo_cache[name] = yolo
            while len(self._yolo_cache) > self._cache_size:
                self._yolo_cache.popitem(last=False)
            return yolo

    def evict(self, name: str) -> None:
        with self._lock:
            self._yolo_cache.pop(name, None)

    # ---- defaults --------------------------------------------------------

    def get_defaults(self) -> dict[Task, str]:
        """Return one default model per task, omitting tasks with no loaded model.

        The frontend treats a missing key as "no models available" — that's
        more honest than returning a shipped fallback that doesn't exist on
        disk yet (e.g. classify weights before P2 fetches them).
        """
        with self._lock:
            stored: dict[str, str] = {}
            if self._defaults_path.is_file():
                try:
                    stored = json.loads(self._defaults_path.read_text())
                except (OSError, json.JSONDecodeError):
                    stored = {}
            out: dict[Task, str] = {}
            for task, fallback in SHIPPED_DEFAULTS.items():
                picked = stored.get(task) or fallback
                if picked in self._records and self._records[picked].task == task:
                    out[task] = picked
                    continue
                # Stored default disappeared (deleted, moved) — fall back to
                # any record of the right task: bundled before user.
                available = [
                    r.name for r in self._records.values() if r.task == task
                ]
                if available:
                    out[task] = available[0]
            return out

    def rename(self, old_name: str, new_name: str) -> ModelRecord:
        """Rename a user/trained checkpoint in place.

        Bundled weights are read-only — they live in the install tree and
        would be re-fetched by `scripts/fetch-models.py` anyway. The rest
        sit under `<storage_root>/models/<task>/` where the user fully
        owns the filesystem.

        Side effects beyond the rename itself:
          * Update `defaults.json` if the old name was a per-task default.
          * Drop the warm YOLO instance from the LRU cache (the file path
            it captured is stale).
          * Re-scan so `_records` reflects the new name.
        """
        with self._lock:
            if old_name not in self._records:
                raise KeyError(old_name)
            record = self._records[old_name]
            if record.source == "bundled":
                raise ValueError(
                    f"{old_name!r} is a bundled model — bundled weights are read-only"
                )
            if new_name in self._records and new_name != old_name:
                raise ValueError(
                    f"a model named {new_name!r} already exists"
                )
            old_path = record.path
            new_path = old_path.with_name(new_name)
            if new_path.exists() and new_path != old_path:
                raise ValueError(
                    f"file already exists at {new_path.name!r}"
                )

            old_path.rename(new_path)

            # If this model was a default, point defaults.json at the new name
            # so the user's choice survives the rename.
            if self._defaults_path.is_file():
                try:
                    current = json.loads(self._defaults_path.read_text())
                except (OSError, json.JSONDecodeError):
                    current = {}
                touched = False
                for task, picked in list(current.items()):
                    if picked == old_name:
                        current[task] = new_name
                        touched = True
                if touched:
                    self._defaults_path.write_text(json.dumps(current, indent=2))

            self._yolo_cache.pop(old_name, None)
            self.scan()
            return self._records[new_name]

    def delete(self, name: str) -> None:
        """Remove a user/trained checkpoint from disk and the registry.

        Bundled weights are rejected — they're part of the install tree
        and `scripts/fetch-models.py` would re-fetch them anyway. The
        rest sit under `<storage_root>/models/<task>/` where the user
        owns the filesystem.

        Side effects beyond the unlink itself:
          * Drop the entry from `defaults.json` if it was a per-task
            default. `get_defaults()` already falls back to "any
            record of the right task" on the next read, so we don't
            need to auto-pick a successor here.
          * Evict the warm YOLO instance from the LRU.
          * Re-scan so `_records` no longer lists the name.

        Tolerates a file already missing on disk (the on-disk state
        wins — we still clean up the registry + defaults so the UI
        stops showing a ghost entry).
        """
        with self._lock:
            if name not in self._records:
                raise KeyError(name)
            record = self._records[name]
            if record.source == "bundled":
                raise ValueError(
                    f"{name!r} is a bundled model — bundled weights are read-only"
                )

            try:
                record.path.unlink()
            except FileNotFoundError:
                pass

            if self._defaults_path.is_file():
                try:
                    current = json.loads(self._defaults_path.read_text())
                except (OSError, json.JSONDecodeError):
                    current = {}
                touched = False
                for task, picked in list(current.items()):
                    if picked == name:
                        del current[task]
                        touched = True
                if touched:
                    self._defaults_path.write_text(json.dumps(current, indent=2))

            self._yolo_cache.pop(name, None)
            self.scan()

    def set_default(self, task: Task, name: str) -> None:
        with self._lock:
            record = self.get(name)
            if record.task != task:
                raise ValueError(
                    f"model {name!r} has task={record.task!r}, can't set as {task!r} default"
                )
            self._defaults_path.parent.mkdir(parents=True, exist_ok=True)
            current: dict[str, str] = {}
            if self._defaults_path.is_file():
                try:
                    current = json.loads(self._defaults_path.read_text())
                except (OSError, json.JSONDecodeError):
                    current = {}
            current[task] = name
            self._defaults_path.write_text(json.dumps(current, indent=2))

    # ---- internals -------------------------------------------------------

    def _inspect(self, path: Path, *, source: Source) -> ModelRecord:
        """Read task + classes + param count from a .pt — costs ~1 s per file.

        ultralytics' YOLO loader is the only reliable way to read the
        embedded task tag; the raw torch.load surface changed between
        v8.4 patches.

        ImportError from a missing `ml` extra is surfaced as a
        `ModelLoadError` so the registry can degrade gracefully: a fresh
        clone with only the desktop extras installed still serves
        `/api/models` (just with an empty list) instead of returning 500.
        """
        try:
            from ultralytics import YOLO
            yolo = YOLO(str(path))
        except ImportError as exc:
            raise ModelLoadError(
                f"ultralytics not installed — `uv sync --extra ml` to enable model loading ({exc})"
            ) from exc
        except Exception as exc:  # noqa: BLE001 — surface as a registry-level error
            raise ModelLoadError(f"could not load {path.name}: {exc}") from exc

        task = getattr(yolo, "task", None)
        if task not in _SUPPORTED_TASKS:
            raise ModelLoadError(
                f"{path.name}: task={task!r} not supported in v1 "
                "(detection + classification only)"
            )

        names = dict(getattr(yolo, "names", {}) or {})
        params = sum(p.numel() for p in yolo.model.parameters()) if hasattr(yolo, "model") else 0
        size_mb = path.stat().st_size / (1024 * 1024)

        return ModelRecord(
            name=path.name,
            task=task,  # type: ignore[arg-type] — checked above
            source=source,
            path=path,
            classes=names,
            num_classes=len(names),
            params=params,
            size_mb=size_mb,
        )
