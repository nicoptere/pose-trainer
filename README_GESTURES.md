# Gesture Detection, Segmentation & Clustering System

PyTorch and MediaPipe-based system for detecting gestures in videos, clustering by similarity, and training classifiers for real-time gesture recognition.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Local Workflow](#local-workflow)
- [Google Cloud Storage Workflow](#google-cloud-storage-workflow)
- [Google Colab Workflow](#google-colab-workflow)
- [Components](#components)
- [Output Structure](#output-structure)
- [Configuration](#configuration)
- [Requirements](#requirements)

---

## Quick Start

### Local Processing

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Add videos to videos/ directory

# 3. Run gesture clustering
python run.py

# 4. Train classifier
python classification.py

# 5. Extract animations for web app
python classification.py --extract-animations
```

---

## Local Workflow

### Step 1: Detect and Cluster Gestures

Process videos to detect gestures and cluster by similarity using DTW:

```bash
python run.py
```

**What it does:**
- Analyzes videos at reduced FPS (default: 12 FPS)
- Detects gestures using MediaPipe pose estimation + activity detection
- Clusters similar gestures using DTW distance
- Saves segments and clustering results

**Output:** `output_<N>v_<FPS>fps_<MIN>-<MAX>f/`
- `N` = number of videos processed
- `FPS` = analysis frame rate
- `MIN-MAX` = gesture length range in frames

### Step 2: Extract Cluster Videos (Optional)

Extract individual video clips organized by cluster:

```bash
python run.py --extract-clusters
```

### Step 3: Train Gesture Classifier

Train a PyTorch classifier and export to ONNX:

```bash
python classification.py
```

**Outputs:**
- `output_XXv_XXfps_XX-XXf/gesture_classifier.onnx` - Trained model
- `public/gesture_classifier.onnx` - Copy for web app
- `public.zip` - Downloadable package with model

### Step 4: Extract Animation Data

Generate gesture sequences for web visualization:

```bash
python classification.py --extract-animations
```

**Output:** `public/cluster_animations.json`

---

## Google Cloud Storage Workflow

Process videos and store results in Google Cloud Storage.

### Prerequisites

```bash
# Install GCS support
pip install google-cloud-storage>=2.10.0

# Authenticate
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
# OR
gcloud auth application-default login
```

### GCS Commands

```bash
# Process videos from GCS, save to GCS
python run_gcs.py \
  --videos gs://my-bucket/videos/ \
  --output gs://my-bucket/output/

# Train with GCS manifest, save model to GCS
python classification_gcs.py \
  --manifest gs://my-bucket/output_50v_12fps_24-72f/clustering_manifest.json \
  --output gs://my-bucket/models/gesture_classifier.onnx

# Extract animations to GCS
python classification_gcs.py \
  --extract-animations \
  --manifest gs://my-bucket/output_50v_12fps_24-72f/clustering_manifest.json \
  --animations-output gs://my-bucket/public/cluster_animations.json
```

### Mixed Workflows

```bash
# Local videos → GCS output
python run_gcs.py --videos videos/ --output gs://my-bucket/output/

# GCS videos → Local output
python run_gcs.py --videos gs://my-bucket/videos/ --output output/
```

---

## Google Colab Workflow

For cloud-based processing without local setup, use the provided Colab notebook:

**[📓 Open in Colab](gesture_clustering_colab.ipynb)**

### Key Benefits

1. **Free GPU/TPU** acceleration for faster processing
2. **No local installation** required
3. **Google Drive ↔ GCS** integration
4. **Persistent storage** via GCS buckets
5. **Team collaboration** via notebook sharing

### Typical Processing Times

- **Gesture Clustering**: 30-60 min for ~50 videos
- **Classifier Training**: 5-10 min
- **Animation Extraction**: 2-5 min

### Colab Workflow Steps

1. Mount Google Drive and authenticate GCS
2. Copy training videos from Drive to GCS bucket
3. Run gesture detection and clustering
4. Train classifier on clustered gestures
5. Extract animations for web app
6. Download results or access from GCS

---

## Components

### Core Scripts

- **run.py** - Gesture detection and clustering pipeline
- **run_gcs.py** - GCS-enabled wrapper for run.py
- **classification.py** - Classifier training and ONNX export
- **classification_gcs.py** - GCS-enabled wrapper for classification.py

### Utilities

- **gcs_utils.py** - Google Cloud Storage helper functions
- **scripts/similarity_engine.py** - DTW-based similarity computation
- **scripts/config.py** - Centralized configuration

### Notebook

- **gesture_clustering_colab.ipynb** - Complete Colab workflow

---

## Output Structure

```
output_50v_12fps_24-72f/           # Dynamic folder name
├── segments/                       # Individual gesture videos
│   ├── video_segment_000.mp4
│   ├── video_segment_000_metadata.json
│   └── segments_manifest.json
├── clusters/                       # Empty (deprecated)
├── cluster_0/                      # Gestures grouped by cluster
│   ├── video_0_gesture_000.mp4
│   └── ...
├── cluster_1/
│   └── ...
├── clustering_manifest.json        # Main clustering results
├── similarity_report.md            # Similarity statistics
├── gesture_classifier.onnx         # Trained model
└── public/                         # Web app assets
    ├── gesture_classifier.onnx     # Model copy for deployment
    └── cluster_animations.json     # Animation data

public.zip                          # Downloadable package
```

---

## Configuration

Edit parameters in `run.py`:

```python
ANALYSIS_FPS = 12              # Analysis frame rate
GESTURE_MIN_FRAMES = 24        # Min gesture length (2 sec @ 12 FPS)
GESTURE_MAX_FRAMES = 72        # Max gesture length (6 sec @ 12 FPS)
USE_HDBSCAN = True             # Auto-detect cluster count
N_CLUSTERS = None              # Or set fixed number
```

---

## Requirements

### Installation

```bash
pip install -r requirements.txt
```

### Key Dependencies

- **torch** >= 2.0.0 - PyTorch for classifier training
- **mediapipe** >= 0.10.0 - Pose estimation
- **opencv-python** >= 4.8.0 - Video processing
- **dtaidistance** >= 2.3.10 - DTW similarity
- **hdbscan** >= 0.8.33 - Density-based clustering
- **google-cloud-storage** >= 2.10.0 - GCS support (optional)

### System Requirements

- **Python**: 3.8+
- **RAM**: 8GB+ recommended
- **GPU**: Optional, speeds up MediaPipe processing
- **Disk**: 2-5GB per hour of video

---

## Advanced Usage

### Custom Output Directory

Output directory is automatically named based on configuration. To run multiple experiments:

1. Adjust parameters in `run.py` (FPS, min/max frames)
2. Run pipeline - new folder created automatically
3. Results stored in `output_<config>/`

### Model Deployment

After training, the ONNX model is automatically:
1. Copied to `public/gesture_classifier.onnx`
2. Packaged in `public.zip` for easy download
3. Copied to `output_XXv_XXfps_XX-XXf/public/` for archiving

Use the model in your web app:

```javascript
// Load ONNX model in browser
const session = await ort.InferenceSession.create('public/gesture_classifier.onnx');
```

---

## Troubleshooting

**No gestures detected:**
- Adjust `GESTURE_MIN_FRAMES` and `GESTURE_MAX_FRAMES`
- Check video quality and lighting
- Verify MediaPipe can detect poses

**Too many/few clusters:**
- Set `USE_HDBSCAN = False` and specify `N_CLUSTERS`
- Adjust min/max gesture length to filter noise

**Out of memory:**
- Reduce `ANALYSIS_FPS`
- Process fewer videos at once
- Use Colab with GPU runtime

---

## Documentation

- [Colab Notebook](gesture_clustering_colab.ipynb)

---

## License

MIT
