import { GoogleGenAI, FunctionDeclaration, Type } from "@google/genai";
import { fileToGenerativePart } from "./utils";

const getClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key not found in environment (NEXT_PUBLIC_GEMINI_API_KEY)");
  console.log("Using Gemini API Key:", apiKey.substring(0, 5) + "...");
  return new GoogleGenAI({ apiKey });
};

export const analyzeGestureVideo = async (file: File, gestureName: string): Promise<string> => {
  const ai = getClient();
  const videoPart = await fileToGenerativePart(file);

  const prompt = `
    I am training a system to recognize hand gestures. 
    The name of this gesture is "${gestureName}".
    Please analyze the video and provide a concise but highly distinctive visual description of this gesture. 
    Focus on:
    1. The initial position of the hand/body.
    2. The motion trajectory.
    3. The final position.
    4. Key features that distinguish it from other common gestures.
    
    Output ONLY the description paragraph. Do not include introductory text.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [videoPart, { text: prompt }],
    },
  });

  return response.text || "No description generated.";
};

export const identifyGestureToolDeclaration: FunctionDeclaration = {
  name: 'identifyGesture',
  parameters: {
    type: Type.OBJECT,
    description: 'Call this function when a specific known gesture is identified in the video stream.',
    properties: {
      gestureName: {
        type: Type.STRING,
        description: 'The name of the identified gesture.',
      },
      confidence: {
        type: Type.NUMBER,
        description: 'Confidence level between 0 and 1.',
      },
    },
    required: ['gestureName'],
  },
};
