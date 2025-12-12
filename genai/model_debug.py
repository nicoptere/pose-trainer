import onnxruntime as ort
import numpy as np
import json

MODEL_PATH = 'genai/result/gesture_classifier.onnx'

def test_model():
    print(f"Loading model: {MODEL_PATH}")
    try:
        sess = ort.InferenceSession(MODEL_PATH)
    except Exception as e:
        print(f"Failed to load model: {e}")
        return

    input_name = sess.get_inputs()[0].name
    input_shape = sess.get_inputs()[0].shape
    print(f"Input Name: {input_name}")
    print(f"Input Shape: {input_shape}")
    
    # Expected: [batch, sequence_length, input_size]
    # batch is dynamic usually, let's say 1
    # sequence_length should be 150
    # input_size should be 132
    
    seq_len = input_shape[1] if isinstance(input_shape[1], int) else 150
    input_size = input_shape[2] if isinstance(input_shape[2], int) else 132
    
    print(f"Testing with SeqLen: {seq_len}, InputSize: {input_size}")

    # 1. Random Input
    dummy_input = np.random.randn(1, seq_len, input_size).astype(np.float32)
    res = sess.run(None, {input_name: dummy_input})
    classification = res[1] # Output 1 is classification
    print("\n--- Random Input ---")
    print(f"Raw Logits: {classification}")
    probs = np.exp(classification) / np.sum(np.exp(classification), axis=1, keepdims=True)
    print(f"Probs: {probs}")
    
    # 2. Zeros Input (Static/Null)
    zeros_input = np.zeros((1, seq_len, input_size), dtype=np.float32)
    res_zeros = sess.run(None, {input_name: zeros_input})
    class_zeros = res_zeros[1]
    print("\n--- Zeros Input ---")
    print(f"Raw Logits: {class_zeros}")
    probs_zeros = np.exp(class_zeros) / np.sum(np.exp(class_zeros), axis=1, keepdims=True)
    print(f"Probs: {probs_zeros}")
    
    # 3. Simulate "Standard Pose" (e.g. standing)
    # Just repeating a plausible single frame
    # We can't easily fake a valid skeleton without effort, but we can verify variety.
    
    # Check if weights are collapsed
    if np.allclose(probs, probs_zeros, atol=1e-2):
        print("\nWARNING: Model outputs seemingly identical/collapsed predictions for random vs zero input.")
    else:
        print("\nModel reacts differently to different inputs (Good).")

if __name__ == "__main__":
    test_model()
