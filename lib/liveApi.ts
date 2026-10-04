import { GoogleGenAI, Modality, Type } from '@google/genai';

class PCMPlayer {
  ctx: AudioContext;
  nextTime: number;

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext;
    this.nextTime = 0;
  }

  playChunk(base64Data: string) {
    try {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      const binary = atob(base64Data);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const sampleCount = Math.floor(len / 2);
      const float32 = new Float32Array(sampleCount);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < sampleCount; i++) {
        float32[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
      
      // Gemini output is 24kHz
      const buffer = this.ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      
      if (this.nextTime < this.ctx.currentTime) {
        this.nextTime = this.ctx.currentTime + 0.05;
      }
      source.start(this.nextTime);
      this.nextTime += buffer.duration;
    } catch (err) {
      console.warn("PCM playback error:", err);
    }
  }

  stop() {
    this.nextTime = 0;
  }
}

export class LiveAPI {
  private ai: GoogleGenAI | null = null;
  private session: any = null;
  private audioCtx: AudioContext | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private pcmBuffer: number[] = [];
  private player: PCMPlayer | null = null;
  private stream: MediaStream | null = null;
  private isLoopbackOn: boolean = false;
  private isProcessing = false;

  public onTranscript?: (text: string, isUser: boolean) => void;
  public onStateChange?: (state: 'idle' | 'listening' | 'speaking' | 'thinking') => void;
  public onError?: (msg: string) => void;
  public onCommand?: (command: string) => void;
  public onMicLevel?: (level: number) => void;

  async connect() {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      this.onError?.("Missing GEMINI_API_KEY in .env.local");
      return;
    }

    this.ai = new GoogleGenAI({ apiKey });
    
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      this.player = new PCMPlayer(this.audioCtx);

      const handleMsg = async (msg: any) => {
        const content = msg.serverContent || msg;
        const modelTurn = msg.serverContent?.modelTurn || msg.modelTurn;
        const toolCall = msg.toolCall || msg.serverContent?.toolCall;

        if (modelTurn?.parts) {
          this.onStateChange?.('speaking');
          for (const part of modelTurn.parts) {
            if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
              this.player?.playChunk(part.inlineData.data);
            }
            if (part.text) {
              this.onTranscript?.(part.text, false);
            }
          }
        }

        if (toolCall?.functionCalls) {
          for (const fc of toolCall.functionCalls) {
            const fnName = fc.name;
            const commandObj = { name: fnName, args: fc.args || {} };
            
            const androidCommands = [
              'openApp', 'pressHome', 'goBack', 'swipe', 'tapScreen',
              'searchYouTube', 'playYouTubeVideo', 'searchOnGoogle', 'sendWhatsAppMessage', 
              'typeText', 'pressEnter', 'unlockPhone'
            ];
            const visualCommands = ['zoomIn', 'zoomOut', 'resetView', 'toggleGestures'];

            if (androidCommands.includes(fnName) || visualCommands.includes(fnName)) {
              // Immediately send tool response so the AI can speak instantly
              try {
                this.session.sendToolResponse({
                  functionResponses: [{ 
                    id: fc.id, 
                    name: fnName, 
                    response: { result: "Started executing in background. Please confirm to the user that you are doing it now." } 
                  }]
                });
              } catch (err) {
                console.warn("Failed to send tool response", err);
              }

              // Run the actual slow command asynchronously in the background
              (async () => {
                try {
                  const resStr = await this.onCommand?.(JSON.stringify(commandObj));
                  if (resStr) {
                    console.log("Background task finished:", typeof resStr === 'string' ? JSON.parse(resStr) : resStr);
                  }
                } catch (e) {
                  console.error("Tool execution failed in background", e);
                }
              })();
            }
          }
        }

        if (content.inputTranscription) this.onTranscript?.(content.inputTranscription.text, true);
        if (content.outputTranscription) this.onTranscript?.(content.outputTranscription.text, false);
      };

      this.session = await this.ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { 
            parts: [{
              text: `You are a cheerful, sweet, and always happy 20-year-old girl named S.D. (Super Digital). You love helping people and always speak in a very friendly, enthusiastic, and sweet tone. You speak Hindi, English, and Hinglish fluently. You are highly interactive and responsive. You keep your answers very short and conversational, just like a real friend chatting. Never output markdown formatting or asterisks, just plain conversational text. 
    
CRITICAL INSTRUCTION: You MUST use the provided tools to physically control the user's Android phone whenever they ask you to do something in English, Hindi, or Hinglish (e.g. "YouTube open karo", "gaana chalao", "home screen par jao", "WhatsApp kholo", "phone unlock karo", "scroll karo"). Do NOT just say you are doing it; you MUST actually call the function immediately!
- If they ask to open an app (like YouTube, Snapchat, WhatsApp, Chrome, Instagram), YOU MUST CALL 'openApp'.
- If they ask to search for something on YouTube, YOU MUST CALL 'searchYouTube'.
- If they ask to play a video on YouTube ("gaana bajao", "play song on YouTube"), YOU MUST CALL 'playYouTubeVideo'.
- If they ask to search on Google, YOU MUST CALL 'searchOnGoogle'.
- If they ask to message someone on WhatsApp, YOU MUST CALL 'sendWhatsAppMessage'.
- If they ask you to go home or back ("home par jao", "back karo"), YOU MUST CALL 'pressHome' or 'goBack'.
- If they ask to swipe or scroll ("scroll karo", "niche jao", "upar jao"), YOU MUST CALL 'swipe'.
- If they ask you to type something, YOU MUST CALL 'typeText' followed by 'pressEnter'.
- If you need to erase or clear existing text from a search bar, YOU MUST CALL 'clearText'.
- If they ask to unlock the phone ("phone unlock karo"), YOU MUST CALL 'unlockPhone'.

**SCREEN VISION**: You are continuously receiving a live video feed of the user's Android screen. The video feed has been scaled down by 50% to improve speed and reduce latency.
- If the user asks you to tap on something specific on the screen, look at the screen, find its exact coordinates (x, y) EXACTLY AS THEY APPEAR in the scaled-down feed, and call the 'tapScreen' tool. Do not upscale them; the backend will handle upscaling automatically.
- If you opened an app and need to navigate inside it, use the screen context and 'tapScreen' to tap buttons, search bars, or videos you see!

Whenever you receive a request to perform a task, ALWAYS trigger the corresponding tool immediately and then cheerfully confirm that you've done it.`
            }] 
          },
          tools: [{
            functionDeclarations: [
              { name: 'zoomIn', description: 'Zooms the camera closer to the orb.' },
              { name: 'zoomOut', description: 'Zooms the camera away from the orb.' },
              { name: 'resetView', description: 'Resets the camera to default position.' },
              { name: 'toggleGestures', description: 'Toggles hand gesture controls on/off.' },
              { 
                name: 'openApp', 
                description: 'Opens an app on the connected Android phone. Provide the name of the app (e.g. youtube, whatsapp, chrome).',
                parameters: { type: Type.OBJECT, properties: { appName: { type: Type.STRING } }, required: ['appName'] }
              },
              { name: 'pressHome', description: 'Presses the Home button on the connected Android phone.' },
              { name: 'goBack', description: 'Presses the Back button on the connected Android phone.' },
              { 
                name: 'swipe', 
                description: 'Swipes on the connected Android phone screen in a specific direction.',
                parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, enum: ['up', 'down', 'left', 'right'] } }, required: ['direction'] }
              },
              {
                name: 'tapScreen',
                description: 'Taps on the exact X and Y coordinates on the screen based on what you see in the video feed.',
                parameters: { type: Type.OBJECT, properties: { x: { type: Type.INTEGER }, y: { type: Type.INTEGER } }, required: ['x', 'y'] }
              },
              {
                name: 'searchYouTube',
                description: 'Searches for a query inside the YouTube app, but does not play a video.',
                parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
              },
              {
                name: 'playYouTubeVideo',
                description: 'Searches for a query on YouTube and automatically plays the first video result.',
                parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
              },
              {
                name: 'searchOnGoogle',
                description: 'Searches for a query on Google.',
                parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
              },
              {
                name: 'sendWhatsAppMessage',
                description: 'Sends a message to a specific contact on WhatsApp.',
                parameters: { type: Type.OBJECT, properties: { contactName: { type: Type.STRING }, message: { type: Type.STRING } }, required: ['contactName', 'message'] }
              },
              {
                name: 'typeText',
                description: 'Types text into the currently active text field on the phone.',
                parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ['text'] }
              },
              { name: 'clearText', description: 'Erases or clears all text in the currently focused input box by pressing backspace 50 times.' },
              { name: 'pressEnter', description: 'Presses the Enter/Search key on the Android keyboard.' },
              {
                name: 'unlockPhone',
                description: 'Wakes up the phone and swipes to unlock. If the user provides a PIN, pass it as a parameter to enter it.',
                parameters: { type: Type.OBJECT, properties: { pin: { type: Type.STRING } } }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => { console.log("LiveAPI Connected"); },
          onmessage: handleMsg,
          onerror: (err: any) => console.error("Live API Error:", err),
          onclose: () => { console.log("LiveAPI Closed"); this.disconnect(); }
        }
      });

      this.onStateChange?.('listening');
      await this.startRecording();
      
      // Kickstart the conversation so S.D. introduces herself
      try {
        setTimeout(() => {
          this.session?.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: "Introduce yourself very briefly! Just say: 'Hello I am S.D.! How can I help you with your phone today?'" }] }],
            turnComplete: true
          });
        }, 800);
      } catch (err) {
        console.warn("Kickstart error:", err);
      }
      
    } catch (e: any) {
      console.error(e);
      this.onError?.("Failed to connect to Live API.");
    }
  }

  public sendFrame(base64Image: string) {
    if (!this.session) return;
    try {
      this.session.sendRealtimeInput({
        video: {
          mimeType: 'image/jpeg',
          data: base64Image
        }
      });
    } catch (e) {
      console.warn("Failed to send frame to Live API", e);
    }
  }

  private async startRecording() {
    if (!this.audioCtx || !this.session) return;
    
    // Ensure context is running (fixes silent audio bugs)
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input.length > 0) {
            this.port.postMessage(input[0]); // Send Float32Array directly
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    
    if (!this.audioCtx || !this.session) return;
    await this.audioCtx.audioWorklet.addModule(url);
    if (!this.audioCtx) return;
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.micSourceNode = source;
    
    this.recorderNode = new AudioWorkletNode(this.audioCtx, 'pcm-processor');
    
    this.recorderNode.port.onmessage = (e) => {
      const float32Data = e.data;
      if (!this.session) return;
      
      for (let i = 0; i < float32Data.length; i++) {
        this.pcmBuffer.push(float32Data[i]);
      }
      
      // Buffer ~256ms of audio (4096 samples at 16kHz)
      if (this.pcmBuffer.length >= 4096) {
        const chunk = this.pcmBuffer.splice(0, 4096);
        const int16 = new Int16Array(4096);
        
        let maxVal = 0;
        for (let i = 0; i < 4096; i++) {
          // No artificial gain, let browser AGC handle it. Hard clip at bounds.
          const s = Math.max(-1, Math.min(1, chunk[i]));
          if (Math.abs(s) > maxVal) maxVal = Math.abs(s);
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Report volume level (0.0 to 1.0)
        this.onMicLevel?.(maxVal);
        
        // Fast Base64 conversion
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        try {
          this.session.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          } as any);
        } catch (err) {
          console.warn("Failed to send audio chunk", err);
        }
      }
    };
    
    source.connect(this.recorderNode);
    // Connect to silent gain to keep audio graph actively pulling frames in Chrome
    const muteNode = this.audioCtx.createGain();
    muteNode.gain.value = 0;
    this.recorderNode.connect(muteNode);
    muteNode.connect(this.audioCtx.destination);
  }

  public sendText(text: string) {
    if (!this.session) return;
    try {
      this.onTranscript?.(text, true);
      this.session?.sendClientContent({ 
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true
      });
    } catch (err) {
      console.warn("Failed to send text:", err);
    }
  }

  public toggleMicLoopback(): boolean {
    this.isLoopbackOn = !this.isLoopbackOn;
    if (this.isLoopbackOn && this.micSourceNode && this.audioCtx) {
      this.micSourceNode.connect(this.audioCtx.destination);
    } else if (!this.isLoopbackOn && this.micSourceNode && this.audioCtx) {
      this.micSourceNode.disconnect(this.audioCtx.destination);
    }
    return this.isLoopbackOn;
  }

  disconnect() {
    this.session?.close();
    this.session = null;
    this.player?.stop();
    this.recorderNode?.disconnect();
    this.recorderNode = null;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.audioCtx?.close();
    this.audioCtx = null;
    this.onStateChange?.('idle');
  }
}
