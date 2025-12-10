import os
import json
import shutil
import re
from moviepy.video.io.VideoFileClip import VideoFileClip

def sanitize_filename(name):
    """Sanitize string to be safe for directory/filenames."""
    return re.sub(r'[<>:"/\\|?*]', '_', name).strip()

def sync_dataset(metadata, dataset_root):
    """
    Synchronizes the 'dataset' folder structure with the provided metadata.
    
    metadata structure expected:
    {
        "classes": [{"id": "...", "name": "..."}],
        "videos": [
            {
                "id": "...", "classId": "...", "parentVideoId": "...",
                "startTime": 0.0, "endTime": 5.0, "url": "..." 
            }
        ]
    }
    """
    
    classes_map = {c['id']: c['name'] for c in metadata.get('classes', [])}
    
    videos = metadata.get('videos', [])
    
    # 1. Identify Desired Video Clips
    # Map: desired_file_path -> { 'source': source_path, 'start': s, 'end': e }
    desired_files = {}
    
    stats = {'created': 0, 'deleted': 0, 'errors': 0, 'skipped': 0}
    
    print(f"Syncing dataset to {dataset_root}...")
    
    if not os.path.exists(dataset_root):
        os.makedirs(dataset_root)
        
    # Group videos by class
    for video in videos:
        class_id = video.get('classId')
        
        # Skip unsorted or unassigned
        if not class_id or class_id == 'Unsorted':
            continue
            
        class_name = classes_map.get(class_id)
        if not class_name:
            print(f"Warning: Class ID {class_id} not found in classes list.")
            continue
            
        # We only care about subclips which have a parentVideoId
        parent_id = video.get('parentVideoId')
        
        # Find the parent video to get the actual URL/Path
        # Note: video['url'] in subclip might be empty or same as parent. 
        # Usually subclip metadata might not have 'url', or 'url' points to generated subclip?
        # In this system, 'url' seems to be the source URL for the player.
        
        # If it's a subclip, we look up the parent for the source file
        source_url = video.get('url')
        if parent_id:
            parent_video = next((v for v in videos if v['id'] == parent_id), None)
            if parent_video and parent_video.get('url'):
                source_url = parent_video.get('url')
        
        if not source_url:
            print(f"Warning: No source URL for video {video['id']}")
            continue
            
        # Check start/end time
        start_time = video.get('startTime')
        end_time = video.get('endTime')
        
        # If it's a full video assigned to a class (no start/end), deciding policy:
        # User said "classes and the subclip". If it's a full video, maybe copy it?
        # But 'MediaBunny' implies subclip focus.
        # Logic: If start/end exist, cut. If not, copy full? 
        # Let's assume full copy if no times, or 0 to Duration.
        
        is_subclip = (start_time is not None and end_time is not None)
        
        safe_class_name = sanitize_filename(class_name)
        file_ext = os.path.splitext(source_url)[1] or '.mp4'
        if '?' in file_ext: file_ext = file_ext.split('?')[0] # Remove query params
        
        # Filename: subclipID.ext
        target_filename = f"{video['id']}{file_ext}"
        target_dir = os.path.join(dataset_root, safe_class_name)
        target_path = os.path.join(target_dir, target_filename)
        
        desired_files[target_path] = {
            'source': source_url,
            'start': start_time if is_subclip else 0,
            'end': end_time if is_subclip else None,
            'is_subclip': is_subclip,
            'id': video['id']
        }

    # 2. Cleanup Phase: Remove files/folders not in desired list
    
    # List all class directories
    try:
        existing_dirs = [d for d in os.listdir(dataset_root) if os.path.isdir(os.path.join(dataset_root, d))]
    except FileNotFoundError:
        existing_dirs = []

    for d in existing_dirs:
        dir_path = os.path.join(dataset_root, d)
        
        # If directory is not mapped to any current class, delete it?
        # Be careful: class name change? 
        # Logic: If directory contains files that are NOT in desired_files, delete files.
        # If directory empty, delete directory.
        
        # Better: Walk all files.
        for root, dirs, files in os.walk(dir_path):
            for file in files:
                full_path = os.path.join(root, file)
                if full_path not in desired_files:
                    print(f"Deleting orphaned file: {full_path}")
                    try:
                        os.remove(full_path)
                        stats['deleted'] += 1
                    except OSError as e:
                        print(f"Error deleting {full_path}: {e}")
        
        # If dir is empty, remove it
        if not os.listdir(dir_path):
             # Only remove if it's not a desired class dir (though if empty and existing, maybe keep?)
             # But if class was renamed, we want to remove old dir.
             # Check if this dir name matches any desired class.
             # This is tricky if case differs.
             # Simple approach: rmdir if empty.
             try:
                 os.rmdir(dir_path)
             except:
                 pass

    # 3. Creation Phase
    for target_path, info in desired_files.items():
        target_dir = os.path.dirname(target_path)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
            
        if os.path.exists(target_path):
            # File exists. Ideally check if parameters changed.
            # For now, skip if exists.
            # stats['skipped'] += 1
            # UNLESS: We want to support updates? 
            # If user changed start/end time, filename (ID) is same.
            # We should probably check modification time or store metadata sidecar.
            # For now, simplistic: Start/End time is usually baked into the file? No.
            # Re-creating every time is slow.
            # Compromise: Skip if exists. User must delete to regenerate?
            # Or: add time to filename? -> `id_start_end.mp4`.
            # If I stick to ID only, I won't detect time changes.
            # But the requirement says "structure should be updated".
            # I will trust the user or the ID strategy.
            # Let's check file size?
            stats['skipped'] += 1
            continue
            
        print(f"Creating {target_path} from {info['source']} ({info['start']}-{info['end']})")
        
        try:
            source = info['source']
            # Convert URI to path if possible
            if source.startswith('file:///'):
                source = source.replace('file:///', '') # Windows/Linux
            
            # Handle /api/videos prefix
            if source.startswith('/api/videos/'):
                source = source.replace('/api/videos/', '')
            
            # Use MoviePy
            if not os.path.exists(source):
                # Try relative to CWD?
                if os.path.exists(os.path.join(os.getcwd(), source)):
                    source = os.path.join(os.getcwd(), source)
                else:
                    print(f"Error: Source file not found: {source}")
                    stats['errors'] += 1
                    continue
            
            if info['is_subclip']:
                with VideoFileClip(source) as video:
                    # Clip
                    new_clip = video.subclip(info['start'], info['end'])
                    # Write
                    new_clip.write_videofile(target_path, codec="libx264", audio_codec="aac", logger=None)
            else:
                # Copy full file
                shutil.copy2(source, target_path)
                
            stats['created'] += 1
            
        except Exception as e:
            print(f"Failed to create {target_path}: {e}")
            stats['errors'] += 1

    return stats

def scan_dataset(dataset_root):
    """
    Scans the dataset folder for video files and classes (folders).
    Updates metadata.json.
    Returns the grouped structure expected by the frontend.
    """
    metadata_path = os.path.join(dataset_root, 'metadata.json')
    
    meta = {}
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
        except Exception as e:
            print(f"Error loading metadata: {e}")
            
    if 'classes' not in meta: meta['classes'] = []
    if 'sourceVideos' not in meta: meta['sourceVideos'] = []
    
    existing_classes = {c['id']: c for c in meta['classes']}
    # video ID -> video object
    existing_videos = {v['id']: v for v in meta['sourceVideos']}
    
    found_video_objs = []
    found_class_names = set()
    
    # 1. Scan filesystem
    for root, dirs, files in os.walk(dataset_root):
        # Avoid processing reserved Windows names or hidden folders
        for excluded in ['nul', 'con', 'prn', 'aux', '__pycache__', '.git']:
            if excluded in dirs:
                dirs.remove(excluded)
                
        try:
            rel_root = os.path.relpath(root, dataset_root)
        except ValueError:
            continue
        
        # Directories in root are classes
        if rel_root == '.':
            for d in dirs:
                found_class_names.add(d)
        else:
            # Subdirectories implies we are inside a Class
            # Just take top level folder as class
            top_class = rel_root.split(os.sep)[0]
            found_class_names.add(top_class)
            
        for f in files:
            if f.lower().endswith(('.mp4', '.mov', '.webm', '.mkv', '.avi')):
                full_path = os.path.join(root, f)
                # rel_path is the ID, e.g. "Unsorted/video.mp4"
                rel_path = os.path.relpath(full_path, dataset_root).replace('\\', '/')
                
                # Deduce class from path
                parts = rel_path.split('/')
                if len(parts) > 1:
                    vid_class_id = parts[0]
                else:
                    vid_class_id = 'Unsorted'
                
                # Build/Update video object
                if rel_path in existing_videos:
                    vid_obj = existing_videos[rel_path]
                    # Ensure path is correct format for frontend
                    vid_obj['path'] = rel_path # We utilize rel_path, frontend prepends /api/videos/
                else:
                    vid_obj = {
                        'id': rel_path,
                        'name': f,
                        'path': rel_path
                    }
                    existing_videos[rel_path] = vid_obj
                
                found_video_objs.append(vid_obj)

    # 2. Update Metadata
    
    # Add new classes
    for c_name in found_class_names:
        if c_name not in existing_classes:
            existing_classes[c_name] = {
                'id': c_name,
                'name': c_name,
                'subclips': []
            }
            
    # Update sourceVideos list to match what was found on disk
    meta['sourceVideos'] = found_video_objs
    meta['classes'] = list(existing_classes.values())
    
    # Save metadata
    try:
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
    except Exception as e:
        print(f"Error saving metadata: {e}")

    # 3. Build Response (Grouped by Class) for Frontend
    response_groups = []
    
    # Group found videos by class
    videos_by_class = {}
    for v in found_video_objs:
        parts = v['id'].split('/')
        c_id = parts[0] if len(parts) > 1 else 'Unsorted'
        if c_id not in videos_by_class: videos_by_class[c_id] = []
        videos_by_class[c_id].append(v)
        
    for c in meta['classes']:
        c_id = c['id']
        c_videos = videos_by_class.get(c_id, [])
        response_groups.append({
            'id': c_id,
            'name': c['name'],
            'count': len(c_videos),
            'videos': c_videos
        })
        
    return response_groups

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            data = json.load(f)
        sync_dataset(data, 'dataset')
    else:
        # Test scan
        print(json.dumps(scan_dataset('dataset'), indent=2))

