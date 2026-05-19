# Train on Colab — Setup Guide

This guide walks a clinician through one full training run on **free
Google Colab**, with VRL-YOLO-GUI as the live UI on the desktop.

The companion notebooks live under `notebooks/` in this repo:

- `01_train_detect_colab.ipynb` — for object-detection datasets
  (Roboflow / YOLO format with `data.yaml`).
- `02_train_classify_colab.ipynb` — for classification datasets
  (ImageFolder layout).

You don't need to clone the repo yourself — the notebooks clone it for
you inside the Colab session. You also don't need a Cloudflare or
Google Cloud account; only a Google account (for Drive + Colab).

---

## 1. Upload your dataset to Drive

In your Google Drive, create the folder structure:

```
MyDrive/
└── VRL-YOLO-GUI/
    └── datasets/
        └── <dataset_name>/        ← drag your dataset folder in here
```

The dataset folder layout depends on the task:

### Detection

```
<dataset_name>/
├── data.yaml                  ← Roboflow / YOLO-format data.yaml
├── train/images/*.jpg
├── train/labels/*.txt
├── valid/images/*.jpg
└── valid/labels/*.txt
```

If you used Roboflow's "Export → YOLOv8" option, the resulting zip
already has this exact shape. Just unzip and drag the top folder into
`MyDrive/VRL-YOLO-GUI/datasets/`.

### Classification

Either flat ImageFolder:

```
<dataset_name>/
├── class_a/*.jpg
├── class_b/*.jpg
└── class_c/*.jpg
```

…or a pre-split layout:

```
<dataset_name>/
├── train/class_a/*.jpg
├── train/class_b/*.jpg
└── val/class_a/*.jpg
```

Either works — Ultralytics figures it out from what's there.

---

## 2. Open the right notebook in Colab

The desktop app's **Connect to Colab** modal has an *Open notebook*
button that does this for you. If you're opening it manually:

- Detection: <https://colab.research.google.com/github/atultiwari/VRL-YOLO-GUI/blob/main/notebooks/01_train_detect_colab.ipynb>
- Classification: <https://colab.research.google.com/github/atultiwari/VRL-YOLO-GUI/blob/main/notebooks/02_train_classify_colab.ipynb>

These URLs always point to the latest `main`, so any fix lands the next
time you open the notebook.

---

## 3. Set the runtime to GPU

`Runtime → Change runtime type → GPU`. Pick T4 if asked — it's free
and trains a small YOLO model in 30–60 minutes.

---

## 4. Edit the `CONFIG` cell

In the notebook, find the cell labelled `# 3. CONFIG`. You'll see a
small Python dict:

```python
CONFIG = {
    'dataset_name': 'my-detect-dataset',
    'model':        'yolo26n.pt',
    'epochs':       50,
    'imgsz':        640,
    'batch':        16,
}
```

Change `dataset_name` to the folder name you used in step 1. Adjust
the other values if you know you want to.

---

## 5. Run all cells

`Runtime → Run all`. The notebook will:

1. Mount your Drive (you'll be asked to authorize — that's normal).
2. Clone the VRL-YOLO-GUI repo and install Ultralytics (~30 seconds).
3. Download the `cloudflared` binary (~10 seconds).
4. Start a local server and a Cloudflare tunnel.
5. Print a URL like:

   ```
   ========================================================================
   Copy this URL into the desktop app's "Connect to Colab" modal:

       https://abc-def-ghi.trycloudflare.com?token=AbCdEf1234567890

   Keep this notebook running. The URL stops working when the cell stops.
   ========================================================================
   ```

6. Start training. You can watch metrics scroll in the cell output,
   but you'll see the same data plotted live in the desktop app.

---

## 6. Connect from the desktop

In VRL-YOLO-GUI:

1. Go to **Train → Configure**.
2. Click **Run on Colab**.
3. Paste the URL from the notebook into the modal.
4. Click **Connect**.

The desktop redirects to **Train → Run** with live charts updating as
each epoch completes — same screen as a local training run.

---

## 7. Save the trained model

When training finishes, the cell output will say *"Training finished —
exit code 0"*. In the desktop, click **Save to library**. The desktop
downloads `best.pt` through the same tunnel and saves it to your local
model library. You can now use the model from **Predict** like any
other model.

---

## Troubleshooting

### *"Couldn't reach that Colab session"* in the desktop modal

The tunnel URL went stale. Re-run the cell that prints the URL (you
can just re-run the whole notebook if easier), then paste the new URL.

### Drive mount asks for permission again

Colab sessions expire after ~90 minutes of inactivity (free tier) and
12 hours of total runtime. If the session dies mid-training, you'll
need to start over — incremental resume isn't supported yet.

### Tunnel URL prints but desktop won't connect

Check the cell output for an error from `cloudflared`. The most common
issue is a transient Cloudflare outage — wait a minute, re-run the
cell.

### *"No GPU available"* in the training output

You forgot to set `Runtime → Change runtime type → GPU`. Change it,
then `Runtime → Restart and run all`.

### Where is best.pt if I want to download it manually?

Inside the Colab session: `/content/vrl-yolo-gui-runs/<run-name>/weights/best.pt`.
You can use Colab's File menu (left sidebar) to download it directly if
the desktop save fails.

---

## Security note

The tunnel URL is technically public — anyone who knows it can hit the
endpoints. We mitigate that with a random token appended to the URL;
the server rejects any request without it. **Don't share the printed
URL outside the desktop app.** The token regenerates every time you
re-run the cell, so a stale URL someone saw last week is harmless.
