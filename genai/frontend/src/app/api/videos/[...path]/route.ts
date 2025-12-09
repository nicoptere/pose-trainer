
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const DATASET_DIR = path.join(process.cwd(), '../dataset');

// Helper to convert Node stream to Web stream
function nodeStreamToIterator(stream: fs.ReadStream) {
  return new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(chunk));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    }
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: urlPath } = await params;
    const filePath = path.join(DATASET_DIR, ...urlPath);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const stream = nodeStreamToIterator(file);
      
      return new NextResponse(stream as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': 'video/mp4',
        },
      });
    } else {
      const file = fs.createReadStream(filePath);
      const stream = nodeStreamToIterator(file);
      return new NextResponse(stream as any, {
        headers: {
          'Content-Length': fileSize.toString(),
          'Content-Type': 'video/mp4',
        },
      });
    }

  } catch (error) {
    console.error('Error streaming video:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
