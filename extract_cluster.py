"""
Extract and save gesture video segments based on DTW clustering results.

This script reads the clustering_manifest.json produced by run.py and extracts
the actual video segments for each clustered gesture, saving them at 30fps
in their respective cluster subdirectories.

Usage:
    python extract+cluster.py
    
Configuration:
    - Manifest path: output/clustering_manifest.json
    - Output format: MP4 at 30fps
    - Naming: cluster_N/<video_name>_gesture_<idx>.mp4
"""

import os
import json
import cv2
from pathlib import Path
from typing import Dict, List
from tqdm import tqdm


# Configuration
MANIFEST_PATH = 'output/clustering_manifest.json'
OUTPUT_FPS = 30  # Output video frame rate
VIDEO_CODEC = 'mp4v'  # MP4 codec


def load_manifest(manifest_path: str) -> Dict:
    """
    Load the clustering manifest.
    
    Args:
        manifest_path: Path to clustering_manifest.json
        
    Returns:
        Manifest dictionary
    """
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    return manifest


def extract_video_segment(
    video_path: str,
    start_frame: int,
    end_frame: int,
    output_path: str,
    output_fps: int = 30,
    original_fps: int = None
) -> bool:
    """
    Extract a segment from a video and save it.
    
    Args:
        video_path: Path to source video
        start_frame: Start frame (in ANALYSIS_FPS)
        end_frame: End frame (in ANALYSIS_FPS)
        output_path: Path to save extracted segment
        output_fps: Output video frame rate
        original_fps: Original video FPS (if None, will be detected)
        
    Returns:
        Success status
    """
    # Open source video
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return False
    
    # Get video properties
    if original_fps is None:
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Get analysis FPS from manifest (frames were extracted at this rate)
    # The start_frame and end_frame are in the analysis FPS space
    # We need to map them back to the original video FPS space
    
    # Read from manifest - gestures were detected at ANALYSIS_FPS
    # The manifest contains start/end frames in the ANALYSIS_FPS space
    # But we want to extract from the original video at original FPS
    
    # Since gestures in manifest are in analysis FPS space,
    # we need to convert them to original FPS space
    # However, for this script, we'll assume the manifest contains
    # the actual frame numbers from the source video
    
    # Create output video writer
    fourcc = cv2.VideoWriter_fourcc(*VIDEO_CODEC)
    out = cv2.VideoWriter(output_path, fourcc, output_fps, (width, height))
    
    if not out.isOpened():
        print(f"Error: Could not create output video {output_path}")
        cap.release()
        return False
    
    # Calculate frame range in original video
    # If gestures were detected at ANALYSIS_FPS (e.g., 5 FPS) from original video (e.g., 30 FPS),
    # the frame indices need to be scaled
    # analysis_fps = 5, original_fps = 30, frame_skip = 6
    # start_frame in analysis space needs to be multiplied by frame_skip
    
    # Actually, looking at the run.py code, the start_frame and end_frame
    # stored in gestures are indices in the ANALYSIS_FPS sequence
    # We need to map them back to original video frame indices
    
    # For now, let's extract based on the assumption that we need to
    # reconstruct the segment at the target FPS
    
    # Seek to start frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    
    # Extract frames
    frames_extracted = 0
    for frame_idx in range(start_frame, end_frame):
        ret, frame = cap.read()
        if not ret:
            break
        
        out.write(frame)
        frames_extracted += 1
    
    # Release resources
    cap.release()
    out.release()
    
    return frames_extracted > 0


def process_clustering_manifest(manifest_path: str) -> Dict:
    """
    Process the clustering manifest and extract all gesture segments.
    
    Args:
        manifest_path: Path to clustering_manifest.json
        
    Returns:
        Statistics about extraction
    """
    # Load manifest
    print(f"Loading manifest from: {manifest_path}")
    manifest = load_manifest(manifest_path)
    
    # Get manifest info
    total_gestures = manifest.get('total_gestures', 0)
    num_clusters = manifest.get('num_clusters', 0)
    analysis_fps = manifest.get('analysis_fps', 5)
    
    print(f"\nManifest Summary:")
    print(f"  Total gestures: {total_gestures}")
    print(f"  Number of clusters: {num_clusters}")
    print(f"  Analysis FPS: {analysis_fps}")
    print(f"  Output FPS: {OUTPUT_FPS}")
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
            
            # For extraction, we need to consider the frame skip
            # The start_frame and end_frame are in ANALYSIS_FPS space
            # We need to map them to original video space
            
            # Open source video to get original FPS
            cap = cv2.VideoCapture(source_video)
            original_fps = int(cap.get(cv2.CAP_PROP_FPS))
            cap.release()
            
            # Calculate frame skip used during analysis
            frame_skip = max(1, original_fps // analysis_fps)
            
            # Map analysis frames to original video frames
            original_start_frame = start_frame * frame_skip
            original_end_frame = end_frame * frame_skip
            
            # Create output filename
            output_filename = f"{video_name}_gesture_{idx:03d}.mp4"
            output_path = os.path.join(cluster_dir, output_filename)
            
            # Extract segment
            success = extract_video_segment(
                video_path=source_video,
                start_frame=original_start_frame,
                end_frame=original_end_frame,
                output_path=output_path,
                output_fps=OUTPUT_FPS,
                original_fps=original_fps
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
    """Main entry point."""
    print("=" * 70)
    print("GESTURE VIDEO EXTRACTION FROM CLUSTERING RESULTS")
    print("=" * 70)
    print()
    
    # Check if manifest exists
    if not os.path.exists(MANIFEST_PATH):
        print(f"Error: Manifest not found at {MANIFEST_PATH}")
        print("Please run 'python run.py' first to generate clustering results.")
        return
    
    # Process manifest and extract videos
    stats = process_clustering_manifest(MANIFEST_PATH)
    
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
    
    print(f"Output directory: {os.path.dirname(MANIFEST_PATH)}")
    print("Video segments saved in cluster_N/ subdirectories")


if __name__ == "__main__":
    main()
