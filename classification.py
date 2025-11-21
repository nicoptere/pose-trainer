"""
Train a gesture classifier from DTW clustering results.

This script trains an ONNX classifier on the clustered gestures produced by run.py.
Each cluster becomes a class label for supervised learning.

Usage:
    # Train classifier
    python classification.py
    
    # Extract animations for web app
    python classification.py --extract-animations
    
    Or customize:
    python classification.py --manifest output/clustering_manifest.json \
                       --output models/gesture_classifier.onnx
"""

import os
import sys
import json
import numpy as np
import cv2
import mediapipe as mp
from pathlib import Path
from typing import List, Tuple
from tqdm import tqdm

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

import config
from gesture_detector import TemporalPoseModel


# ============================================================================
# CONFIGURABLE PARAMETERS
# ============================================================================

MANIFEST_PATH = 'output/clustering_manifest.json'
OUTPUT_MODEL_PATH = 'models/gesture_classifier.onnx'

# Training configuration
BATCH_SIZE = 16
LEARNING_RATE = 0.001
EPOCHS = 50
TRAIN_TEST_SPLIT = 0.2

# ============================================================================


class GestureDataset(Dataset):
    """Dataset for gesture sequences with cluster labels."""
    
    def __init__(self, sequences: List[np.ndarray], labels: List[int], sequence_length: int = 30):
        """
        Initialize dataset.
        
        Args:
            sequences: List of pose sequences
            labels: List of cluster labels
            sequence_length: Target sequence length (pad or truncate)
        """
        self.sequences = sequences
        self.labels = labels
        self.sequence_length = sequence_length
    
    def __len__(self):
        return len(self.sequences)
    
    def __getitem__(self, idx):
        sequence = self.sequences[idx]
        label = self.labels[idx]
        
        # Pad or truncate to target length
        seq_len = len(sequence)
        if seq_len < self.sequence_length:
            # Pad with zeros
            padding = np.zeros((self.sequence_length - seq_len, sequence.shape[1]))
            sequence = np.vstack([sequence, padding])
        elif seq_len > self.sequence_length:
            # Truncate
            sequence = sequence[:self.sequence_length]
        
        return torch.FloatTensor(sequence), torch.LongTensor([label])[0]


def load_gesture_sequence(
    video_path: str,
    start_frame: int,
    end_frame: int,
    analysis_fps: int
) -> np.ndarray:
    """
    Load a gesture sequence from video.
    
    Args:
        video_path: Path to source video
        start_frame: Start frame in analysis FPS space
        end_frame: End frame in analysis FPS space
        analysis_fps: FPS used during analysis
        
    Returns:
        Pose sequence array [num_frames, 132]
    """
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
    
    if not landmarks_list:
        return np.zeros((1, config.INPUT_SIZE))
    
    return np.array(landmarks_list)


def load_training_data(manifest_path: str) -> Tuple[List[np.ndarray], List[int]]:
    """
    Load training data from clustering manifest.
    
    Args:
        manifest_path: Path to clustering_manifest.json
        
    Returns:
        Tuple of (sequences, labels)
    """
    # Load manifest
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    analysis_fps = manifest.get('analysis_fps', 5)
    
    sequences = []
    labels = []
    
    print("Loading gesture sequences from videos...")
    
    for cluster_id, cluster_data in manifest['clusters'].items():
        gestures = cluster_data['gestures']
        
        print(f"Loading Cluster {cluster_id}: {len(gestures)} gestures")
        
        for gesture_info in tqdm(gestures, desc=f"  Cluster {cluster_id}"):
            # Load gesture sequence
            sequence = load_gesture_sequence(
                video_path=gesture_info['source_video'],
                start_frame=gesture_info['start_frame'],
                end_frame=gesture_info['end_frame'],
                analysis_fps=analysis_fps
            )
            
            sequences.append(sequence)
            labels.append(int(cluster_id))
    
    return sequences, labels


def train_classifier(manifest_path: str, output_model_path: str):
    """
    Train a gesture classifier from clustered data.
    
    Args:
        manifest_path: Path to clustering_manifest.json
        output_model_path: Path to save trained ONNX model
    """
    print("=" * 70)
    print("GESTURE CLASSIFIER TRAINING")
    print("=" * 70)
    print()
    
    # Load manifest
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    num_classes = manifest['num_clusters']
    
    print(f"Configuration:")
    print(f"  Number of classes: {num_classes}")
    print(f"  Batch size: {BATCH_SIZE}")
    print(f"  Learning rate: {LEARNING_RATE}")
    print(f"  Epochs: {EPOCHS}")
    print()
    
    # Load training data
    sequences, labels = load_training_data(manifest_path)
    
    print(f"\nLoaded {len(sequences)} training samples")
    
    # Split train/test
    from sklearn.model_selection import train_test_split
    
    # Check if we can stratify (need at least test_size samples per class)
    min_samples_per_class = min([labels.count(i) for i in set(labels)])
    test_samples = int(len(sequences) * TRAIN_TEST_SPLIT)
    can_stratify = test_samples >= num_classes and min_samples_per_class >= 2
    
    if not can_stratify:
        print(f"\n⚠️  WARNING: Too many classes ({num_classes}) for {len(sequences)} samples")
        print(f"   Cannot use stratified split (need at least {num_classes} test samples)")
        print(f"   Using simple random split instead")
        print(f"   Consider reducing min_cluster_size in HDBSCAN or collecting more data\n")
        
        train_seqs, test_seqs, train_labels, test_labels = train_test_split(
            sequences, labels, test_size=TRAIN_TEST_SPLIT, random_state=42
        )
    else:
        train_seqs, test_seqs, train_labels, test_labels = train_test_split(
            sequences, labels, test_size=TRAIN_TEST_SPLIT, random_state=42, stratify=labels
        )
    
    print(f"Train samples: {len(train_seqs)}")
    print(f"Test samples: {len(test_seqs)}")
    print()
    
    # Create datasets
    train_dataset = GestureDataset(train_seqs, train_labels, sequence_length=config.SEQUENCE_LENGTH)
    test_dataset = GestureDataset(test_seqs, test_labels, sequence_length=config.SEQUENCE_LENGTH)
    
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False)
    
    # Create model
    print("Initializing model...")
    model = TemporalPoseModel(
        input_size=config.INPUT_SIZE,
        hidden_size=config.HIDDEN_SIZE,
        num_classes=num_classes,
        num_layers=config.NUM_LAYERS,
        embedding_size=config.EMBEDDING_SIZE
    )
    
    device = config.DEVICE
    model = model.to(device)
    
    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # Training loop
    print("\nTraining...")
    best_acc = 0.0
    
    for epoch in range(EPOCHS):
        # Train
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        
        for sequences_batch, labels_batch in train_loader:
            sequences_batch = sequences_batch.to(device)
            labels_batch = labels_batch.to(device)
            
            optimizer.zero_grad()
            
            # Forward pass
            presence, classification, _ = model(sequences_batch, return_embedding=True)
            
            # Loss (only classification for now)
            loss = criterion(classification, labels_batch)
            
            # Backward pass
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item()
            
            # Accuracy
            _, predicted = torch.max(classification, 1)
            train_total += labels_batch.size(0)
            train_correct += (predicted == labels_batch).sum().item()
        
        train_acc = 100 * train_correct / train_total
        
        # Test
        model.eval()
        test_loss = 0.0
        test_correct = 0
        test_total = 0
        
        with torch.no_grad():
            for sequences_batch, labels_batch in test_loader:
                sequences_batch = sequences_batch.to(device)
                labels_batch = labels_batch.to(device)
                
                presence, classification, _ = model(sequences_batch, return_embedding=True)
                loss = criterion(classification, labels_batch)
                
                test_loss += loss.item()
                
                _, predicted = torch.max(classification, 1)
                test_total += labels_batch.size(0)
                test_correct += (predicted == labels_batch).sum().item()
        
        test_acc = 100 * test_correct / test_total
        
        print(f"Epoch [{epoch+1}/{EPOCHS}] "
              f"Train Loss: {train_loss/len(train_loader):.4f} "
              f"Train Acc: {train_acc:.2f}% "
              f"Test Loss: {test_loss/len(test_loader):.4f} "
              f"Test Acc: {test_acc:.2f}%")
        
        # Save best model
        if test_acc > best_acc:
            best_acc = test_acc
            torch.save(model.state_dict(), output_model_path.replace('.onnx', '.pth'))
    
    print(f"\nBest test accuracy: {best_acc:.2f}%")
    
    # Load best model
    model.load_state_dict(torch.load(output_model_path.replace('.onnx', '.pth')))
    model.eval()
    
    # Export to ONNX
    print("\nExporting to ONNX...")
    
    # Create a wrapper that always returns embeddings
    class ModelWrapper(nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model
        
        def forward(self, x):
            return self.model(x, return_embedding=True)
    
    wrapped_model = ModelWrapper(model)
    wrapped_model.eval()
    
    dummy_input = torch.randn(1, config.SEQUENCE_LENGTH, config.INPUT_SIZE).to(device)
    
    os.makedirs(os.path.dirname(output_model_path), exist_ok=True)
    
    torch.onnx.export(
        wrapped_model,
        dummy_input,
        output_model_path,
        input_names=['input'],
        output_names=['presence', 'classification', 'embedding'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'presence': {0: 'batch_size'},
            'classification': {0: 'batch_size'},
            'embedding': {0: 'batch_size'}
        },
        opset_version=11
    )
    
    print(f"Model saved to: {output_model_path}")
    
    # Save class labels
    labels_path = output_model_path.replace('.onnx', '_labels.json')
    with open(labels_path, 'w') as f:
        json.dump({
            'num_classes': num_classes,
            'class_names': [f'gesture_{i}' for i in range(num_classes)]
        }, f, indent=2)
    
    print(f"Labels saved to: {labels_path}")
    
    print("\n" + "=" * 70)
    print("TRAINING COMPLETE")
    print("=" * 70)
    
    # ========================================================================
    # DEPLOYMENT WORKFLOW
    # ========================================================================
    print("\n" + "=" * 70)
    print("DEPLOYING MODEL TO PUBLIC FOLDER")
    print("=" * 70)
    
    import shutil
    import zipfile
    
    # 1. Copy ONNX model to public folder
    public_dir = 'public'
    os.makedirs(public_dir, exist_ok=True)
    
    public_model_path = os.path.join(public_dir, 'gesture_classifier.onnx')
    shutil.copy2(output_model_path, public_model_path)
    print(f"✅ Copied model to: {public_model_path}")
    
    # 2. Create public.zip for easy download
    zip_path = 'public.zip'
    print(f"\n📦 Creating {zip_path}...")
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(public_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, start=os.path.dirname(public_dir))
                zipf.write(file_path, arcname)
                print(f"  Added: {arcname}")
    
    print(f"✅ Created {zip_path} ({os.path.getsize(zip_path) / 1024:.1f} KB)")
    
    # 3. Copy public folder to output directory
    manifest_dir = os.path.dirname(manifest_path)
    output_public_dir = os.path.join(manifest_dir, 'public')
    
    if os.path.exists(output_public_dir):
        shutil.rmtree(output_public_dir)
    
    shutil.copytree(public_dir, output_public_dir)
    print(f"✅ Copied public folder to: {output_public_dir}")
    
    #  Print summary
    print("\n" + "=" * 70)
    print("DEPLOYMENT COMPLETE")
    print("=" * 70)
    print(f"\n📍 Model Locations:")
    print(f"  Training output: {output_model_path}")
    print(f"  Public folder: {public_model_path}")
    print(f"  Output archive: {output_public_dir}")
    print(f"\n📦 Download Package:")
    print(f"  {zip_path} - Ready for deployment")
    print()


def extract_cluster_animations(
    manifest_path: str = MANIFEST_PATH,
    output_path: str = 'public/cluster_animations.json'
) -> None:
    """
    Extract representative gesture sequences for each cluster to use as animations.
    
    Args:
        manifest_path: Path to clustering_manifest.json
        output_path: Path to save animations JSON
    """
    print("=" * 70)
    print("EXTRACTING CLUSTER ANIMATIONS")
    print("=" * 70)
    print()
    
    # Load manifest
    if not os.path.exists(manifest_path):
        print(f"Error: Manifest not found at {manifest_path}")
        print("Please run 'python run.py' first to generate clustering results.")
        return
    
    with open(manifest_path, 'r') as f:
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
    print(f"\nSaving animations to {output_path}")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    output_data = {
        'num_clusters': num_clusters,
        'analysis_fps': analysis_fps,
        'animations': animations
    }
    
    with open(output_path, 'w') as f:
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


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Train gesture classifier from clustering results")
    parser.add_argument('--manifest', type=str, default=MANIFEST_PATH,
                       help='Path to clustering_manifest.json')
    parser.add_argument('--output', type=str, default=OUTPUT_MODEL_PATH,
                       help='Path to save ONNX model')
    parser.add_argument('--extract-animations', action='store_true',
                       help='Extract cluster animations for web app instead of training')
    parser.add_argument('--animations-output', type=str, default='public/cluster_animations.json',
                       help='Path to save animations JSON')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.manifest):
        print(f"Error: Manifest not found at {args.manifest}")
        print("Please run 'python run.py' first to generate clustering results.")
        return
    
    if args.extract_animations:
        # Extract animations mode
        extract_cluster_animations(args.manifest, args.animations_output)
    else:
        # Training mode
        train_classifier(args.manifest, args.output)


if __name__ == "__main__":
    main()
