import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import LabelEncoder

# Configuration
INPUT_FILE = 'output/data.csv'
MODEL_PATH = 'model.onnx'

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
    # Load data to get dimensions
    df = pd.read_csv(INPUT_FILE)
    X = df.iloc[:, :-1].values
    y_str = df.iloc[:, -1].values
    
    le = LabelEncoder()
    y = le.fit_transform(y_str)
    
    input_size = X.shape[1]
    num_classes = len(le.classes_)
    
    # Create a new model (we'll train a simple one quickly or just export the architecture)
    model = PoseClassifier(input_size, num_classes)
    model.eval()
    
    # Export to ONNX
    print("Exporting model to ONNX...")
    dummy_input = torch.randn(1, input_size)
    
    import onnx
    print(f"ONNX version: {onnx.__version__}")
    
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

if __name__ == "__main__":
    main()
