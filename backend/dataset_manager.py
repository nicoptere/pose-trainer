import os
import json
import shutil
import re
import traceback
import io
import numpy as np
import base64
from PIL import Image
from moviepy.editor import VideoFileClip, vfx
from moviepy.video.io.ffmpeg_writer import ffmpeg_write_video

def sanitize_filename(name):
    """Sanitize string to be safe for directory/filenames."""
    return re.sub(r'[<>:"/\\|?*]', '_', name).strip()

def generate_thumbnail(video_path):
    """Generates a base64 JPEG thumbnail from the first frame of a video using MoviePy and PIL."""
    try:
        # Use MoviePy to get the first frame
        with VideoFileClip(video_path) as clip:
            # get_frame returns a numpy array representing the frame at t=0
            frame = clip.get_frame(0)
            
            # Convert numpy array to PIL Image
            image = Image.fromarray(frame)
            
            # Resize to reasonable thumbnail size
            target_width = 200
            w_percent = (target_width / float(image.size[0]))
            h_size = int((float(image.size[1]) * float(w_percent)))
            
            # Use LANCZOS for high quality downsampling
            image = image.resize((target_width, h_size), Image.Resampling.LANCZOS)
            
            # Encode as JPEG to memory buffer
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=70)
            jpg_as_text = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            return f"data:image/jpeg;base64,{jpg_as_text}"
            
    except Exception as e:
        print(f"Thumbnail generation failed for {video_path}: {e}")
        return None

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

    # Read existing metadata BEFORE scan_dataset overwrites it
    old_subclips_map = {}
    metadata_path = os.path.join(dataset_root, 'metadata.json')
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                old_meta = json.load(f)
                for c in old_meta.get('classes', []):
                    if 'subclips' in c:
                        for sc in c['subclips']:
                            old_subclips_map[sc['id']] = sc
        except: pass

    # 1. Recover Source Videos from Disk (Preserve Inputs)
    # The frontend might send a partial list of sourceVideos. We MUST NOT delete existing source videos on disk.
    # We treat the Disk as the Authority for what Source Videos exist.
    # We treat the Frontend as the Authority for Classes and Subclips.
    
    current_disk_state = scan_dataset(dataset_root)
    # current_disk_state is a list of groups. We need to extract source videos.
    disk_source_videos = []
    for group in current_disk_state:
        for v in group['videos']:
            # Double check to ensure we DON'T add subclips to sourceVideos
            if v['id'].startswith('subclip-'): continue

            # We assume everything on disk is a potential source video if it's not a known subclip?
            # Actually, scan_dataset returns everything.
            # We want to ensure 'videos' list (used for desired_files) includes ALL these.
            
            # Use the path from the scan result
            # v['path'] is e.g. "Unsorted/video.mp4"
            disk_source_videos.append({
                'id': v['id'],
                'name': v['name'],
                'path': v['path']
                # classId is group['id']
            })

    # Prepare final 'videos' list for processing
    # We start with the disk source videos (so they are automatically "desired")
    videos = list(disk_source_videos)
    
    # Now merge/add subclips from Frontend Metadata
    # And potentially overwrite source video metadata if frontend has newer info? 
    # (For now, just appending subclips is key).
    
    if 'classes' in metadata:
        for c in metadata['classes']:
            if 'subclips' in c:
                for sc in c['subclips']:
                    sc['classId'] = c['id']
                    videos.append(sc)

    # Sync Metadata.json with reality + subclips
    # We want to save a metadata.json that has:
    # classes: from Frontend
    # sourceVideos: from Disk (so we don't lose them)
    # This ensures consistency.
    
    metadata_to_save = {
        'metadata': metadata.get('metadata', {}),
        'classes': metadata.get('classes', []),
        'sourceVideos': disk_source_videos
    }

    try:
        metadata_path = os.path.join(dataset_root, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata_to_save, f, indent=2)
        print(f"Saved updated metadata.json")
    except Exception as e:
        print(f"Error saving metadata.json: {e}")

    # 2. Identify Desired Video Clips
    desired_files = {}
    stats = {'created': 0, 'deleted': 0, 'errors': 0, 'skipped': 0, 'error_messages': []}
    
    print(f"Syncing dataset to {dataset_root}...")
    
    if not os.path.exists(dataset_root):
        os.makedirs(dataset_root)
        
    for video in videos:
        # Determine Target Path
        class_id = video.get('classId')
        
        # Determine Source Path (for copying/subclipping)
        source_url = video.get('url') or video.get('path')
        parent_id = video.get('parentVideoId')
        
        if parent_id:
             # It's a subclip, find parent in our list
             parent = next((v for v in videos if v.get('id') == parent_id), None)
             if parent:
                 source_url = parent.get('url') or parent.get('path')
        
        # Subclip Detection
        start_time = video.get('startTime')
        end_time = video.get('endTime')
        is_subclip = (start_time is not None and end_time is not None)
        
        # Class Name Resolution
        if not class_id:
            # Try to deduce from path if source video
            if not is_subclip and video.get('path'):
                parts = video['path'].split('/')
                class_id = parts[0] if len(parts) > 1 else 'Unsorted'
            else:
                class_id = 'Unsorted'

        class_name = classes_map.get(class_id, class_id)
        safe_class_name = sanitize_filename(class_name)
        
        # Target Filename
        if is_subclip:
            # SKIP subclips in Unsorted (virtual only)
            if class_id == 'Unsorted':
                continue

            ext = '.mp4'
            if source_url:
                _, ext = os.path.splitext(source_url)
                if '?' in ext: ext = ext.split('?')[0]
                if not ext: ext = '.mp4'
            
            target_filename = f"{video['id']}{ext}"
            target_path = os.path.join(dataset_root, safe_class_name, target_filename)
        else:
            # Source Video - preserve path
            if video.get('path'):
                target_path = os.path.join(dataset_root, video['path'])
            else:
                # Should not happen for disk_source_videos
                target_path = os.path.join(dataset_root, safe_class_name, f"{video['id']}.mp4")

        desired_files[target_path] = {
            'source': source_url,
            'start': start_time,
            'end': end_time,
            'is_subclip': is_subclip,
            'id': video.get('id'),
            'crop': video.get('crop'),
            'thumbnailUrl': video.get('thumbnailUrl')
        }

    # 3. Cleanup Phase
    # (Delete files not in desired_files)
    try:
        existing_dirs = [d for d in os.listdir(dataset_root) if os.path.isdir(os.path.join(dataset_root, d))]
    except FileNotFoundError:
        existing_dirs = []

    for d in existing_dirs:
        dir_path = os.path.join(dataset_root, d)
        for root, dirs, files in os.walk(dir_path):
            for file in files:
                full_path = os.path.join(root, file)
                # Normalization for comparison
                full_path_norm = os.path.normpath(full_path)
                
                # Normalization for comparison
                # Optimization: Normalize desired keys once?
                if 'desired_norm' not in locals():
                     desired_norm = set(os.path.normpath(dp) for dp in desired_files)

                is_desired = False
                if full_path_norm in desired_norm:
                    is_desired = True
                
                # Protect sidecar audio files
                if not is_desired and file.endswith('.wav'):
                    # Check if the corresponding video file is desired
                    base_acc = os.path.splitext(full_path_norm)[0]
                    # Try common video extensions
                    for vext in ['.mp4', '.mov', '.webm', '.mkv', '.avi']:
                        if (base_acc + vext) in desired_norm:
                            is_desired = True
                            break

                if not is_desired:
                    # Don't delete metadata.json!
                    if file == 'metadata.json': continue
                    
                    print(f"Deleting orphaned file: {full_path}")
                    try:
                        os.remove(full_path)
                        stats['deleted'] += 1
                    except OSError as e:
                        msg = f"Error deleting {full_path}: {e}"
                        print(msg)
                        stats['error_messages'].append(msg)
        
    # Remove empty dirs (except Unsorted, maybe?)
    if not os.listdir(dir_path):
            try:
                os.rmdir(dir_path)
            except: pass

    # 4. Creation Phase
    for target_path, info in desired_files.items():
        if os.path.exists(target_path):
            # Check for changes if it's a subclip
            should_recompute = False
            if info['is_subclip']:
                # Check if audio file exists (if not, we must recompute to generate it)
                audio_path = os.path.splitext(target_path)[0] + ".wav"
                if not os.path.exists(audio_path):
                        print(f"Subclip {info['id']} missing audio: recomputing...")
                        should_recompute = True

                old_sc = old_subclips_map.get(info['id'])
                if old_sc and not should_recompute:
                    # Compare key properties
                    # We use a small epsilon for floats if needed, but equality is usually fine for JSON roundtrip
                    # Or check thumbnailUrl as user suggested (data url change)
                    # We check both to be safe.
                    if (old_sc.get('startTime') != info['start'] or 
                        old_sc.get('endTime') != info['end'] or
                        old_sc.get('crop') != info['crop'] or
                        old_sc.get('thumbnailUrl') != info.get('thumbnailUrl')):
                        print(f"Subclip {info['id']} updated, recomputing...")
                        should_recompute = True
            
            if not should_recompute:
                stats['skipped'] += 1
                continue
            
        try:
            print(f"Creating {target_path} from {info['source']} ...".encode('utf-8', errors='replace').decode('utf-8'))
        except:
             print(f"Creating {target_path} ...")
        
        try:
            source = info['source']
            if not source:
                msg = f"Skipping {target_path}: No source defined"
                print(msg)
                stats['errors'] += 1
                stats['error_messages'].append(msg)
                continue

            # Path Resolution Fix
            # Remove /api/videos/ prefix if present
            if source.startswith('/api/videos/'): source = source.replace('/api/videos/', '')
            if source.startswith(os.getcwd()): source = os.path.relpath(source, os.getcwd()) # Simplify
            
            # Check locations
            possible_paths = [
                source,
                os.path.join(dataset_root, source), # Check inside dataset
                os.path.join(os.getcwd(), source)
            ]
            
            found_source = None
            for p in possible_paths:
                if os.path.exists(p):
                    found_source = p
                    break
            
            if not found_source:
                 msg = f"Error: Source file not found: {source}"
                 print(msg)
                 stats['errors'] += 1
                 stats['error_messages'].append(msg)
                 continue
                 
            # Create Directory
            target_dir = os.path.dirname(target_path)
            if not os.path.exists(target_dir):
                os.makedirs(target_dir)

            if info['is_subclip']:
                print(f"DEBUG: Processing subclip. Source: {found_source}, Start: {info['start']}, End: {info['end']}")
                
                # Ensure times are floats
                start_t = float(info['start'])
                end_t = float(info['end'])
                
                # Create a temporary safe filename for processing to avoid issues with special chars
                temp_safe_source = f"temp_source_{info.get('id', 'video')}.mp4"
                temp_safe_source = sanitize_filename(temp_safe_source)
                shutil.copy2(found_source, temp_safe_source)

                try:
                    with VideoFileClip(temp_safe_source) as video:
                        new_clip = video.subclip(start_t, end_t)
                        
                        # Apply Crop if present
                        if info.get('crop'):
                            c = info['crop']
                            w, h = new_clip.size
                            x1 = int(c['x'] * w)
                            y1 = int(c['y'] * h)
                            width = int(c['width'] * w)
                            height = int(c['height'] * h)
                            
                            new_clip = new_clip.fx(vfx.crop, x1=x1, y1=y1, width=width, height=height)

                        # Explicitly handle FPS
                        my_fps = new_clip.fps 
                        if not my_fps and hasattr(video, 'fps'):
                             my_fps = video.fps
                        
                        if not my_fps:
                            print("Warning: Could not detect FPS from source. Defaulting to 30 fps.")
                            my_fps = 30.0
                        
                        my_fps = float(my_fps)
                        print(f"DEBUG: Writing video with FPS={my_fps}")

                        # Set FPS on the clip object itself
                        new_clip.fps = my_fps
                        
                        # Explicitly set duration to ensure subclip bounds are respected
                        # This fixes "duration leaking" from parent clip when bypassing decorators
                        new_clip = new_clip.set_duration(end_t - start_t)
                        new_clip.start = 0
                        new_clip.end = end_t - start_t
                        
                        # Ensure metadata application (Duration)
                        expected_duration = end_t - start_t
                        print(f"DEBUG: Writing subclip. Expected Duration: {expected_duration:.4f}s, Clip Duration: {new_clip.duration:.4f}s")

                        # Write Audio File separately (requested feature)
                        if new_clip.audio:
                            audio_target_path = os.path.splitext(target_path)[0] + ".wav"
                            print(f"DEBUG: Writing separate audio to {audio_target_path}")
                            new_clip.audio.write_audiofile(audio_target_path, codec='pcm_s16le', verbose=False, logger=None)

                        # Write video with audio
                        # Reverting to write_videofile to ensure proper audio muxing
                        new_clip.write_videofile(
                            target_path, 
                            fps=my_fps, 
                            codec="libx264", 
                            audio_codec="aac", 
                            temp_audiofile=f"temp-audio-{info['id']}.m4a",
                            remove_temp=True,
                            verbose=False,
                            logger=None
                        )
                finally:
                    if os.path.exists(temp_safe_source):
                        try:
                            os.remove(temp_safe_source)
                        except: pass
            else:
                # Copy full file (Source Video) - only if we are restoring/moving
                if found_source != target_path:
                    shutil.copy2(found_source, target_path)
                
            stats['created'] += 1
            
        except Exception as e:
            traceback_str = traceback.format_exc()
            msg = f"Failed to create {target_path}: {str(e)}\n{traceback_str}"
            print(msg)
            stats['errors'] += 1
            stats['error_messages'].append(msg)

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
            # Skip hidden files
            if f.startswith('.'): continue
            
            # Skip generated subclips (they should not appear in sourceVideos)
            if f.startswith('subclip-'): continue

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
                    
                    if 'thumbnailUrl' not in vid_obj:
                         vid_obj['thumbnailUrl'] = generate_thumbnail(full_path)
                else:
                    vid_obj = {
                        'id': rel_path,
                        'name': f,
                        'path': rel_path,
                        'thumbnailUrl': generate_thumbnail(full_path)
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
        
        # Merge subclips from metadata into the response
        if 'subclips' in c:
            for sc in c['subclips']:
                # Construct video object for frontend
                # Point 'path' to parentVideoId so frontend constructs correct stream URL
                subclip_obj = {
                    'id': sc['id'],
                    'name': sc['name'],
                    'path': sc['parentVideoId'],
                    'parentVideoId': sc['parentVideoId'],
                    'startTime': sc.get('startTime'),
                    'endTime': sc.get('endTime'),
                    'crop': sc.get('crop'),
                    'color': sc.get('color'),
                    'thumbnailUrl': sc.get('thumbnailUrl')
                }
                c_videos.append(subclip_obj)

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

