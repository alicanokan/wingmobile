
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FeatherScene } from './components/FeatherScene';
import { AudioAnalyzer } from './services/audioService';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';

const App: React.FC = () => {
  const [role, setRole] = useState<'display' | 'controller'>('display');
  const [isStarted, setIsStarted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const targetPeerId = params.get('id');

    if (urlRole === 'controller' && targetPeerId) {
      setRole('controller');
      initController(targetPeerId);
    } else {
      initHost();
    }

    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (analyzerRef.current) analyzerRef.current.stop();
    };
  }, []);

  const initHost = () => {
    try {
      const peer = new Peer();
      peerRef.current = peer;
      
      peer.on('open', (id) => {
        console.log('Host initialized with ID:', id);
        setPeerId(id);
      });

      peer.on('connection', (conn) => {
        console.log('Remote device connected');
        connRef.current = conn;
        setIsConnected(true);
        setShowQR(false);
        setIsStarted(true); 
        
        conn.on('data', (data: any) => {
          if (typeof data === 'number') {
            setVolume(data);
          }
        });
        
        conn.on('close', () => {
          setIsConnected(false);
          setVolume(0);
        });
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        setError('Connection service encountered an error.');
      });
    } catch (e) {
      console.error('Failed to create Peer:', e);
      setError('Could not initialize PeerJS.');
    }
  };

  const initController = (targetId: string) => {
    try {
      const peer = new Peer();
      peerRef.current = peer;
      
      peer.on('open', () => {
        console.log('Controller ready, connecting to:', targetId);
        const conn = peer.connect(targetId);
        connRef.current = conn;
        
        conn.on('open', () => setIsConnected(true));
        conn.on('close', () => setIsConnected(false));
        conn.on('error', (err) => setError('Failed to link to display.'));
      });
    } catch (e) {
      setError('Could not initialize mobile controller.');
    }
  };

  const startInteraction = useCallback(async () => {
    try {
      if (analyzerRef.current) return;
      const analyzer = new AudioAnalyzer();
      await analyzer.init();
      analyzerRef.current = analyzer;
      setIsStarted(true);

      const update = () => {
        if (analyzerRef.current) {
          const currentVol = analyzerRef.current.getVolume();
          setVolume(currentVol);
          
          if (connRef.current && role === 'controller' && connRef.current.open) {
            connRef.current.send(currentVol);
          }
          requestAnimationFrame(update);
        }
      };
      update();
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Microphone access is required for interactivity.");
    }
  }, [role]);

  // Controller UI (Mobile)
  if (role === 'controller') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] p-8 text-white">
        <div className="text-center mb-12">
          <h1 className="text-xl font-light tracking-[0.4em] uppercase mb-4">Wing Beat Sensor</h1>
          <div className={`inline-block px-3 py-1 rounded-full text-[8px] tracking-[0.2em] uppercase border ${isConnected ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}>
            {isConnected ? 'Link Active' : 'Connecting to Display...'}
          </div>
        </div>

        {!isStarted ? (
          <button
            onClick={startInteraction}
            className="w-56 h-56 rounded-full border border-white/20 flex flex-col items-center justify-center space-y-4 hover:bg-white/5 transition-all group active:scale-95"
          >
            <div className="w-12 h-12 rounded-full border border-white/40 flex items-center justify-center group-hover:scale-110 transition-transform">
              <div className="w-2 h-2 bg-white rounded-full animate-ping" />
            </div>
            <span className="text-[10px] tracking-[0.4em] uppercase font-light">Activate Mic</span>
          </button>
        ) : (
          <div className="relative w-64 h-64 flex flex-col items-center justify-center">
             <div 
               className="absolute inset-0 border border-white/10 rounded-full transition-transform duration-75" 
               style={{ transform: `scale(${1 + volume * 1.5})`, opacity: 0.1 + volume }}
             />
             <div className="text-center z-10">
               <span className="text-6xl font-thin block mb-2 tabular-nums">{Math.round(volume * 100)}</span>
               <span className="text-[8px] tracking-[0.5em] text-white/40 uppercase">Sending Data</span>
             </div>
          </div>
        )}
        {error && <p className="mt-8 text-red-400 text-[10px] uppercase tracking-widest">{error}</p>}
      </div>
    );
  }

  // Display UI (Desktop)
  return (
    <div className="relative w-screen h-screen bg-[#050505] overflow-hidden select-none">
      {/* Header */}
      <div className="absolute top-8 left-8 z-10 pointer-events-none">
        <h1 className="text-2xl font-light tracking-[0.3em] text-white/90 uppercase mb-2">Wing Beat</h1>
        <p className="text-[9px] tracking-[0.4em] text-white/30 uppercase">A Ritual of Remembrance</p>
      </div>

      {/* Connection Controls */}
      <div className="absolute top-8 right-8 z-[60] flex flex-col items-end">
        {!isConnected ? (
          <button 
            onClick={() => setShowQR(true)}
            className={`px-4 py-2 text-[10px] tracking-[0.3em] uppercase border transition-all duration-300 bg-transparent text-white/60 border-white/20 hover:border-white/60 hover:text-white`}
          >
            [ SYNC PHONE ]
          </button>
        ) : (
          <div className="flex flex-col items-end">
            <div className="flex items-center space-x-2 text-green-400 font-bold text-[10px] tracking-widest uppercase">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>Linked</span>
            </div>
          </div>
        )}
        {isStarted && (
          <div className="mt-6 flex flex-col items-end">
            <label className="text-[8px] tracking-[0.3em] text-white/30 uppercase mb-2">Sensitivity</label>
            <input
              type="range" min="0.1" max="5" step="0.1"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              className="w-24 h-0.5 bg-white/10 appearance-none cursor-pointer accent-white"
            />
          </div>
        )}
      </div>

      {/* QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="bg-white p-10 rounded-sm flex flex-col items-center shadow-2xl scale-100 transition-transform">
            {peerId ? (
              <>
                <div className="bg-white p-2">
                  <QRCodeSVG 
                    value={`${window.location.origin}${window.location.pathname}?role=controller&id=${peerId}`} 
                    size={240}
                    level="L"
                  />
                </div>
                <h3 className="text-black text-[12px] tracking-[0.4em] uppercase mt-8 font-black">Scan with Phone</h3>
                <p className="text-black/40 text-[9px] tracking-[0.2em] mt-3 uppercase text-center max-w-[220px]">
                  Bridges your mobile mic to this session
                </p>
              </>
            ) : (
              <div className="h-[240px] w-[240px] flex flex-col items-center justify-center space-y-4">
                <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <p className="text-black text-[10px] uppercase tracking-widest font-bold">Waiting for ID...</p>
              </div>
            )}
            <button 
              onClick={() => setShowQR(false)} 
              className="mt-10 px-8 py-2 border border-black/10 text-[9px] uppercase text-black/40 hover:text-black hover:border-black transition-all tracking-[0.4em]"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Initial Landing UI */}
      {!isStarted && !showQR && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/60 backdrop-blur-sm">
          <div className="max-w-md text-center px-6">
            <h2 className="text-5xl font-extralight mb-8 tracking-tighter text-white uppercase italic">Ritual</h2>
            <p className="text-[11px] text-white/40 leading-loose mb-12 tracking-[0.2em] uppercase font-light">
              Your breath moves the digital spine.
            </p>
            <button
              onClick={startInteraction}
              className="px-12 py-4 border border-white/20 text-white/80 hover:bg-white hover:text-black hover:border-white transition-all duration-500 tracking-[0.5em] uppercase text-[10px] font-bold"
            >
              Start Locally
            </button>
          </div>
        </div>
      )}

      <FeatherScene volume={volume} sensitivity={sensitivity} />
      
      <div className="absolute bottom-8 left-8 z-10 pointer-events-none">
        <p className="text-[10px] tracking-[0.5em] text-white/10 uppercase">Alican Okan / 2025</p>
      </div>
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_200px_rgba(0,0,0,1)]" />
    </div>
  );
};

export default App;
