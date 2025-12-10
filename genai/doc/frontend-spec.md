
# Frontend Specification: The "Gesture Lab"

## 1. Overview
The Frontend is a browser-based application ("Gesture Lab") that serves two purposes:
1.  **Curator Mode:** Allows experts to record, edit, and label the "Reference Set" of gestures.
2.  **Benchmark/Live Mode:** Captures live webcam feed, performs multi-person pre-processing, and sends requests to the Backend.

## 2. Tech Stack (Google Standard)
*   **Framework:** **Next.js** (React)
    *   *Why:* Robust routing, server-side rendering for auth/management, standard for Google web apps.
*   **Language:** **TypeScript**
*   **UI Library:** **Material UI (MUI)**
    *   *Why:* Implements Material Design 3, ensuring a "Google-native" look and feel.
*   **State Management:** **Zustand** (or Context API) for managing the "Recording" state.
*   **Video Processing Engine:** **MediaBunny**
    *   *Why:* A high-performance, lightweight JavaScript library for video manipulation. It allows us to trim, crop, and remux video blobs directly in the browser without the massive payload/overhead of a full `ffmpeg.wasm` implementation for simple tasks.
*   **Computer Vision:** **MediaPipe Pose (JS Solution)**
    *   *Why:* Best-in-class client-side pose tracking for the "Smart Crop" logic.

## 3. Key Components

### 3.1. The MediaBunny Editor (Curator Mode)
A timeline-based interface for creating "Golden References".

*   **`VideoRecorder` Component:**
    *   Uses `MediaRecorder` API to capture high-bitrate `webm` from the webcam.
    *   Stores the raw Blob in an `IndexingDB` (via idb) to handle large files without crashing RAM.
*   **`TimelineTrimmer` Component:**
    *   Visualizes the video strip.
    *   **MediaBunny Integration:**
        *   User drags "In" and "Out" handles.
        *   On "Save", calls `MediaBunny.slice(blob, start, end)`.
        *   MediaBunny remuxes the keyframes to ensure a clean playback file (essential for the AI model).
*   **`ClassManager`:**
    *   Sidebar listing classes (e.g., "Squat", "Lunge").
    *   Drag-and-drop the trimmed clips into these class buckets.

### 3.2. The Smart Cropper (Live Mode)
The logic to handle multi-person scenarios *before* uploading to the cloud.

*   **`PoseTracker` Worker:**
    *   Runs MediaPipe Pose in a **Web Worker** to keep the UI usage smooth.
    *   Output: List of `[x, y, w, h]` bounding boxes for every person in the frame, updated at ~30fps.
*   **`DynamicCropper` Logic:**
    *   *Input:* Rolling 5s video buffer.
    *   *Process:*
        1.  Identify stable actor IDs (via IoU tracking).
        2.  Calculate the "Bounding Box Union" for Actor X over the last 5 seconds (to cover their full range of motion).
        3.  Add 20% padding.
        4.  Use **MediaBunny** (or an HTML5 Canvas capture loop) to export a cropped video file just for that region.
    *   *Output:* `actor_1.webm`, `actor_2.webm`.

## 4. User Experience (UX)
*   **Design:** Clean, "Lab" aesthetic. Dark mode default (better for video work).
*   **Feedback:** When Benchmark runs, show a live confidence score overlaying each person's bounding box.

## 5. Interaction to Backend
*   The frontend does **not** call Vertex AI directly.
*   It uploads the formatted/cropped video to **Google Cloud Storage (GCS)** via a Signed URL pattern.
*   It then triggers a Cloud Function (or Next.js API route) to initiate the Gemini analysis.
