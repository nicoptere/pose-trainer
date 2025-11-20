# Gesture Detection, Segmentation & Similarity System


# Step 1: Cluster gestures
python run.py

# Step 2: Extract video segments (optional, for visualization)
python extract_cluster.py

# Step 3: Train classifier on clustered data
python classification.py

=====================================

PyTorch-based system to detect gestures in videos, segment them into clips, and sort by similarity.

## Quick Start

### Simple Mode (No Training Required)

Detect gestures using activity threshold:

```bash
python scripts/process_gestures.py --input videos/ --output output/ --simple
```

### With Temporal Model (Better Accuracy)
M
1. **Prepare sequences**:
   ```bash
   python scripts/prepare_sequences.py --source csv --csv data.csv
   ```

2. **Train temporal model**:
   ```bash
   python scripts/train_temporal.py --sequences data_sequences.npz
   ```

3. **Run full pipeline**:
   ```bash
   python scripts/process_gestures.py --input videos/ --model models/temporal_model.pth
   ```

## Components

- **gesture_detector.py** - LSTM-based gesture detection with dual modes
- **video_segmenter.py** - Cuts videos into gesture clips
- **similarity_engine.py** - Compares and clusters gestures
- **process_gestures.py** - End-to-end pipeline orchestrator
- **prepare_sequences.py** - Prepares training data
- **train_temporal.py** - Trains temporal LSTM model
- **config.py** - Centralized configuration

## Features

✅ Dual detection modes (simple activity / LSTM model)
✅ Automatic video segmentation with metadata
✅ Similarity analysis with clustering
✅ Visualization (similarity heatmaps)
✅ Comprehensive reporting

## Output Structure

```
output/
├── segments/
│   ├── video_segment_000.mp4
│   ├── video_segment_000_metadata.json
│   └── segments_manifest.json
└── clusters/
    ├── cluster_0/
    ├── cluster_1/
    └── clustering_manifest.json
```

## Configuration

Edit `scripts/config.py` to adjust:
- Sequence length (default: 30 frames)
- Detection thresholds
- Model hyperparameters
- Similarity metrics

## Requirements

Install dependencies:
```bash
pip install -r requirements.txt
```

Key packages:
- torch
- mediapipe
- opencv-python
- scikit-learn
- tqdm
- matplotlib

## Test Results

Tested on 6 videos:
- ✅ 59 gestures detected
- ✅ 59 video segments created
- ✅ Complete metadata generation
- ✅ ~12 minute processing time

## Documentation

See [walkthrough.md](file:///C:/Users/barra/.gemini/antigravity/brain/bfcc1fa8-86cb-4f90-8ecb-2c5a3294e8f2/walkthrough.md) for detailed documentation.
