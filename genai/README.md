
# Gesture Lab (GenAI)

This directory contains the Next-Generation Gesture Recognition system powered by Google Gemini 1.5 Pro.

## Directory Structure
*   `frontend/`: Next.js Web Application ("Gesture Lab").
*   `backend/`: Python Flask backend for dataset management and serving the app.
*   `dataset/`: Local dataset directory containing videos and class folders.
*   `videos/`: Sample raw videos.
*   `*.md`: Architecture documentation.

## Getting Started

### 1. Backend Setup

1.  Create and activate a virtual environment:
    ```bash
    python -m venv env
    .\env\Scripts\activate
    ```

2.  Install requirements:
    ```bash
    pip install -r requirements.txt
    ```
    *Note: You also need `ffmpeg` installed on your system for video processing.*

### 2. Frontend Setup

1.  Navigate to the frontend directory:
    ```bash
    cd frontend
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### 3. Development

To run the application in development mode (with hot reloading):

1.  Start the Backend (in one terminal):
    ```bash
    python main.py
    ```
    The API will run on **http://localhost:8080**.

2.  Start the Frontend (in another terminal):
    ```bash
    cd frontend
    npm run dev
    ```
    The web app will be available at **http://localhost:3000**.

### 4. Production Build

To run the application in production mode (frontend served separately or statically):

1.  Build the Frontend:
    ```bash
    cd frontend
    npm run build
    npx serve@latest out
    ```
    The static frontend effectively expects relative API paths or uses the production config.

2.  Start the Backend:
    ```bash
    python main.py
    ```

## Workflow
1.  Drop video files into `dataset/` (or subdirectory folders for specific classes).
2.  Refresh the web interface to see them in the Collection.
3.  Organize, Crop, and Label gestures using the UI.
4.  Metadata is automatically synced to `dataset/metadata.json`.

## Troubleshooting

### Kill All Processes
If you need to stop all running python and node processes (e.g., if ports are stuck), run this command in PowerShell:

```powershell
taskkill /F /IM python.exe /IM node.exe
```
