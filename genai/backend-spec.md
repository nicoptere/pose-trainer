
# Backend Specification: The Vertex AI Oracle

## 1. Overview
The Backend acts as the "Brain". It is stateless, serverless, and leverages Google's most powerful multimodal models. It receives a query video and a set of reference candidates, and returns a high-confidence classification.

## 2. Tech Stack
*   **Cloud Platform:** **Google Cloud Platform (GCP)**
*   **Model:** **Gemini 1.5 Pro** (Preview/002)
    *   *Capability:* 2M+ Token Context Window (Video is token-heavy).
*   **Orchestration:** **Vertex AI SDK for Python**
*   **Storage:** **Google Cloud Storage (GCS)** (Standard class).

## 3. The Inference Pipeline

### 3.1. Ingestion
1.  **Video Receipt:** Frontend uploads `query_crop.mp4` to `gs://your-bucket/incoming/`.
2.  **Reference Loading:** The backend maintains a map of Reference Videos resident in GCS (e.g., `gs://your-bucket/refs/squat_perfect.mp4`).

### 3.2. Prompt Engineering (The Core Intelligence)
We construct a **Multimodal Prompt** that interleaves video and text.

**Structure:**
```python
prompt_parts = [
    "Role: You are an expert Biomechanics and Movement Analyst.",
    "Task: Compare the 'Query Video' to the provided 'Reference Videos'. Identify which interaction it matches.",
    
    # --- Reference Block ---
    "--- REFERENCE CLASS: JUMPING JACK ---",
    Part.from_uri("gs://.../ref_jumping_jack_01.mp4"),
    "Description: A standard jumping jack. Note the hand meeting point above head.",
    
    "--- REFERENCE CLASS: SQUAT ---",
    Part.from_uri("gs://.../ref_squat_01.mp4"),
    "Description: Hips descend below knees, back straight.",
    
    # --- Query Block ---
    "--- QUERY VIDEO TO ANALYZE ---",
    Part.from_uri("gs://.../incoming/query_crop.mp4"),
    
    # --- Instructions ---
    """
    Instructions:
    1. Watch the Query Video carefully.
    2. Compare the limb trajectories and kinematics to each Reference Class.
    3. If the movement matches a Reference Class with >90% certainty, output that class.
    4. If the movement is ambiguous or doesn't match, output 'UNKNOWN'.
    5. PROVIDE REASONING based on specific visual evidence (e.g., 'Target arms did not go above shoulder height').
    
    Output Format: JSON
    {
        "match": "JUMPING_JACK" | "SQUAT" | "UNKNOWN",
        "confidence": 0.0 - 1.0,
        "reasoning": "..."
    }
    """
]
```

### 3.3. Scalability with Vector Search (Future Proofing)
*Concept:* If the Reference Set grows to >50 videos, putting them all in the context window becomes expensive and slow.
*   **Hybrid RAG Approach:**
    1.  Use **Vertex AI Multimodal Embeddings** to convert `Query Video` -> `Vector V`.
    2.  Query **Vertex AI Vector Search** to find the Top-5 most visually similar Reference Videos.
    3.  Construct the Gemini Prompt using *only* those Top-5 references (filtering out the irrelevant 45).
    4.  This keeps the context window manageable while supporting 10,000+ classes.

## 4. API Interface (Cloud Function)
*   **Endpoint:** `POST /analyze-gesture`
*   **Body:**
    ```json
    {
        "gcs_uri": "gs://...",
        "actor_id": "person_1"
    }
    ```
*   **Response:**
    ```json
    {
        "class": "SQUAT",
        "confidence": 0.98,
        "reasoning": "Perfect form detected matching Reference B."
    }
    ```
