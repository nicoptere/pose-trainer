
# Benchmark Strategy: The Ground Truth Loop

## 1. Overview
Since we are optimizing for accuracy over latency, we need a rigorous way to measure that accuracy. The "Gesture Lab" includes a dedicated Benchmark Mode that automates the testing of the model against known Ground Truths.

## 2. Experimental Design
*   **Unit of analysis:** A "Session" consisting of N distinct gesture attempts.
*   **Variables:**
    *   Lighting conditions (Daylight vs Low Light).
    *   Camera Angle (Front-on vs 45-degree).
    *   Actor (Person A vs Person B).
*   **Goal:** Reach >95% accuracy on the "Golden Set" before deployment.

## 3. The Benchmark Workflow (Frontend)

1.  **Setup Phase:**
    *   User selects the "Protocol": e.g., "Standard Fitness Test (Squat, Lunge, Jack)".
    *   User stands in front of the camera.
2.  **Instruction Loop:**
    *   App Text-to-Speech: *"Please perform a SQUAT in 3... 2... 1..."*
    *   **Recording:** App records 5 seconds.
    *   **Labeling:** The app *knows* this file `test_squat_01.mp4` should be a SQUAT. This is the **Ground Truth**.
    *   *Repeat* for all gestures in the protocol.
3.  **Batch Analysis:**
    *   The frontend uploads all captured test clips to the Backend.
    *   The Backend processes them against the Reference Set.
4.  **Reporting:**
    *   The system compares `Predicted Class` vs `Ground Truth`.

## 4. Metrics & Reporting

### 4.1. The Matrix
The output is a Confusion Matrix visualized in the UI:

| Target \ Predicted | Squat | Lunge | Unknown |
| :--- | :---: | :---: | :---: |
| **Squat** | **10** (TP) | 0 | 1 (FN) |
| **Lunge** | 1 (FP) | **9** | 1 |

*   **Green:** Correct Match.
*   **Red:** Misclassification (Confused Pairs). Be careful if "Squat" is frequently confused for "Lunge" -> indicates References are too similar.

### 4.2. Failure Analysis
*   Clicking on a "Failure" (e.g., the Squat classified as Lunge) pulls up the **Gemini Reasoning** log.
*   *Example Log:* "I classified this as Lunge because the user's right leg stepped forward significantly, which aligns with reference `lunge_01.mp4`."
*   *Action:* User realizes they actually *did* do a bad squat, or that the reference needs updating.

## 5. Artifacts
*   **Test Sets:** Users can export their "Benchmark Session" (videos + labels) as a `.zip` dataset for regression testing later.
