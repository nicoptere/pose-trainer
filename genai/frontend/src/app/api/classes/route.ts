import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATASET_DIR = path.join(process.cwd(), '../dataset');
const METADATA_PATH = path.join(DATASET_DIR, 'metadata.json');

interface Metadata {
    classes: string[];
    subclips: any[];
}

function readMetadata(): Metadata {
    if (fs.existsSync(METADATA_PATH)) {
        try {
            const content = fs.readFileSync(METADATA_PATH, 'utf-8');
            return JSON.parse(content);
        } catch {
            return { classes: [], subclips: [] };
        }
    }
    return { classes: [], subclips: [] };
}

function writeMetadata(metadata: Metadata): void {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
}

// GET - List all classes (directories + metadata)
export async function GET() {
    try {
        const metadata = readMetadata();
        
        // Get directories from filesystem
        const fsDirs = fs.existsSync(DATASET_DIR) 
            ? fs.readdirSync(DATASET_DIR).filter(f => 
                fs.statSync(path.join(DATASET_DIR, f)).isDirectory()
              )
            : [];
        
        // Merge with metadata classes (in case of empty directories or virtual classes)
        const allClasses = Array.from(new Set([...fsDirs, ...metadata.classes]));
        
        return NextResponse.json({ classes: allClasses });
    } catch (error) {
        console.error('Error reading classes:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST - Add a new class
export async function POST(request: NextRequest) {
    try {
        const { name } = await request.json();
        
        if (!name || typeof name !== 'string') {
            return NextResponse.json({ error: 'Invalid class name' }, { status: 400 });
        }
        
        // Sanitize name for filesystem
        const safeName = name.replace(/[<>:"/\\|?*]/g, '_').trim();
        if (!safeName) {
            return NextResponse.json({ error: 'Invalid class name' }, { status: 400 });
        }
        
        const classPath = path.join(DATASET_DIR, safeName);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(classPath)) {
            fs.mkdirSync(classPath, { recursive: true });
        }
        
        // Also add to metadata
        const metadata = readMetadata();
        if (!metadata.classes.includes(safeName)) {
            metadata.classes.push(safeName);
            writeMetadata(metadata);
        }
        
        return NextResponse.json({ success: true, name: safeName });
    } catch (error) {
        console.error('Error adding class:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE - Remove a class
export async function DELETE(request: NextRequest) {
    try {
        const { name } = await request.json();
        
        if (!name || typeof name !== 'string') {
            return NextResponse.json({ error: 'Invalid class name' }, { status: 400 });
        }
        
        // Don't allow deleting "Unsorted"
        if (name === 'Unsorted') {
            return NextResponse.json({ error: 'Cannot delete Unsorted class' }, { status: 400 });
        }
        
        const classPath = path.join(DATASET_DIR, name);
        
        // Move any videos in this class to Unsorted
        const unsortedPath = path.join(DATASET_DIR, 'Unsorted');
        if (!fs.existsSync(unsortedPath)) {
            fs.mkdirSync(unsortedPath, { recursive: true });
        }
        
        if (fs.existsSync(classPath)) {
            const files = fs.readdirSync(classPath);
            for (const file of files) {
                const srcFile = path.join(classPath, file);
                const destFile = path.join(unsortedPath, file);
                // Only move video files
                if (file.endsWith('.mp4') || file.endsWith('.webm')) {
                    fs.renameSync(srcFile, destFile);
                }
            }
            // Remove the directory if empty
            const remaining = fs.readdirSync(classPath);
            if (remaining.length === 0) {
                fs.rmdirSync(classPath);
            }
        }
        
        // Remove from metadata
        const metadata = readMetadata();
        metadata.classes = metadata.classes.filter(c => c !== name);
        // Unassign subclips from this class
        metadata.subclips = metadata.subclips.map(s => 
            s.classId === name ? { ...s, classId: 'Unsorted' } : s
        );
        writeMetadata(metadata);
        
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting class:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
