import os
import json
import shutil
import re
import traceback
from moviepy.editor import VideoFileClip, vfx
from moviepy.video.io.ffmpeg_writer import ffmpeg_write_video

def sanitize_filename(name):
    return re.sub(r'[<>:"/\\|?*]', '_', name).strip()

def safe_print(msg):
    try:
        print(msg.encode('utf-8', errors='replace').decode('utf-8'))
    except:
        print("Message unprintable due to encoding error")

def test_creation():
    dataset_root = os.path.join(os.getcwd(), 'dataset')
    metadata_path = os.path.join(dataset_root, 'metadata.json')
    
    safe_print(f"Reading metadata from: {metadata_path}")
    
    try:
        with open(metadata_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        safe_print(f"Failed to load metadata: {e}")
        return

    # Extract all subclips from classes
    subclips = []
    if 'classes' in data:
        for cls in data['classes']:
            if 'subclips' in cls:
                subclips.extend(cls['subclips'])
    
    safe_print(f"Found {len(subclips)} subclips to process.")
    
    for info in subclips:
        safe_print("\n---------------------------------------------------")
        safe_print(f"Processing subclip: {info.get('id')}")
        
        # Determine source
        source_id = info.get('parentVideoId')
        safe_print(f"Parent Video ID: {source_id}")
        
        # Try to resolve source path
        source_url = source_id 
        
        possible_paths = [
            source_url,
            os.path.join(dataset_root, source_url),
            os.path.join(os.getcwd(), source_url)
        ]
        
        found_source = None
        for p in possible_paths:
            if os.path.exists(p):
                found_source = p
                safe_print(f"Found source at: {p}")
                break
        
        if not found_source:
            safe_print(f"ERROR: Source not found for {source_id}")
            continue

        # Create safe temp source
        try:
            temp_safe_source = f"debug_temp_{sanitize_filename(info['id'])}.mp4"
            print(f"Creating temp source copy: {temp_safe_source}")
            shutil.copy2(found_source, temp_safe_source)
            
            start_t = float(info['startTime'])
            end_t = float(info['endTime'])
            safe_print(f"Times: Start={start_t} (type {type(start_t)}), End={end_t} (type {type(end_t)})")
            
            with VideoFileClip(temp_safe_source) as video:
                safe_print(f"Video Loaded. Duration: {video.duration}, FPS: {video.fps}")
                
                new_clip = video.subclip(start_t, end_t)
                safe_print(f"Subclip created. Duration: {new_clip.duration}")
                
                if info.get('crop'):
                    c = info['crop']
                    w, h = new_clip.size
                    x1 = int(c['x'] * w)
                    y1 = int(c['y'] * h)
                    width = int(c['width'] * w)
                    height = int(c['height'] * h)
                    safe_print(f"Crop pixels: x1={x1}, y1={y1}, width={width}, height={height}")
                    new_clip = new_clip.fx(vfx.crop, x1=x1, y1=y1, width=width, height=height)
                
                my_fps = new_clip.fps or video.fps
                if not my_fps:
                    safe_print("FPS is None, defaulting to 30.0")
                    my_fps = 30.0
                
                my_fps = float(my_fps)
                
                # Use standard method to set FPS (returns new clip in some versions or modifies in place)
                # But safer to reassign
                if hasattr(new_clip, 'set_fps'):
                     new_clip = new_clip.set_fps(my_fps)
                else:
                     new_clip.fps = my_fps
                     
                safe_print(f"Final FPS set to: {new_clip.fps} (type {type(new_clip.fps)})")
                
                target_filename = f"debug_out_{sanitize_filename(info['id'])}.mp4"
                safe_print(f"Writing to: {target_filename}")
                
                # Write using internal writer to bypass decorators
                temp_audio = None
                try:
                    if new_clip.audio:
                        temp_audio = f"temp_audio_{sanitize_filename(info['id'])}.m4a"
                        new_clip.audio.write_audiofile(temp_audio, codec='aac')
                    
                    ffmpeg_write_video(new_clip, target_filename, new_clip.fps, codec="libx264", audiofile=temp_audio)
                    safe_print("SUCCESS: Video written (with audio).")
                except Exception as e:
                    safe_print(f"FAIL: Write failed: {e}")
                    traceback.print_exc()
                finally:
                    if temp_audio and os.path.exists(temp_audio):
                        try: os.remove(temp_audio)
                        except: pass

        except Exception as e:
            safe_print(f"An error occurred: {e}")
            traceback.print_exc()
        finally:
            if os.path.exists(temp_safe_source):
                try:
                    os.remove(temp_safe_source)
                    safe_print("Temp source removed.")
                except: pass

if __name__ == "__main__":
    test_creation()
