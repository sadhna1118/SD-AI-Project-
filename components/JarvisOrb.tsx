"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import { SciFiAudio } from "@/lib/audio";
import { LiveAPI } from "@/lib/liveApi";

type CameraState = "off" | "starting" | "on" | "error";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const audioRef = useRef<SciFiAudio | null>(null);
  const liveApiRef = useRef<LiveAPI | null>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [aiState, setAiState] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [transcript, setTranscript] = useState<{ text: string, isUser: boolean } | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);

  const [directStatus, setDirectStatus] = useState<string>("");
  const [phoneScreen, setPhoneScreen] = useState<string | null>(null);
  const [showPhoneScreen, setShowPhoneScreen] = useState<boolean>(true);
  const [textCmd, setTextCmd] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // QR & Wireless Connect Modal State
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [activeModalTab, setActiveModalTab] = useState<'qr' | 'wireless'>('qr');
  const [connectIp, setConnectIp] = useState<string>('192.168.1.6');
  const [connectPort, setConnectPort] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [isPairingMode, setIsPairingMode] = useState<boolean>(false);
  const [connectLoading, setConnectLoading] = useState<boolean>(false);
  const [connectResult, setConnectResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentUrl(window.location.href);
    }
  }, []);

  const checkDeviceStatus = async () => {
    try {
      const res = await fetch('/api/android/connect');
      const data = await res.json();
      if (data.success && data.connected && data.devices.length > 0) {
        setConnectedDevice(`${data.devices[0].model} (${data.devices[0].id})`);
      } else {
        setConnectedDevice(null);
      }
    } catch {
      setConnectedDevice(null);
    }
  };

  useEffect(() => {
    checkDeviceStatus();
    const interval = setInterval(checkDeviceStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectWireless = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectPort.trim()) return;
    setConnectLoading(true);
    setConnectResult(null);

    try {
      const res = await fetch('/api/android/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isPairingMode ? 'pair' : 'connect',
          ip: connectIp,
          port: connectPort,
          code: pairingCode
        })
      });
      const data = await res.json();
      setConnectResult({
        success: data.success,
        message: data.message || data.error || (data.success ? 'Connected!' : 'Failed to connect')
      });
      if (data.success) {
        await checkDeviceStatus();
      }
    } catch (err: any) {
      setConnectResult({ success: false, message: err.message });
    } finally {
      setConnectLoading(false);
    }
  };

  const runDirectCmd = async (cmd: string, args?: any) => {
    setIsExecuting(true);
    setDirectStatus(`Running: ${cmd}...`);
    try {
      const res = await fetch('/api/android', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args })
      });
      const data = await res.json();
      if (data.success) {
        setDirectStatus(`✓ Success: ${cmd}`);
      } else {
        setDirectStatus(`✗ Error: ${data.error || 'Failed'}`);
      }
    } catch (e: any) {
      setDirectStatus(`✗ Error: ${e.message}`);
    } finally {
      setIsExecuting(false);
      setTimeout(() => setDirectStatus(''), 4000);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textCmd.trim()) return;
    const t = textCmd.trim();
    const lower = t.toLowerCase();

    if (aiState !== 'idle') {
      liveApiRef.current?.sendText(t);
      setTextCmd('');
      return;
    }

    if (lower.includes('home')) {
      await runDirectCmd('pressHome');
    } else if (lower.includes('back')) {
      await runDirectCmd('goBack');
    } else if (lower.includes('unlock')) {
      await runDirectCmd('unlockPhone');
    } else if (lower.includes('youtube')) {
      if (lower.startsWith('play')) {
        const query = lower.replace(/^play\s+/, '').replace(/\s+on\s+youtube.*$/, '').trim();
        await runDirectCmd('playYouTubeVideo', { query });
      } else {
        await runDirectCmd('openApp', { appName: 'youtube' });
      }
    } else if (lower.includes('whatsapp')) {
      await runDirectCmd('openApp', { appName: 'whatsapp' });
    } else if (lower.includes('chrome')) {
      await runDirectCmd('openApp', { appName: 'chrome' });
    } else if (lower.includes('scroll down') || lower.includes('down')) {
      await runDirectCmd('swipe', { direction: 'down' });
    } else if (lower.includes('scroll up') || lower.includes('up')) {
      await runDirectCmd('swipe', { direction: 'up' });
    } else {
      await runDirectCmd('openApp', { appName: t });
    }
    setTextCmd('');
  };

  useEffect(() => {
    audioRef.current = new SciFiAudio();
    liveApiRef.current = new LiveAPI();
    
    liveApiRef.current.onStateChange = setAiState;
    liveApiRef.current.onTranscript = (text, isUser) => setTranscript({ text, isUser });
    liveApiRef.current.onError = setErrorMsg;
    liveApiRef.current.onMicLevel = setMicLevel;

    return () => {
      audioRef.current?.dispose();
      liveApiRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const pollScreen = async () => {
      if (!isActive) return;
      if (aiState === 'idle' && !showPhoneScreen) {
        timeoutId = setTimeout(pollScreen, 3000);
        return;
      }
      try {
        const res = await fetch('/api/android/screen');
        const data = await res.json();
        if (data.success && data.base64 && isActive) {
          setPhoneScreen(data.base64);
          if (aiState !== 'idle') {
            const img = new Image();
            img.src = 'data:image/png;base64,' + data.base64;
            img.onload = () => {
              if (!isActive) return;
              const canvas = document.createElement('canvas');
              const scale = 0.5;
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
              const jpegBase64 = canvas.toDataURL('image/jpeg', 0.3).split(',')[1];
              liveApiRef.current?.sendFrame(jpegBase64);
            };
          }
        }
      } catch (e) {
        console.warn("Screen poll failed:", e);
      }
      if (isActive) {
        timeoutId = setTimeout(pollScreen, 3000);
      }
    };

    pollScreen();

    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [aiState, showPhoneScreen]);

  const handleGlobalInteraction = useCallback(() => {
    audioRef.current?.init();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    try {
      const scene = createOrbScene(container);
      sceneRef.current = scene;
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to initialize WebGL.");
    }
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setErrorMsg(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setErrorMsg(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  const toggleAI = useCallback(async () => {
    if (aiState === 'idle') {
      await liveApiRef.current?.connect();
    } else {
      liveApiRef.current?.disconnect();
    }
  }, [aiState]);

  if (liveApiRef.current) {
    liveApiRef.current.onCommand = async (cmd: string) => {
      console.log("Executing AI Command:", cmd);
      
      // Handle visual commands
      if (cmd === 'zoomIn') {
        sceneRef.current?.zoomIn();
        audioRef.current?.playInteractionSound('zoom');
      } else if (cmd === 'zoomOut') {
        sceneRef.current?.zoomOut();
        audioRef.current?.playInteractionSound('zoom');
      } else if (cmd === 'resetView') {
        sceneRef.current?.resetView();
        audioRef.current?.playInteractionSound('click');
      } else if (cmd === 'toggleGestures') {
        toggleGestures();
        audioRef.current?.playInteractionSound('click');
      } 
      // Handle JSON commands for Android
      else if (cmd.startsWith('{')) {
        try {
          const cmdData = JSON.parse(cmd);
          console.log("Sending ADB Command to backend:", cmdData);
          const res = await fetch('/api/android', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: cmdData.name, args: cmdData.args })
          });
          const result = await res.json();
          if (!result.success) {
            console.warn("ADB Warning:", result.error);
          }
          return result;
        } catch (e) {
          console.warn("Failed to parse or execute JSON command:", e);
          return { success: false, error: "Failed to execute" };
        }
      }
    };
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures]);

  const cameraOn = camera === "on";

  return (
    <div onClick={handleGlobalInteraction} onPointerDown={handleGlobalInteraction}>
      <div ref={containerRef} className="orb-root" />

      {errorMsg ? (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'black', zIndex: 50 }}>
          <div style={{ color: '#ef4444', fontFamily: 'monospace', textAlign: 'center', padding: '1rem', border: '1px solid #ef4444', borderRadius: '0.25rem', backgroundColor: 'rgba(127, 29, 29, 0.2)', maxWidth: '28rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>SYSTEM ERROR</h2>
            <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>{errorMsg}</p>
            <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '1rem' }}>Hardware acceleration may be disabled, or WebGL contexts are exhausted. Please restart your browser.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="overlay-vignette" />
          <div className="overlay-grain" />
          <div className="overlay-scanlines" />

          <div className="hud hud-title">S.D.</div>

          {/* Top Right Header: Connection Status Badge + QR Modal Trigger */}
          <div style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 35,
            display: 'flex',
            gap: '12px',
            alignItems: 'center'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              border: `1px solid ${connectedDevice ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
              borderRadius: '20px',
              padding: '5px 12px',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: connectedDevice ? '#4ade80' : '#f87171',
              boxShadow: connectedDevice ? '0 0 10px rgba(34, 197, 94, 0.2)' : 'none'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: connectedDevice ? '#22c55e' : '#ef4444',
                boxShadow: `0 0 8px ${connectedDevice ? '#22c55e' : '#ef4444'}`
              }} />
              <span>{connectedDevice ? connectedDevice : 'PHONE DISCONNECTED'}</span>
            </div>

            <button
              type="button"
              className="hud-btn"
              style={{
                height: '34px',
                padding: '0 12px',
                fontSize: '12px',
                borderColor: '#ff33cc',
                boxShadow: '0 0 12px rgba(255, 51, 204, 0.4)',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
              onClick={() => setShowConnectModal(true)}
            >
              📷 QR / CONNECT
            </button>
          </div>

          {/* QR Code & Wireless Connect Modal */}
          {showConnectModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              zIndex: 60,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}>
              <div style={{
                backgroundColor: '#0a050f',
                border: '1px solid #ff33cc',
                borderRadius: '12px',
                boxShadow: '0 0 30px rgba(255, 51, 204, 0.35)',
                width: '100%',
                maxWidth: '460px',
                color: '#fff',
                fontFamily: 'monospace',
                overflow: 'hidden'
              }}>
                {/* Modal Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderBottom: '1px solid rgba(255, 51, 204, 0.3)',
                  backgroundColor: 'rgba(255, 51, 204, 0.08)'
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ff33cc', letterSpacing: '0.05em' }}>
                    ⚡ CONNECT & SHARE
                  </div>
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#fff',
                      fontSize: '18px',
                      cursor: 'pointer',
                      padding: '0 4px'
                    }}
                    onClick={() => setShowConnectModal(false)}
                  >
                    ✕
                  </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 51, 204, 0.2)' }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: activeModalTab === 'qr' ? 'rgba(255, 51, 204, 0.15)' : 'transparent',
                      border: 'none',
                      borderBottom: activeModalTab === 'qr' ? '2px solid #ff33cc' : 'none',
                      color: activeModalTab === 'qr' ? '#ff33cc' : 'rgba(255, 255, 255, 0.6)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                    onClick={() => setActiveModalTab('qr')}
                  >
                    📱 SCAN QR CODE
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: activeModalTab === 'wireless' ? 'rgba(255, 51, 204, 0.15)' : 'transparent',
                      border: 'none',
                      borderBottom: activeModalTab === 'wireless' ? '2px solid #ff33cc' : 'none',
                      color: activeModalTab === 'wireless' ? '#ff33cc' : 'rgba(255, 255, 255, 0.6)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                    onClick={() => setActiveModalTab('wireless')}
                  >
                    ⚡ WIRELESS ADB
                  </button>
                </div>

                {/* Tab Content */}
                <div style={{ padding: '20px' }}>
                  {activeModalTab === 'qr' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                      <p style={{ fontSize: '12px', opacity: 0.85, marginBottom: '14px' }}>
                        Apne mobile camera se scan karke ye dashboard turant phone par kholein:
                      </p>
                      <div style={{
                        padding: '12px',
                        backgroundColor: '#fff',
                        borderRadius: '8px',
                        boxShadow: '0 0 15px rgba(255, 51, 204, 0.4)',
                        marginBottom: '14px'
                      }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentUrl || 'https://gravity-mathematical-muze-romantic.trycloudflare.com')}`}
                          alt="Live Website QR Code"
                          width={180}
                          height={180}
                          style={{ display: 'block' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '360px' }}>
                        <input
                          type="text"
                          readOnly
                          value={currentUrl}
                          style={{
                            flex: 1,
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            border: '1px solid rgba(255, 51, 204, 0.3)',
                            borderRadius: '4px',
                            color: '#ff33cc',
                            padding: '6px 10px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            outline: 'none'
                          }}
                        />
                        <button
                          type="button"
                          className="hud-btn"
                          style={{ height: '32px', padding: '0 10px', fontSize: '11px' }}
                          onClick={() => {
                            if (navigator.clipboard) {
                              navigator.clipboard.writeText(currentUrl);
                              setCopiedLink(true);
                              setTimeout(() => setCopiedLink(false), 2000);
                            }
                          }}
                        >
                          {copiedLink ? '✓ COPIED' : 'COPY'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Wireless ADB Form */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '6px',
                        marginBottom: '14px',
                        fontSize: '12px'
                      }}>
                        <span>STATUS:</span>
                        <span style={{ color: connectedDevice ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                          {connectedDevice ? `CONNECTED (${connectedDevice})` : 'DISCONNECTED'}
                        </span>
                      </div>

                      {connectResult && (
                        <div style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          marginBottom: '12px',
                          fontSize: '12px',
                          backgroundColor: connectResult.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          border: `1px solid ${connectResult.success ? '#22c55e' : '#ef4444'}`,
                          color: connectResult.success ? '#4ade80' : '#f87171'
                        }}>
                          {connectResult.message}
                        </div>
                      )}

                      <form onSubmit={handleConnectWireless} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="mode"
                              checked={!isPairingMode}
                              onChange={() => setIsPairingMode(false)}
                            />
                            Direct Connect (Pehle se paired)
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginLeft: '12px' }}>
                            <input
                              type="radio"
                              name="mode"
                              checked={isPairingMode}
                              onChange={() => setIsPairingMode(true)}
                            />
                            Pair New Device (6-digit Code)
                          </label>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', opacity: 0.8, display: 'block', marginBottom: '4px' }}>IP ADDRESS</label>
                            <input
                              type="text"
                              value={connectIp}
                              onChange={(e) => setConnectIp(e.target.value)}
                              placeholder="localhost ya 192.168.x.x"
                              style={{
                                width: '100%',
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                border: '1px solid rgba(255, 51, 204, 0.4)',
                                borderRadius: '4px',
                                color: '#fff',
                                padding: '8px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                outline: 'none'
                              }}
                            />
                          </div>

                          <div style={{ width: '130px' }}>
                            <label style={{ fontSize: '11px', opacity: 0.8, display: 'block', marginBottom: '4px' }}>PORT (5-DIGIT)</label>
                            <input
                              type="text"
                              value={connectPort}
                              onChange={(e) => setConnectPort(e.target.value)}
                              placeholder="e.g. 38475"
                              style={{
                                width: '100%',
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                border: '1px solid rgba(255, 51, 204, 0.4)',
                                borderRadius: '4px',
                                color: '#fff',
                                padding: '8px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                outline: 'none'
                              }}
                            />
                          </div>
                        </div>

                        {isPairingMode && (
                          <div>
                            <label style={{ fontSize: '11px', opacity: 0.8, display: 'block', marginBottom: '4px' }}>6-DIGIT PAIRING CODE</label>
                            <input
                              type="text"
                              value={pairingCode}
                              onChange={(e) => setPairingCode(e.target.value)}
                              placeholder="e.g. 123456"
                              style={{
                                width: '100%',
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                border: '1px solid rgba(255, 51, 204, 0.4)',
                                borderRadius: '4px',
                                color: '#fff',
                                padding: '8px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                outline: 'none'
                              }}
                            />
                          </div>
                        )}

                        <button
                          type="submit"
                          className="hud-btn"
                          disabled={connectLoading || !connectPort.trim()}
                          style={{
                            marginTop: '8px',
                            height: '38px',
                            backgroundColor: 'rgba(255, 51, 204, 0.2)',
                            borderColor: '#ff33cc',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          {connectLoading ? 'CONNECTING...' : isPairingMode ? 'PAIR & CONNECT PHONE' : '⚡ CONNECT PHONE'}
                        </button>
                      </form>

                      {/* Instructions */}
                      <div style={{
                        marginTop: '16px',
                        padding: '10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        opacity: 0.8,
                        lineHeight: '1.5'
                      }}>
                        <div style={{ color: '#ffaa30', fontWeight: 'bold', marginBottom: '4px' }}>📋 Kaise use karein:</div>
                        1. Phone mein <b>Settings &gt; Developer Options</b> mein jayein.<br />
                        2. <b>Wireless Debugging</b> ko ON karein.<br />
                        3. Wahan jo <b>IP address &amp; Port</b> (jaise :38475) dikhe, wo Port yahan daalkar <b>CONNECT</b> dabayein!
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {aiState !== 'idle' && (
            <div style={{ position: 'absolute', bottom: '2rem', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none', zIndex: 10, padding: '1rem' }}>
              <div style={{ fontFamily: 'monospace', color: '#ffaa30', textAlign: 'center', textShadow: '0 0 10px rgba(255, 170, 48, 0.8)' }}>
                <div style={{ fontSize: '0.875rem', marginBottom: '1rem', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  {aiState.toUpperCase()}
                  {/* Mic Level Visualizer (Always show when connected) */}
                  <div style={{ width: '50px', height: '4px', backgroundColor: 'rgba(255, 170, 48, 0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, micLevel * 100)}%`, height: '100%', backgroundColor: '#ffaa30', transition: 'width 0.1s' }} />
                  </div>
                </div>
                {transcript && (
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', letterSpacing: '0.05em', maxWidth: '42rem', backgroundColor: 'rgba(0, 0, 0, 0.4)', padding: '1rem', borderRadius: '0.75rem', backdropFilter: 'blur(4px)', border: '1px solid rgba(255, 170, 48, 0.3)' }}>
                    <span style={{ color: transcript.isUser ? "white" : "#ffaa30" }}>
                      {transcript.isUser ? "YOU: " : "S.D.: "}
                    </span>
                    <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>{transcript.text}</span>
                  </div>
                )}</div>
            </div>
          )}

          <div className="hud hud-hint">
            <div>
              <span className="key">DRAG</span> spin&nbsp;&nbsp;
              <span className="key">SCROLL</span> zoom
            </div>
            {cameraOn ? (
              <div>
                <span className="key">PINCH + MOVE</span> spin&nbsp;&nbsp;
                <span className="key">PINCH BOTH HANDS ± SPREAD</span> zoom
              </div>
            ) : (
              <div>
                <span className="key">G</span> hand gestures&nbsp;&nbsp;
                <span className="key">R</span> reset&nbsp;&nbsp;
                <span className="key">+/−</span> zoom
              </div>
            )}
          </div>
        </>
      )}

      {/* Live Phone Screen Mirror */}
      {showPhoneScreen && phoneScreen && (
        <div style={{
          position: 'fixed',
          top: '70px',
          left: '20px',
          zIndex: 30,
          border: '1px solid rgba(255, 51, 204, 0.6)',
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          boxShadow: '0 0 20px rgba(255, 51, 204, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px'
        }}>
          <div style={{
            fontSize: '11px',
            color: '#ff33cc',
            fontFamily: 'monospace',
            marginBottom: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            fontWeight: 'bold'
          }}>
            <span>📱 LIVE PHONE</span>
            <span style={{ cursor: 'pointer', color: '#fff', padding: '0 4px' }} onClick={() => setShowPhoneScreen(false)}>✕</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${phoneScreen}`}
            alt="Live Phone Screen"
            style={{ width: '130px', height: 'auto', borderRadius: '6px' }}
          />
        </div>
      )}

      <div className="hud hud-controls" style={{ maxWidth: '420px', width: '100%' }}>
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>

        {/* Action Status Banner */}
        {directStatus && (
          <div style={{
            padding: '4px 10px',
            backgroundColor: directStatus.startsWith('✓') ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
            border: `1px solid ${directStatus.startsWith('✓') ? '#22c55e' : '#ef4444'}`,
            color: directStatus.startsWith('✓') ? '#4ade80' : '#f87171',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            width: '100%',
            textAlign: 'center'
          }}>
            {directStatus}
          </div>
        )}

        {/* Text Command Input */}
        <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: '6px', width: '100%' }}>
          <input
            type="text"
            value={textCmd}
            onChange={(e) => setTextCmd(e.target.value)}
            placeholder="Type command (e.g. open youtube)..."
            style={{
              flex: 1,
              background: 'rgba(0, 0, 0, 0.75)',
              border: '1px solid rgba(255, 51, 204, 0.45)',
              borderRadius: '4px',
              padding: '6px 10px',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: '13px',
              outline: 'none'
            }}
          />
          <button
            type="submit"
            className="hud-btn"
            style={{ height: '34px', minWidth: '55px', fontSize: '12px', padding: '0 8px' }}
            disabled={isExecuting}
          >
            SEND
          </button>
        </form>

        {/* Quick Phone Controls */}
        <div className="hud-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px' }}>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('pressHome')}>
            🏠 HOME
          </button>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('goBack')}>
            ◀ BACK
          </button>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('openApp', { appName: 'youtube' })}>
            📺 YOUTUBE
          </button>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('openApp', { appName: 'whatsapp' })}>
            💬 WHATSAPP
          </button>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('swipe', { direction: 'down' })}>
            ⬇ SCROLL
          </button>
          <button type="button" className="hud-btn" style={{ fontSize: '11px', height: '30px', padding: '0 6px' }} onClick={() => runDirectCmd('unlockPhone')}>
            🔓 UNLOCK
          </button>
          <button
            type="button"
            className="hud-btn"
            style={{ fontSize: '11px', height: '30px', padding: '0 6px', color: showPhoneScreen ? '#22c55e' : '#ff33cc' }}
            onClick={() => setShowPhoneScreen(!showPhoneScreen)}
          >
            📱 SCREEN
          </button>
        </div>

        {/* Main AI & Gesture Controls */}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={() => {
              toggleGestures();
              audioRef.current?.playInteractionSound('click');
            }}
            disabled={camera === "starting"}
          >
            {camera === "starting" ? "INITIALIZING." : cameraOn ? "GESTURES ON" : "GESTURES OFF"}
          </button>
          
          <button
            type="button"
            className="hud-btn"
            onClick={() => {
              toggleAI();
              audioRef.current?.playInteractionSound('click');
            }}
          >
            {aiState === 'idle' ? "START S.D. AI" : "STOP S.D. AI"}
          </button>
        </div>
        <div className="hud-row">
          <button type="button" className="hud-btn" onClick={() => { sceneRef.current?.zoomIn(); audioRef.current?.playInteractionSound('zoom'); }} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="hud-btn" onClick={() => { sceneRef.current?.zoomOut(); audioRef.current?.playInteractionSound('zoom'); }} aria-label="Zoom out">
            -
          </button>
          <button type="button" className="hud-btn" onClick={() => { sceneRef.current?.resetView(); audioRef.current?.playInteractionSound('click'); }}>
            RESET
          </button>
        </div>
      </div>
    </div>
  );
}
