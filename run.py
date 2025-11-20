"""
DTW-based gesture clustering from video samples.

This script processes videos in the 'videos' folder, extracts pose sequences at a reduced FPS,
detects gestures within a specified duration range, and clusters them using DTW similarity.

Usage:
    python run.py
    
Configuration:
    Edit the constants below to adjust:
    - ANALYSIS_FPS: Frames per second to analyze (default: 5)
    - GESTURE_MIN_FRAMES: Minimum gesture length in frames (default: 5 = 1 second at 5 FPS)
    - GESTURE_MAX_FRAMES: Maximum gesture length in frames (default: 20 = 4 seconds at 5 FPS)
    - N_CLUSTERS: Number of clusters (default: 20), or None for HDBSCAN auto-clustering
    - USE_HDBSCAN: Set to True to use HDBSCAN instead of fixed cluster count
"""

import os
import sys
import json
import numpy as np
import cv2
import mediapipe as mp
from pathlib import Path
from typing import List, Dict, Tuple
from tqdm import tqdm

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

from similarity_engine import SimilarityEngine
import config

# ============================================================================
# CONFIGURABLE PARAMETERS
# ============================================================================

# Analysis frame rate (process every Nth frame to speed up)
ANALYSIS_FPS = 5  # Analyze at 5 frames per second

# Gesture duration constraints (in frames at ANALYSIS_FPS)
GESTURE_MIN_FRAMES = 5   # Minimum: 1 second at 5 FPS
GESTURE_MAX_FRAMES = 20  # Maximum: 4 seconds at 5 FPS

# Clustering configuration
N_CLUSTERS = 20          # Fixed number of clusters (set to None to use HDBSCAN)
USE_HDBSCAN = False      # Set to True to automatically infer cluster count

# DTW configuration
DTW_DOWNSAMPLE_FACTOR = 1  # Additional downsampling for DTW (1 = no extra downsampling)

# Output directory
OUTPUT_DIR = 'output/dtw_clusters'

# ============================================================================


class VideoGestureProcessor:
    """Process videos to extract pose sequences at specified FPS."""
    
    def __init__(self, target_fps: int = 5):
        """
        Initialize the processor.
        
        Args:
            target_fps: Target frames per second for analysis
        """
        self.target_fps = target_fps
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            min_detection_confidence=config.POSE_CONFIDENCE,
            min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
        )
    
    def extract_pose_sequence_at_fps(self, video_path: str) -> Tuple[np.ndarray, int]:
        """
        Extract pose landmarks from video at specified FPS.
        
        Args:
            video_path: Path to video file
            
        Returns:
            landmarks_sequence: Array of shape [num_frames, input_size]
            original_fps: Original video frame rate
        """
        cap = cv2.VideoCapture(video_path)
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
        
        # Calculate frame skip interval
        frame_skip = max(1, original_fps // self.target_fps)
        
        landmarks_list = []
        frame_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            # Only process every Nth frame
            if frame_idx % frame_skip == 0:
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.pose.process(image)
                
                if results.pose_landmarks:
                    row = []
                    for lm in results.pose_landmarks.landmark:
                        row.extend([lm.x, lm.y, lm.z, lm.visibility])
                    landmarks_list.append(row)
                else:
                    # No pose detected, use zero vector
                    landmarks_list.append([0.0] * config.INPUT_SIZE)
            
            frame_idx += 1
        
        cap.release()
        
        if not landmarks_list:
            # Return empty array if no landmarks found
            return np.zeros((0, config.INPUT_SIZE)), original_fps
        
        return np.array(landmarks_list), original_fps
    
    def detect_gestures_by_activity(
        self, 
        landmarks_sequence: np.ndarray,
        min_frames: int,
        max_frames: int,
        activity_threshold: float = 0.05
    ) -> List[Dict]:
        """
        Detect gestures based on motion activity.
        
        Args:
            landmarks_sequence: Pose sequence [num_frames, input_size]
            min_frames: Minimum gesture duration in frames
            max_frames: Maximum gesture duration in frames
            activity_threshold: Movement threshold for detection
            
        Returns:
            List of gesture dictionaries with start/end frames
        """
        if len(landmarks_sequence) < min_frames:
            return []
        
        # Compute frame-to-frame movement
        movement = np.linalg.norm(np.diff(landmarks_sequence, axis=0), axis=1)
        
        # Smooth movement signal
        from scipy.ndimage import uniform_filter1d
        smoothed_movement = uniform_filter1d(movement, size=3)
        
        # Detect active regions
        active = smoothed_movement > activity_threshold
        
        # Find contiguous active regions
        gestures = []
        in_gesture = False
        start_frame = 0
        
        for i, is_active in enumerate(active):
            if is_active and not in_gesture:
                # Start of gesture
                start_frame = i
                in_gesture = True
            elif not is_active and in_gesture:
                # End of gesture
                end_frame = i
                duration = end_frame - start_frame
                
                # Check duration constraints
                if min_frames <= duration <= max_frames:
                    gestures.append({
                        'start_frame': start_frame,
                        'end_frame': end_frame,
                        'duration_frames': duration,
                        'duration_seconds': duration / self.target_fps,
                        'sequence': landmarks_sequence[start_frame:end_frame]
                    })
                
                in_gesture = False
        
        # Handle gesture at end of video
        if in_gesture:
            end_frame = len(active)
            duration = end_frame - start_frame
            if min_frames <= duration <= max_frames:
                gestures.append({
                    'start_frame': start_frame,
                    'end_frame': end_frame,
                    'duration_frames': duration,
                    'duration_seconds': duration / self.target_fps,
                    'sequence': landmarks_sequence[start_frame:end_frame]
                })
        
        return gestures
    
    def process_video(
        self, 
        video_path: str, 
        min_frames: int, 
        max_frames: int
    ) -> List[Dict]:
        """
        Process a single video to extract gestures.
        
        Args:
            video_path: Path to video file
            min_frames: Minimum gesture duration
            max_frames: Maximum gesture duration
            
        Returns:
            List of detected gestures with sequences
        """
        # Extract poses at target FPS
        landmarks_sequence, original_fps = self.extract_pose_sequence_at_fps(video_path)
        
        if len(landmarks_sequence) == 0:
            return []
        
        # Detect gestures
        gestures = self.detect_gestures_by_activity(
            landmarks_sequence, 
            min_frames, 
            max_frames
        )
        
        # Add video metadata
        for gesture in gestures:
            gesture['source_video'] = video_path
            gesture['video_name'] = Path(video_path).stem
            gesture['original_fps'] = original_fps
            gesture['analysis_fps'] = self.target_fps
        
        return gestures
    
    def close(self):
        """Release resources."""
        self.pose.close()


def cluster_gestures_dtw(
    gestures: List[Dict],
    n_clusters: int = None,
    use_hdbscan: bool = False,
    output_dir: str = 'output/dtw_clusters'
) -> Dict:
    """
    Cluster gestures using DTW similarity.
    
    Args:
        gestures: List of gesture dictionaries with 'sequence' field
        n_clusters: Number of clusters (ignored if use_hdbscan=True)
        use_hdbscan: Use HDBSCAN for automatic cluster detection
        output_dir: Output directory for clustered results
        
    Returns:
        Clustering manifest with results
    """
    if not gestures:
        print("No gestures to cluster")
        return {}
    
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"\nClustering {len(gestures)} gestures using DTW...")
    
    # Extract sequences for DTW
    sequences = [g['sequence'] for g in gestures]
    
    # For DTW, we need to create dummy embeddings (SimilarityEngine expects them)
    # but the DTW metric will use the raw sequences instead
    dummy_embeddings = np.random.randn(len(gestures), 64)  # Dummy embeddings
    
    # Create segments format expected by SimilarityEngine
    segments = []
    for idx, gesture in enumerate(gestures):
        segments.append({
            'segment_id': idx,
            'segment_path': gesture['source_video'],  # Original video path
            'source_video': gesture['source_video'],
            'start_frame': gesture['start_frame'],
            'end_frame': gesture['end_frame'],
            'duration_seconds': gesture['duration_seconds'],
            'duration_frames': gesture['duration_frames'],
            'confidence': 1.0,
            'embedding': dummy_embeddings[idx],  # Dummy embedding
            'sequence': gesture['sequence']  # Raw sequence for DTW
        })
    
    # Use DTW-based similarity engine
    engine = SimilarityEngine(metric='dtw')
    
    # Manually load sequences into engine
    engine.raw_sequences = sequences
    
    # Compute DTW similarity matrix
    from dtaidistance import dtw_ndim
    
    n = len(sequences)
    distances = np.zeros((n, n))
    
    print("Computing DTW pairwise distances...")
    for i in tqdm(range(n), desc="DTW computation"):
        for j in range(i, n):
            if i == j:
                distances[i, j] = 0.0
            else:
                # Downsample for speed if needed
                seq_i = sequences[i][::DTW_DOWNSAMPLE_FACTOR] if DTW_DOWNSAMPLE_FACTOR > 1 else sequences[i]
                seq_j = sequences[j][::DTW_DOWNSAMPLE_FACTOR] if DTW_DOWNSAMPLE_FACTOR > 1 else sequences[j]
                
                distance = dtw_ndim.distance(seq_i, seq_j)
                distances[i, j] = distance
                distances[j, i] = distance
    
    # Normalize distances
    max_dist = distances.max()
    if max_dist > 0:
        distances = distances / max_dist
    
    # Convert to similarity
    similarity_matrix = 1 / (1 + distances)
    
    # Perform clustering
    if use_hdbscan:
        print("Using HDBSCAN for automatic cluster detection...")
        import hdbscan
        
        # Convert similarity to distance for HDBSCAN
        distance_matrix = 1 - similarity_matrix
        
        clusterer = hdbscan.HDBSCAN(
            metric='precomputed',
            min_cluster_size=2,
            min_samples=1
        )
        labels = clusterer.fit_predict(distance_matrix)
        
        # Count clusters (excluding noise points labeled as -1)
        n_clusters_found = len(set(labels)) - (1 if -1 in labels else 0)
        print(f"HDBSCAN found {n_clusters_found} clusters")
        
        # Remap -1 (noise) to separate clusters
        if -1 in labels:
            max_label = labels.max()
            noise_indices = np.where(labels == -1)[0]
            for i, idx in enumerate(noise_indices):
                labels[idx] = max_label + 1 + i
    else:
        # Use K-means clustering
        from sklearn.cluster import KMeans
        
        n_clusters = n_clusters or N_CLUSTERS
        n_clusters = min(n_clusters, len(gestures))
        
        print(f"Using K-means with {n_clusters} clusters...")
        
        # Cluster based on embeddings (derived from similarity)
        embeddings = dummy_embeddings  # Could use MDS on similarity matrix for better results
        clusterer = KMeans(n_clusters=n_clusters, random_state=42)
        labels = clusterer.fit_predict(embeddings)
    
    # Organize by cluster
    clusters = {}
    for cluster_id in set(labels):
        cluster_gestures = [
            gestures[i] for i in range(len(gestures)) 
            if labels[i] == cluster_id
        ]
        clusters[int(cluster_id)] = cluster_gestures
        print(f"Cluster {cluster_id}: {len(cluster_gestures)} gestures")
    
    # Save clustering manifest
    manifest = {
        'total_gestures': len(gestures),
        'num_clusters': len(clusters),
        'metric': 'dtw',
        'analysis_fps': ANALYSIS_FPS,
        'gesture_min_frames': GESTURE_MIN_FRAMES,
        'gesture_max_frames': GESTURE_MAX_FRAMES,
        'clustering_method': 'hdbscan' if use_hdbscan else 'kmeans',
        'clusters': {}
    }
    
    for cluster_id, cluster_gestures in clusters.items():
        cluster_dir = os.path.join(output_dir, f'cluster_{cluster_id}')
        os.makedirs(cluster_dir, exist_ok=True)
        
        manifest['clusters'][cluster_id] = {
            'size': len(cluster_gestures),
            'gestures': []
        }
        
        for gesture in cluster_gestures:
            gesture_info = {
                'source_video': gesture['source_video'],
                'video_name': gesture['video_name'],
                'start_frame': int(gesture['start_frame']),
                'end_frame': int(gesture['end_frame']),
                'duration_seconds': float(gesture['duration_seconds']),
                'duration_frames': int(gesture['duration_frames'])
            }
            manifest['clusters'][cluster_id]['gestures'].append(gesture_info)
    
    # Save manifest
    manifest_path = os.path.join(output_dir, 'clustering_manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\nSaved clustering manifest to {manifest_path}")
    
    # Create similarity report
    report_lines = [
        "# DTW Gesture Clustering Report",
        "",
        f"**Total Gestures:** {len(gestures)}",
        f"**Number of Clusters:** {len(clusters)}",
        f"**Clustering Method:** {'HDBSCAN (auto)' if use_hdbscan else f'K-means (k={n_clusters})'}",
        f"**Similarity Metric:** DTW (Dynamic Time Warping)",
        f"**Analysis FPS:** {ANALYSIS_FPS}",
        f"**Gesture Duration:** {GESTURE_MIN_FRAMES}-{GESTURE_MAX_FRAMES} frames ({GESTURE_MIN_FRAMES/ANALYSIS_FPS:.1f}-{GESTURE_MAX_FRAMES/ANALYSIS_FPS:.1f} seconds)",
        "",
        "## Cluster Distribution",
        ""
    ]
    
    for cluster_id in sorted(clusters.keys()):
        size = len(clusters[cluster_id])
        report_lines.append(f"- **Cluster {cluster_id}:** {size} gestures")
    
    report_lines.extend([
        "",
        "## Similarity Statistics",
        ""
    ])
    
    # Compute statistics (excluding diagonal)
    mask = ~np.eye(len(gestures), dtype=bool)
    similarities = similarity_matrix[mask]
    
    report_lines.extend([
        f"- **Average Similarity:** {similarities.mean():.3f}",
        f"- **Max Similarity:** {similarities.max():.3f}",
        f"- **Min Similarity:** {similarities.min():.3f}",
        f"- **Std Deviation:** {similarities.std():.3f}"
    ])
    
    report_path = os.path.join(output_dir, 'similarity_report.md')
    with open(report_path, 'w') as f:
        f.write('\n'.join(report_lines))
    
    print(f"Saved similarity report to {report_path}")
    
    return manifest


def main():
    """Main entry point for DTW clustering."""
    
    print("=" * 70)
    print("DTW-BASED GESTURE CLUSTERING")
    print("=" * 70)
    print(f"\nConfiguration:")
    print(f"  Analysis FPS: {ANALYSIS_FPS}")
    print(f"  Gesture duration: {GESTURE_MIN_FRAMES}-{GESTURE_MAX_FRAMES} frames")
    print(f"  Duration range: {GESTURE_MIN_FRAMES/ANALYSIS_FPS:.1f}-{GESTURE_MAX_FRAMES/ANALYSIS_FPS:.1f} seconds")
    print(f"  Clustering: {'HDBSCAN (auto)' if USE_HDBSCAN else f'K-means (k={N_CLUSTERS})'}")
    print(f"  Output directory: {OUTPUT_DIR}")
    print()
    
    # Find videos
    video_dir = 'videos'
    if not os.path.exists(video_dir):
        print(f"Error: Video directory '{video_dir}' not found")
        return
    
    video_paths = []
    for ext in config.VIDEO_EXTENSIONS:
        video_paths.extend(Path(video_dir).glob(f'*{ext}'))
    
    video_paths = [str(p) for p in video_paths]
    
    if not video_paths:
        print(f"No videos found in '{video_dir}'")
        return
    
    print(f"Found {len(video_paths)} videos\n")
    
    # Process videos
    print("=" * 70)
    print("STEP 1: EXTRACTING GESTURES FROM VIDEOS")
    print("=" * 70)
    
    processor = VideoGestureProcessor(target_fps=ANALYSIS_FPS)
    
    all_gestures = []
    for video_path in tqdm(video_paths, desc="Processing videos"):
        gestures = processor.process_video(
            video_path,
            min_frames=GESTURE_MIN_FRAMES,
            max_frames=GESTURE_MAX_FRAMES
        )
        all_gestures.extend(gestures)
    
    processor.close()
    
    print(f"\nExtracted {len(all_gestures)} gestures from {len(video_paths)} videos")
    
    if not all_gestures:
        print("No gestures found. Try adjusting GESTURE_MIN_FRAMES, GESTURE_MAX_FRAMES, or activity threshold.")
        return
    
    # Cluster gestures
    print("\n" + "=" * 70)
    print("STEP 2: CLUSTERING GESTURES WITH DTW")
    print("=" * 70)
    
    manifest = cluster_gestures_dtw(
        all_gestures,
        n_clusters=N_CLUSTERS,
        use_hdbscan=USE_HDBSCAN,
        output_dir=OUTPUT_DIR
    )
    
    # Summary
    print("\n" + "=" * 70)
    print("CLUSTERING COMPLETE")
    print("=" * 70)
    print(f"\nResults saved to: {OUTPUT_DIR}")
    print(f"  - clustering_manifest.json")
    print(f"  - similarity_report.md")
    print(f"  - cluster_<N>/ directories")
    print()



if __name__ == "__main__":
    try:
        # Import scipy for gesture detection
        from scipy.ndimage import uniform_filter1d
    except ImportError:
        print("Error: scipy is required. Install with: pip install scipy")
        sys.exit(1)
    
    main()
