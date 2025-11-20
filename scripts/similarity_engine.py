"""
Similarity engine for comparing and sorting gestures.
Computes pairwise similarities and organizes gestures by similarity.
"""
import numpy as np
import json
import os
import shutil
from typing import List, Dict, Tuple
from sklearn.metrics.pairwise import cosine_similarity, euclidean_distances
from sklearn.cluster import KMeans, AgglomerativeClustering
import matplotlib.pyplot as plt
import seaborn as sns
from dtaidistance import dtw
from pathlib import Path
import config


class SimilarityEngine:
    """
    Computes similarity between gestures and organizes them.
    """
    def __init__(self, metric: str = 'cosine'):
        """
        Initialize similarity engine.
        
        Args:
            metric: Similarity metric ('cosine', 'euclidean', 'dtw')
        """
        self.metric = metric
        self.raw_sequences = None  # Store raw sequences for DTW
        
    def compute_similarity_matrix(self, embeddings: np.ndarray, 
                                 sequences: List = None) -> np.ndarray:
        """
        Compute pairwise similarity matrix.
        
        Args:
            embeddings: Array of embeddings [num_gestures, embedding_dim]
            sequences: List of raw pose sequences (for DTW)
            
        Returns:
            Similarity matrix [num_gestures, num_gestures]
        """
        if self.metric == 'cosine':
            # Cosine similarity (higher = more similar)
            similarity = cosine_similarity(embeddings)
        elif self.metric == 'euclidean':
            # Convert distance to similarity (higher = more similar)
            distances = euclidean_distances(embeddings)
            similarity = 1 / (1 + distances)
        elif self.metric == 'dtw':
            # Dynamic Time Warping on raw sequences
            if sequences is None:
                raise ValueError("DTW requires raw pose sequences")
            print("Computing DTW similarity matrix (this may take a while)...")
            similarity = self._compute_dtw_similarity(sequences)
        else:
            raise ValueError(f"Unknown metric: {self.metric}")
        
        return similarity
    
    def _compute_dtw_similarity(self, sequences: List[np.ndarray]) -> np.ndarray:
        """
        Compute DTW-based similarity matrix using multivariate DTW.
        
        Args:
            sequences: List of pose sequences, each of shape [num_frames, num_features]
            
        Returns:
            Similarity matrix [num_sequences, num_sequences]
        """
        from tqdm import tqdm
        from dtaidistance import dtw_ndim
        
        n = len(sequences)
        distances = np.zeros((n, n))
        
        # Compute pairwise DTW distances
        for i in tqdm(range(n), desc="Computing DTW distances"):
            for j in range(i, n):
                if i == j:
                    distances[i, j] = 0.0
                else:
                    # Downsample sequences for speed (use every 3rd frame)
                    seq_i = sequences[i][::3]
                    seq_j = sequences[j][::3]
                    
                    # Compute Multivariate DTW distance
                    # dtaidistance expects [len, dim] which matches our input
                    distance = dtw_ndim.distance(seq_i, seq_j)
                    distances[i, j] = distance
                    distances[j, i] = distance
        
        # Convert distances to similarities
        # Normalize distances first
        max_dist = distances.max()
        if max_dist > 0:
            distances = distances / max_dist
        
        # Convert to similarity (higher = more similar)
        similarity = 1 / (1 + distances)
        
        return similarity
    
    def cluster_gestures(self, embeddings: np.ndarray, 
                        n_clusters: int = None,
                        method: str = 'kmeans') -> np.ndarray:
        """
        Cluster gestures based on embeddings.
        
        Args:
            embeddings: Array of embeddings [num_gestures, embedding_dim]
            n_clusters: Number of clusters (if None, auto-determine)
            method: Clustering method ('kmeans' or 'hierarchical')
            
        Returns:
            Cluster labels [num_gestures]
        """
        if n_clusters is None:
            # Auto-determine number of clusters
            n_clusters = min(config.NUM_CLUSTERS, len(embeddings))
        
        if method == 'kmeans':
            clusterer = KMeans(n_clusters=n_clusters, random_state=42)
        elif method == 'hierarchical':
            clusterer = AgglomerativeClustering(n_clusters=n_clusters)
        else:
            raise ValueError(f"Unknown clustering method: {method}")
        
        labels = clusterer.fit_predict(embeddings)
        
        return labels
    
    def find_similar_gestures(self, segments: List[Dict], 
                            query_idx: int,
                            top_k: int = 5) -> List[Tuple[int, float]]:
        """
        Find the most similar gestures to a query gesture.
        
        Args:
            segments: List of segment dictionaries with embeddings
            query_idx: Index of query gesture
            top_k: Number of similar gestures to return
            
        Returns:
            List of (index, similarity_score) tuples, sorted by similarity
        """
        top_indices = np.argsort(similarities)[::-1]
        top_indices = [i for i in top_indices if i != query_idx][:top_k]
        
        return [(idx, similarities[idx]) for idx in top_indices]
    
    def organize_by_similarity(self, segments: List[Dict],
                              output_dir: str = None,
                              copy_files: bool = True) -> Dict:
        """
        Organize gesture segments by similarity using clustering.
        
        Args:
            segments: List of segment dictionaries with embeddings
            output_dir: Output directory for organized segments
            copy_files: Whether to copy video files to cluster directories
            
        Returns:
            Organization info with clusters and similarity scores
        """
        if not segments:
            print("No segments to organize")
            return {}
        
        output_dir = output_dir or config.CLUSTERS_DIR
        os.makedirs(output_dir, exist_ok=True)
        
        # Extract embeddings
        embeddings = np.array([s['embedding'] for s in segments])
        
        # Extract raw sequences for DTW if needed
        sequences = None
        if self.metric == 'dtw':
            sequences = self._load_sequences_from_segments(segments)
        
        print(f"Computing similarity for {len(segments)} gestures...")
        
        # Compute similarity matrix
        similarity_matrix = self.compute_similarity_matrix(embeddings, sequences)
        
        # Cluster gestures
        n_clusters = min(config.NUM_CLUSTERS, len(segments))
        labels = self.cluster_gestures(embeddings, n_clusters=n_clusters)
        
        # Organize segments by cluster
        clusters = {}
        for cluster_id in range(n_clusters):
            cluster_segments = [
                segments[i] for i in range(len(segments)) 
                if labels[i] == cluster_id
            ]
            clusters[cluster_id] = cluster_segments
            
            print(f"Cluster {cluster_id}: {len(cluster_segments)} gestures")
            
            # Copy files to cluster directory if requested
            if copy_files:
                cluster_dir = os.path.join(output_dir, f'cluster_{cluster_id}')
                os.makedirs(cluster_dir, exist_ok=True)
                
                for seg in cluster_segments:
                    src_path = seg['segment_path']
                    dst_path = os.path.join(cluster_dir, Path(src_path).name)
                    if os.path.exists(src_path):
                        shutil.copy2(src_path, dst_path)
        
        # Create organization manifest
        manifest = {
            'total_gestures': len(segments),
            'num_clusters': n_clusters,
            'metric': self.metric,
            'clusters': {}
        }
        
        for cluster_id, cluster_segments in clusters.items():
            manifest['clusters'][cluster_id] = {
                'size': len(cluster_segments),
                'segments': [
                    {
                        'segment_id': s['segment_id'],
                        'segment_path': s['segment_path'],
                        'source_video': s['source_video'],
                        'duration': s['duration_seconds'],
                        'confidence': s.get('confidence', 1.0)
                    }
                    for s in cluster_segments
                ]
            }
        
        print(f"\nSaved clustering manifest to {manifest_path}")
        
        # Visualize similarity matrix
        if config.VISUALIZE_RESULTS:
            self.visualize_similarity_matrix(
                similarity_matrix, 
                labels,
                save_path=os.path.join(output_dir, 'similarity_matrix.png')
            )
        
        return manifest
    
    def _load_sequences_from_segments(self, segments: List[Dict]) -> List[np.ndarray]:
        """
        Load raw pose sequences from segment metadata for DTW comparison.
        
        Args:
            segments: List of segment dictionaries
            
        Returns:
            List of pose sequences
        """
        import cv2
        import mediapipe as mp
        from tqdm import tqdm
        
        mp_pose = mp.solutions.pose
        pose = mp_pose.Pose(
            static_image_mode=False,
            min_detection_confidence=config.POSE_CONFIDENCE,
            min_tracking_confidence=config.POSE_TRACKING_CONFIDENCE
        )
        
        sequences = []
        
        print("Loading pose sequences from video segments...")
        for seg in tqdm(segments, desc="Loading segments"):
            video_path = seg['segment_path']
            
            cap = cv2.VideoCapture(video_path)
            landmarks_list = []
            
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(image)
                
                if results.pose_landmarks:
                    row = []
                    for lm in results.pose_landmarks.landmark:
                        row.extend([lm.x, lm.y, lm.z, lm.visibility])
                    landmarks_list.append(row)
                else:
                    landmarks_list.append([0.0] * config.INPUT_SIZE)
            
            cap.release()
            
            if landmarks_list:
                sequences.append(np.array(landmarks_list))
            else:
                # Fallback: create dummy sequence
                sequences.append(np.zeros((10, config.INPUT_SIZE)))
        
        pose.close()
        
        return sequences
    
    def visualize_similarity_matrix(self, similarity_matrix: np.ndarray,
                                   labels: np.ndarray = None,
                                   save_path: str = None):
        """
        Visualize the similarity matrix as a heatmap.
        
        Args:
            similarity_matrix: Pairwise similarity matrix
            labels: Cluster labels for sorting
            save_path: Path to save figure
        """
        fig, ax = plt.subplots(figsize=(10, 8))
        
        # Sort by cluster if labels provided
        if labels is not None:
            sort_idx = np.argsort(labels)
            similarity_matrix = similarity_matrix[sort_idx][:, sort_idx]
        
        # Plot heatmap
        sns.heatmap(
            similarity_matrix,
            cmap='viridis',
            square=True,
            cbar_kws={'label': 'Similarity'},
            ax=ax
        )
        
        ax.set_title('Gesture Similarity Matrix')
        ax.set_xlabel('Gesture ID')
        ax.set_ylabel('Gesture ID')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150)
            print(f"Saved similarity matrix visualization to {save_path}")
        else:
            plt.show()
        
        plt.close()
    
    def create_similarity_report(self, segments: List[Dict],
                                output_path: str = None,
                                sequences: List[np.ndarray] = None) -> str:
        """
        Create a detailed similarity report.
        
        Args:
            segments: List of segment dictionaries with embeddings
            output_path: Path to save report (markdown file)
            sequences: List of raw pose sequences (for DTW)
            
        Returns:
            Report text
        """
        
        embeddings = np.array([s['embedding'] for s in segments])
        similarity_matrix = self.compute_similarity_matrix(embeddings)
        
        # Create report
        report_lines = [
            "# Gesture Similarity Report",
            "",
            f"**Total Gestures:** {len(segments)}",
            f"**Similarity Metric:** {self.metric}",
            "",
            "## Similarity Statistics",
            ""
        ]
        
        # Compute statistics (excluding diagonal)
        mask = ~np.eye(len(segments), dtype=bool)
        similarities = similarity_matrix[mask]
        
        report_lines.extend([
            f"- **Average Similarity:** {similarities.mean():.3f}",
            f"- **Max Similarity:** {similarities.max():.3f}",
            f"- **Min Similarity:** {similarities.min():.3f}",
            f"- **Std Deviation:** {similarities.std():.3f}",
            "",
            "## Most Similar Pairs",
            ""
        ])
        
        # Find most similar pairs
        upper_tri = np.triu_indices(len(segments), k=1)
        pair_similarities = [
            (i, j, similarity_matrix[i, j])
            for i, j in zip(upper_tri[0], upper_tri[1])
        ]
        pair_similarities.sort(key=lambda x: x[2], reverse=True)
        
        for i, j, sim in pair_similarities[:10]:
            seg_i = segments[i]
            seg_j = segments[j]
            report_lines.append(
                f"{i+1}. Gesture {i} & Gesture {j}: **{sim:.3f}**"
            )
            report_lines.append(f"   - {Path(seg_i['segment_path']).name}")
            report_lines.append(f"   - {Path(seg_j['segment_path']).name}")
            report_lines.append("")
        
        report = "\n".join(report_lines)
        
        if output_path:
            with open(output_path, 'w') as f:
                f.write(report)
            print(f"Saved similarity report to {output_path}")
        
        return report


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Compute gesture similarity")
    parser.add_argument('--segments', type=str, required=True,
                       help='Path to segments manifest JSON')
    parser.add_argument('--metric', type=str, default='cosine',
                       choices=['cosine', 'euclidean', 'dtw'],
                       help='Similarity metric')
    parser.add_argument('--output', type=str, default=None,
                       help='Output directory for clusters')
    parser.add_argument('--no-copy', action='store_true',
                       help='Do not copy video files')
    
    args = parser.parse_args()
    
    # Load segments
    with open(args.segments, 'r') as f:
        data = json.load(f)
    
    segments = data.get('segments', data)
    
    # Filter segments with embeddings
    segments_with_embeddings = [s for s in segments if 'embedding' in s]
    
    if not segments_with_embeddings:
        print("Error: No segments with embeddings found")
        exit(1)
    
    print(f"Loaded {len(segments_with_embeddings)} segments with embeddings")
    
    # Compute similarity and organize
    engine = SimilarityEngine(metric=args.metric)
    manifest = engine.organize_by_similarity(
        segments_with_embeddings,
        output_dir=args.output,
        copy_files=not args.no_copy
    )
    
    # Create report
    report_path = os.path.join(args.output or config.CLUSTERS_DIR, 'similarity_report.md')
    engine.create_similarity_report(segments_with_embeddings, report_path)
