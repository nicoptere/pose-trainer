
import { create } from 'zustand';

export interface Subclip {
  label: string;
  startTime: number;
  endTime: number;
}

export interface VideoClip {
  id: string; // "Class/Filename.mp4" or "Unsorted/Filename.mp4"
  name: string;
  url: string; // "/api/videos/Class/Filename.mp4"
  blob?: Blob; // For new recordings
  classId: string; // "Unsorted", "Squat", etc.
  subclips: Subclip[];
}

export interface GestureClass {
  id: string;
  name: string;
  count: number;
}

interface AppState {
  classes: GestureClass[];
  videos: VideoClip[];
  
  fetchDataset: () => Promise<void>;
  
  // Actions
  addClass: (name: string) => void;
  addRecording: (blob: Blob) => void;
  deleteRecording: (id: string) => void;
  moveVideo: (videoId: string, targetClassId: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  classes: [],
  videos: [],

  fetchDataset: async () => {
    try {
      const res = await fetch('/api/videos');
      const data = await res.json();
      
      const loadedClasses: GestureClass[] = [];
      const loadedVideos: VideoClip[] = [];

      // @ts-ignore
      data.forEach((group: any) => {
        loadedClasses.push({ id: group.id, name: group.name, count: group.count });
        // @ts-ignore
        group.videos.forEach((vid: any) => {
          loadedVideos.push({
            id: vid.id,
            name: vid.name,
            url: `/api/videos/${vid.path}`,
            classId: group.id,
            subclips: [] // Initialize with empty list, or load from sidecar JSON later
          });
        });
      });

      set({ classes: loadedClasses, videos: loadedVideos });
    } catch (err) {
      console.error("Failed to fetch dataset", err);
    }
  },

  addClass: (name) => set((state) => ({
    classes: [...state.classes, { id: name, name, count: 0 }]
  })),

  addRecording: (blob) => {
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `rec-${date}.webm`;
    
    set((state) => ({
      videos: [...state.videos, {
        id: `Unsorted/${name}`,
        name,
        url,
        blob,
        classId: 'Unsorted',
        subclips: [] 
      }]
    }));
  },

  deleteRecording: (id) => set((state) => ({
    videos: state.videos.filter(r => r.id !== id)
  })),

  moveVideo: (videoId, targetClassId) => set((state) => {
    // 1. Find video
    const video = state.videos.find(v => v.id === videoId);
    if (!video) return state;

    // 2. Remove from old list, Add to new list (Update classId)
    // Ideally call API here to move file on disk
    
    return {
      videos: state.videos.map(v => 
        v.id === videoId ? { ...v, classId: targetClassId } : v
      )
    };
  }),
}));
