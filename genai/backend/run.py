"""
Manual Clustering Pipeline.

This script processes videos in the 'dataset' folder, assuming existing subdirectories
represent Class Labels (clusters). It extracts pose sequences and generates a
clustering_manifest.json compatible with the classifier training script.

It skips:
- Temporal gesture detection (assumes files ARE the gestures)
- Unsupervised clustering (uses directory structure as ground truth)

Usage:
    python run.py
"""

import os
import sys
import json
import numpy as np
import mediapipe as mp
from pathlib import Path
from typing import List, Dict, Tuple
from tqdm import tqdm

# Replace cv2 with moviepy and PIL
from moviepy.editor import VideoFileClip
from PIL import Image

# Add scripts directory to path (if needed later)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'training'))

import config

# ============================================================================
# CONFIGURABLE PARAMETERS
# ============================================================================

def load_config():
    """Load configuration from gesture_config.json or use defaults."""
    config_path = 'gesture_config.json'
    if not os.path.exists(config_path):
        # Try one level up
        config_path = '../gesture_config.json'

    # Default configuration
    defaults = {
        'analysis_fps': 12,
        'output_path': 'genai/result'
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                defaults.update(user_config)
                print(f"[OK] Loaded configuration from {config_path}")
        except Exception as e:
            print(f"[WARN] Warning: Could not load {config_path}: {e}")
    
    return defaults

_config = load_config()
ANALYSIS_FPS = _config['analysis_fps']
OUTPUT_PATH = _config['output_path']

# Determine absolute path for output
# If relative, make it relative to project root (parent of genai/) or CWD? 
# The script is run from genai/. CWD is c:\ML\perso\pose-trainer\genai
# If output_path is 'genai/result', we probably want it relative to CWD parent?
# Or if CWD is 'genai', then 'result' works?
# The user specified "default is genai/result". If running from root, that's fine.
# If running from genai/, we might need to adjust.
# Let's rely on standard path resolution relative to CWD.
OUTPUT_DIR = OUTPUT_PATH
if not os.path.isabs(OUTPUT_DIR):
    # If we are in genai/ folder, and path starts with genai/, we might be duping?
    # No, typically relative to CWD.
    # main.py runs this script with CWD='genai'.
    # So if path is 'genai/result', it tries to create 'genai/genai/result'.
    # We should probably fix the path if running from subdir.
    cwd = os.getcwd()
    if os.path.basename(cwd) == 'genai' and OUTPUT_PATH.startswith('genai/'):
        OUTPUT_DIR = OUTPUT_PATH.replace('genai/', '', 1)
    
print(f"Output directory: {OUTPUT_DIR}")

# ============================================================================
# SKELETON NORMALIZATION (Reused)
# ============================================================================

def normalize_skeleton(landmarks: np.ndarray) -> np.ndarray:
    """Normalize skeleton to be invariant to position, scale, and orientation."""
    landmarks = landmarks.reshape(33, 4)
    coords = landmarks[:, :3].copy()
    visibility = landmarks[:, 3:4]
    
    left_shoulder = coords[11]
    right_shoulder = coords[12]
    left_hip = coords[23]
    right_hip = coords[24]
    
    shoulder_mid = (left_shoulder + right_shoulder) / 2
    hip_mid = (left_hip + right_hip) / 2
    torso_center = (shoulder_mid + hip_mid) / 2
    
    centered = coords - torso_center
    torso_height = np.linalg.norm(shoulder_mid - hip_mid)
    if torso_height < 1e-6: torso_height = 1.0
    scaled = centered / torso_height
    
    normalized = np.concatenate([scaled, visibility], axis=1)
    return normalized.flatten()

# ============================================================================
# VIDEO PROCESSING
# ============================================================================

class VideoProcessor:
    def __init__(self, target_fps: int = 5):
        self.target_fps = target_fps
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            min_detection_confidence=config.POSE_CONFIDENCE,
            min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
        )
    
    def extract_pose_sequence(self, video_path: str) -> Tuple[np.ndarray, int]:
        try:
            clip = VideoFileClip(video_path)
        except Exception as e:
            print(f"Error opening video {video_path}: {e}")
            return np.zeros((0, config.INPUT_SIZE)), 0
            
        original_fps = int(clip.fps)
        
        # Calculate step in seconds to match target_fps
        # iterating iter_frames(fps=target_fps) is easiest
        
        landmarks_list = []
        
        # We iterate at target_fps directly
        for frame in clip.iter_frames(fps=self.target_fps, dtype='uint8'):
             # Frame is already numpy array in RGB
             # MediaPipe expects RGB
             results = self.pose.process(frame)
             
             if results.pose_landmarks:
                 row = []
                 for lm in results.pose_landmarks.landmark:
                     row.extend([lm.x, lm.y, lm.z, lm.visibility])
                 landmarks_list.append(normalize_skeleton(np.array(row)).tolist())
             else:
                 landmarks_list.append([0.0] * config.INPUT_SIZE)
        
        clip.close()
        return np.array(landmarks_list), original_fps
        
    def close(self):
        self.pose.close()

def main():
    print("="*60)
    print("PROCESSING MANUAL DATASET FOR TRAINING")
    print("="*60)
    
    # 1. SCAN DATASET FOLDER
    dataset_root = os.path.join(os.getcwd(), 'dataset') # Expects 'dataset' in CWD
    if not os.path.exists(dataset_root):
        # Fallback to ../dataset if running from genai/
        dataset_root = os.path.join(os.path.dirname(os.getcwd()), 'dataset')
        
    if not os.path.exists(dataset_root):
        print(f"Error: Dataset directory not found at {dataset_root}")
        return

    # Sanitize reserved filenames on Windows (e.g., 'nul', 'con', 'prn')
    if os.name == 'nt':
        reserved_names = {'nul', 'con', 'prn', 'aux', 'com1', 'com2', 'com3', 'com4', 'lpt1', 'lpt2', 'lpt3', 'lpt4'}
        for name in os.listdir(dataset_root):
            if name.lower() in reserved_names:
                old_path = os.path.join(dataset_root, name)
                # Use \\?\(abspath) to handle reserved names if normal path fails, but straight rename might fail too.
                # Python's rename might work if we are careful.
                # Try absolute path with extended prefix for robustness
                abs_old_path = os.path.abspath(old_path)
                if not abs_old_path.startswith('\\\\?\\'):
                    abs_old_path = '\\\\?\\' + abs_old_path
                
                new_name = f"{name}_safe"
                new_path = os.path.join(dataset_root, new_name)
                
                print(f"[WARN] Found reserved folder name '{name}'. Renaming to '{new_name}'...")
                try:
                    os.rename(abs_old_path, new_path)
                except Exception as e:
                    print(f"[ERR] Failed to rename reserved folder '{name}': {e}")
                    print("      Please rename this folder manually to proceed.")

    print(f"Scanning dataset at: {dataset_root}")
    
    # Find all class folders (excluding Unsorted)
    classes = [d for d in os.listdir(dataset_root) 
              if os.path.isdir(os.path.join(dataset_root, d)) and d not in ['Unsorted']]
    
    if not classes:
        print("No class folders found in dataset directory!")
        return

    print(f"Found {len(classes)} classes: {classes}")
    
    # 2. PROCESS VIDEOS
    processor = VideoProcessor(target_fps=ANALYSIS_FPS)
    
    manifest_clusters = {}
    total_gestures = 0
    
    # OUTPUT_DIR is already resolved from config
    clusters_output_dir = os.path.join(OUTPUT_DIR, 'clusters')
    os.makedirs(clusters_output_dir, exist_ok=True)

    # Dictionary to store class name mapping
    class_map = {} # class_name -> cluster_id (int)
    
    for i, class_name in enumerate(sorted(classes)):
        cluster_id = i
        class_map[class_name] = cluster_id
        
        class_dir = os.path.join(dataset_root, class_name)
        video_files = [f for f in os.listdir(class_dir) 
                      if f.lower().endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm'))]
        
        print(f"\nProcessing Class '{class_name}' (ID: {cluster_id}) - {len(video_files)} videos")
        
        cluster_gestures = []
        
        for video_file in tqdm(video_files, desc=f"  Class {class_name}", ascii=True):
            video_path = os.path.join(class_dir, video_file)
            
            # Extract landmarks (treating whole video as gesture)
            sequence, original_fps = processor.extract_pose_sequence(video_path)
            
            if len(sequence) == 0:
                print(f"  Warning: No poses found in {video_file}, skipping.")
                continue
                
            duration_frames = len(sequence) # in analysis fps
            duration_seconds = duration_frames / ANALYSIS_FPS
            
            gesture_info = {
                'source_video': os.path.abspath(video_path),
                'video_name': video_file,
                'start_frame': 0,
                'end_frame': duration_frames, 
                'duration_seconds': duration_seconds,
                'duration_frames': duration_frames,
            }
            cluster_gestures.append(gesture_info)
            total_gestures += 1
            
        manifest_clusters[str(cluster_id)] = {
            'size': len(cluster_gestures),
            'gestures': cluster_gestures,
            'label': class_name # Store the original label name
        }

    processor.close()
    
    # 3. SAVE MANIFEST
    manifest = {
        'total_gestures': total_gestures,
        'num_clusters': len(classes),
        'metric': 'manual', # It's manually labeled
        'analysis_fps': ANALYSIS_FPS,
        'clustering_method': 'manual_folders',
        'clusters': manifest_clusters,
        'class_map': class_map # Save the mapping for reference
    }
    
    manifest_path = os.path.join(OUTPUT_DIR, 'clustering_manifest.json')
    
    # Manually serialize to avoid issues? standard json dump works.
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
        
    print(f"\n[OK] Processing complete!")
    print(f"Total Gestures: {total_gestures}")
    print(f"Manifest saved to: {manifest_path}")
    print("\nYou can now run the classifier training.")

if __name__ == "__main__":
    main()
