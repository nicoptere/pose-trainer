
'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { IconButton, Paper, Typography, Box } from '@mui/material';
import { Delete } from '@mui/icons-material';

interface Props {
    id: string;
    title: string;
    children: React.ReactNode;
    onDelete?: (id: string) => void | Promise<void>;
}

export function DroppableClass({ id, title, children, onDelete }: Props) {
    const { isOver, setNodeRef } = useDroppable({
        id: id,
    });

    const style = {
        backgroundColor: isOver ? '#e3f2fd' : 'white',
        transition: 'background-color 0.2s',
    };

    return (
        <Paper
            ref={setNodeRef}
            elevation={1}
            sx={{ p: 1, minHeight: 100, minWidth: 100, ...style }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" color={isOver ? 'primary' : 'textPrimary'} fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                    {title}
                </Typography>
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

            <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {children}
            </Box>
        </Paper>
    );
}
