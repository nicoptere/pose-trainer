import os
import cv2
import mediapipe as mp
import pandas as pd
import numpy as np

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5, min_tracking_confidence=0.5)

# Define output file
OUTPUT_FILE = 'output/data.csv'
VIDEO_DIR = 'videos'

def extract_landmarks(video_path, class_name):
    cap = cv2.VideoCapture(video_path)
    data = []
    
    frame_count = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
            
        # Convert the BGR image to RGB
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image.flags.writeable = False
        
        # Process the image and detect the pose
        results = pose.process(image)
        
        if results.pose_landmarks:
            # Extract landmarks
            landmarks = results.pose_landmarks.landmark
            row = []
            for lm in landmarks:
                row.extend([lm.x, lm.y, lm.z, lm.visibility])
            
            row.append(class_name)
            data.append(row)
            
        frame_count += 1
        
    cap.release()
    return data

def main():
    all_data = []
    
    # Check if video directory exists
    if not os.path.exists(VIDEO_DIR):
        print(f"Directory {VIDEO_DIR} not found.")
        return

    # Iterate through each folder in videos directory
    for class_folder in os.listdir(VIDEO_DIR):
        class_path = os.path.join(VIDEO_DIR, class_folder)
        
        if not os.path.isdir(class_path):
            continue
            
        print(f"Processing class: {class_folder}")
        
        for video_file in os.listdir(class_path):
            video_path = os.path.join(class_path, video_file)
            
            # Skip non-video files (simple check)
            if not video_file.lower().endswith(('.mp4', '.mov', '.avi', '.mkv')):
                continue
                
            print(f"  Extracting from: {video_file}")
            video_data = extract_landmarks(video_path, class_folder)
            all_data.extend(video_data)
            
    # Create DataFrame and save to CSV
    if all_data:
        # Create column names
        columns = []
        for i in range(33):
            columns.extend([f'x{i}', f'y{i}', f'z{i}', f'v{i}'])
        columns.append('class')
        
        df = pd.DataFrame(all_data, columns=columns)
        df.to_csv(OUTPUT_FILE, index=False)
        print(f"Extraction complete. Data saved to {OUTPUT_FILE}")
        print(f"Total samples: {len(df)}")
        print(df['class'].value_counts())
    else:
        print("No data extracted. Ensure 'videos/' contains subfolders with video files.")

if __name__ == "__main__":
    main()
