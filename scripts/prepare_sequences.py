"""
Prepare sequence data for temporal model training.
Converts frame-level pose data into temporal sequences.
"""
import pandas as pd
import numpy as np
import json
from typing import List, Tuple
import config


def create_sequences_from_csv(csv_path: str = 'data.csv',
                              sequence_length: int = None,
                              stride: int = None,
                              output_path: str = 'data_sequences.npz') -> Tuple[np.ndarray, np.ndarray]:
    """
    Create temporal sequences from frame-level CSV data.
    
    Args:
        csv_path: Path to CSV file with pose landmarks
        sequence_length: Number of frames per sequence
        stride: Number of frames to skip between sequences
        output_path: Path to save sequences
        
    Returns:
        X_sequences: Array of shape [num_sequences, sequence_length, input_size]
        y_sequences: Array of labels [num_sequences]
    """
    sequence_length = sequence_length or config.SEQUENCE_LENGTH
    stride = stride or config.STRIDE
    
    print(f"Loading data from {csv_path}...")
    df = pd.read_csv(csv_path)
    
    print(f"Loaded {len(df)} frames")
    print(f"Classes: {df['class'].unique()}")
    
    # Get unique classes and encode them
    from sklearn.preprocessing import LabelEncoder
    le = LabelEncoder()
    class_labels = le.fit_transform(df['class'].values)
    
    # Save label encoder
    label_mapping = {i: label for i, label in enumerate(le.classes_)}
    with open('sequence_labels.json', 'w') as f:
        json.dump(label_mapping, f, indent=2)
    print(f"Saved label mapping to sequence_labels.json")
    
    # Extract features (all columns except 'class')
    X = df.iloc[:, :-1].values
    
    # Group by class to maintain temporal continuity
    sequences_X = []
    sequences_y = []
    
    for class_name in df['class'].unique():
        class_df = df[df['class'] == class_name]
        class_X = class_df.iloc[:, :-1].values
        class_label = le.transform([class_name])[0]
        
        print(f"\nProcessing class '{class_name}' ({len(class_df)} frames)...")
        
        # Create sequences with sliding window
        num_sequences = (len(class_X) - sequence_length) // stride + 1
        
        for i in range(num_sequences):
            start_idx = i * stride
            end_idx = start_idx + sequence_length
            
            if end_idx <= len(class_X):
                sequence = class_X[start_idx:end_idx]
                sequences_X.append(sequence)
                sequences_y.append(class_label)
        
        print(f"  Created {num_sequences} sequences")
    
    X_sequences = np.array(sequences_X)
    y_sequences = np.array(sequences_y)
    
    print(f"\nTotal sequences created: {len(X_sequences)}")
    print(f"Sequence shape: {X_sequences.shape}")
    
    # Save sequences
    np.savez(output_path, X=X_sequences, y=y_sequences)
    print(f"Saved sequences to {output_path}")
    
    return X_sequences, y_sequences


def create_sequences_from_videos(video_dir: str = None,
                                 sequence_length: int = None,
                                 stride: int = None,
                                 output_path: str = 'video_sequences.npz'):
    """
    Create sequences directly from videos using MediaPipe.
    This is an alternative to using pre-extracted CSV data.
    
    Args:
        video_dir: Directory containing video files organized by class
        sequence_length: Number of frames per sequence
        stride: Number of frames to skip between sequences
        output_path: Path to save sequences
    """
    import os
    import cv2
    import mediapipe as mp
    
    video_dir = video_dir or config.VIDEO_DIR
    sequence_length = sequence_length or config.SEQUENCE_LENGTH
    stride = stride or config.STRIDE
    
    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        min_detection_confidence=config.POSE_CONFIDENCE,
        min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
    )
    
    from sklearn.preprocessing import LabelEncoder
    
    all_sequences = []
    all_labels = []
    class_names = []
    
    # Iterate through class folders
    for class_folder in sorted(os.listdir(video_dir)):
        class_path = os.path.join(video_dir, class_folder)
        
        if not os.path.isdir(class_path):
            continue
        
        class_names.append(class_folder)
        print(f"\nProcessing class: {class_folder}")
        
        # Process each video in the class
        for video_file in os.listdir(class_path):
            if not video_file.lower().endswith(config.VIDEO_EXTENSIONS):
                continue
            
            video_path = os.path.join(class_path, video_file)
            print(f"  Processing video: {video_file}")
            
            # Extract poses from video
            cap = cv2.VideoCapture(video_path)
            landmarks_list = []
            
            while cap.isOpened():
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
            
            # Create sequences from this video
            landmarks_array = np.array(landmarks_list)
            num_sequences = (len(landmarks_array) - sequence_length) // stride + 1
            
            for i in range(num_sequences):
                start_idx = i * stride
                end_idx = start_idx + sequence_length
                
                if end_idx <= len(landmarks_array):
                    sequence = landmarks_array[start_idx:end_idx]
                    all_sequences.append(sequence)
                    all_labels.append(class_folder)
            
            print(f"    Created {num_sequences} sequences from {len(landmarks_array)} frames")
    
    # Encode labels
    le = LabelEncoder()
    y_sequences = le.fit_transform(all_labels)
    X_sequences = np.array(all_sequences)
    
    # Save label mapping
    label_mapping = {i: label for i, label in enumerate(le.classes_)}
    with open('sequence_labels.json', 'w') as f:
        json.dump(label_mapping, f, indent=2)
    
    print(f"\nTotal sequences: {len(X_sequences)}")
    print(f"Sequence shape: {X_sequences.shape}")
    print(f"Classes: {le.classes_}")
    
    # Save sequences
    np.savez(output_path, X=X_sequences, y=y_sequences)
    print(f"Saved sequences to {output_path}")
    
    return X_sequences, y_sequences


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Prepare sequence data for temporal model")
    parser.add_argument('--source', type=str, choices=['csv', 'videos'], default='csv',
                       help='Data source (csv or videos)')
    parser.add_argument('--csv', type=str, default='data.csv',
                       help='Path to CSV file (if source=csv)')
    parser.add_argument('--videos', type=str, default=None,
                       help='Path to videos directory (if source=videos)')
    parser.add_argument('--sequence-length', type=int, default=None,
                       help='Sequence length in frames')
    parser.add_argument('--stride', type=int, default=None,
                       help='Stride between sequences')
    parser.add_argument('--output', type=str, default='data_sequences.npz',
                       help='Output file path')
    
    args = parser.parse_args()
    
    if args.source == 'csv':
        create_sequences_from_csv(
            csv_path=args.csv,
            sequence_length=args.sequence_length,
            stride=args.stride,
            output_path=args.output
        )
    else:
        create_sequences_from_videos(
            video_dir=args.videos,
            sequence_length=args.sequence_length,
            stride=args.stride,
            output_path=args.output
        )
