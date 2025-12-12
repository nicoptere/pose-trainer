import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    TextField,
    FormControlLabel,
    Switch,
    Button,
    Grid,
    Divider,
    Alert,
    CircularProgress
} from '@mui/material';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import SaveIcon from '@mui/icons-material/Save';

// Configuration Interface
interface GestureConfig {
    analysis_fps: number;
    output_path?: string;
    // Legacy/Unused fields removed or made optional
    gesture_min_seconds?: number;
    gesture_max_seconds?: number;
    n_clusters?: number | null;
    use_hdbscan?: boolean;
    dtw_downsample_factor?: number;
    sequence_length?: number;
    stride?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

import { useStore } from '../store/useStore';

export default function TrainingTab() {
    const [config, setConfig] = useState<GestureConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [training, setTraining] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [trainOutput, setTrainOutput] = useState<string | null>(null);

    const classes = useStore((state) => state.classes);

    // Fetch Config
    useEffect(() => {
        fetchConfig();
    }, []);

    // Sync n_clusters with class count if appropriate
    useEffect(() => {
        if (config && !config.use_hdbscan) {
            // Default to class count if n_clusters is not set, or if we want to enforce it.
            // We only enforce if current value is null or we are initializing.
            // But let's respect the user's manual change? 
            // The prompt says "use the classes from the classlist panel as n_clusters".
            // I will set it if it is null/0.
            if (config.n_clusters === null || config.n_clusters === 0) {
                setConfig(prev => prev ? ({ ...prev, n_clusters: classes.length }) : null);
            }
        }
    }, [config?.use_hdbscan, classes.length]);

    const fetchConfig = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/config/gesture`);
            if (!res.ok) throw new Error("Failed to load configuration");
            const data = await res.json();

            // If using defaults (hdbscan=false in main.py) and n_clusters is null, use class count
            if (!data.use_hdbscan && (data.n_clusters === null || data.n_clusters === 0)) {
                data.n_clusters = classes.length;
            }
            setConfig(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (field: keyof GestureConfig, value: any) => {
        if (!config) return;
        setConfig({
            ...config,
            [field]: value
        });
    };

    const handleSave = async () => {
        if (!config) return;
        try {
            setSaving(true);
            setSuccessMsg(null);
            setError(null);

            const res = await fetch(`${API_URL}/api/config/gesture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (!res.ok) throw new Error("Failed to save configuration");

            setSuccessMsg("Configuration saved successfully!");
            setTimeout(() => setSuccessMsg(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleRetrain = async () => {
        try {
            setTraining(true);
            setTrainOutput(null);
            setError(null);

            const res = await fetch(`${API_URL}/api/train/mediapipe`, {
                method: 'POST'
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Training failed");
            }

            setSuccessMsg("Mediapipe processing completed successfully!");
            setTrainOutput(data.output || "No output returned.");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTraining(false);
        }
    };

    const handleTrainClassifier = async () => {
        try {
            setTraining(true);
            setTrainOutput(null);
            setError(null);

            const res = await fetch(`${API_URL}/api/train/classifier`, {
                method: 'POST'
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Classifier training failed");
            }

            setSuccessMsg("Classifier training completed successfully!");
            setTrainOutput(data.output || "No output returned.");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTraining(false);
        }
    };

    if (loading) {
        return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
    }

    if (!config) {
        return <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="error">Could not load configuration.</Typography></Box>;
    }

    return (
        <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
            <Paper sx={{ p: 4, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                    <ModelTrainingIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                    <Box>
                        <Typography variant="h5" fontWeight="bold">Processing Configuration</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Configure parameters for gesture analysis and clustering
                        </Typography>
                    </Box>
                </Box>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                {successMsg && <Alert severity="success" sx={{ mb: 2 }}>{successMsg}</Alert>}

                <Grid container spacing={3}>
                    <Grid size={{ xs: 12 }}>
                        <TextField
                            fullWidth
                            label="Analysis FPS"
                            type="number"
                            value={config.analysis_fps}
                            onChange={(e) => handleInputChange('analysis_fps', Number(e.target.value))}
                            helperText="Frames per second to analyze (lower = faster)"
                        />
                    </Grid>

                    <Grid size={{ xs: 6 }}>
                        <TextField
                            fullWidth
                            label="Buffering Length (frames)"
                            type="number"
                            value={config.sequence_length || 150}
                            onChange={(e) => handleInputChange('sequence_length', Number(e.target.value))}
                            helperText="Number of frames to buffer (Default: 150 / 5s)"
                        />
                    </Grid>

                    <Grid size={{ xs: 6 }}>
                        <TextField
                            fullWidth
                            label="Stride"
                            type="number"
                            value={config.stride || 10}
                            onChange={(e) => handleInputChange('stride', Number(e.target.value))}
                            helperText="Sliding window step size (frames)"
                        />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <TextField
                            fullWidth
                            label="Output Destination"
                            value={config.output_path || 'genai/result'}
                            onChange={(e) => handleInputChange('output_path', e.target.value)}
                            helperText="Folder to save training artifacts and models"
                            slotProps={{
                                htmlInput: { placeholder: "genai/result" }
                            }}
                        />
                    </Grid>
                </Grid>

                <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end', borderTop: '1px solid #eee', pt: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<SaveIcon />}
                        onClick={handleSave}
                        disabled={saving}
                        size="small"
                    >
                        {saving ? 'Saving...' : 'Save Config'}
                    </Button>
                </Box>
            </Paper>

            <Paper sx={{ mt: 3, p: 3, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" fontWeight="bold">Training Pipeline</Typography>
                </Box>

                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Button
                            variant="contained"
                            color="warning"
                            onClick={handleRetrain}
                            disabled={training}
                            fullWidth
                            size="large"
                            sx={{ height: '100%' }}
                        >
                            {training ? <CircularProgress size={24} color="inherit" sx={{ mr: 1 }} /> : null}
                            <Box sx={{ textAlign: 'left' }}>
                                <Typography variant="button" display="block">1. Process Dataset</Typography>
                                <Typography variant="caption" display="block" sx={{ textTransform: 'none', opacity: 0.8 }}>
                                    Extract poses & Generate Manifest
                                </Typography>
                            </Box>
                        </Button>
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <Button
                            variant="contained"
                            color="success"
                            onClick={handleTrainClassifier}
                            disabled={training}
                            fullWidth
                            size="large"
                            sx={{ height: '100%' }}
                        >
                            {training ? <CircularProgress size={24} color="inherit" sx={{ mr: 1 }} /> : null}
                            <Box sx={{ textAlign: 'left' }}>
                                <Typography variant="button" display="block">2. Train Model</Typography>
                                <Typography variant="caption" display="block" sx={{ textTransform: 'none', opacity: 0.8 }}>
                                    Train Classifier & Export ONNX
                                </Typography>
                            </Box>
                        </Button>
                    </Grid>
                </Grid>

                {trainOutput && (
                    <Box sx={{ mt: 3, bgcolor: '#f5f5f5', p: 2, borderRadius: 1, maxHeight: 300, overflow: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{trainOutput}</pre>
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
