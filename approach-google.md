
# Approach: High-Fidelity Google-Native Gesture Recognition (v2)

## Executive Summary
This logic prioritizes **Google-native technologies** (Gemini 1.5 Pro, Vertex AI) and **Accuracy** over speed. It assumes a flexible latency budget (up to 5 mins) and cost coverage. 

## 1. Core Logic: The "In-Context" Comparator
*   **Model:** `gemini-1.5-pro-002` (or latest).
*   **Method:** **Visual Few-Shotting**. We do not train a classifier. We pass *Reference Videos* + *Query Video* in a single prompt context.
*   **Multi-Person Strategy:**
    *   **Preprocessing:** Use **MediaPipe Pose** (Client-side) to detect number of people.
    *   **Crop & Zoom (Smart Logic):** If 3 people are in frame, the client cuts 3 separate 5s clips (one centered on each person) before sending to Gemini. This isolates the gesture and removes ambiguity.
    *   **Prompting:** If cropping isn't viable, we strictly prompt Gemini: *"Identify the gesture performed by the person on the LEFT"*, leveraging its spatial reasoning.

---

## 2. Frontend Architecture: Browser-Based Editor
We will build a high-fidelity "Gesture Lab" directly in the browser to allow researchers/users to curate the *Reference Set*.

### Tech Stack
*   **Framework:** React/Next.js (Google standard for modern web apps).
*   **Video Engine:** **MediaBunny**.
    *   *Why MediaBunny:* It is a high-performance, purpose-built JS library for browser-side media manipulation (trimming, remuxing, thumbnail generation) without the heavy overhead of raw WASM ports. It allows "FFmpeg-like" operations natively in JS.
*   **UI Components:** Material UI (MUI) - sticking to Google's design system.

### Editor Workflow
1.  **Collection Manager:** Users create "Classes" (buckets).
2.  **Import/Capture:**
    *   Upload long-form video.
    *   Record directly via Webcam.
3.  **The "Cutter" Interface (powered by MediaBunny):**
    *   Timeline view of the video.
    *   User sets `In` and `Out` points to isolate a specific gesture repetition.
    *   **Action:** Click "Extract to Class -> 'Waving'".
    *   *Backend:* MediaBunny slices the Blob client-side.
4.  **Verification:** The snippet plays back immediately in a grid under the class name.

---

## 3. Benchmark Suite (The "Ground Truth" Loop)
To scientifically measure accuracy, we introduce a benchmarking mode.

*   **Input:** Live Webcam or "Test Video Folder".
*   **Protocol:**
    1.  User selects a "Ground Truth" label (e.g., "I am about to do: Jumping Jacks").
    2.  System records N seconds.
    3.  System sends to Gemini (Scenario A).
    4.  **Metric:** `Match (True/False)`.
*   **Report Card:**
    *   Generates a matrix: *Accuracy per Class*.
    *   Identifies "Confused Pairs" (e.g., Model consistenly thinks 'Squat' is 'Unknown').

---

## 4. Operational Scenarios (Refined)

### Scenario A: The "In-Context" Oracle (Recommended)
*   **Flow:** Client (MediaBunny Crop) $\rightarrow$ GCS $\rightarrow$ Gemini 1.5 Pro Prompt.
*   **Prompt Structure:**
    > "Analyze the video. There are [N] people. Focus on the person in the [Center/Left]. Compare their movement to these Reference Videos: [Ref_A, Ref_B]. Return JSON: { 'class': 'Ref_A', 'confidence': 0.9, 'person_id': 1 }"

### Scenario B: Vector Search (Scale)
*   **Flow:** Video $\rightarrow$ Vertex Multimodal Embedding $\rightarrow$ Vector Search Index.
*   **Refinement:** Use **Person-Centric Cropping** before embedding. Embeddings fail if the frame is 90% background and 10% person. MediaPipe bounding boxes should guide the crop.

## 5. Implementation Roadmap
1.  **Phase 1 (Editor):** Build the MediaBunny-based cropper to generate the "Golden Dataset" of reference clips.
2.  **Phase 2 (Pipeline):** Connect the "Benchmark" button to `gemini-1.5-pro` API.
3.  **Phase 3 (Multi-Person):** Integrate MediaPipe Pose locally to auto-crop distinct actors before upload.

## Relevant Links & Resources
*   **MediaBunny:** [Documentation/Repo](https://github.com/greggman/mediabunny) (or distinct internal/external equivalent if proprietary - *Note: confirming MediaBunny is an emerging web-media library*).
*   **MediaPipe Pose:** [TFJS / JS Solutions](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker).
