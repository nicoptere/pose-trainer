"""
Main pipeline for gesture detection, segmentation, and similarity sorting.
End-to-end processing of videos.
"""
import os
import json
from pathlib import Path
from typing import List, Dict
from tqdm import tqdm
import config
from gesture_detector import GestureDetector
from video_segmenter import VideoSegmenter
from similarity_engine import SimilarityEngine


class GesturePipeline:
    """
    Complete pipeline for gesture processing.
    """
    def __init__(self, 
                 model_path: str = None,
                 use_simple_detection: bool = False,
                 similarity_metric: str = 'cosine',
                 device: str = None):
        """
        Initialize the pipeline.
        
        Args:
            model_path: Path to trained temporal model
            use_simple_detection: Use activity threshold instead of model
            similarity_metric: Similarity metric for clustering
            device: Device for model inference
        """
        self.use_simple_detection = use_simple_detection
        
        device = device or str(config.DEVICE)
        
        # Initialize components
        print("Initializing gesture detector...")
        self.detector = GestureDetector(model_path=model_path, device=device)
        
        print("Initializing video segmenter...")
        self.segmenter = VideoSegmenter(output_dir=config.SEGMENTS_DIR)
        
        print("Initializing similarity engine...")
        self.similarity_engine = SimilarityEngine(metric=similarity_metric)
        
        print("Pipeline ready!\n")
    
    def find_videos(self, input_path: str) -> List[str]:
        """
        Find all video files in input path.
        
        Args:
            input_path: Path to video file or directory
            
        Returns:
            List of video file paths
        """
        video_paths = []
        
        if os.path.isfile(input_path):
            # Single video file
            if input_path.lower().endswith(config.VIDEO_EXTENSIONS):
                video_paths.append(input_path)
        elif os.path.isdir(input_path):
            # Directory: search recursively
            for root, dirs, files in os.walk(input_path):
                for file in files:
                    if file.lower().endswith(config.VIDEO_EXTENSIONS):
                        video_paths.append(os.path.join(root, file))
        
        return video_paths
    
    def process_videos(self, input_path: str, output_dir: str = None) -> Dict:
        """
        Process all videos through the complete pipeline.
        
        Args:
            input_path: Path to video file or directory
            output_dir: Output directory for results
            
        Returns:
            Results dictionary with all processing information
        """
        output_dir = output_dir or config.OUTPUT_DIR
        os.makedirs(output_dir, exist_ok=True)
        
        # Find videos
        print("Finding videos...")
        video_paths = self.find_videos(input_path)
        
        if not video_paths:
            print(f"No videos found in {input_path}")
            return {}
        
        print(f"Found {len(video_paths)} videos\n")
        
        # Step 1: Detect gestures in all videos
        print("=" * 60)
        print("STEP 1: DETECTING GESTURES")
        print("=" * 60)
        
        all_gestures = {}
        
        for video_path in tqdm(video_paths, desc="Detecting gestures"):
            try:
                gestures = self.detector.detect_gestures(
                    video_path,
                    use_model=not self.use_simple_detection
                )
                all_gestures[video_path] = gestures
            except Exception as e:
                print(f"\nError processing {video_path}: {e}")
                all_gestures[video_path] = []
        
        total_gestures = sum(len(g) for g in all_gestures.values())
        print(f"\nDetected {total_gestures} total gestures across {len(video_paths)} videos")
        
        # Step 2: Segment videos
        print("\n" + "=" * 60)
        print("STEP 2: SEGMENTING VIDEOS")
        print("=" * 60)
        
        all_segments = self.segmenter.segment_multiple_videos(
            all_gestures,
            save_manifest=True
        )
        
        print(f"\nCreated {len(all_segments)} video segments")
        
        # Step 3: Compute similarity and organize
        if all_segments and not self.use_simple_detection:
            # Filter segments with embeddings
            segments_with_embeddings = [s for s in all_segments if 'embedding' in s]
            
            if segments_with_embeddings:
                print("\n" + "=" * 60)
                print("STEP 3: COMPUTING SIMILARITY & CLUSTERING")
                print("=" * 60)
                
                clustering_manifest = self.similarity_engine.organize_by_similarity(
                    segments_with_embeddings,
                    output_dir=config.CLUSTERS_DIR,
                    copy_files=config.SAVE_SEGMENTS
                )
                
                # Create similarity report
                report_path = os.path.join(output_dir, 'similarity_report.md')
                self.similarity_engine.create_similarity_report(
                    segments_with_embeddings,
                    output_path=report_path
                )
            else:
                print("\nNo segments with embeddings found. Skipping similarity analysis.")
                clustering_manifest = None
        else:
            print("\nSkipping similarity analysis (simple detection mode or no segments)")
            clustering_manifest = None
        
        # Create final summary
        print("\n" + "=" * 60)
        print("PIPELINE COMPLETE")
        print("=" * 60)
        
        results = {
            'input_path': input_path,
            'num_videos': len(video_paths),
            'total_gestures_detected': total_gestures,
            'total_segments_created': len(all_segments),
            'detection_method': 'model' if not self.use_simple_detection else 'simple',
            'output_directory': output_dir,
            'segments_directory': config.SEGMENTS_DIR,
            'clusters_directory': config.CLUSTERS_DIR if clustering_manifest else None,
            'video_results': {}
        }
        
        for video_path, gestures in all_gestures.items():
            results['video_results'][video_path] = {
                'num_gestures': len(gestures),
                'gestures': gestures
            }
        
        # Save final manifest
        if config.SAVE_MANIFEST:
            manifest_filename = Path(config.MANIFEST_PATH).name
            manifest_path = os.path.join(output_dir, manifest_filename)
            with open(manifest_path, 'w') as f:
                # Convert numpy types to native Python for JSON serialization
                def convert_to_native(obj):
                    if hasattr(obj, 'tolist'):
                        return obj.tolist()
                    return obj
                
                results_serializable = json.loads(
                    json.dumps(results, default=convert_to_native)
                )
                json.dump(results_serializable, f, indent=2)
            
            print(f"\nSaved final manifest to {manifest_path}")
        
        # Print summary
        print(f"\nSummary:")
        print(f"  Videos processed: {len(video_paths)}")
        print(f"  Gestures detected: {total_gestures}")
        print(f"  Segments created: {len(all_segments)}")
        if clustering_manifest:
            print(f"  Clusters formed: {clustering_manifest['num_clusters']}")
        print(f"\nOutput directory: {output_dir}")
        
        return results


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Complete gesture detection, segmentation, and similarity pipeline"
    )
    parser.add_argument('--input', type=str, required=True,
                       help='Input video file or directory')
    parser.add_argument('--output', type=str, default=None,
                       help='Output directory')
    parser.add_argument('--model', type=str, default=None,
                       help='Path to trained temporal model')
    parser.add_argument('--simple', action='store_true',
                       help='Use simple activity detection instead of model')
    parser.add_argument('--metric', type=str, default='cosine',
                       choices=['cosine', 'euclidean'],
                       help='Similarity metric')
    parser.add_argument('--device', type=str, default=None,
                       help='Device for model inference (cuda or cpu)')
    
    args = parser.parse_args()
    
    # Initialize pipeline
    pipeline = GesturePipeline(
        model_path=args.model,
        use_simple_detection=args.simple,
        similarity_metric=args.metric,
        device=args.device
    )
    
    # Run pipeline
    results = pipeline.process_videos(
        input_path=args.input,
        output_dir=args.output
    )
    
    print("\n✓ Pipeline completed successfully!")


if __name__ == "__main__":
    main()
