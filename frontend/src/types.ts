export interface Gesture {
    id: string;
    name: string;
    description: string;
    videoUrl?: string; // Object URL for preview or path
    timestamp: number;
}
