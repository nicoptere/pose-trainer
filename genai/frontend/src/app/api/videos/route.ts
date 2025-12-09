
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATASET_DIR = path.join(process.cwd(), '../dataset');

export async function GET() {
  try {
    // Ensure dataset dir exists
    if (!fs.existsSync(DATASET_DIR)) {
      return NextResponse.json({ error: 'Dataset directory not found' }, { status: 404 });
    }

    const classes = fs.readdirSync(DATASET_DIR).filter(file => {
        return fs.statSync(path.join(DATASET_DIR, file)).isDirectory();
    });

    const structure = classes.map(cls => {
      const classPath = path.join(DATASET_DIR, cls);
      const videos = fs.readdirSync(classPath)
        .filter(file => file.endsWith('.mp4') || file.endsWith('.webm'))
        .map(file => ({
            id: `${cls}/${file}`, // Path as ID
            name: file,
            path: `${cls}/${file}`
        }));
      
      return {
        id: cls,
        name: cls,
        count: videos.length,
        videos: videos
      };
    });

    return NextResponse.json(structure);
  } catch (error) {
    console.error('Error reading dataset:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
