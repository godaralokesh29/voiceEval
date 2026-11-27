import express from "express";
import { PreInterviewBody } from "./types";
import { scrapeGithub } from "./scrapers/github";
import cors from "cors";
import { prisma } from "./db";
import { attachLiveServer, isLive } from "./live";
import { calculateResult } from "./result";

const app = express();
app.use(express.json());
app.use(cors());

app.post("/api/v1/pre-interview", async (req, res) => { 
    const { success, data } = PreInterviewBody.safeParse(req.body) ;

    if (!success) {
        res.status(411).json({
            message: "Incorrect body"
        });
        return 
    }

    // TODO: URL can be very malformed, probably use an SLM here?
    const githubUrl = data.github.endsWith("/") ? data.github.slice(0, -1) : data.github;

    const githubUsername = githubUrl.split("/").pop()!;

    let githubData: unknown = [];
    try {
        githubData = await scrapeGithub(githubUsername);
    } catch (error: any) {
        console.error("GitHub scrape failed:", error?.response?.status ?? error?.message);
        res.status(400).json({ message: "Could not fetch that GitHub profile" });
        return;
    }

    const interview = await prisma.interview.create({
        data: {
            githubMetadata: JSON.stringify(githubData),
            status: "Pre"
        }
    })

    res.json({ id: interview.id });
})

app.get("/api/v1/result/:interviewId", async (req, res) => {
  const interview = await prisma.interview.findFirst({
    where: {
      id: req.params.interviewId
    },
    include: {
      conversations: { orderBy: { createdAt: "asc" } }
    }
  })

  if (!interview) {
    res.status(411).json({
      message: "Interview not found"
    })
    return 
  }

  res.json({
    score: interview?.score,
    feedback: interview?.feedback,
    transcript: interview?.conversations.map(c => ({
      type: c.type,
      content: c.message,
      createdAt: c.createdAt
    })),
    status: interview.status
  })

  // TODO: Should add some sort of a lock here.
  // Only score once the live voice session has fully ended (its transcript is flushed on close).
  if (interview.status != "Done" && !isLive(interview.id) && !evaluating.has(interview.id)) {
    evaluating.add(interview.id);
    try {
      const result = await calculateResult(interview.conversations)

      await prisma.interview.update({
        where: {
          id: req.params.interviewId
        },
        data: {
          status: "Done",
          feedback: result.feedback,
          score: result.score
        }
      })
    } catch (error) {
      console.error("Evaluation failed:", error);
    } finally {
      evaluating.delete(interview.id);
    }
  }
})

// Interviews currently being scored, so polling doesn't trigger duplicate Gemini calls.
const evaluating = new Set<string>();

const PORT = Number(process.env.PORT ?? 3001);
const server = app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

// Real-time voice interviews: ws://localhost:PORT/api/v1/live/:interviewId (Gemini Live bridge)
attachLiveServer(server);
