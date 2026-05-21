# F1 Plan — Models library: delete + reveal on disk

> Concrete plan for **Future Feature #1** from `docs/FUTURE-FEATURES.md`.
> **Not yet committed to implementation** — this doc captures the design
> + open decisions for sign-off before any code lands.
>
> Once signed off, this becomes the F1 section in `docs/PHASE-STATUS.md`
> at phase boundary, and the matching `CHANGELOG.md` / changelog.ts
> entries.

---

## 1. Scope summary

Two related additions to `/models`:

- **Delete** user-created and trained-locally checkpoints. Bundled
  starter weights stay undeletable (they live in the install tree,
  re-fetchable by `scripts/fetch-models.py`).
- **Show storage path** + a **"Reveal in Finder / Explorer"** button on
  every model card (bundled too — same affordance).

Out of scope for F1: the "warn if a saved prediction report references
this model" guard from FUTURE-FEATURES.md item 1's acceptance criteria.
That guard requires the persistent training history from F3 to be
meaningful. Plain confirmation modal for now.

---

## 2. Backend

### 2.1 New: `ModelRegistry.delete(name)` in `server/vrl_yolo/engine/registry.py`

Mirror `rename(old_name, new_name)`'s structure (the existing reference
implementation for "mutating a non-bundled checkpoint on disk"):

- Acquire `self._lock`.
- KeyError if `name` not in `self._records`.
- ValueError if `record.source == "bundled"` — message: `"<name> is a
  bundled model — bundled weights are read-only"`. Route maps to 403.
- `record.path.unlink()` — if it's already gone (e.g. someone deleted
  it externally between `scan()` and the click), tolerate `FileNotFoundError`
  silently and proceed to the cleanup steps.
- If this model was a per-task default, drop the entry from
  `defaults.json` (don't auto-pick a successor — `get_defaults()`
  already falls back to "any record of the right task" on the next
  read).
- Drop the warm YOLO instance via `self._yolo_cache.pop(name, None)`.
- `self.scan()` to refresh `_records`.
- Return `None`.

### 2.2 New route: `DELETE /api/models/{name}`

In `server/vrl_yolo/api/routers/models.py`:

```python
@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(
    name: str, registry: ModelRegistry = Depends(get_registry)
) -> None:
    try:
        registry.delete(name)
    except KeyError as exc:
        raise HTTPException(404, f"model {name!r} not found") from exc
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc
```

403 (not 400) for the bundled-model rejection — matches the
"forbidden, not malformed" semantics; client uses status code to
distinguish "this UI affordance shouldn't have been clickable" from
"this name has never existed."

### 2.3 Schema update: surface the path

`ModelInfo` in `server/vrl_yolo/api/schemas.py` already has `name`, `task`,
`source`, `num_classes`, `classes`, `params`, `size_mb`. Add:

```python
class ModelInfo(BaseModel):
    ...
    path: str  # absolute path on disk
```

Wire it in `_record_to_info(record)` (one new line: `path=str(record.path)`).
`ModelRecord` already has `path: Path` — already serialised in
`ModelRecord.to_json()`, just not in the API DTO.

### 2.4 New route: `POST /api/models/{name}/reveal`

Reveal-on-disk is OS-level, not browser-level — so the backend does it.
The renderer is sandboxed under Pyloid; it has no way to spawn `open`.

```python
import platform
import subprocess

@router.post("/{name}/reveal", status_code=status.HTTP_204_NO_CONTENT)
def reveal_model(
    name: str, registry: ModelRegistry = Depends(get_registry)
) -> None:
    try:
        record = registry.get(name)
    except KeyError as exc:
        raise HTTPException(404, f"model {name!r} not found") from exc
    if not record.path.is_file():
        raise HTTPException(410, f"checkpoint file missing on disk: {record.path}")

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", "-R", str(record.path)], check=False)
        elif system == "Windows":
            # /select, requires no space after the comma; Path-shape required.
            subprocess.run(["explorer", f"/select,{record.path}"], check=False)
        else:  # Linux + fallbacks
            subprocess.run(["xdg-open", str(record.path.parent)], check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(500, f"could not open file manager: {exc}") from exc
```

Notes on safety:
- `record.path` comes from registry scan output, which is anchored at
  `_bundled_dir` and `_user_dir` — never user-controlled. No path-traversal
  surface.
- `check=False` — we don't fail the request if the file manager exits
  non-zero (e.g. xdg-open's "no opener found" on a barebones Linux). The
  UI doesn't show a confirmation; not getting a Finder window is the user
  signal that something went wrong.
- `subprocess.run` not `Popen` — file managers detach immediately, so
  there's no zombie. Tested pattern in `yolo-gui`'s
  `start_colab.py` (sibling project) for the same OS-detect-and-spawn
  flow.

---

## 3. Frontend

### 3.1 `apps/web/lib/api.ts`

Add three exports (mirroring `renameModel` / `modelDownloadUrl` patterns):

```typescript
export async function deleteModel(name: string): Promise<void>;
export async function revealModel(name: string): Promise<void>;
```

Both use the existing `request()` helper. `deleteModel` is `DELETE`,
`revealModel` is `POST` with empty body.

### 3.2 `apps/web/lib/types.ts`

Add `path: string` to `ModelInfo`.

### 3.3 `apps/web/app/models/page.tsx`

Per-card additions inside `ModelCard`:

- **Path row** — beneath the file name, a single-line truncated
  `<code className="text-xs text-muted-foreground">{model.path}</code>`
  with `title={model.path}` so hover reveals the full path. Always
  visible (bundled too).
- **Reveal icon button** — `<FolderOpen />` from lucide-react, next to
  the existing Download icon button in the card footer. Calls
  `revealModel(model.name)` on click. No success toast; the Finder
  window appearing IS the success signal. Show `ApiError.message` as a
  brief inline error if the call fails.
- **Delete icon button** — `<Trash2 />` from lucide-react. Disabled
  with `title="Bundled models are read-only"` when `model.source ===
  "bundled"`. Otherwise opens an `<AlertDialog>` (radix-ui, already in
  `components/ui/`):

  > **Delete this model?**
  >
  > `<model.name>` will be permanently removed from
  > `<model.path>`. This can't be undone.
  >
  > [Cancel] [Delete]

  On confirm: call `deleteModel(model.name)`, then
  `queryClient.invalidateQueries({ queryKey: ["models"] })`. On error,
  show the `ApiError.message` inline at the bottom of the dialog with
  the dialog left open so the user can retry / read the error / cancel.

### 3.4 No `settings.mode === "desktop"` gate

The FUTURE-FEATURES doc said "visible only when `settings.mode ===
"desktop"`." That setting doesn't exist — and this project is
always-desktop by definition (Pyloid + QtWebEngine binary, with no
web-mode build). Reveal button always visible. If a web build ever
ships, this becomes a real gate; tracked as a forward-ref in the
F1 carry-forward note.

---

## 4. Tests

Add to `tests/test_models_api.py` (existing — covers rename + import):

| Test | Asserts |
|---|---|
| `test_delete_user_model_removes_file_and_record` | After `DELETE`, `path.is_file()` is False and `GET /api/models` no longer lists the name |
| `test_delete_bundled_rejected_with_403` | bundled name → 403 + bundled file untouched |
| `test_delete_missing_returns_404` | unknown name → 404 |
| `test_delete_clears_default_when_deleting_default_model` | set default → delete → defaults.json no longer contains the entry |
| `test_path_field_present_on_list_response` | every record has `path` field, absolute |
| `test_reveal_returns_204_on_macos` | mock `subprocess.run`, assert called with `["open", "-R", record_path]` |
| `test_reveal_404_on_unknown` | unknown name → 404, no subprocess call |
| `test_reveal_410_when_file_missing` | path.unlink() before request → 410, no subprocess call |

For the reveal tests, monkeypatch `platform.system` + `subprocess.run`
to verify dispatch per-OS without actually opening Finder.

No new frontend tests for this phase — the existing P3b smoke (page
loads, mutations call API) covers the surface. Manual verification
checklist in §6.

---

## 5. Edge cases worth flagging now

1. **Deleting the currently-selected default model** — the default
   silently disappears from `get_defaults()`'s output, and the
   frontend's "set as default" buttons remain available on remaining
   models of the right task. Tested above.
2. **Deleting a model mid-inference** — `ModelRegistry.load()` holds a
   reference to the YOLO instance, but if we `delete()` while a
   `/api/inference/single` is in flight, the instance stays alive in
   the request-scoped local but its `path` is now a dead pointer. No
   user-visible issue: the inference completes, the next request fails
   to load (file missing), the user sees a clear error. Worth a brief
   note in the F1 carry-forward — not worth blocking deletion behind
   "no active inferences" tracking for v1.
3. **Concurrent delete + rename of the same name** — registry lock
   serialises them; second one gets KeyError → 404.
4. **Disk full during delete** — `unlink()` doesn't write, so this
   isn't a real concern. The post-delete `scan()` could fail if
   `_user_dir` becomes unreadable, but that's a much bigger problem.

---

## 6. Manual verification checklist

Before shipping:

- [ ] `uv sync --extra ml` clean
- [ ] `uv run --extra ml pytest tests/test_models_api.py` green (8 new + existing pass)
- [ ] `pnpm tsc --noEmit` clean
- [ ] Dev run: `PYTHONUNBUFFERED=1 uv run --extra ml python src-pyloid/main.py`
  - [ ] `/models` shows path under every name
  - [ ] Trash icon on user/trained cards; tooltip on bundled
  - [ ] Reveal opens Finder, file pre-selected
  - [ ] Delete confirmation shows file name + full path
  - [ ] After delete, model is gone from the list (no refresh needed)
  - [ ] Deleting a default model leaves the page in a coherent state
- [ ] CHANGELOG.md + apps/web/lib/changelog.ts entry for v0.10.0
- [ ] docs/PHASE-STATUS.md F1 section
- [ ] pyproject.toml version bump to 0.10.0
- [ ] Tag `v0.10-f1-models-polish`
- [ ] Push, then chore commit to backfill SHA

---

## 7. Versioning + commit

- **pyproject.toml:** `0.9.1` → `0.10.0` (minor — new user-visible
  feature, no breaking changes).
- **Tag:** `v0.10-f1-models-polish` (matches the F1 naming proposed
  earlier; keeps P-numbering free for original PLAN.md §14 phases).
- **Commit message:**
  `feat(f1): models library — delete + reveal on disk + path on every card`.

---

## 8. Decisions (signed off 2026-05-21)

1. **Hard-delete.** `path.unlink()`. macOS Finder Trash is the
   system-level safety net since `models/` is under
   `~/Library/Application Support/`.
2. **403 for bundled-delete rejection.** Communicates policy
   ("exists but immutable") vs. 404 ("never existed").
3. **Show path on every card** including bundled — consistent
   affordance.
4. **Reveal button on every card** including bundled — same.

Implementation: ~½ day of focused work including tests.
