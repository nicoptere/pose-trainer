
'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Card, CardMedia, Typography, Box } from '@mui/material';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    id: string;
    url: string;
    thumbnailUrl?: string; // Base64 or standard URL
    name: string;
    width?: number;
    onClick?: () => void;
    onHover?: (e: React.MouseEvent, videoId: string) => void;
    onLeave?: () => void;
}

export function DraggableVideo({ id, url, thumbnailUrl, name, width = 80, onClick, onHover, onLeave }: Props) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: id,
        data: { type: 'video' }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        cursor: 'grab',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={onClick}
            onMouseEnter={(e) => onHover?.(e, id)}
            onMouseLeave={onLeave}
        >
            <Card sx={{ width: width, m: 0.5, boxShadow: 1 }}>
                {thumbnailUrl ? (
                    <CardMedia
                        component="img"
                        src={thumbnailUrl}
                        sx={{ height: width * 0.56, bgcolor: 'black', objectFit: 'cover' }} // approx 16:9
                    />
                ) : (
                    <CardMedia
                        component="video"
                        src={url}
                        sx={{ height: width * 0.56, bgcolor: 'black' }}
                    />
                )}
                <Box sx={{ p: 0.5 }}>
                    <Typography variant="caption" noWrap display="block" title={name} sx={{ fontSize: '0.6rem' }}>
                        {name}
                    </Typography>
                </Box>
            </Card>
        </div>
    );
}
