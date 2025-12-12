
'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { IconButton, Paper, Typography, Box, Switch, TextField, Button, Tooltip, Badge } from '@mui/material';
import { Delete, VolumeUp, VolumeOff, Psychology } from '@mui/icons-material';
import { GestureClass } from '../store/useStore';

interface Props {
    id: string;
    classData: GestureClass;
    children: React.ReactNode;
    onDelete?: (id: string) => void | Promise<void>;
    onUpdate?: (id: string, updates: Partial<GestureClass>) => void;
    onCompute?: (id: string) => void;
    columns?: number;
}

export function DroppableClass({ id, classData, children, onDelete, onUpdate, onCompute, columns }: Props) {
    const { isOver, setNodeRef } = useDroppable({
        id: id,
    });

    const style = {
        backgroundColor: isOver ? '#e3f2fd' : 'white',
        transition: 'background-color 0.2s',
        border: classData.isDirty ? '2px solid #ff9800' : '1px solid transparent'
    };

    return (
        <Paper
            ref={setNodeRef}
            elevation={1}
            sx={{
                p: 2,
                minHeight: 150,
                minWidth: 100,
                ...style,
                display: 'flex',
                flexDirection: 'row',
                gap: 2
            }}
        >
            {/* --- Left Column: Header, Grid, Compute (62%) --- */}
            <Box sx={{ width: '62%', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flexShrink: 0 }}>
                {/* Header: Title, Audio Toggle, Delete */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" color={isOver ? 'primary' : 'textPrimary'} fontWeight="bold" sx={{ fontSize: '1rem' }}>
                            {classData.name} ({classData.count})
                        </Typography>
                        {onUpdate && (
                            <Tooltip title={classData.hasAudio ? "Audio Enabled" : "Audio Disabled"}>
                                <IconButton
                                    size="small"
                                    onClick={() => onUpdate(id, { hasAudio: !classData.hasAudio })}
                                    color={classData.hasAudio ? "primary" : "default"}
                                >
                                    {classData.hasAudio ? <VolumeUp fontSize="small" /> : <VolumeOff fontSize="small" />}
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>

                    {onDelete && (
                        <IconButton
                            size="small"
                            onClick={() => onDelete(id)}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1, color: 'error.main' } }}
                        >
                            <Delete fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                {/* Video Grid */}
                <Box sx={{
                    flex: 1,
                    ...(columns ? {
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, 1fr)`,
                        gap: 1,
                        alignContent: 'start'
                    } : {
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        alignContent: 'start'
                    })
                }}>
                    {children}
                </Box>

                {/* Compute Button */}
                {onCompute && (
                    <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-start' }}>
                        <Button
                            variant="contained"
                            size="small"
                            color="secondary"
                            startIcon={<Psychology />}
                            onClick={() => onCompute(id)}
                            sx={{ fontSize: '0.7rem', textTransform: 'none' }}
                        >
                            Compute Features
                        </Button>
                    </Box>
                )}
            </Box>

            {/* --- Right Column: Caption (38%) --- */}
            {onUpdate && (
                <Box sx={{ width: '38%', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                    <TextField
                        fullWidth
                        multiline
                        placeholder="Class caption/description..."
                        value={classData.caption}
                        onChange={(e) => onUpdate(id, { caption: e.target.value })}
                        variant="outlined"
                        size="small"
                        InputProps={{
                            sx: {
                                height: '100%',
                                alignItems: 'flex-start',
                                overflowY: 'auto'
                            }
                        }}
                        sx={{
                            height: '100%',
                            '& .MuiInputBase-root': { height: '100%' },
                            '& textarea': { height: '100% !important', overflow: 'auto !important' }
                        }}
                    />
                </Box>
            )}
        </Paper>
    );
}
