
# Approach: Latent Space Gesture Recognition (The "Recall" Architecture)

## Executive Summary
This document explores a **retrieval-based** approach to gesture recognition, moving away from rigid classification heads toward a semantic, open-vocabulary model. The core hypothesis is that determining a gesture can be reframed as a **video-to-video search problem** (retrieving the closest "reference" gesture) or a **video-to-text problem** (projecting the video into a shared latent space with its textual label).

The proposed workflow (streaming 5s sliding windows to a VLM) effectively constitutes a **Multimodal RAG (Retrieval-Augmented Generation)** system where the "query" is the live video feed.

## Expert Panel Analysis

### 1. The Computer Vision Perspective (Dr. Architect)
**Feasibility of the "5s Window / 1s Stride" Strategy**
*   **The Workflow:** Sending a 5-second video buffer every second allows for identifying *complete* gestures that unfold over time.
*   **The Challenge:** Latency. Uploading ~5 seconds of video (even at 480p) + Network RTT + Inference time might exceed the 1-second stride budget, leading to backlog.
*   **Optimization:** We rarely need the full pixels. 
    *   *Option A:* Send compressed embeddings (if a local encoder exists).
    *   *Option B:* Send heavily downsampled/low-FPS video (e.g., 5-10fps is often sufficient for gestures).

### 2. The Latent Space Perspective (Prof. Embeddings)
**Gemini & Multimodal Embeddings**
Google's Gemini models (specifically the multimodal variants) map video and text into a shared semantic space.
*   **Concept:** Use `gemini-embedding-001` (or Pro-vision equivalents) to pre-calculate vectors for your "Reference Gestures" (e.g., a video of someone waving = Vector $G_{wave}$).
*   **Runtime:** The live 5s clip is embedded into Vector $V_{live}$.
*   **Inference:** $Class = argmax(CosineSimilarity(V_{live}, \{G_{wave}, G_{jump}, ...\}))$.
*   **Advantage:** This is **Zero-Shot / Few-Shot**. To add a class, you just add one video file. No retraining.

---

## Scenarios

### Scenario A: The Pure "Cloud Oracle" (Closest to User Request)
*   **Mechanism:** 
    *   **Setup:** You upload "Reference Videos" to Gemini/Vertex AI and store their identifiers/embeddings.
    *   **Loop:** Every 1s, the client cuts the last 5s buffer, sends it to the Gemini API with a prompt: *"Which of these reference videos does this clip most resemble? [List of References]"* or simply compares embeddings.
*   **Pros:** Highest accuracy; utilizes Gemini's massive world knowledge (can recognize "drinking water" without being explicitly trained on it if using open-vocab text matching).
*   **Cons:** High latency (API calls); Cost (video processing tokens).
*   **Viability:** Good for "slow" interactions, likely too laggy for tight feedback loops (like games).

### Scenario B: The "Hybrid Embedder" (Recommended)
*   **Mechanism:**
    *   **Local:** Run a lightweight feature extractor (like **MediaPipe** or a small **CLIP** vision encoder) locally to get a vector per frame.
    *   **Aggregation:** Pooling these frame vectors (e.g., temporal averaging or a small LSTM) creates the "Clip Vector".
    *   **Cloud/Local DB:** Perform the vector search against your Reference Set locally (using FAISS or just numpy).
*   **Gemini's Role:** Use Gemini *offline* to caption and verify the quality of your Reference Set, or generating the synthetic "perfect" embedding for a text description to match against.
*   **Pros:** Real-time (40ms inference); Privacy; No network latency loop.
*   **Cons:** Requires implementing the "Video Encoder" locally.

### Scenario C: The "Semantic Proxy" (Video-to-Text)
*   **Mechanism:**
    *   Instead of matching video-to-video, match video-to-text.
    *   **Pre-calc:** Encode labels "Doing a pushup", "Waving hand" into text embeddings $T$.
    *   **Runtime:** Encode live video $V$ into the same space. Find closest $T$.
*   **Pros:** Extremely flexible definitions (just type "A person looking confused" and it starts recognizing it).

---

## Relevant Papers & Prior Art (prioritizing Code/OS)

### 1. **VideoLLaMA2 & Video-LLaVA**
These are the current state-of-the-art for "Video Chat". They connect a vision encoder (like CLIP-ViT-L/14) to a LLaMA language decoder.
*   **Relevance:** They prove you can project video into language space.
*   **Code:** [VideoLLaMA2 GitHub](https://github.com/DAMO-NLP-SG/VideoLLaMA2) | [Video-LLaVA GitHub](https://github.com/PKU-YuanGroup/Video-LLaVA)
*   **Takeaway:** You can run quantized versions of these locally to get "descriptions" of your 5s clips, then match those descriptions to your classes.

### 2. **ActionCLIP / CLIP4Clip**
Instead of using a heavy LLM, these papers adapt CLIP (Image-Text matching) for Video. This is much faster and fits the "Embedding Match" idea perfectly.
*   **Technique:** They treat video as a bag of image frames and align them with text labels.
*   **Code:** [ActionCLIP GitHub](https://github.com/sallymmx/ActionCLIP)
*   **Key Insight:** This is the most "grounded" realization of your idea. A simple dot product between the video buffer and the text label "waving".

### 3. **MediaPipe Gesture Recognition (The Pragmatic Choice)**
Google's MediaPipe already does this with "Gesture Embeddings".
*   **Mechanism:** It extracts Hand Landmarks -> Embedding Network -> Vector.
*   **Customization:** You provide ~10 photos/videos of a gesture to "finetune" the head.
*   **Relevance:** It is the "Edge" version of your Gemini idea.
*   **Code:** [MediaPipe Custom Guidelines](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer)

## Verdict

Your specific proposal ($5s$ buffer $\rightarrow$ Cloud API) is **valid but implementation-heavy** due to latency.

**The "Eye-Bird" Recommendation:**
Adopt **Scenario B (Hybrid)** using an **ActionCLIP** style architecture.
1.  **Offline:** Use Gemini to generating rich textual descriptions of your classes (e.g., "A person raising their hand and moving it side to side").
2.  **Runtime:** Use a quantized **CLIP/SigLIP** model to embed the 5s video buffer.
3.  **Matching:** Calculate similarity between the *Live Video Embedding* and the *Gemini-Generated Text Embeddings*.

This gives you the "Open Vocabulary" power of Gemini (describe anything to detect it) with the speed of local vectors.
