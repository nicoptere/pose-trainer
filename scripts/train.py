import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import json
import torch.onnx

# Configuration
INPUT_FILE = 'output/data.csv'
MODEL_PATH = 'model.onnx'
LABELS_PATH = 'public/labels.json'
EPOCHS = 50
BATCH_SIZE = 16
LEARNING_RATE = 0.001

class PoseDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.FloatTensor(X)
        self.y = torch.LongTensor(y)
        
    def __len__(self):
        return len(self.X)
    
    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]

class PoseClassifier(nn.Module):
    def __init__(self, input_size, num_classes):
        super(PoseClassifier, self).__init__()
        self.layer1 = nn.Linear(input_size, 64)
        self.relu1 = nn.ReLU()
        self.layer2 = nn.Linear(64, 32)
        self.relu2 = nn.ReLU()
        self.output = nn.Linear(32, num_classes)
        
    def forward(self, x):
        x = self.relu1(self.layer1(x))
        x = self.relu2(self.layer2(x))
        x = self.output(x)
        return x

def main():
    # Load data
    try:
        df = pd.read_csv(INPUT_FILE)
    except FileNotFoundError:
        print(f"Error: {INPUT_FILE} not found. Run extract.py first.")
        return

    print(f"Loaded {len(df)} samples.")
    
    # Separate features and labels
    X = df.iloc[:, :-1].values
    y_str = df.iloc[:, -1].values
    
    # Encode labels
    le = LabelEncoder()
    y = le.fit_transform(y_str)
    classes = le.classes_
    print(f"Classes: {classes}")
    
    # Save labels for web app
    with open(LABELS_PATH, 'w') as f:
        json.dump(list(classes), f)
    print(f"Labels saved to {LABELS_PATH}")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    train_dataset = PoseDataset(X_train, y_train)
    test_dataset = PoseDataset(X_test, y_test)
    
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE)
    
    # Initialize model
    input_size = X.shape[1]
    num_classes = len(classes)
    model = PoseClassifier(input_size, num_classes)
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # Training loop
    print("Starting training...")
    for epoch in range(EPOCHS):
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0
        
        for inputs, labels in train_loader:
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item()
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
        if (epoch + 1) % 10 == 0:
            print(f"Epoch {epoch+1}/{EPOCHS}, Loss: {running_loss/len(train_loader):.4f}, Acc: {100 * correct / total:.2f}%")
            
    # Evaluation
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for inputs, labels in test_loader:
            outputs = model(inputs)
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
    print(f"Test Accuracy: {100 * correct / total:.2f}%")
    
    # Save model state
    torch.save(model.state_dict(), 'model_state.pth')
    print("Model state saved to model_state.pth")
    
    # Export to ONNX - try with export_params=True
    try:
        model.eval()
        dummy_input = torch.randn(1, input_size)
        
        # Use a simpler export without onnx import
        torch.onnx.export(
            model,
            dummy_input,
            MODEL_PATH,
            export_params=True,
            opset_version=11,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
        )
        print(f"Model exported to {MODEL_PATH}")
    except Exception as e:
        print(f"ONNX export failed: {e}")
        print("Trying TorchScript export as fallback...")
        try:
            traced_model = torch.jit.trace(model, dummy_input)
            traced_model.save('model.pt')
            print("Model saved as TorchScript to model.pt")
        except Exception as e2:
            print(f"TorchScript export also failed: {e2}")

if __name__ == "__main__":
    main()
