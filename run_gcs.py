"""
GCS-enabled wrapper for run.py gesture clustering pipeline.

This script adds Google Cloud Storage support to the gesture clustering pipeline,
allowing you to:
- Read videos from GCS buckets
- Write outputs to GCS buckets
- Process data seamlessly between local and cloud storage

Usage:
    # Process local videos, save to GCS
    python run_gcs.py --videos videos/ --output gs://my-bucket/output/
    
    # Process GCS videos, save locally
    python run_gcs.py --videos gs://my-bucket/videos/ --output output/
    
    # Full GCS workflow
    python run_gcs.py --videos gs://my-bucket/videos/ --output gs://my-bucket/results/
    
    # Extract clusters with GCS support
    python run_gcs.py --extract-clusters --manifest gs://my-bucket/output/clustering_manifest.json
"""

import os
import sys
import argparse
import shutil
from pathlib import Path
from typing import List

# Import the original run.py module
import run
import gcs_utils


def process_with_gcs(video_dir: str, output_dir: str):
    """
    Run the gesture clustering pipeline with GCS support.
    
    Args:
        video_dir: Local directory or GCS path (gs://bucket/path/)
        output_dir: Local directory or GCS path for outputs
    """
    gcs_temp_dir = None
    local_video_dir = video_dir
    local_output_dir = output_dir
    is_gcs_input = gcs_utils.is_gcs_path(video_dir)
    is_gcs_output = gcs_utils.is_gcs_path(output_dir)
    
    try:
        # Handle GCS video input
        if is_gcs_input:
            print(f"📥 Detected GCS video path: {video_dir}")
            
            # Create temp directory for downloads
            gcs_temp_dir = gcs_utils.create_temp_dir()
            local_video_dir = os.path.join(gcs_temp_dir, 'videos')
            os.makedirs(local_video_dir, exist_ok=True)
            
            # List and download videos from GCS
            print(f"📋 Listing videos in GCS...")
            from scripts import config
            video_paths = gcs_utils.list_gcs_blobs(video_dir, config.VIDEO_EXTENSIONS)
            
            if not video_paths:
                print(f"❌ No videos found in GCS path '{video_dir}'")
                return
            
            print(f"✅ Found {len(video_paths)} videos in GCS")
            print(f"⬇️  Downloading to: {local_video_dir}\n")
            
            # Download videos
            from tqdm import tqdm
            for gcs_path in tqdm(video_paths, desc="Downloading videos"):
                filename = os.path.basename(gcs_utils.parse_gcs_path(gcs_path)[1])
                local_path = os.path.join(local_video_dir, filename)
                gcs_utils.download_from_gcs(gcs_path, local_path)
            
            print()
        
        # Handle GCS output
        if is_gcs_output:
            print(f"☁️  Output will be uploaded to GCS: {output_dir}")
            if not gcs_temp_dir:
                gcs_temp_dir = gcs_utils.create_temp_dir()
            local_output_dir = os.path.join(gcs_temp_dir, 'output')
            os.makedirs(local_output_dir, exist_ok=True)
            print(f"📁 Using local temp directory: {local_output_dir}\n")
        
        # Temporarily override OUTPUT_DIR in run module
        original_output_dir = run.OUTPUT_DIR
        run.OUTPUT_DIR = local_output_dir
        
        # Temporarily change to video directory for processing
        original_cwd = os.getcwd()
        
        # Create a videos symlink or copy to expected location if needed
        if is_gcs_input:
            # Create videos directory in current location pointing to temp
            temp_videos_link = 'videos_temp'
            if os.path.exists(temp_videos_link):
                if os.path.islink(temp_videos_link):
                    os.unlink(temp_videos_link)
                else:
                    shutil.rmtree(temp_videos_link)
            
            # Copy videos to expected location
            shutil.copytree(local_video_dir, temp_videos_link)
            
            # Temporarily rename original videos if it exists
            videos_backup = None
            if os.path.exists('videos') and not os.path.islink('videos'):
                videos_backup = 'videos_original_backup'
                os.rename('videos', videos_backup)
            
            # Create symlink or rename temp to videos
            os.rename(temp_videos_link, 'videos')
            
            try:
                # Run the main pipeline
                print("=" * 70)
                print("🚀 STARTING GESTURE CLUSTERING PIPELINE")
                print("=" * 70)
                print()
                
                run.main()
                
                print()
                print("=" * 70)
                print("✅ PIPELINE COMPLETE")
                print("=" * 70)
                print()
            finally:
                # Restore original videos directory
                if os.path.exists('videos'):
                    shutil.rmtree('videos')
                if videos_backup and os.path.exists(videos_backup):
                    os.rename(videos_backup, 'videos')
        else:
            # Run the main pipeline with local videos
            print("=" * 70)
            print("🚀 STARTING GESTURE CLUSTERING PIPELINE")
            print("=" * 70)
            print()
            
            # Temporarily override the videos directory
            original_main = run.main
            
            def main_wrapper():
                # Just call original main, it looks for 'videos' directory
                return original_main()
            
            run.main = main_wrapper
            run.main()
            run.main = original_main
            
            print()
            print("=" * 70)
            print("✅ PIPELINE COMPLETE")  
            print("=" * 70)
            print()
        
        # Restore OUTPUT_DIR
        run.OUTPUT_DIR = original_output_dir
        
        # Upload results to GCS if needed
        if is_gcs_output:
            print("=" * 70)
            print(f"⬆️  UPLOADING RESULTS TO GCS")
            print("=" * 70)
            print()
            
            uploaded_files = gcs_utils.sync_to_gcs(
                local_output_dir,
                output_dir,
                extensions=['.json', '.mp4', '.md']
            )
            
            print(f"\n✅ Uploaded {len(uploaded_files)} files to {output_dir}")
            print()
        
        print("=" * 70)
        print("🎉 ALL OPERATIONS COMPLETE")
        print("=" * 70)
        print(f"\n📊 Results location: {output_dir if is_gcs_output else local_output_dir}")
        print()
        
    finally:
        # Cleanup temp directory
        if gcs_temp_dir and os.path.exists(gcs_temp_dir):
            print(f"🧹 Cleaning up temp directory: {gcs_temp_dir}")
            shutil.rmtree(gcs_temp_dir)


def extract_clusters_with_gcs(manifest_path: str, output_fps: int = 30):
    """
    Extract video clusters with GCS support.
    
    Args:
        manifest_path: Local path or GCS path to clustering_manifest.json
        output_fps: Output video FPS
    """
    gcs_temp_dir = None
    local_manifest_path = manifest_path
    is_gcs_manifest = gcs_utils.is_gcs_path(manifest_path)
    
    try:
        # Download manifest from GCS if needed
        if is_gcs_manifest:
            print(f"📥 Downloading manifest from GCS: {manifest_path}")
            gcs_temp_dir = gcs_utils.create_temp_dir()
            local_manifest_path = os.path.join(gcs_temp_dir, 'clustering_manifest.json')
            gcs_utils.download_from_gcs(manifest_path, local_manifest_path)
            print()
        
        # Run extraction
        stats = run.extract_clusters_from_manifest(
            manifest_path=local_manifest_path,
            output_fps=output_fps
        )
        
        # Upload results if manifest was from GCS
        if is_gcs_manifest:
            print("\n⬆️  Uploading extracted clusters to GCS...")
            output_dir = os.path.dirname(manifest_path)
            local_output_dir = os.path.dirname(local_manifest_path)
            
            uploaded_files = gcs_utils.sync_to_gcs(
                local_output_dir,
                output_dir,
                extensions=['.mp4', '.json']
            )
            
            print(f"✅ Uploaded {len(uploaded_files)} files to {output_dir}")
        
        return stats
        
    finally:
        # Cleanup temp directory
        if gcs_temp_dir and os.path.exists(gcs_temp_dir):
            print(f"🧹 Cleaning up temp directory: {gcs_temp_dir}")
            shutil.rmtree(gcs_temp_dir)


def main():
    """Main entry point for GCS-enabled gesture clustering."""
    parser = argparse.ArgumentParser(
        description='Gesture clustering with Google Cloud Storage support',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        '--videos',
        type=str,
        default='videos',
        help='Path to video directory or GCS path (e.g., gs://bucket/videos/)'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        default=run.OUTPUT_DIR,
        help='Output directory or GCS path (e.g., gs://bucket/output/)'
    )
    
    parser.add_argument(
        '--extract-clusters',
        action='store_true',
        help='Extract video segments organized by cluster from existing manifest'
    )
    
    parser.add_argument(
        '--manifest',
        type=str,
        default=None,
        help='Path to clustering manifest (local or GCS path)'
    )
    
    parser.add_argument(
        '--output-fps',
        type=int,
        default=30,
        help='Output video FPS for cluster extraction (default: 30)'
    )
    
    args = parser.parse_args()
    
    # Check for scipy dependency
    try:
        from scipy.ndimage import uniform_filter1d
    except ImportError:
        print("❌ Error: scipy is required. Install with: pip install scipy")
        sys.exit(1)
    
    # Check for GCS dependency if GCS paths are used
    is_using_gcs = (
        gcs_utils.is_gcs_path(args.videos) or
        gcs_utils.is_gcs_path(args.output) or
        (args.manifest and gcs_utils.is_gcs_path(args.manifest))
    )
    
    if is_using_gcs:
        try:
            gcs_utils.get_gcs_client()
        except ImportError:
            print("❌ Error: google-cloud-storage is required for GCS support.")
            print("   Install with: pip install google-cloud-storage")
            sys.exit(1)
    
    if args.extract_clusters:
        # Extract clusters mode
        manifest_path = args.manifest or os.path.join(args.output, 'clustering_manifest.json')
        
        print("=" * 70)
        print("GESTURE VIDEO EXTRACTION FROM CLUSTERING RESULTS")
        print("=" * 70)
        print()
        
        try:
            stats = extract_clusters_with_gcs(manifest_path, args.output_fps)
            
            # Print final summary
            print("=" * 70)
            print("✅ EXTRACTION COMPLETE")
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
            
        except FileNotFoundError as e:
            print(f"❌ Error: {e}")
            print("Please run clustering first to generate manifest.")
            sys.exit(1)
    else:
        # Run full pipeline
        process_with_gcs(args.videos, args.output)


if __name__ == "__main__":
    main()
