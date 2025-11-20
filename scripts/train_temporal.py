"""
Train temporal LSTM model for gesture detection.
Extends the existing pose classification with temporal modeling.
"""
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
import json
import os
from tqdm import tqdm
import config
from gesture_detector import TemporalPoseModel


class SequenceDataset(Dataset):
    """
    Dataset for temporal sequences.
    """
    def __init__(self, X, y):
        self.X = torch.FloatTensor(X)
        self.y = torch.LongTensor(y)
        
    def __len__(self):
        return len(self.X)
    
    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


def train_temporal_model(sequence_file: str = 'data_sequences.npz',
                        epochs: int = None,
                        batch_size: int = None,
                        learning_rate: float = None,
                        model_save_path: str = None):
    """
    Train the temporal LSTM model on sequence data.
    
    Args:
        sequence_file: Path to .npz file with sequences
        epochs: Number of training epochs
        batch_size: Batch size
        learning_rate: Learning rate
        model_save_path: Path to save trained model
    """
    epochs = epochs or config.TEMPORAL_EPOCHS
    batch_size = batch_size or config.TEMPORAL_BATCH_SIZE
    learning_rate = learning_rate or config.TEMPORAL_LEARNING_RATE
    model_save_path = model_save_path or config.TEMPORAL_MODEL_PATH
    
    # Load sequence data
    print(f"Loading sequences from {sequence_file}...")
    data = np.load(sequence_file)
    X = data['X']  # Shape: [num_sequences, sequence_length, input_size]
    y = data['y']  # Shape: [num_sequences]
    
    print(f"Loaded {len(X)} sequences")
    print(f"Sequence shape: {X.shape}")
    
    # Load label mapping
    with open('sequence_labels.json', 'r') as f:
        label_mapping = json.load(f)
    
    num_classes = len(label_mapping)
    print(f"Number of classes: {num_classes}")
    print(f"Classes: {list(label_mapping.values())}")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=config.TRAIN_TEST_SPLIT, random_state=42
    )
    
    print(f"\nTraining samples: {len(X_train)}")
    print(f"Test samples: {len(X_test)}")
    
    # Create datasets and dataloaders
    train_dataset = SequenceDataset(X_train, y_train)
    test_dataset = SequenceDataset(X_test, y_test)
    
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=batch_size)
    
    # Initialize model
    model = TemporalPoseModel(
        input_size=config.INPUT_SIZE,
        hidden_size=config.HIDDEN_SIZE,
        num_classes=num_classes,
        num_layers=config.NUM_LAYERS,
        embedding_size=config.EMBEDDING_SIZE
    ).to(config.DEVICE)
    
    print(f"\nModel architecture:")
    print(model)
    print(f"\nUsing device: {config.DEVICE}")
    
    # Loss functions and optimizer
    presence_criterion = nn.BCELoss()  # For gesture presence
    classification_criterion = nn.CrossEntropyLoss()  # For gesture classification
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    
    # Training loop
    print(f"\nStarting training for {epochs} epochs...")
    best_test_acc = 0.0
    
    for epoch in range(epochs):
        # Training phase
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        
        pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}")
        for inputs, labels in pbar:
            inputs = inputs.to(config.DEVICE)
            labels = labels.to(config.DEVICE)
            
            optimizer.zero_grad()
            
            # Forward pass
            presence, classification = model(inputs)
            
            # Compute losses
            # Presence: all samples have gestures (binary label = 1)
            presence_labels = torch.ones_like(presence)
            loss_presence = presence_criterion(presence, presence_labels)
            
            # Classification loss
            loss_classification = classification_criterion(classification, labels)
            
            # Total loss (weighted combination)
            loss = 0.3 * loss_presence + 0.7 * loss_classification
            
            # Backward pass
            loss.backward()
            optimizer.step()
            
            # Statistics
            train_loss += loss.item()
            _, predicted = torch.max(classification.data, 1)
            train_total += labels.size(0)
            train_correct += (predicted == labels).sum().item()
            
            pbar.set_postfix({
                'loss': f'{loss.item():.4f}',
                'acc': f'{100 * train_correct / train_total:.2f}%'
            })
        
        train_acc = 100 * train_correct / train_total
        avg_train_loss = train_loss / len(train_loader)
        
        # Evaluation phase
        model.eval()
        test_correct = 0
        test_total = 0
        test_loss = 0.0
        
        with torch.no_grad():
            for inputs, labels in test_loader:
                inputs = inputs.to(config.DEVICE)
                labels = labels.to(config.DEVICE)
                
                presence, classification = model(inputs)
                
                presence_labels = torch.ones_like(presence)
                loss_presence = presence_criterion(presence, presence_labels)
                loss_classification = classification_criterion(classification, labels)
                loss = 0.3 * loss_presence + 0.7 * loss_classification
                
                test_loss += loss.item()
                _, predicted = torch.max(classification.data, 1)
                test_total += labels.size(0)
                test_correct += (predicted == labels).sum().item()
        
        test_acc = 100 * test_correct / test_total
        avg_test_loss = test_loss / len(test_loader)
        
        print(f"Epoch {epoch+1}/{epochs}:")
        print(f"  Train Loss: {avg_train_loss:.4f}, Train Acc: {train_acc:.2f}%")
        print(f"  Test Loss: {avg_test_loss:.4f}, Test Acc: {test_acc:.2f}%")
        
        # Save best model
        if test_acc > best_test_acc:
            best_test_acc = test_acc
            
            os.makedirs(os.path.dirname(model_save_path), exist_ok=True)
            
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'test_acc': test_acc,
                'num_classes': num_classes,
                'label_mapping': label_mapping,
                'config': {
                    'input_size': config.INPUT_SIZE,
                    'hidden_size': config.HIDDEN_SIZE,
                    'num_layers': config.NUM_LAYERS,
                    'embedding_size': config.EMBEDDING_SIZE
                }
            }, model_save_path)
            
            print(f"  ✓ Saved best model (acc: {test_acc:.2f}%)")
    
    print(f"\nTraining complete!")
    print(f"Best test accuracy: {best_test_acc:.2f}%")
    print(f"Model saved to: {model_save_path}")
    
    return model


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Train temporal gesture detection model")
    parser.add_argument('--sequences', type=str, default='data_sequences.npz',
                       help='Path to sequence data file')
    parser.add_argument('--epochs', type=int, default=None,
                       help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=None,
                       help='Batch size')
    parser.add_argument('--lr', type=float, default=None,
                       help='Learning rate')
    parser.add_argument('--output', type=str, default=None,
                       help='Output path for model')
    
    args = parser.parse_args()
    
    train_temporal_model(
        sequence_file=args.sequences,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        model_save_path=args.output
    )
