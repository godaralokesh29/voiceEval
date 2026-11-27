import { LIVE_WS_URL } from "@/lib/config";
import { createLevelMeter, PcmPlayer, startMicCapture, type MicCapture } from "@/lib/audio";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, Loader2, PhoneOff, User, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { VoiceOrb } from "./VoiceOrb";

type Status = "connecting" | "live" | "ending" | "error";

const END_REASON_MESSAGES: Record<string, string> = {
    replaced_by_new_connection: "This interview was opened in another tab or window.",
    client_disconnected: "The connection to the interview server was lost.",
};

export function Interview() {
    const { interviewId } = useParams();
    const navigate = useNavigate();

    const [status, setStatus] = useState<Status>("connecting");
    const [errorMessage, setErrorMessage] = useState("");
    const [audioBlocked, setAudioBlocked] = useState(false);
    const [aiLevel, setAiLevel] = useState(0);
    const [userLevel, setUserLevel] = useState(0);

    // Resources we need to tear down on exit.
    const wsRef = useRef<WebSocket | null>(null);
    const captureRef = useRef<MicCapture | null>(null);
    const playerRef = useRef<PcmPlayer | null>(null);
    const userStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    // Flags read inside socket callbacks (state would be stale there).
    const endingRef = useRef(false);
    const failedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        endingRef.current = false;
        failedRef.current = false;

        function fail(message: string) {
            if (cancelled || endingRef.current || failedRef.current) return;
            failedRef.current = true;
            cleanup();
            setErrorMessage(message);
            setStatus("error");
        }

        (async () => {
            // 1. Microphone first, so the permission prompt doesn't race the session.
            const ms = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            });
            if (cancelled) {
                ms.getTracks().forEach((t) => t.stop());
                return;
            }
            userStreamRef.current = ms;

            // 2. Audio graph: AI playback + meters.
            const audioCtx = new AudioContext();
            audioCtxRef.current = audioCtx;
            const player = new PcmPlayer(audioCtx);
            playerRef.current = player;
            const aiMeter = createLevelMeter(audioCtx, player.node);
            let userMeter: (() => number) | null = null;

            // 3. Live session via our backend (the Gemini key never reaches the browser).
            const ws = new WebSocket(`${LIVE_WS_URL}/api/v1/live/${interviewId}`);
            ws.binaryType = "arraybuffer";
            wsRef.current = ws;

            ws.onmessage = async (event) => {
                if (typeof event.data !== "string") {
                    player.enqueue(event.data as ArrayBuffer); // AI voice, PCM16 24 kHz
                    return;
                }
                const msg = JSON.parse(event.data);
                switch (msg.type) {
                    case "ready": {
                        try {
                            const capture = await startMicCapture(audioCtx, ms, (pcm) => {
                                if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
                            });
                            if (cancelled) return capture.stop();
                            captureRef.current = capture;
                            userMeter = createLevelMeter(audioCtx, capture.source);
                        } catch (err: any) {
                            return fail(`Could not start microphone streaming: ${err?.message ?? err}`);
                        }
                        // Autoplay policy: a direct page load may leave audio suspended until a click.
                        if (audioCtx.state === "suspended") {
                            await audioCtx.resume().catch(() => {});
                            if (audioCtx.state === "suspended") setAudioBlocked(true);
                        }
                        setStatus("live");
                        const tick = () => {
                            setAiLevel(aiMeter());
                            if (userMeter) setUserLevel(userMeter());
                            rafRef.current = requestAnimationFrame(tick);
                        };
                        rafRef.current = requestAnimationFrame(tick);
                        break;
                    }
                    case "interrupted":
                        player.flush(); // candidate started talking: stop the AI immediately
                        break;
                    case "warning":
                        toast(msg.message);
                        break;
                    case "error":
                        fail(msg.message ?? "Something went wrong with the interview session.");
                        break;
                    case "ended":
                        fail(END_REASON_MESSAGES[msg.reason] ?? "The interview session ended unexpectedly.");
                        break;
                }
            };

            ws.onclose = () => fail("The connection to the interview server was lost.");
        })().catch((err) => {
            console.error("Interview setup failed:", err);
            fail(
                err?.name === "NotAllowedError"
                    ? "Microphone access was denied. Allow mic access and reload the page."
                    : err?.message ?? String(err)
            );
        });

        return () => {
            cancelled = true;
            cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interviewId]);

    function cleanup() {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        captureRef.current?.stop();
        captureRef.current = null;
        playerRef.current?.flush();
        const ws = wsRef.current;
        if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, "client cleanup");
        userStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioCtxRef.current?.close().catch(() => {});
    }

    async function endInterview() {
        endingRef.current = true;
        setStatus("ending");
        captureRef.current?.stop();
        captureRef.current = null;
        playerRef.current?.flush();

        // Ask the server to finish: it saves the remaining transcript, then closes the socket.
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, 4000);
                ws.addEventListener(
                    "close",
                    () => {
                        clearTimeout(timeout);
                        resolve();
                    },
                    { once: true },
                );
                ws.send(JSON.stringify({ type: "end" }));
            });
        }
        cleanup();
        navigate(`/result/${interviewId}`);
    }

    function enableAudio() {
        audioCtxRef.current?.resume().then(() => setAudioBlocked(false)).catch(() => {});
    }

    const aiSpeaking = aiLevel > 0.06 && aiLevel >= userLevel;
    const userSpeaking = userLevel > 0.06 && userLevel > aiLevel;

    return (
        <main className="flex h-screen w-screen flex-col overflow-hidden">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="relative flex size-2.5">
                        <span
                            className={
                                status === "live"
                                    ? "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
                                    : "hidden"
                            }
                        />
                        <span
                            className={
                                "relative inline-flex size-2.5 rounded-full " +
                                (status === "live" ? "bg-emerald-400" : "bg-amber-400")
                            }
                        />
                    </span>
                    {status === "connecting"
                        ? "Connecting…"
                        : status === "ending"
                          ? "Wrapping up…"
                          : status === "error"
                            ? "Couldn't start"
                            : "Interview live"}
                </div>
                <span className="text-sm text-muted-foreground">AI Interview</span>
            </header>

            {/* Stage */}
            <div className="flex flex-1 items-center justify-center px-6">
                {status === "error" ? (
                    <div className="flex max-w-md flex-col items-center gap-4 text-center">
                        <p className="text-lg font-medium">We couldn't start your interview</p>
                        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {errorMessage}
                        </p>
                        <Button variant="outline" onClick={() => navigate("/")}>
                            Back to start
                        </Button>
                    </div>
                ) : status === "connecting" ? (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Loader2 className="size-7 animate-spin" />
                        <p className="text-sm">Setting up your interview & microphone…</p>
                    </div>
                ) : (
                    <div className="flex w-full max-w-3xl items-center justify-center gap-12 sm:gap-24">
                        <VoiceOrb
                            level={aiLevel}
                            speaking={aiSpeaking}
                            label="Interviewer"
                            sublabel="Listening"
                            icon={Bot}
                            accent="violet"
                        />
                        <VoiceOrb
                            level={userLevel}
                            speaking={userSpeaking}
                            label="You"
                            sublabel="Mic on"
                            icon={User}
                            accent="emerald"
                        />
                    </div>
                )}
            </div>

            {/* Controls */}
            <footer className="flex justify-center gap-3 px-6 py-8">
                {audioBlocked && status === "live" && (
                    <Button variant="outline" size="lg" onClick={enableAudio} className="gap-2 rounded-full px-6">
                        <Volume2 className="size-4" />
                        Enable audio
                    </Button>
                )}
                <Button
                    variant="destructive"
                    size="lg"
                    onClick={endInterview}
                    disabled={status === "ending"}
                    className="gap-2 rounded-full px-6"
                >
                    {status === "ending" ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <PhoneOff className="size-4" />
                    )}
                    End interview
                </Button>
            </footer>
        </main>
    );
}
