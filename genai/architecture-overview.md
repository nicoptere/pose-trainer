
# Architecture Overview: High-Fidelity Multi-Person Gesture Recognition

## 1. Executive Summary
This architecture describes a system designed for **maximum gesture recognition accuracy**, prioritizing precision over real-time latency. It relies on a **Google-native stack** (Gemini 1.5 Pro, Vertex AI, GCS) to perform "Visual Few-Shot Learning" via long-context inference.

By removing the constraint of real-time inference (allowing up to 5 minutes latency), we shift from lightweight, lossy embeddings to **full-fidelity video token ingestion**. The system acts as a "Cloud Oracle": it watches a video, compares it against a curated set of "Reference Gestures" in its context window, and acts as an expert human analyst to determine the match.

## 2. System Logic: The "In-Context" Comparator
Unlike traditional classification (training a model on weights), this system uses **In-Context Learning**.

*   **The "Reference Set":** A collection of "Golden Standard" video clips defining each class (e.g., 3 clips of a "Perfect Squat").
*   **The "Query":** The live video buffer (e.g., 5 seconds) to be analyzed.
*   **The Operation:** Both Reference and Query videos are passed to Gemini 1.5 Pro in a single prompt. The model visually compares the query movement to the references to find the best match.

## 3. High-Level Data Flow

```mermaid
graph LR
    User[User / Webcam] -->|Recording| Frontend[Gesture Lab (Frontend)]
    Frontend -->|1. Smart Crop (MediaPipe)| Cropped[actor_crop.mp4]
    Frontend -->|2. Upload| GCS[Google Cloud Storage]
    
    subgraph Vertex AI
        GCS -->|URI References| Gemini[Gemini 1.5 Pro]
        GCS -->|URI Query| Gemini
        Gemini -->|Reasoning| Decision[JSON Classification]
    end
    
    Decision -->|Feedback| Frontend
```

## 4. Multi-Person Strategy (The "Speaker Diarization" of Movement)
A critical challenge is recognizing gestures in a crowded scene. We employ a strict **"Isolate then Analyze"** strategy:

1.  **Detection (Client-Side):** The Frontend runs **MediaPipe Pose** in real-time.
2.  **Tracking:** Typically assigns a unique ID to each skeleton in the frame.
3.  **Smart Cropping:**
    *   Instead of sending the full 1920x1080 frame (which dilutes the "pixels per token" density for the actor), the frontend **dynamically crops** the video around the target actor.
    *   *Example:* If 3 people are dancing, the frontend generates 3 separate video requests: `crop_person_A.mp4`, `crop_person_B.mp4`, `crop_person_C.mp4`.
4.  **Serialization:** Each crop is sent to Gemini as a distinct request, ensuring the model focuses 100% of its attention on one kinematic chain.

## 5. Directory Structure
*   `frontend-spec.md` - Technical specs for the React/MediaBunny "Gesture Lab".
*   `backend-spec.md` - Prompt engineering and Vertex AI pipeline.
*   `benchmark-strategy.md` - The scientific method for validating accuracy.
