"""
Configuration file for gesture detection, segmentation, and similarity sorting.
"""
import os

# Directories
VIDEO_DIR = 'videos'
OUTPUT_DIR = 'output'
SEGMENTS_DIR = os.path.join(OUTPUT_DIR, 'segments')
CLUSTERS_DIR = os.path.join(OUTPUT_DIR, 'clusters')
MODELS_DIR = 'models'

# Ensure directories exist
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(SEGMENTS_DIR, exist_ok=True)
os.makedirs(CLUSTERS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# MediaPipe Pose Configuration
POSE_CONFIDENCE = 0.5
POSE_TRACKING_CONFIDENCE = 0.5
NUM_POSE_LANDMARKS = 33
LANDMARK_FEATURES = 4  # x, y, z, visibility

# Temporal Model Configuration
SEQUENCE_LENGTH = 30  # Number of frames in a sequence
STRIDE = 10  # Frames to skip between sequences during sliding window
HIDDEN_SIZE = 128  # LSTM hidden size
NUM_LAYERS = 2  # Number of LSTM layers
EMBEDDING_SIZE = 64  # Size of gesture embedding

# Gesture Detection Configuration
CONFIDENCE_THRESHOLD = 0.7  # Minimum confidence for gesture detection
MIN_GESTURE_LENGTH = 30  # Minimum frames for a valid gesture
MAX_GESTURE_LENGTH = 120  # Maximum frames for a valid gesture
ACTIVITY_THRESHOLD = 0.05  # Threshold for movement detection (optional)

# Video Processing Configuration
FPS = 30  # Target frames per second
VIDEO_EXTENSIONS = ('.mp4', '.mov', '.avi', '.mkv', '.MOV')

# Model Paths
CLASSIFIER_PATH = 'model_state.pth'
TEMPORAL_MODEL_PATH = os.path.join(MODELS_DIR, 'temporal_model.pth')
LABELS_PATH = 'public/labels.json'

# Training Configuration
EPOCHS = 50
BATCH_SIZE = 16
LEARNING_RATE = 0.001
TRAIN_TEST_SPLIT = 0.2
MANIFEST_PATH = os.path.join(OUTPUT_DIR, 'gesture_manifest.json')
VISUALIZE_RESULTS = True

# Device Configuration
import torch
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Feature Input Size
INPUT_SIZE = NUM_POSE_LANDMARKS * LANDMARK_FEATURES  # 33 landmarks * 4 features = 132
