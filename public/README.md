# Webcam Gesture Classifier

Real-time gesture classification using MediaPipe Pose and a trained ONNX neural network.

## Features

- **Temporal Window**: Analyzes 30 frames (~4 seconds) for accurate gesture recognition
- **Live Webcam**: Real-time pose detection and classification
- **Confidence Visualization**: Shows prediction confidence with color-coded bar
- **20 Gesture Classes**: Trained on DTW-clustered gesture data

## How to Use

### 1. Start a Local Server

The app requires HTTPS or localhost to access the webcam. Use Python's built-in server:

```bash
cd public
python -m http.server 8000
```

### 2. Open in Browser

Navigate to:
```
http://localhost:8000
```

### 3. Allow Webcam Access

When prompted, allow the browser to access your webcam.

### 4. Perform Gestures

- Stand in view of the camera so your full body is visible
- Perform smooth, deliberate gestures
- The model will analyze 30 frames (~4 seconds) to classify your gesture
- Results appear with confidence percentage

## Technical Details

- **Model**: TemporalPoseModel (LSTM-based)
- **Input**: 30 frames × 132 features  (33 pose landmarks × 4 values each)
- **Output**: 20 gesture classes
- **FPS**: ~7.5 FPS for inference (balances accuracy and performance)
- **Pose Detection**: MediaPipe Pose (via CDN)
- **Inference**: ONNX Runtime Web

## Files

- `index.html` - Web interface
- `app.js` - Application logic with temporal window
- `style.css` - Styling
- `gesture_classifier.onnx` - Trained LSTM model
- `gesture_classifier_labels.json` - Class names

## Tips for Best Results

1. **Lighting**: Ensure good lighting for pose detection
2. **Background**: Plain or contrasting background works best 
3. **Full Body**: Stay in frame with your whole body visible
4. **Smooth Movements**: Perform gestures smoothly over 3-4 seconds
5. **Distance**: Stand 1.5-3 meters from camera

## Troubleshooting

**Model not loading?**
- Check browser console for errors
- Ensure `gesture_classifier.onnx` and `gesture_classifier_labels.json` are in the `public` folder

**Webcam not working?**
- Use HTTPS or localhost (browser security requirement)
- Check browser permissions
- Ensure no other app is using the webcam

**Low accuracy?**
- Perform gestures similar to training data
- Ensure good lighting and visibility
- Wait for buffer to fill (30 frames)

## Browser Compatibility

- Chrome/Edge: ✅ Recommended
- Firefox: ✅ Supported
- Safari: ✅ Supported (may need to enable experimental features)
