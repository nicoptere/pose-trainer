import os
import json
import sys
import subprocess

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
    response = send_from_directory(dataset_root, filename)
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

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

            # --- AUTO CONVERT to H.264 ---
            try:
                # Check if it looks like a video
                if filename.lower().endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm')):
                    tmp_convert = os.path.join(unsorted_path, f"temp_convert_{filename}")
                    # Run ffmpeg conversion
                    # -y overwrite, -c:v libx264 -c:a aac -movflags +faststart
                    cmd = [
                        'ffmpeg', '-y', '-i', target_path,
                        '-c:v', 'libx264', '-c:a', 'aac', 
                        '-movflags', '+faststart',
                        tmp_convert
                    ]
                    # We run this synchronously. For large files, this should be a background task. 
                    # But for this demo context, sync is safer to ensure it's ready.
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    # If successful, replace original
                    if os.path.exists(tmp_convert):
                        os.replace(tmp_convert, target_path)
                        app.logger.info(f"Converted {filename} to H.264")
            except Exception as cv_err:
                app.logger.error(f"Conversion failed for {filename}: {cv_err}")
                # We leave the original file on failure
            
            saved_files.append(filename)
            
        # Refresh metadata to include new files
        scan_dataset(dataset_root)
        
        return jsonify({'success': True, 'files': saved_files}), 200
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run locally
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
