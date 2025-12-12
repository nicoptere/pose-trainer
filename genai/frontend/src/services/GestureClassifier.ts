
interface GestureClassifierEvents {
    onResult?: (result: {
        label: string;
        confidence: number;
        index: number;
        all: Array<{ label: string; confidence: number; index: number }>;
        pose?: number[];
    }) => void;
    onBuffering?: (count: number, info: string) => void;
    onError?: (error: string) => void;
    onLog?: (message: string) => void;
}

export class GestureClassifier {
    private worker: Worker | null = null;
    private labels: string[] = [];
    private sequenceLength: number = 150;
    private events: GestureClassifierEvents;
    private isReady: boolean = false;

    constructor(events: GestureClassifierEvents = {}) {
        this.events = events;
    }

    public async init(apiUrl: string): Promise<void> {
        try {
            // 1. Load Data
            const labelsRes = await fetch(`${apiUrl}/api/model/labels`);
            if (!labelsRes.ok) throw new Error("Failed to load labels");
            const labelsData = await labelsRes.json();
            this.labels = labelsData.class_names;

            // Fetch config for sequence length
            try {
                const confRes = await fetch(`${apiUrl}/api/config/gesture`);
                if (confRes.ok) {
                    const confData = await confRes.json();
                    this.sequenceLength = confData.sequence_length || 150;
                }
            } catch (e) {
                console.warn("Failed to load gesture config, using default", e);
            }

            // 2. Initialize ONNX Worker
            this.worker = new Worker('/onnx/worker.js');
            const modelUrl = `${apiUrl}/api/model/onnx?t=${Date.now()}`;

            this.worker.postMessage({
                type: 'init',
                payload: {
                    modelUrl,
                    sequenceLength: this.sequenceLength
                }
            });

            this.worker.onmessage = this.handleWorkerMessage.bind(this);

        } catch (err: any) {
            console.error("GestureClassifier Init Error:", err);
            if (this.events.onError) this.events.onError(err.message || "Failed to initialize classifier.");
        }
    }

    private handleWorkerMessage(e: MessageEvent) {
        const { type, classification, error, count, log } = e.data;

        if (type === 'ready') {
            this.isReady = true;
            if (this.events.onLog) this.events.onLog("ONNX Worker Ready");
        } else if (type === 'result') {
            const { classification, pose } = e.data;
            this.processClassification(classification, pose);
        } else if (type === 'buffering') {
            if (this.events.onBuffering) {
                this.events.onBuffering(count, `Buffering ${count}/${this.sequenceLength}`);
            }
        } else if (type === 'log') {
            if (this.events.onLog) this.events.onLog(log);
        } else if (type === 'error') {
            if (this.events.onError) this.events.onError(error);
        }
    }

    private processClassification(classification: Float32Array, pose?: number[]) {
        // Debug classification output
        // console.log("Classification Output:", classification);

        const expScores = [];
        let sumExp = 0;

        for (let i = 0; i < classification.length; i++) {
            const val = classification[i];
            const exp = Math.exp(val);
            expScores.push(exp);
            sumExp += exp;
        }

        const allResults = expScores.map((exp, i) => ({
            index: i,
            label: this.labels[i] || `Class ${i}`,
            confidence: exp / sumExp
        }));

        // Sort descending by confidence
        allResults.sort((a, b) => b.confidence - a.confidence);

        const best = allResults[0];

        if (this.events.onResult) {
            this.events.onResult({
                label: best.label,
                confidence: best.confidence,
                index: best.index,
                all: allResults,
                pose: pose // Pass the normalized pose
            });
        }
    }

    public process(landmarks: any[], flipInput: boolean = true) {
        if (!this.worker || !this.isReady) return;

        // Apply optional X-flip (mirroring) before sending to model
        const safeLandmarks = landmarks.map((l: any) => ({
            x: flipInput ? (1.0 - l.x) : l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility
        }));

        this.worker.postMessage({ type: 'process', payload: safeLandmarks });
    }

    public getLabels(): string[] {
        return this.labels;
    }

    public destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
