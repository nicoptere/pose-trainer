"""
GCS-enabled wrapper for classification.py

This script adds Google Cloud Storage support to the gesture classifier training and animation extraction,
allowing you to read manifests and videos from GCS and save models/animations to GCS.

Usage:
    # Train classifier with GCS manifest
    python classification_gcs.py --manifest gs://my-bucket/output/clustering_manifest.json --output gs://my-bucket/models/
    
    # Extract animations to GCS
    python classification_gcs.py --extract-animations --manifest gs://my-bucket/output/clustering_manifest.json --animations-output gs://my-bucket/public/
"""

import os
import sys
import argparse
import shutil
from pathlib import Path

# Import the original classification module
import classification
import gcs_utils


def train_with_gcs(manifest_path: str, output_path: str):
    """
    Train classifier with GCS support.
    
    Args:
        manifest_path: Local or GCS path to clustering_manifest.json
        output_path: Local or GCS path for model output
    """
    gcs_temp_dir = None
    local_manifest_path = manifest_path
    local_output_path = output_path
    is_gcs_manifest = gcs_utils.is_gcs_path(manifest_path)
    is_gcs_output = gcs_utils.is_gcs_path(output_path)
    
    try:
        # Download manifest from GCS if needed
        if is_gcs_manifest:
            print(f"📥 Downloading manifest from GCS: {manifest_path}")
            gcs_temp_dir = gcs_utils.create_temp_dir()
            local_manifest_path = os.path.join(gcs_temp_dir, 'clustering_manifest.json')
            gcs_utils.download_from_gcs(manifest_path, local_manifest_path)
            print()
        
        # Setup local output path if outputting to GCS
        if is_gcs_output:
            if not gcs_temp_dir:
                gcs_temp_dir = gcs_utils.create_temp_dir()
            local_output_path = os.path.join(gcs_temp_dir, os.path.basename(output_path))
        
        # Train classifier
        print("🚀 Training classifier...\n")
        classification.train_classifier(local_manifest_path, local_output_path)
        
        # Upload model to GCS if needed
        if is_gcs_output:
            print(f"\n⬆️  Uploading model to GCS: {output_path}")
            gcs_utils.upload_to_gcs(local_output_path, output_path)
            print(f"✅ Model uploaded successfully\n")
        
        print("🎉 Training complete!")
        print(f"📊 Model saved to: {output_path if is_gcs_output else local_output_path}")
        
    finally:
        # Cleanup temp directory
        if gcs_temp_dir and os.path.exists(gcs_temp_dir):
            print(f"🧹 Cleaning up temp directory: {gcs_temp_dir}")
            shutil.rmtree(gcs_temp_dir)


def extract_animations_with_gcs(manifest_path: str, output_path: str):
    """
    Extract animations with GCS support.
    
    Args:
        manifest_path: Local or GCS path to clustering_manifest.json
        output_path: Local or GCS path for animations JSON
    """
    gcs_temp_dir = None
    local_manifest_path = manifest_path
    local_output_path = output_path
    is_gcs_manifest = gcs_utils.is_gcs_path(manifest_path)
    is_gcs_output = gcs_utils.is_gcs_path(output_path)
    
    try:
        # Download manifest from GCS if needed
        if is_gcs_manifest:
            print(f"📥 Downloading manifest from GCS: {manifest_path}")
            gcs_temp_dir = gcs_utils.create_temp_dir()
            local_manifest_path = os.path.join(gcs_temp_dir, 'clustering_manifest.json')
            gcs_utils.download_from_gcs(manifest_path, local_manifest_path)
            print()
        
        # Setup local output path if outputting to GCS
        if is_gcs_output:
            if not gcs_temp_dir:
                gcs_temp_dir = gcs_utils.create_temp_dir()
            local_output_path = os.path.join(gcs_temp_dir, os.path.basename(output_path))
        
        # Extract animations
        print("🎬 Extracting animations...\n")
        classification.extract_cluster_animations(local_manifest_path, local_output_path)
        
        # Upload animations to GCS if needed
        if is_gcs_output:
            print(f"\n⬆️  Uploading animations to GCS: {output_path}")
            gcs_utils.upload_to_gcs(local_output_path, output_path)
            print(f"✅ Animations uploaded successfully\n")
        
        print("🎉 Animation extraction complete!")
        print(f"📊 Animations saved to: {output_path if is_gcs_output else local_output_path}")
        
    finally:
        # Cleanup temp directory
        if gcs_temp_dir and os.path.exists(gcs_temp_dir):
            print(f"🧹 Cleaning up temp directory: {gcs_temp_dir}")
            shutil.rmtree(gcs_temp_dir)


def main():
    """Main entry point for GCS-enabled classification."""
    parser = argparse.ArgumentParser(
        description='Gesture classifier training with Google Cloud Storage support',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        '--manifest',
        type=str,
        default=classification.MANIFEST_PATH,
        help='Path to clustering manifest (local or GCS path)'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        default=classification.OUTPUT_MODEL_PATH,
        help='Path to save ONNX model (local or GCS path)'
    )
    
    parser.add_argument(
        '--extract-animations',
        action='store_true',
        help='Extract cluster animations for web app instead of training'
    )
    
    parser.add_argument(
        '--animations-output',
        type=str,
        default='public/cluster_animations.json',
        help='Path to save animations JSON (local or GCS path)'
    )
    
    args = parser.parse_args()
    
    # Check for GCS dependency if GCS paths are used
    is_using_gcs = (
        gcs_utils.is_gcs_path(args.manifest) or
        gcs_utils.is_gcs_path(args.output) or
        (args.extract_animations and gcs_utils.is_gcs_path(args.animations_output))
    )
    
    if is_using_gcs:
        try:
            gcs_utils.get_gcs_client()
        except ImportError:
            print("❌ Error: google-cloud-storage is required for GCS support.")
            print("   Install with: pip install google-cloud-storage")
            sys.exit(1)
    
    if args.extract_animations:
        # Extract animations mode
        extract_animations_with_gcs(args.manifest, args.animations_output)
    else:
        # Training mode
        train_with_gcs(args.manifest, args.output)


if __name__ == "__main__":
    main()
