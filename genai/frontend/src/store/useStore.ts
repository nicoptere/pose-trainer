
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VideoClip {
  id: string; // "Class/Filename.mp4" or "Unsorted/Filename.mp4" or "subclip-uuid"
  name: string;
  url: string; // "/api/videos/Class/Filename.mp4"
  blob?: Blob; // For new recordings
  classId: string; // "Unsorted", "Squat", etc.
  
  // Subclip specific
  parentVideoId?: string;
  startTime?: number;
  endTime?: number;
  thumbnailUrl?: string;
  color?: string;
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
  // NEW: Add a virtual subclip
  addSubclip: (parentVideo: VideoClip, start: number, end: number, color: string, thumbnail: string) => void;
  
  deleteRecording: (id: string) => void;
  moveVideo: (videoId: string, targetClassId: string) => void;
  // updateSubclips removed in favor of addSubclip logic
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      classes: [],
      videos: [],

      fetchDataset: async () => {
        try {
          const res = await fetch('/api/videos');
          const data = await res.json();
          
          const loadedClasses: GestureClass[] = [];
          
          // Current state (restored from LS)
          const currentVideos = get().videos; 
          const persistedSubclips = currentVideos.filter(v => v.parentVideoId); // Keep all subclips
          
          const loadedVideos: VideoClip[] = [...persistedSubclips]; // Start with subclips

          // Placeholders for checking if API video is already known (e.g. moved class)
          // We can't easily know if a file moved on disk vs moved in UI. 
          // Implementation simplification: 
          // 1. If video ID exists in LS, take its 'classId' from LS? 
          //    YES, if we want persistence of "Unsorted -> Class" moves.
          //    BUT if the user moved it on disk, the API reports new class. API truth should usually win for disk location.
          //    However, `moveVideo` tool updates UI state. The actual backend file move is NOT IMPLEMENTED yet in this memory.
          //    So 'classId' in store is purely virtual for now.
          
          // Implementation: Trust API for existence, trust LS for metadata?
          // Let's just load API videos and if they match an ID in LS, maybe preserve some props?
          
          // @ts-ignore
          data.forEach((group: any) => {
            loadedClasses.push({ id: group.id, name: group.name, count: group.count });
            // @ts-ignore
            group.videos.forEach((vid: any) => {
              // Ensure we don't duplicate if it was somehow in subclips (unlikely)
              
              const existing = currentVideos.find(v => v.id === vid.id);
              
              loadedVideos.push({
                id: vid.id,
                name: vid.name,
                url: `/api/videos/${vid.path}`,
                // If we have a local override for classId (moved in UI but not on disk), should we use it? 
                // For this task, let's stick to API truth for main files to avoid confusion.
                classId: group.id, 
                // No subclips array anymore
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
            classId: 'Unsorted'
          }]
        }));
      },

      deleteRecording: (id) => set((state) => ({
        videos: state.videos.filter(r => r.id !== id)
      })),

      moveVideo: (videoId, targetClassId) => set((state) => {
        return {
          videos: state.videos.map(v => 
            v.id === videoId ? { ...v, classId: targetClassId } : v
          )
        };
      }),

      addSubclip: (parentVideo, start, end, color, thumbnail) => set((state) => {
          const id = `subclip-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
          // Subclips default to "Unsorted" (or same class as parent? User said "dragged to classes", implying they start unsorted or user chooses).
          // Let's put them in 'Unsorted' initially so they appear in Inbox, ready to be dragged.
          const newClip: VideoClip = {
              id,
              name: `${parentVideo.name} (Clip)`, // Or allow user naming
              url: parentVideo.url,
              classId: 'Unsorted',
              parentVideoId: parentVideo.id,
              startTime: start,
              endTime: end,
              thumbnailUrl: thumbnail,
              color: color
          };
          return { videos: [...state.videos, newClip] };
      }),

    }),
    {
      name: 'gesture-lab-storage',
      partialize: (state) => ({ 
          // Persist all videos, including subclips (which have parentVideoId)
          videos: state.videos.map(v => ({ 
              id: v.id, 
              // We need to persist standard metadata for subclips too
              classId: v.classId,
              parentVideoId: v.parentVideoId,
              startTime: v.startTime,
              endTime: v.endTime,
              thumbnailUrl: v.thumbnailUrl,
              color: v.color,
              name: v.name
          })) 
      }),
      merge: (persistedState: any, currentState) => {
           // We need to merge loaded files from API with persisted subclips from localStorage
           // API provides the "real" files. LocalStorage provides the Subclips and the "classId" for real files (if moved).
           
           // This logic is tricky. Simplified approach:
           // 1. Recover subclips from LS.
           // 2. Recover classId overrides for real files from LS.
           // 3. videos list is mixture of API videos (fresh) + LS subclips.
           
           // Since we don't have full logic here, we rely on `fetchDataset` to populate real videos, 
           // and we just blindly accept persisted subclips?
           // A better approach in `fetchDataset`:
           
           return {
               ...currentState,
               // We don't restore videos here, we let fetchDataset do it, BUT we need a way to pass persisted data to it.
               // Actually, `persist` restores state BEFORE `fetchDataset` is called in component.
               // So `get().videos` in `fetchDataset` has the restored data.
               videos: persistedState.videos || [] 
           }
      }
    }
  )
);
