
'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Card, CardMedia, Typography, Box, IconButton } from '@mui/material';
import { Delete } from '@mui/icons-material';
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
    onDelete?: () => void;
    color?: string;
    startTime?: number;
}

export function DraggableVideo({ id, url, thumbnailUrl, name, width = 80, onClick, onHover, onLeave, onDelete, color, startTime }: Props) {
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
            <Card sx={{
                width: width,
                m: 0.5,
                boxShadow: 1,
                position: 'relative',
                border: color ? `2px solid ${color}` : 'none',
                '&:hover .delete-btn': { opacity: 1 }
            }}>
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

                {onDelete && (
                    <IconButton
                        className="delete-btn"
                        size="small"
                        sx={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            bgcolor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            p: 0.2,
                            opacity: 0,
                            transition: 'opacity 0.2s',
                            '&:hover': { bgcolor: 'rgba(255,0,0,0.7)' }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <Delete fontSize="small" sx={{ fontSize: '1rem' }} />
                    </IconButton>
                )}
            </Card>
        </div>
    );
}
