# Pose Trainer GenAI Backend

This backend service manages the dataset creation by processing metadata and generating video subclips.

## Setup

1.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
    *Note: You also need `ffmpeg` installed on your system for `moviepy` to work.*

## Running the Server

Run the Flask application:
```bash
python main.py
```
The server will start on `http://localhost:8080`.

## API Usage

### Sync Dataset
**POST** `/dataset/sync`

Refreshes the `dataset/` folder based on the provided JSON metadata.

**Body**:
The JSON export from the frontend store (containing `classes` and `videos`).

**Example**:
```json
{
  "classes": [{"id": "c1", "name": "Jump"}],
  "videos": [
    {
      "id": "v1", 
      "classId": "c1", 
      "parentVideoId": "p1", 
      "startTime": 10.5, 
      "endTime": 12.0, 
      "url": "input.mp4"
    }
  ]
}
```

This will create `dataset/Jump/v1.mp4` containing the slice from 10.5s to 12.0s of `input.mp4`.

## Deployment

The application is `AppEngine` ready.
- `app.yaml` is provided.
- `main.py` is the entry point.
- Ensure `gunicorn` is used in production.
