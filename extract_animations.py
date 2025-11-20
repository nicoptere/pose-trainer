"""
Extract representative gesture sequences for each cluster to use as animations in the web app.

This script reads the clustering manifest and extracts one representative gesture
sequence from each cluster, saving them as a JSON file for the browser to animate.
"""

import os
import sys
import json
import numpy as np
import cv2
import mediapipe as mp
from pathlib import Path
from tqdm import tqdm

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))
import config

MANIFEST_PATH = 'output/dtw_clusters/clustering_manifest.json'
OUTPUT_PATH = 'public/cluster_animations.json'


def load_gesture_sequence(video_path, start_frame, end_frame, analysis_fps):
    """Load a gesture sequence from video."""
    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        min_detection_confidence=config.POSE_CONFIDENCE,
        min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
    )
    
    cap = cv2.VideoCapture(video_path)
    original_fps = int(cap.get(cv2.CAP_PROP_FPS))
    
    # Calculate frame skip
    frame_skip = max(1, original_fps // analysis_fps)
    
    # Map to original video frames
    original_start = start_frame * frame_skip
    original_end = end_frame * frame_skip
    
    landmarks_list = []
    
    # Seek to start
    cap.set(cv2.CAP_PROP_POS_FRAMES, original_start)
    
    # Read frames
    for frame_idx in range(original_start, original_end, frame_skip):
        ret, frame = cap.read()
        if not ret:
            break
        
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(image)
        
        if results.pose_landmarks:
            row = []
            for lm in results.pose_landmarks.landmark:
                row.extend([lm.x, lm.y, lm.z, lm.visibility])
            landmarks_list.append(row)
        else:
            landmarks_list.append([0.0] * config.INPUT_SIZE)
    
    cap.release()
    pose.close()
    
    return landmarks_list


def main():
    print("=" * 70)
    print("EXTRACTING CLUSTER ANIMATIONS")
    print("=" * 70)
    print()
    
    # Load manifest
    if not os.path.exists(MANIFEST_PATH):
        print(f"Error: Manifest not found at {MANIFEST_PATH}")
        print("Please run 'python run.py' first to generate clustering results.")
        return
    
    with open(MANIFEST_PATH, 'r') as f:
        manifest = json.load(f)
    
    analysis_fps = manifest.get('analysis_fps', 5)
    num_clusters = manifest['num_clusters']
    
    print(f"Found {num_clusters} clusters")
    print(f"Analysis FPS: {analysis_fps}")
    print()
    
    # Extract representative sequences
    animations = {}
    
    for cluster_id in tqdm(range(num_clusters), desc="Extracting sequences"):
        cluster_data = manifest['clusters'].get(str(cluster_id))
        
        if not cluster_data or not cluster_data['gestures']:
            print(f"Warning: Cluster {cluster_id} has no gestures, skipping")
            continue
        
        # Get first gesture as representative
        gesture = cluster_data['gestures'][0]
        
        try:
            sequence = load_gesture_sequence(
                video_path=gesture['source_video'],
                start_frame=gesture['start_frame'],
                end_frame=gesture['end_frame'],
                analysis_fps=analysis_fps
            )
            
            # Convert to list for JSON serialization
            animations[str(cluster_id)] = {
                'sequence': [list(frame) for frame in sequence],
                'num_frames': len(sequence),
                'source_video': os.path.basename(gesture['source_video']),
                'duration_seconds': gesture['duration_seconds']
            }
            
        except Exception as e:
            print(f"Error loading sequence for cluster {cluster_id}: {e}")
            continue
    
    # Save animations
    print(f"\nSaving animations to {OUTPUT_PATH}")
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    output_data = {
        'num_clusters': num_clusters,
        'analysis_fps': analysis_fps,
        'animations': animations
    }
    
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output_data, f)
    
    print(f"Saved {len(animations)} cluster animations")
    
    # Print statistics
    print("\nAnimation Statistics:")
    for cluster_id, anim in animations.items():
        print(f"  Cluster {cluster_id}: {anim['num_frames']} frames ({anim['duration_seconds']:.1f}s)")
    
    print("\n" + "=" * 70)
    print("EXTRACTION COMPLETE")
    print("=" * 70)
    print(f"\nYou can now use the web app with animated cluster previews!")


if __name__ == "__main__":
    main()
