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
            # Ensure output_path exists in response
            if 'output_path' not in config:
                config['output_path'] = 'genai/result'
            return jsonify(config), 200
        else:
            # Default config if file doesn't exist
            return jsonify({
                "analysis_fps": 12,
                "output_path": "genai/result"
            }), 200
    except Exception as e:
        app.logger.error(f"Get config error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/config/gesture', methods=['POST'])
def update_gesture_config():
    try:
        data = request.json
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'gesture_config.json')
        
        # Write config
        with open(config_path, 'w') as f:
            json.dump(data, f, indent=4)
            
        return jsonify({'success': True}), 200
    except Exception as e:
        app.logger.error(f"Update config error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/train/mediapipe', methods=['POST'])
def train_mediapipe():
    try:
        import subprocess
        
        genai_dir = os.path.dirname(__file__) 
        script_path = os.path.join(genai_dir, 'backend', 'run.py')
        
        # Read output path from config to ensure directory exists
        output_path = 'genai/result'
        config_path = os.path.join(os.path.dirname(genai_dir), 'gesture_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                 conf = json.load(f)
                 output_path = conf.get('output_path', 'genai/result')
        
        # Create output directory
        if not os.path.isabs(output_path):
            # If relative, it's relative to root or genai? 
            # Let's assume relative to root (where main.py is parent dir)
            # Actually main.py is in genai/. Root is parent.
            # If user types "genai/result", and we run from genai/, that works if we are cautious.
            # Let's resolve validation. ideally user types relative to root.
            abs_output = os.path.abspath(os.path.join(os.path.dirname(genai_dir), output_path))
        else:
            abs_output = output_path
            
        os.makedirs(abs_output, exist_ok=True)
        
        cwd = genai_dir
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        
        print(f"Running MediaPipe training: {sys.executable} {script_path}")
        
        result = subprocess.run(
            [sys.executable, script_path], 
            capture_output=True, 
            text=True, 
            cwd=cwd,
            env=env,
            encoding='utf-8', 
            errors='replace'
        )
        
        if result.returncode == 0:
            return jsonify({'success': True, 'output': result.stdout}), 200
        else:
            app.logger.error(f"Training failed: {result.stderr}")
            return jsonify({'error': 'Training failed', 'details': result.stderr, 'output': result.stdout}), 500
            
    except Exception as e:
        app.logger.error(f"Training error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/train/classifier', methods=['POST'])
def train_classifier():
    try:
        import subprocess
        
        root_dir = os.path.dirname(os.path.dirname(__file__)) # c:\ML\perso\pose-trainer
        genai_dir = os.path.dirname(__file__) # c:\ML\perso\pose-trainer\genai
        backend_script = os.path.join(genai_dir, 'backend', 'classification.py')
        
        # Read config for path
        output_path = 'genai/result'
        config_path = os.path.join(root_dir, 'gesture_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                 conf = json.load(f)
                 output_path = conf.get('output_path', 'genai/result')
        
        abs_output_path = output_path if os.path.isabs(output_path) else os.path.join(root_dir, output_path)
        
        # Arguments
        manifest_path = os.path.join(abs_output_path, 'clustering_manifest.json')
        model_output = os.path.join(abs_output_path, 'gesture_classifier.onnx')
        
        cmd = [
            sys.executable, 
            backend_script,
            '--manifest', manifest_path,
            '--output', model_output
        ]
        
        print(f"Running classifier training: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=genai_dir)
        
        if result.returncode != 0:
            return jsonify({'error': 'Training failed', 'details': result.stderr, 'output': result.stdout}), 500

        # --- Extract Animations Step ---
        animations_output = os.path.join(abs_output_path, 'cluster_animations.json')
        cmd_anim = [
            sys.executable, 
            backend_script,
            '--manifest', manifest_path,
            '--extract-animations',
            '--animations-output', animations_output
        ]
        
        print(f"Running animation extraction: {' '.join(cmd_anim)}")
        res_anim = subprocess.run(cmd_anim, capture_output=True, text=True, cwd=genai_dir)
        
        if res_anim.returncode != 0:
            # Don't fail the whole request, but warn
            app.logger.warning(f"Animation extraction failed: {res_anim.stderr}")
            # Append warning to output?
        
        return jsonify({
            'success': True, 
            'output': result.stdout + "\n" + res_anim.stdout,
            'animations_extracted': res_anim.returncode == 0
        }), 200
            
    except Exception as e:
        app.logger.error(f"Classifier training error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/model/animations', methods=['GET'])
def get_model_animations():
    try:
        # Resolve output path
        root_dir = os.path.dirname(os.path.dirname(__file__))
        config_path = os.path.join(root_dir, 'gesture_config.json')
        output_path = 'genai/result'
        
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                 conf = json.load(f)
                 output_path = conf.get('output_path', 'genai/result')
        
        abs_output_path = output_path if os.path.isabs(output_path) else os.path.join(root_dir, output_path)
        anim_path = os.path.join(abs_output_path, 'cluster_animations.json')
        
        if not os.path.exists(anim_path):
            return jsonify({'error': 'Animations not found. Please train the model.'}), 404
            
        return send_from_directory(os.path.dirname(anim_path), os.path.basename(anim_path))
    except Exception as e:
        app.logger.error(f"Serve animations error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/model/onnx', methods=['GET'])
def get_onnx_model():
    try:
        # Resolve output path
        root_dir = os.path.dirname(os.path.dirname(__file__)) # c:\ML\perso\pose-trainer
        config_path = os.path.join(root_dir, 'gesture_config.json')
        output_path = 'genai/result'
        
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                 conf = json.load(f)
                 output_path = conf.get('output_path', 'genai/result')
        
        abs_output_path = output_path if os.path.isabs(output_path) else os.path.join(root_dir, output_path)
        model_path = os.path.join(abs_output_path, 'gesture_classifier.onnx')
        
        if not os.path.exists(model_path):
            return jsonify({'error': 'Model not found. Please train the model first.'}), 404
            
        return send_from_directory(os.path.dirname(model_path), os.path.basename(model_path))
    except Exception as e:
        app.logger.error(f"Serve model error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/model/labels', methods=['GET'])
def get_model_labels():
    try:
        # Resolve output path
        root_dir = os.path.dirname(os.path.dirname(__file__))
        config_path = os.path.join(root_dir, 'gesture_config.json')
        output_path = 'genai/result'
        
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                 conf = json.load(f)
                 output_path = conf.get('output_path', 'genai/result')
        
        abs_output_path = output_path if os.path.isabs(output_path) else os.path.join(root_dir, output_path)
        labels_path = os.path.join(abs_output_path, 'gesture_classifier_labels.json')
        
        if not os.path.exists(labels_path):
            return jsonify({'error': 'Labels not found. Please train the model first.'}), 404
            
        return send_from_directory(os.path.dirname(labels_path), os.path.basename(labels_path))
    except Exception as e:
        app.logger.error(f"Serve labels error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run locally
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
