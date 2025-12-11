"""
Temporal gesture detection using LSTM-based model.
Detects gesture boundaries in video sequences and extracts embeddings.
"""
import torch
import torch.nn as nn
import cv2
import mediapipe as mp
import numpy as np
from typing import List, Tuple, Dict, Optional
import config


class TemporalPoseModel(nn.Module):
    """
    LSTM-based temporal model for gesture detection.
    Processes sequences of pose landmarks and outputs:
    - Gesture presence probability
    - Gesture class (if present)
    - Embedding vector for similarity comparison
    """
    def __init__(self, input_size, hidden_size, num_classes, num_layers=2, embedding_size=64):
        super(TemporalPoseModel, self).__init__()
        
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        # LSTM layers
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.3 if num_layers > 1 else 0
        )
        
        # Gesture presence detection head
        self.presence_head = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )
        
        # Gesture classification head
        self.classification_head = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, num_classes)
        )
        
        # Embedding head (for similarity comparison)
        self.embedding_head = nn.Sequential(
            nn.Linear(hidden_size, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, embedding_size),
            nn.Tanh()  # Normalize embeddings
        )
        
    def forward(self, x, return_embedding=False):
        """
        Forward pass through the model.
        
        Args:
            x: Input tensor [batch_size, sequence_length, input_size]
            return_embedding: If True, return embedding vector
            
        Returns:
            presence: Gesture presence probability [batch_size, 1]
            classification: Gesture class logits [batch_size, num_classes]
            embedding: Embedding vector [batch_size, embedding_size] (if requested)
        """
        # LSTM forward pass
        lstm_out, (hidden, cell) = self.lstm(x)
        
        # Use the last hidden state
        last_hidden = lstm_out[:, -1, :]
        
        # Gesture presence
        presence = self.presence_head(last_hidden)
        
        # Gesture classification
        classification = self.classification_head(last_hidden)
        
        if return_embedding:
            # Embedding for similarity
            embedding = self.embedding_head(last_hidden)
            return presence, classification, embedding
        
        return presence, classification


class GestureDetector:
    """
    Detects gesture boundaries in videos using sliding window approach.
    """
    def __init__(self, model_path: Optional[str] = None, device: str = 'cpu'):
        self.device = torch.device(device)
        
        # Initialize MediaPipe Pose
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            min_detection_confidence=config.POSE_CONFIDENCE,
            min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
        )
        
        # Initialize temporal model
        self.model = None
        if model_path and torch.cuda.is_available():
            self.load_model(model_path)
            
    def load_model(self, model_path: str):
        """Load trained temporal model."""
        checkpoint = torch.load(model_path, map_location=self.device)
        
        self.model = TemporalPoseModel(
            input_size=config.INPUT_SIZE,
            hidden_size=config.HIDDEN_SIZE,
            num_classes=checkpoint.get('num_classes', 2),
            num_layers=config.NUM_LAYERS,
            embedding_size=config.EMBEDDING_SIZE
        ).to(self.device)
        
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()
        
    def extract_pose_sequence(self, video_path: str) -> Tuple[np.ndarray, int]:
        """
        Extract pose landmarks from entire video.
        
        Args:
            video_path: Path to video file
            
        Returns:
            landmarks_sequence: Array of shape [num_frames, input_size]
            fps: Video frame rate
        """
        cap = cv2.VideoCapture(video_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        
        landmarks_sequence = []
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            # Convert BGR to RGB
            image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image.flags.writeable = False
            
            # Process pose
            results = self.pose.process(image)
            
            if results.pose_landmarks:
                # Extract landmarks
                landmarks = results.pose_landmarks.landmark
                row = []
                for lm in landmarks:
                    row.extend([lm.x, lm.y, lm.z, lm.visibility])
                landmarks_sequence.append(row)
            else:
                # If no pose detected, use zeros
                landmarks_sequence.append([0.0] * config.INPUT_SIZE)
                
        cap.release()
        
        return np.array(landmarks_sequence), fps
    
    def detect_gestures_simple(self, landmarks_sequence: np.ndarray, 
                               fps: int) -> List[Dict]:
        """
        Simple gesture detection using activity threshold.
        Detects regions with significant movement.
        
        Args:
            landmarks_sequence: Array of pose landmarks [num_frames, input_size]
            fps: Video frame rate
            
        Returns:
            List of detected gestures with start/end frames
        """
        # Compute frame-to-frame movement
        movement = np.sqrt(np.sum(np.diff(landmarks_sequence, axis=0)**2, axis=1))
        
        # Smooth movement signal
        window_size = 5
        movement_smooth = np.convolve(movement, np.ones(window_size)/window_size, mode='same')
        
        # Detect activity regions
        is_active = movement_smooth > config.ACTIVITY_THRESHOLD
        
        gestures = []
        start_frame = None
        
        for i, active in enumerate(is_active):
            if active and start_frame is None:
                start_frame = i
            elif not active and start_frame is not None:
                end_frame = i
                duration = end_frame - start_frame
                
                # Filter by duration
                if config.MIN_GESTURE_LENGTH <= duration <= config.MAX_GESTURE_LENGTH:
                    gestures.append({
                        'start_frame': start_frame,
                        'end_frame': end_frame,
                        'duration_frames': duration,
                        'duration_seconds': duration / fps,
                        'confidence': 1.0,
                        'method': 'activity_threshold'
                    })
                
                start_frame = None
        
        return gestures
    
    def detect_gestures_model(self, landmarks_sequence: np.ndarray, 
                             fps: int) -> List[Dict]:
        """
        Model-based gesture detection using temporal LSTM.
        Uses sliding window to detect gesture boundaries.
        
        Args:
            landmarks_sequence: Array of pose landmarks [num_frames, input_size]
            fps: Video frame rate
            
        Returns:
            List of detected gestures with embeddings
        """
        if self.model is None:
            raise ValueError("Model not loaded. Use load_model() first.")
        
        num_frames = len(landmarks_sequence)
        gestures = []
        
        # Sliding window detection
        for start_idx in range(0, num_frames - config.SEQUENCE_LENGTH, config.STRIDE):
            end_idx = start_idx + config.SEQUENCE_LENGTH
            
            # Extract sequence
            sequence = landmarks_sequence[start_idx:end_idx]
            
            # Convert to tensor
            sequence_tensor = torch.FloatTensor(sequence).unsqueeze(0).to(self.device)
            
            # Model inference
            with torch.no_grad():
                presence, classification, embedding = self.model(
                    sequence_tensor, 
                    return_embedding=True
                )
                
            presence_prob = presence.item()
            class_logits = classification.squeeze().cpu().numpy()
            embedding_vec = embedding.squeeze().cpu().numpy()
            
            # Check if gesture is present
            if presence_prob > config.CONFIDENCE_THRESHOLD:
                predicted_class = np.argmax(class_logits)
                class_confidence = torch.softmax(classification, dim=1).max().item()
                
                gestures.append({
                    'start_frame': start_idx,
                    'end_frame': end_idx,
                    'duration_frames': config.SEQUENCE_LENGTH,
                    'duration_seconds': config.SEQUENCE_LENGTH / fps,
                    'confidence': presence_prob,
                    'class': int(predicted_class),
                    'class_confidence': class_confidence,
                    'embedding': embedding_vec,
                    'method': 'temporal_model'
                })
        
        # Merge overlapping detections
        gestures = self._merge_overlapping_gestures(gestures)
        
        return gestures
    
    def _merge_overlapping_gestures(self, gestures: List[Dict]) -> List[Dict]:
        """
        Merge overlapping gesture detections.
        Keeps the detection with highest confidence.
        """
        if not gestures:
            return []
        
        # Sort by start frame
        gestures = sorted(gestures, key=lambda x: x['start_frame'])
        
        merged = []
        current = gestures[0]
        
        for next_gesture in gestures[1:]:
            # Check for overlap
            if next_gesture['start_frame'] <= current['end_frame']:
                # Merge: keep higher confidence
                if next_gesture['confidence'] > current['confidence']:
                    current['end_frame'] = max(current['end_frame'], next_gesture['end_frame'])
                    current['confidence'] = next_gesture['confidence']
                    if 'embedding' in next_gesture:
                        current['embedding'] = next_gesture['embedding']
                        current['class'] = next_gesture['class']
                        current['class_confidence'] = next_gesture['class_confidence']
            else:
                # No overlap: save current and move to next
                merged.append(current)
                current = next_gesture
        
        merged.append(current)
        
        return merged
    
    def detect_gestures(self, video_path: str, 
                       use_model: bool = True) -> List[Dict]:
        """
        Detect all gestures in a video.
        
        Args:
            video_path: Path to video file
            use_model: If True, use temporal model; else use activity threshold
            
        Returns:
            List of detected gestures
        """
        print(f"Extracting poses from {video_path}...")
        landmarks_sequence, fps = self.extract_pose_sequence(video_path)
        
        print(f"Detected {len(landmarks_sequence)} frames at {fps} FPS")
        
        if use_model and self.model is not None:
            print("Detecting gestures using temporal model...")
            gestures = self.detect_gestures_model(landmarks_sequence, fps)
        else:
            print("Detecting gestures using activity threshold...")
            gestures = self.detect_gestures_simple(landmarks_sequence, fps)
        
        print(f"Found {len(gestures)} gestures")
        
        # Add video metadata
        for gesture in gestures:
            gesture['video_path'] = video_path
            gesture['fps'] = fps
        
        return gestures


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Detect gestures in video")
    parser.add_argument('--video', type=str, required=True, help='Path to video file')
    parser.add_argument('--model', type=str, default=None, help='Path to trained model')
    parser.add_argument('--simple', action='store_true', help='Use simple activity detection')
    parser.add_argument('--visualize', action='store_true', help='Visualize detections')
    
    args = parser.parse_args()
    
    detector = GestureDetector(model_path=args.model, device=str(config.DEVICE))
    gestures = detector.detect_gestures(args.video, use_model=not args.simple)
    
    print("\nDetected Gestures:")
    for i, g in enumerate(gestures):
        print(f"\nGesture {i+1}:")
        print(f"  Frames: {g['start_frame']} - {g['end_frame']}")
        print(f"  Duration: {g['duration_seconds']:.2f}s")
        print(f"  Confidence: {g['confidence']:.2f}")
        if 'class' in g:
            print(f"  Class: {g['class']} (confidence: {g['class_confidence']:.2f})")
