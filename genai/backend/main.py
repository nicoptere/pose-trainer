
import os
import json
import functions_framework
import vertexai
from vertexai.generative_models import GenerativeModel, Part, SafetySetting

# Initialize Vertex AI
PROJECT_ID = os.environ.get("GCP_PROJECT", "your-project-id")
LOCATION = os.environ.get("GCP_LOCATION", "us-central1")

vertexai.init(project=PROJECT_ID, location=LOCATION)

# Initialize Model (Global scope for warm starts)
# Using gemini-1.5-pro-002 for high accuracy / long context
model = GenerativeModel(
    "gemini-1.5-pro-002",
    system_instruction="You are an expert Biomechanics and Movement Analyst."
)

@functions_framework.http
def analyze_gesture(request):
    """
    HTTP Cloud Function to analyze a gesture video against reference clips.
    Expected JSON Body:
    {
        "query_uri": "gs://bucket/incoming/crop.mp4",
        "references": [
            {"label": "SQUAT", "uri": "gs://bucket/refs/squat.mp4", "desc": "Hips below knees"},
            {"label": "LUNGE", "uri": "gs://bucket/refs/lunge.mp4", "desc": "Step forward"}
        ]
    }
    """
    
    # CORS Headers
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    try:
        request_json = request.get_json(silent=True)
        if not request_json:
            return ({"error": "JSON body required"}, 400, headers)
        
        query_uri = request_json.get("query_uri")
        references = request_json.get("references", [])
        
        if not query_uri:
            return ({"error": "query_uri is required"}, 400, headers)

        # Build Prompt
        prompt_parts = []
        
        # 1. Add References
        for index, ref in enumerate(references):
            label = ref.get("label", f"CLASS_{index}")
            desc = ref.get("desc", "No description provided.")
            uri = ref.get("uri")
            
            prompt_parts.append(f"--- REFERENCE CLASS: {label} ---")
            if uri:
                prompt_parts.append(Part.from_uri(uri, mime_type="video/mp4"))
            prompt_parts.append(f"Description: {desc}")
            prompt_parts.append("\n")

        # 2. Add Query
        prompt_parts.append("--- QUERY VIDEO TO ANALYZE ---")
        prompt_parts.append(Part.from_uri(query_uri, mime_type="video/mp4"))
        
        # 3. Instructions
        prompt_parts.append("""
        Instructions:
        1. Watch the Query Video carefully.
        2. Compare the limb trajectories and kinematics to each Reference Class.
        3. If the movement matches a Reference Class with >90% certainty, output that class.
        4. If the movement is ambiguous or doesn't match, output 'UNKNOWN'.
        5. PROVIDE REASONING based on specific visual evidence.
        
        Output Format: JSON
        {
            "match": "CLASS_LABEL" | "UNKNOWN",
            "confidence": 0.0 - 1.0,
            "reasoning": "..."
        }
        """)

        # Generate
        response = model.generate_content(
            prompt_parts,
            generation_config={"response_mime_type": "application/json"}
        )
        
        response_text = response.text.strip()
        
        # Parse result
        try:
            result = json.loads(response_text)
        except:
            result = {"raw_output": response_text}

        return (json.dumps(result), 200, headers)

    except Exception as e:
        print(f"Error: {e}")
        return (json.dumps({"error": str(e)}), 500, headers)
