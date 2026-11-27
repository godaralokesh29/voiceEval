import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

const outputSchema = z.object({
    feedback: z.string().describe("Feedback for the user"),
    score: z.int().describe("Score out of 10 for their interview"),
});

const RESULT_PROMPT = `
    You are an expert evaluator. Your job is to evaluate the users interview. Give them a score out of 10
    and also let them know any feedback you have about thier interview.

    Please return only a json which looks like this - 
    {
        feedback: string,
        score: number
    }

    DO NOT RETURN ANY OTHER TEXT
    {{USER_TRANSCRIPT}}
`

// Primary model first; fall back when a model is overloaded (503), rate-limited (429) or unavailable (404).
const SCORING_MODELS = [
    process.env.GEMINI_MODEL || "gemini-3.5-flash",
    ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-latest,gemini-flash-lite-latest").split(","),
].map((m) => m.trim()).filter((m, i, all) => m && all.indexOf(m) === i);

export async function calculateResult(messages: {type: "Assistant" | "User", message: string, createdAt: Date}[]) {
    let lastError: unknown;
    for (const model of SCORING_MODELS) {
        try {
            return await scoreWith(model, messages);
        } catch (error: any) {
            lastError = error;
            if (![404, 429, 500, 503].includes(error?.status)) throw error;
            console.warn(`Scoring model ${model} unavailable (${error.status}), trying next`);
        }
    }
    throw lastError;
}

async function scoreWith(model: string, messages: {type: "Assistant" | "User", message: string, createdAt: Date}[]) {
    const response = await ai.models.generateContent({
        model,
        contents: RESULT_PROMPT.replace(`{{USER_TRANSCRIPT}}`, JSON.stringify(messages)),
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                properties: {
                    feedback: { type: "string", description: "Feedback for the user" },
                    score: { type: "integer", description: "Score out of 10 for their interview" },
                },
                required: ["feedback", "score"],
            },
        },
    });
    console.log(response.text!);
    const result = outputSchema.parse(JSON.parse(response.text!));
    return result;

}