import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dataset_manager import sync_dataset

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
        # Using a folder named 'dataset' in the current working directory
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

if __name__ == '__main__':
    # Run locally
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
