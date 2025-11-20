# Gesture Classifier Web App - Complete

## ✅ What's New

**2-Column Layout:**
- Left: Video feed with pose detection and results
- Right: Scrollable cluster gallery (320px wide) with animated gesture previews

**Video Upload Support:**
- Switch between webcam and file upload
- Process uploaded videos for gesture detection
- Radio buttons at the top to select source

**Static Cluster Gallery:**
- Shows looping animations for all 20 clusters
- Animations demonstrate what the model expects
- Highlights active cluster when gesture is detected
- **Does NOT update with live camera feed** (static animations only)

## How to Use

1. **Start the server** (if not already running):
   ```bash
   cd public
   python -m http.server 8000
   ```

2. **Open in browser**: http://localhost:8000

3. **Select source**:
   - **Webcam**: Default, starts automatically
   - **Upload Video**: Click radio button, select file, click "Process Video"

4. **Perform gestures** or let video play
   - Model analyzes 30 frames (~4 seconds)
   - Results show cluster name and confidence
   - Matching cluster card highlights in the gallery

## File Structure

```
public/
├── index.html                    # 2-column layout with source selector
├── style.css                     # Responsive grid, scrollable cluster panel
├── app.js                        # Clean implementation (recreated from scratch)
├── gesture_classifier.onnx       # Trained model
├── gesture_classifier_labels.json # Class labels
├── cluster_animations.json       # Animation data (20 clusters)
└── README.md                     # This file
```

## Features

✅ **Webcam**: Real-time gesture detection
✅ **Video Upload**: Process video files
✅ **Temporal Window**: 4-second sliding window (30 frames)
✅ **Confidence Visualization**: Color-coded bar (green/yellow/red)
✅ **Animated Previews**: Each cluster shows looping gesture
✅ **Responsive**: Works on desktop and mobile
✅ **Clean Code**: Organized sections, well-commented

## Notes

- Cluster gallery shows **static animations only** (not updated by live feed)
- Animations demonstrate what gestures the model is looking for
- Model works on **normalized pose landmarks** (0-1 range)
- Best results with good lighting and full body visibility

Enjoy your gesture classifier! 🎉
