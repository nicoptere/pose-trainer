import os
import json
import sys

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Import from backend package
from backend.dataset_manager import sync_dataset, scan_dataset

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'}), 200

@app.route('/dataset/sync', methods=['POST'])
def sync_dataset_endpoint():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Define dataset root directory
        dataset_root = os.path.join(os.getcwd(), 'dataset')
        
        # Trigger synchronization
        stats = sync_dataset(data, dataset_root)
        
        return jsonify({
            'status': 'success',
            'message': 'Dataset synchronization complete',
            'stats': stats
        }), 200
    except Exception as e:
        app.logger.error(f"Sync error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/videos', methods=['GET'])
def list_videos():
    try:
        dataset_root = os.path.join(os.getcwd(), 'dataset')
        if not os.path.exists(dataset_root):
             os.makedirs(dataset_root)
             
        # Scan and get grouped structure
        data = scan_dataset(dataset_root)
        return jsonify(data), 200
    except Exception as e:
        app.logger.error(f"List videos error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/videos/<path:filename>')
def serve_video(filename):
    dataset_root = os.path.join(os.getcwd(), 'dataset')
    return send_from_directory(dataset_root, filename)

@app.route('/api/classes', methods=['POST'])
def add_class():
    try:
        data = request.json
        name = data.get('name')
        if not name:
            return jsonify({'error': 'Invalid class name'}), 400
        
        # Sanitize
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        if not safe_name:
            return jsonify({'error': 'Invalid class name'}), 400
            
        dataset_root = os.path.join(os.getcwd(), 'dataset')
        class_path = os.path.join(dataset_root, safe_name)
        
        if not os.path.exists(class_path):
            os.makedirs(class_path)
            
        # Update metadata.json to include this new class
        scan_dataset(dataset_root)
            
        return jsonify({'success': True, 'name': safe_name}), 200
    except Exception as e:
        app.logger.error(f"Add class error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/classes', methods=['DELETE'])
def delete_class():
    try:
        data = request.json
        name = data.get('name')
        if not name or name == 'Unsorted':
            return jsonify({'error': 'Invalid class name'}), 400
            
        dataset_root = os.path.join(os.getcwd(), 'dataset')
        class_path = os.path.join(dataset_root, name)
        
        if os.path.exists(class_path):
            # Move videos to Unsorted
            unsorted_path = os.path.join(dataset_root, 'Unsorted')
            if not os.path.exists(unsorted_path):
                os.makedirs(unsorted_path)
                
            for f in os.listdir(class_path):
                src = os.path.join(class_path, f)
                if os.path.isfile(src):
                    dst = os.path.join(unsorted_path, f)
                    # Handle name collision
                    if os.path.exists(dst):
                        base, ext = os.path.splitext(f)
                        import time
                        dst = os.path.join(unsorted_path, f"{base}_{int(time.time())}{ext}")
                    os.rename(src, dst)
            
            try:
                os.rmdir(class_path)
            except OSError:
                # Directory not empty?
                pass
                
        # Update metadata
        scan_dataset(dataset_root)
        
        return jsonify({'success': True}), 200
    except Exception as e:
        app.logger.error(f"Delete class error: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Serve React Static Files
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    static_folder = os.path.join(os.getcwd(), 'frontend', 'out')
    if path != "" and os.path.exists(os.path.join(static_folder, path)):
        return send_from_directory(static_folder, path)
    else:
        return send_from_directory(static_folder, 'index.html')

@app.route('/api/upload', methods=['POST'])
def upload_files():
    try:
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        dataset_root = os.path.join(os.getcwd(), 'dataset')
        unsorted_path = os.path.join(dataset_root, 'Unsorted')
        
        if not os.path.exists(unsorted_path):
            os.makedirs(unsorted_path)
            
        saved_files = []
        for file in files:
            if file.filename == '':
                continue
            
            # Basic sanitization
            filename = "".join([c for c in file.filename if c.isalnum() or c in (' ', '-', '_', '.')]).strip()
            if not filename: filename = f"upload_{int(time.time())}.mp4"
            
            # Context: Handle duplicates
            target_path = os.path.join(unsorted_path, filename)
            if os.path.exists(target_path):
                base, ext = os.path.splitext(filename)
                import time
                target_path = os.path.join(unsorted_path, f"{base}_{int(time.time())}{ext}")
            
            file.save(target_path)
            saved_files.append(filename)
            
        # Refresh metadata to include new files
        scan_dataset(dataset_root)
        
        return jsonify({'success': True, 'files': saved_files}), 200
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/config/gesture', methods=['GET'])
def get_gesture_config():
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'gesture_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                config = json.load(f)
            return jsonify(config), 200
        else:
            # Default config if file doesn't exist
            return jsonify({
                "analysis_fps": 12,
                "gesture_min_seconds": 2,
                "gesture_max_seconds": 6,
                "n_clusters": None,
                "use_hdbscan": False,
                "dtw_downsample_factor": 1
            }), 200
    except Exception as e:
        app.logger.error(f"Get config error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/config/gesture', methods=['POST'])
def update_gesture_config():
    try:
        data = request.json
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'gesture_config.json')
        
        # Validate keys (optional but good practice)
        base_keys = ["analysis_fps", "gesture_min_seconds", "gesture_max_seconds", "n_clusters", "use_hdbscan", "dtw_downsample_factor"]
        
        # Read existing or default to preserve other keys if any? 
        # For now, just rewrite the file with provided data + defaults if missing
        
        with open(config_path, 'w') as f:
            json.dump(data, f, indent=4)
            
        return jsonify({'success': True}), 200
    except Exception as e:
        app.logger.error(f"Update config error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/train/mediapipe', methods=['POST'])
def train_mediapipe():
    try:
        # Trigger run.py
        # We use subprocess to run it asynchronously or synchronously? 
        # User might want to see output. For now, let's run it and return success if it starts.
        # But `run.py` might take a while.
        # A simple polling or blocking implementation:
        
        import subprocess
        root_dir = os.path.dirname(os.path.dirname(__file__))
        script_path = os.path.join(root_dir, 'run.py')
        
        # Run in a separate process? Or block?
        # Blocking for now as it might be safer to ensure it completes, 
        # but typically we'd want a job queue. 
        # Given this is a local tool, blocking with a timeout or just letting it run is common.
        # However, run.py prints to stdout.
        
        # Let's run it and capture output
        result = subprocess.run([sys.executable, script_path], capture_output=True, text=True, cwd=root_dir)
        
        if result.returncode == 0:
            return jsonify({'success': True, 'output': result.stdout}), 200
        else:
            return jsonify({'error': 'Training failed', 'details': result.stderr, 'output': result.stdout}), 500
            
    except Exception as e:
        app.logger.error(f"Training error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/train/classifier', methods=['POST'])
def train_classifier():
    try:
        import subprocess
        
        # Paths relative to genai/
        root_dir = os.path.dirname(os.path.dirname(__file__)) # c:\ML\perso\pose-trainer
        genai_dir = os.path.dirname(__file__) # c:\ML\perso\pose-trainer\genai
        backend_script = os.path.join(genai_dir, 'backend', 'classification.py')
        
        # Arguments
        # Manifest is in root output/
        manifest_path = os.path.join(root_dir, 'output', 'clustering_manifest.json')
        # Model output to root models/
        model_output = os.path.join(root_dir, 'models', 'gesture_classifier.onnx')
        
        # Ensure models dir exists
        os.makedirs(os.path.dirname(model_output), exist_ok=True)
        
        cmd = [
            sys.executable, 
            backend_script,
            '--manifest', manifest_path,
            '--output', model_output
        ]
        
        print(f"Running classifier training: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=genai_dir)
        
        if result.returncode == 0:
            return jsonify({'success': True, 'output': result.stdout}), 200
        else:
            return jsonify({'error': 'Training failed', 'details': result.stderr, 'output': result.stdout}), 500
            
    except Exception as e:
        app.logger.error(f"Classifier training error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run locally
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
