"""
Video segmentation module.
Cuts videos into individual gesture clips based on detected boundaries.
"""
import cv2
import os
import json
from typing import List, Dict
from pathlib import Path
import config


class VideoSegmenter:
    """
    Cuts videos into segments based on gesture detections.
    """
    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir or config.SEGMENTS_DIR
        os.makedirs(self.output_dir, exist_ok=True)
        
    def segment_video(self, video_path: str, gestures: List[Dict], 
                     save_metadata: bool = True) -> List[Dict]:
        """
        Cut video into segments based on detected gestures.
        
        Args:
            video_path: Path to source video
            gestures: List of gesture detections with start/end frames
            save_metadata: Whether to save metadata JSON for each segment
            
        Returns:
            List of segment information with paths
        """
        if not gestures:
            print(f"No gestures to segment from {video_path}")
            return []
        
        cap = cv2.VideoCapture(video_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        video_name = Path(video_path).stem
        segments = []
        
        print(f"Segmenting {video_path}...")
        
        for idx, gesture in enumerate(gestures):
            start_frame = gesture['start_frame']
            end_frame = gesture['end_frame']
            
            # Create output filename
            segment_name = f"{video_name}_segment_{idx:03d}.mp4"
            segment_path = os.path.join(self.output_dir, segment_name)
            
            # Set up video writer
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(segment_path, fourcc, fps, (width, height))
            
            # Seek to start frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            
            # Write frames
            for frame_idx in range(start_frame, end_frame):
                ret, frame = cap.read()
                if not ret:
                    break
                out.write(frame)
            
            out.release()
            
            # Create segment info
            segment_info = {
                'segment_id': idx,
                'segment_path': segment_path,
                'source_video': video_path,
                'start_frame': start_frame,
                'end_frame': end_frame,
                'duration_frames': end_frame - start_frame,
                'duration_seconds': (end_frame - start_frame) / fps,
                'fps': fps,
                'confidence': gesture.get('confidence', 1.0),
                'method': gesture.get('method', 'unknown')
            }
            
            # Add class info if available
            if 'class' in gesture:
                segment_info['predicted_class'] = int(gesture['class'])
                segment_info['class_confidence'] = float(gesture['class_confidence'])
            
            # Add embedding if available
            if 'embedding' in gesture:
                segment_info['embedding'] = gesture['embedding'].tolist()
            
            segments.append(segment_info)
            
            # Save metadata
            if save_metadata:
                metadata_path = segment_path.replace('.mp4', '_metadata.json')
                with open(metadata_path, 'w') as f:
                    json.dump(segment_info, f, indent=2)
            
            print(f"  Created segment {idx+1}/{len(gestures)}: {segment_name}")
        
        cap.release()
        
        return segments
    
    def segment_multiple_videos(self, video_gestures: Dict[str, List[Dict]],
                                save_manifest: bool = True) -> List[Dict]:
        """
        Segment multiple videos.
        
        Args:
            video_gestures: Dict mapping video_path -> list of gestures
            save_manifest: Whether to save a combined manifest
            
        Returns:
            List of all segments from all videos
        """
        all_segments = []
        
        for video_path, gestures in video_gestures.items():
            segments = self.segment_video(video_path, gestures)
            all_segments.extend(segments)
        
        if save_manifest:
            manifest_path = os.path.join(self.output_dir, 'segments_manifest.json')
            with open(manifest_path, 'w') as f:
                json.dump({
                    'total_segments': len(all_segments),
                    'segments': all_segments
                }, f, indent=2)
            print(f"\nSaved manifest to {manifest_path}")
        
        return all_segments
    
    def extract_frames_as_images(self, video_path: str, gestures: List[Dict],
                                 save_dir: str = None) -> List[Dict]:
        """
        Extract key frames from gestures as images (useful for visualization).
        
        Args:
            video_path: Path to source video
            gestures: List of gesture detections
            save_dir: Directory to save images (default: output/frames/)
            
        Returns:
            List of frame information
        """
        save_dir = save_dir or os.path.join(config.OUTPUT_DIR, 'frames')
        os.makedirs(save_dir, exist_ok=True)
        
        cap = cv2.VideoCapture(video_path)
        video_name = Path(video_path).stem
        
        frames_info = []
        
        for idx, gesture in enumerate(gestures):
            # Extract middle frame as representative frame
            mid_frame = (gesture['start_frame'] + gesture['end_frame']) // 2
            
            cap.set(cv2.CAP_PROP_POS_FRAMES, mid_frame)
            ret, frame = cap.read()
            
            if ret:
                frame_name = f"{video_name}_gesture_{idx:03d}_frame_{mid_frame:05d}.jpg"
                frame_path = os.path.join(save_dir, frame_name)
                cv2.imwrite(frame_path, frame)
                
                frames_info.append({
                    'gesture_id': idx,
                    'frame_number': mid_frame,
                    'frame_path': frame_path,
                    'source_video': video_path
                })
        
        cap.release()
        
        return frames_info


def segment_from_manifest(manifest_path: str, output_dir: str = None):
    """
    Segment videos based on a pre-computed gesture manifest.
    
    Args:
        manifest_path: Path to JSON file with video_path -> gestures mapping
        output_dir: Output directory for segments
    """
    with open(manifest_path, 'r') as f:
        data = json.load(f)
    
    segmenter = VideoSegmenter(output_dir=output_dir)
    
    # Handle different manifest formats
    if 'videos' in data:
        video_gestures = data['videos']
    else:
        video_gestures = data
    
    segments = segmenter.segment_multiple_videos(video_gestures)
    
    print(f"\nSegmentation complete!")
    print(f"Total segments created: {len(segments)}")
    
    return segments


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Segment videos based on gestures")
    parser.add_argument('--input', type=str, required=True, 
                       help='Input video file or manifest JSON')
    parser.add_argument('--gestures', type=str, default=None,
                       help='Path to gestures JSON (if input is video)')
    parser.add_argument('--output', type=str, default=None,
                       help='Output directory for segments')
    
    args = parser.parse_args()
    
    segmenter = VideoSegmenter(output_dir=args.output)
    
    # Check if input is manifest or video
    if args.input.endswith('.json'):
        # Manifest mode
        segments = segment_from_manifest(args.input, args.output)
    else:
        # Video mode - need gestures file
        if not args.gestures:
            print("Error: --gestures required when input is a video file")
            exit(1)
        
        with open(args.gestures, 'r') as f:
            gestures = json.load(f)
        
        segments = segmenter.segment_video(args.input, gestures)
    
    print(f"\nCreated {len(segments)} video segments")
