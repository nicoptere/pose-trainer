
# Gesture Lab (GenAI)

This directory contains the Next-Generation Gesture Recognition system powered by Google Gemini 1.5 Pro.

## Directory Structure
*   `frontend/`: Next.js Web Application ("Gesture Lab").
*   `backend/`: Python Cloud Functions for Vertex AI inference.
*   `videos/`: Sample dataset of gesture videos.
*   `*.md`: Architecture documentation.

## Getting Started

### 1. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000`.

### 2. Backend
Deploy the function using `gcloud` or run locally with `functions-framework`.

```bash
cd backend
pip install -r requirements.txt
# Run locally
functions-framework --target=analyze_gesture --debug
```

### 3. Local Development Flow
1.  Run the Frontend.
2.  Record a video in the Lab.
3.  (Implementation Pending) Click "Analyze" to send to the local Backend which forwards to Vertex AI.
