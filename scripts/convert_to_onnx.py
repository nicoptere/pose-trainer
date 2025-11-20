import torch
import pandas as pd
from sklearn.preprocessing import LabelEncoder

# Load data to get dimensions
df = pd.read_csv('data.csv')
X = df.iloc[:, :-1].values
y_str = df.iloc[:, -1].values

le = LabelEncoder()
y = le.fit_transform(y_str)

input_size = X.shape[1]

# Load TorchScript model
model = torch.jit.load('model.pt')
model.eval()

# Export to ONNX
dummy_input = torch.randn(1, input_size)

print("Converting TorchScript to ONNX...")
torch.onnx.export(
    model,
    dummy_input,
    'model.onnx',
    export_params=True,
    opset_version=11,
    do_constant_folding=True,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
)
print("Model exported to model.onnx")
