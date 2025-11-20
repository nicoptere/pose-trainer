"""
Fast DTW-based clustering using sampled sequences.
This script provides a faster alternative by using FastDTW approximation.
"""
import numpy as np
import json
import os
from typing import List, Dict
from tqdm import tqdm
import config
from similarity_engine import SimilarityEngine


def fast_dtw_clustering(segments_file: str, output_dir: str = 'output/clusters_dtw', 
                       sample_size: int = 30):
    """
    Perform DTW clustering on a sample of gestures for faster results.
    
    Args:
        segments_file: Path to segments manifest
        output_dir: Output directory
        sample_size: Number of gestures to sample (reduces computation)
    """
    # Load segments
    with open(segments_file, 'r') as f:
        data = json.load(f)
    
    segments = data.get('segments', data)
    segments_with_embeddings = [s for s in segments if 'embedding' in s]
    
    print(f"Total segments: {len(segments_with_embeddings)}")
    
    # Sample for faster computation if too many
    if len(segments_with_embeddings) > sample_size:
        print(f"Sampling {sample_size} segments for faster DTW computation...")
        import random
        random.seed(42)
        sampled_segments = random.sample(segments_with_embeddings, sample_size)
    else:
        sampled_segments = segments_with_embeddings
    
    print(f"Processing {len(sampled_segments)} segments with DTW")
    
    # Use DTW similarity engine
    engine = SimilarityEngine(metric='dtw')
    manifest = engine.organize_by_similarity(
        sampled_segments,
        output_dir=output_dir,
        copy_files=True
    )
    
    # Create report
    report_path = os.path.join(output_dir, 'dtw_report.md')
    engine.create_similarity_report(sampled_segments, report_path)
    
    print(f"\n✓ DTW clustering complete!")
    print(f"Results in: {output_dir}")
    print(f"Processed: {len(sampled_segments)} gestures")
    
    return manifest


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Fast DTW clustering")
    parser.add_argument('--segments', type=str, 
                       default='output/segments/segments_manifest.json',
                       help='Segments manifest file')
    parser.add_argument('--output', type=str, default='output/clusters_dtw',
                       help='Output directory')
    parser.add_argument('--sample', type=int, default=30,
                       help='Number of gestures to sample (default: 30)')
    
    args = parser.parse_args()
    
    fast_dtw_clustering(args.segments, args.output, args.sample)
