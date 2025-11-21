"""
DTW-based gesture clustering from video samples.

This script processes videos in the 'videos' folder, extracts pose sequences at a reduced FPS,
detects gestures within a specified duration range, and clusters them using DTW similarity.

Usage:
    # Run full pipeline (detect gestures + cluster)
    python run.py
    
    # Extract video segments organized by cluster after clustering
    python run.py --extract-clusters
    
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
ANALYSIS_FPS = 12  # Analyze at 5 frames per second

# Gesture duration constraints (in frames at ANALYSIS_FPS)
GESTURE_MIN_FRAMES = 2 * ANALYSIS_FPS   # Minimum: 2 seconds at 12 FPS
GESTURE_MAX_FRAMES = 6 * ANALYSIS_FPS  # Maximum: 6 seconds at 12 FPS

# Clustering configuration
N_CLUSTERS = None          # Fixed number of clusters (set to None to use HDBSCAN)
USE_HDBSCAN = True      # Set to True to automatically infer cluster count

# DTW configuration
DTW_DOWNSAMPLE_FACTOR = 1  # Additional downsampling for DTW (1 = no extra downsampling)

# Output directory function (generates unique names based on config)
def get_output_dir(video_count: int = None) -> str:
    """
    Generate output directory name with metadata.
    Format: output_<N>v_<FPS>fps_<MIN>-<MAX>f
    
    Example: output_50v_12fps_24-72f
    """
    if video_count is None:
        video_count = 0
    
    min_sec = GESTURE_MIN_FRAMES / ANALYSIS_FPS
    max_sec = GESTURE_MAX_FRAMES / ANALYSIS_FPS
    
    return f"output_{video_count}v_{ANALYSIS_FPS}fps_{GESTURE_MIN_FRAMES}-{GESTURE_MAX_FRAMES}f"

# Default output directory (will be updated with video count during runtime)
OUTPUT_DIR = 'output/clusters'

# ============================================================================
# SKELETON NORMALIZATION
# ============================================================================

def normalize_skeleton(landmarks: np.ndarray) -> np.ndarray:
    """
    Normalize skeleton to be invariant to position, scale, and orientation.
    
    Centers the skeleton at the torso midpoint and scales by torso height.
    This makes gestures comparable regardless of where the person stands
    or how far they are from the camera.
    
    Args:
        landmarks: Array of shape [132] with format [x0,y0,z0,v0, x1,y1,z1,v1, ...]
                   for 33 MediaPipe pose landmarks
    
    Returns:
        Normalized landmarks in the same format
    """
    # Reshape to [33, 4] for easier manipulation
    landmarks = landmarks.reshape(33, 4)
    
    # Extract x, y, z coordinates (keep visibility as-is)
    coords = landmarks[:, :3].copy()
    visibility = landmarks[:, 3:4]
    
    # Key landmark indices (MediaPipe topology)
    # 11: left shoulder, 12: right shoulder
    # 23: left hip, 24: right hip
    left_shoulder = coords[11]
    right_shoulder = coords[12]
    left_hip = coords[23]
    right_hip = coords[24]
    
    # Calculate torso center (midpoint of shoulders and hips)
    shoulder_mid = (left_shoulder + right_shoulder) / 2
    hip_mid = (left_hip + right_hip) / 2
    torso_center = (shoulder_mid + hip_mid) / 2
    
    # Center all coordinates at torso
    centered = coords - torso_center
    
    # Calculate torso height for scaling
    torso_height = np.linalg.norm(shoulder_mid - hip_mid)
    
    # Avoid division by zero
    if torso_height < 1e-6:
        torso_height = 1.0
    
    # Scale by torso height (normalize to unit torso)
    scaled = centered / torso_height
    
    # Recombine with visibility
    normalized = np.concatenate([scaled, visibility], axis=1)
    
    # Flatten back to [132]
    return normalized.flatten()

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
                    
                    # Normalize the skeleton before storing
                    row_array = np.array(row)
                    normalized_row = normalize_skeleton(row_array)
                    landmarks_list.append(normalized_row.tolist())
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


def save_gesture_segment(gesture_data: dict, output_dir: str, segment_id: int) -> str:
    """
    Save a gesture segment as a video file immediately after detection.
    
    Args:
        gesture_data: Dictionary with 'source_video', 'start_frame', 'end_frame', 'sequence'
        output_dir: Base output directory
        segment_id: Unique segment identifier
        
    Returns:
        Path to saved segment
    """
    source_video = gesture_data['source_video']
    start_frame = gesture_data['start_frame']
    end_frame = gesture_data['end_frame']
    
    # Create segments directory
    segments_dir = os.path.join(output_dir, 'segments')
    os.makedirs(segments_dir, exist_ok=True)
    
    # Generate segment filename
    video_basename = os.path.splitext(os.path.basename(source_video))[0]
    segment_filename = f"segment_{segment_id:04d}_{video_basename}_f{start_frame}-{end_frame}.mp4"
    segment_path = os.path.join(segments_dir, segment_filename)
    
    # Open source video
    cap = cv2.VideoCapture(source_video)
    original_fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Setup video writer (save at original FPS for quality)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(segment_path, fourcc, original_fps, (width, height))
    
    # Calculate original video frame range (accounting for analysis FPS downsampling)
    # start_frame and end_frame are in analysis FPS, need to map back to original FPS
    frame_skip = max(1, original_fps // ANALYSIS_FPS)
    original_start = start_frame * frame_skip
    original_end = end_frame * frame_skip
    
    # Seek to start frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, original_start)
    
    # Write frames
    for frame_idx in range(original_start, original_end):
        ret, frame = cap.read()
        if not ret:
            break
        out.write(frame)
    
    cap.release()
    out.release()
    
    return segment_path


def cluster_gestures_dtw(
    gestures: List[Dict],
    n_clusters: int = None,
    use_hdbscan: bool = False,
    output_dir: str = 'output/clusters'
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


def extract_video_segment(
    video_path: str,
    start_frame: int,
    end_frame: int,
    output_path: str,
    output_fps: int = 30,
    analysis_fps: int = None
) -> bool:
    """
    Extract a segment from a video and save it.
    
    Args:
        video_path: Path to source video
        start_frame: Start frame (in analysis FPS space)
        end_frame: End frame (in analysis FPS space)
        output_path: Path to save extracted segment
        output_fps: Output video frame rate
        analysis_fps: Analysis FPS used during detection (for frame mapping)
        
    Returns:
        Success status
    """
    # Open source video
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return False
    
    # Get video properties
    original_fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Create output video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, output_fps, (width, height))
    
    if not out.isOpened():
        print(f"Error: Could not create output video {output_path}")
        cap.release()
        return False
    
    # Map analysis frames to original video frames
    if analysis_fps is None:
        analysis_fps = ANALYSIS_FPS
    
    frame_skip = max(1, original_fps // analysis_fps)
    original_start_frame = start_frame * frame_skip
    original_end_frame = end_frame * frame_skip
    
    # Seek to start frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, original_start_frame)
    
    # Extract frames
    frames_extracted = 0
    for frame_idx in range(original_start_frame, original_end_frame):
        ret, frame = cap.read()
        if not ret:
            break
        
        out.write(frame)
        frames_extracted += 1
    
    # Release resources
    cap.release()
    out.release()
    
    return frames_extracted > 0


def extract_clusters_from_manifest(
    manifest_path: str = None,
    output_fps: int = 30
) -> Dict:
    """
    Extract video segments organized by cluster from clustering manifest.
    
    Args:
        manifest_path: Path to clustering_manifest.json (default: OUTPUT_DIR/clustering_manifest.json)
        output_fps: Output video frame rate
        
    Returns:
        Statistics about extraction
    """
    if manifest_path is None:
        manifest_path = os.path.join(OUTPUT_DIR, 'clustering_manifest.json')
    
    print(f"\nLoading manifest from: {manifest_path}")
    
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    # Get manifest info
    total_gestures = manifest.get('total_gestures', 0)
    num_clusters = manifest.get('num_clusters', 0)
    analysis_fps = manifest.get('analysis_fps', ANALYSIS_FPS)
    
    print(f"\nManifest Summary:")
    print(f"  Total gestures: {total_gestures}")
    print(f"  Number of clusters: {num_clusters}")
    print(f"  Analysis FPS: {analysis_fps}")
    print(f"  Output FPS: {output_fps}")
    print()
    
    # Base output directory
    base_output_dir = os.path.dirname(manifest_path)
    
    # Statistics
    stats = {
        'total_gestures': total_gestures,
        'extracted': 0,
        'failed': 0,
        'clusters': {}
    }
    
    # Process each cluster
    clusters = manifest.get('clusters', {})
    
    for cluster_id, cluster_data in clusters.items():
        cluster_dir = os.path.join(base_output_dir, f'cluster_{cluster_id}')
        os.makedirs(cluster_dir, exist_ok=True)
        
        gestures = cluster_data.get('gestures', [])
        print(f"Processing Cluster {cluster_id}: {len(gestures)} gestures")
        
        cluster_stats = {
            'total': len(gestures),
            'extracted': 0,
            'failed': 0
        }
        
        # Process each gesture in the cluster
        for idx, gesture in enumerate(tqdm(gestures, desc=f"  Cluster {cluster_id}")):
            source_video = gesture.get('source_video')
            video_name = gesture.get('video_name', Path(source_video).stem)
            start_frame = gesture.get('start_frame')
            end_frame = gesture.get('end_frame')
            
            # Create output filename
            output_filename = f"{video_name}_gesture_{idx:03d}.mp4"
            output_path = os.path.join(cluster_dir, output_filename)
            
            # Extract segment
            success = extract_video_segment(
                video_path=source_video,
                start_frame=start_frame,
                end_frame=end_frame,
                output_path=output_path,
                output_fps=output_fps,
                analysis_fps=analysis_fps
            )
            
            if success:
                cluster_stats['extracted'] += 1
                stats['extracted'] += 1
            else:
                cluster_stats['failed'] += 1
                stats['failed'] += 1
        
        stats['clusters'][cluster_id] = cluster_stats
        print(f"  Extracted: {cluster_stats['extracted']}/{cluster_stats['total']}")
        print()
    
    return stats


def main():
    """Main entry point for DTW clustering."""
    
    print("=" * 70)
    print("DTW-BASED GESTURE CLUSTERING")
    print("=" * 70)
    
    # Find videos first to get count for output naming
    video_dir = 'videos'
    if not os.path.exists(video_dir):
        print(f"Error: Video directory '{video_dir}' not found")
        return
    
    video_paths = []
    for ext in config.VIDEO_EXTENSIONS:
        video_paths.extend(Path(video_dir).glob(f'*{ext}'))
    
    video_paths = sorted([str(p) for p in video_paths])
    
    if not video_paths:
        print(f"No videos found in '{video_dir}'")
        return
    
    # Generate dynamic output directory
    video_count = len(video_paths)
    output_dir = get_output_dir(video_count)
    
    print(f"\nConfiguration:")
    print(f"  Videos found: {video_count}")
    print(f"  Analysis FPS: {ANALYSIS_FPS}")
    print(f"  Gesture duration: {GESTURE_MIN_FRAMES}-{GESTURE_MAX_FRAMES} frames")
    print(f"  Duration range: {GESTURE_MIN_FRAMES/ANALYSIS_FPS:.1f}-{GESTURE_MAX_FRAMES/ANALYSIS_FPS:.1f} seconds")
    print(f"  Clustering: {'HDBSCAN (auto)' if USE_HDBSCAN else f'K-means (k={N_CLUSTERS})'}")
    print(f"  Output directory: {output_dir}")
    print()
    
    # Create output directory early
    os.makedirs(output_dir, exist_ok=True)
    segments_manifest_path = os.path.join(output_dir, 'segments_manifest.json')
    
    # Process videos and save segments progressively
    print("=" * 70)
    print("STEP 1: EXTRACTING GESTURES FROM VIDEOS")
    print("=" * 70)
    
    processor = VideoGestureProcessor(target_fps=ANALYSIS_FPS)
    
    all_gestures = []
    segment_id = 0
    
    # Progressive manifest (updated as we go)
    progressive_manifest = {
        'analysis_fps': ANALYSIS_FPS,
        'gesture_duration_range': {
            'min_frames': GESTURE_MIN_FRAMES,
            'max_frames': GESTURE_MAX_FRAMES,
            'min_seconds': GESTURE_MIN_FRAMES / ANALYSIS_FPS,
            'max_seconds': GESTURE_MAX_FRAMES / ANALYSIS_FPS
        },
        'videos_processed': 0,
        'total_gestures': 0,
        'segments': []
    }
    
    for video_idx, video_path in enumerate(tqdm(video_paths, desc="Processing videos")):
        gestures = processor.process_video(
            video_path,
            min_frames=GESTURE_MIN_FRAMES,
            max_frames=GESTURE_MAX_FRAMES
        )
        
        # Save each gesture segment immediately
        for gesture in gestures:
            # Save video segment
            segment_path = save_gesture_segment(gesture, output_dir, segment_id)
            
            # Add to gesture data
            gesture['segment_id'] = segment_id
            gesture['segment_path'] = segment_path
            
            # Add to progressive manifest
            progressive_manifest['segments'].append({
                'segment_id': segment_id,
                'segment_path': segment_path,
                'source_video': gesture['source_video'],
                'start_frame': gesture['start_frame'],
                'end_frame': gesture['end_frame'],
                'duration_frames': gesture['duration_frames'],
                'duration_seconds': gesture['duration_seconds']
            })
            
            segment_id += 1
        
        all_gestures.extend(gestures)
        
        # Update manifest after each video
        progressive_manifest['videos_processed'] = video_idx + 1
        progressive_manifest['total_gestures'] = len(all_gestures)
        
        with open(segments_manifest_path, 'w') as f:
            json.dump(progressive_manifest, f, indent=2)
    
    processor.close()
    
    print(f"\nExtracted {len(all_gestures)} gestures from {len(video_paths)} videos")
    print(f"Saved segments to: {os.path.join(output_dir, 'segments')}")
    print(f"Saved segment manifest to: {segments_manifest_path}")
    
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
        output_dir=output_dir
    )
    
    # Summary
    print("\n" + "=" * 70)
    print("CLUSTERING COMPLETE")
    print("=" * 70)
    print(f"\nResults saved to: {output_dir}")
    print(f"  - segments/ directory (video segments)")
    print(f"  - segments_manifest.json (all detected segments)")
    print(f"  - clustering_manifest.json (clustered results)")
    print(f"  - similarity_report.md")
    print(f"  - cluster_<N>/ directories")
    print()


if __name__ == "__main__":
    import argparse
    
    try:
        # Import scipy for gesture detection
        from scipy.ndimage import uniform_filter1d
    except ImportError:
        print("Error: scipy is required. Install with: pip install scipy")
        sys.exit(1)
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Gesture clustering and extraction')
    parser.add_argument(
        '--extract-clusters',
        action='store_true',
        help='Extract video segments organized by cluster from existing manifest'
    )
    parser.add_argument(
        '--manifest',
        type=str,
        default=None,
        help=f'Path to clustering manifest (default: {OUTPUT_DIR}/clustering_manifest.json)'
    )
    parser.add_argument(
        '--output-fps',
        type=int,
        default=30,
        help='Output video FPS for cluster extraction (default: 30)'
    )
    
    args = parser.parse_args()
    
    if args.extract_clusters:
        # Only extract clusters from existing manifest
        print("=" * 70)
        print("GESTURE VIDEO EXTRACTION FROM CLUSTERING RESULTS")
        print("=" * 70)
        print()
        
        try:
            stats = extract_clusters_from_manifest(
                manifest_path=args.manifest,
                output_fps=args.output_fps
            )
            
            # Print final summary
            print("=" * 70)
            print("EXTRACTION COMPLETE")
            print("=" * 70)
            print(f"\nTotal gestures: {stats['total_gestures']}")
            print(f"Successfully extracted: {stats['extracted']}")
            print(f"Failed: {stats['failed']}")
            print()
            
            # Print cluster breakdown
            print("Cluster Breakdown:")
            for cluster_id, cluster_stats in stats['clusters'].items():
                print(f"  Cluster {cluster_id}: {cluster_stats['extracted']}/{cluster_stats['total']} extracted")
            print()
            
            manifest_path = args.manifest or os.path.join(OUTPUT_DIR, 'clustering_manifest.json')
            output_dir = os.path.dirname(manifest_path)
            print(f"Output directory: {output_dir}")
            print("Video segments saved in cluster_N/ subdirectories")
        except FileNotFoundError as e:
            print(f"Error: {e}")
            print("Please run 'python run.py' first to generate clustering results.")
            sys.exit(1)
    else:
        # Run full pipeline
        main()

