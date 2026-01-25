import React, { useState, useEffect, useRef } from 'react';
import './index.css';

const DEFAULT_SETTINGS = {
  warmup: 10,
  workout: 20,
  rest: 10,
  rounds: 8,
  sets: 3,
  setRest: 30,
  cooldown: 60
};

const PHASES = {
  IDLE: 'idle',
  WARMUP: 'warmup',
  WORKOUT: 'workout',
  REST: 'rest',
  SET_REST: 'setRest',
  COOLDOWN: 'cooldown',
  FINISHED: 'finished'
};

const PHASE_NAMES = {
  [PHASES.WARMUP]: 'Warm Up',
  [PHASES.WORKOUT]: 'Workout',
  [PHASES.REST]: 'Rest',
  [PHASES.SET_REST]: 'Set Rest',
  [PHASES.COOLDOWN]: 'Cooldown',
  [PHASES.FINISHED]: 'Finished'
};

const PHASE_COLORS = {
  [PHASES.WARMUP]: '#f39c12',
  [PHASES.WORKOUT]: '#e74c3c',
  [PHASES.REST]: '#2ecc71',
  [PHASES.SET_REST]: '#3498db',
  [PHASES.COOLDOWN]: '#9b59b6',
  [PHASES.FINISHED]: '#ffffff'
};

const formatTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const SettingControl = ({ value, onChange, step, isTime }) => {
  const [localValue, setLocalValue] = useState(isTime ? formatTime(value) : value.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalValue(isTime ? formatTime(value) : value.toString());
    }
  }, [value, isEditing, isTime]);

  const commitChange = () => {
    let newVal = value;
    const str = localValue.trim();
    if (isTime) {
      // Parse "mm:ss" or "hh:mm:ss" or "ss"
      const parts = str.split(':').map(p => parseInt(p, 10));
      if (!parts.some(isNaN)) {
        if (parts.length === 3) newVal = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) newVal = parts[0] * 60 + parts[1];
        else if (parts.length === 1) newVal = parts[0];
      }
    } else {
      const parsed = parseInt(str, 10);
      if (!isNaN(parsed)) newVal = parsed;
    }
    onChange(Math.max(0, newVal));
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  return (
    <div className="spin-button">
      <button onClick={() => onChange(value - step)} tabIndex="-1">-</button>
      <input 
        className="spin-input"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitChange}
        onFocus={(e) => { setIsEditing(true); e.target.select(); }}
        onKeyDown={handleKeyDown}
      />
      <button onClick={() => onChange(value + step)} tabIndex="-1">+</button>
    </div>
  );
};


function App() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('intervalTimerSettings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const [profiles, setProfiles] = useState(() => {
    try {
      const saved = localStorage.getItem('intervalTimerProfiles');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState(PHASES.IDLE);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentSet, setCurrentSet] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  
  const timerRef = useRef(null);
  const workerRef = useRef(null);
  const startTimeRef = useRef(null);
  const baseTimeRef = useRef(null);
  const audioContext = useRef(null);
  const wakeLock = useRef(null);
  const pipWindowRef = useRef(null);
  const [isPipActive, setIsPipActive] = useState(false);

  // Initialize Web Worker for background timing
  useEffect(() => {
    const workerCode = `
      let timer = null;
      self.onmessage = (e) => {
        if (e.data === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(() => self.postMessage('tick'), 100);
        } else if (e.data === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    workerRef.current = new Worker(workerUrl);

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      URL.revokeObjectURL(workerUrl);
    };
  }, []);

  // Sync timer when coming back to the tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isRunning && startTimeRef.current !== null) {
        syncTime();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isRunning]);

  const syncTime = () => {
    if (!startTimeRef.current) return;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const newTimeLeft = Math.max(0, baseTimeRef.current - elapsed);
    if (newTimeLeft !== timeLeft) {
      setTimeLeft(newTimeLeft);
    }
  };

  useEffect(() => {
    localStorage.setItem('intervalTimerSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('intervalTimerProfiles', JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    return () => {
      if (wakeLock.current) wakeLock.current.release();
    };
  }, []);

  const initAudio = () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.error('Wake Lock failed:', err);
      }
    }
  };

  // Audio helper
  const playSound = (freq, duration, type = 'sine', startTime = null) => {
    if (!audioContext.current) return;
    const ctx = audioContext.current;
    const start = startTime || ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(start);
    gain.gain.setValueAtTime(0.1, start);
    gain.gain.exponentialRampToValueAtTime(0.00001, start + duration);
    osc.stop(start + duration);
  };

  const playTick = () => playSound(880, 0.1);
  const playDoubleTick = () => {
    if (!audioContext.current) return;
    const now = audioContext.current.currentTime;
    playSound(880, 0.08, 'sine', now);
    playSound(880, 0.08, 'sine', now + 0.15);
  };
  const playFinished = () => playSound(440, 0.8, 'square');

  // Timer tick logic using Web Worker for background stability
  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        baseTimeRef.current = timeLeft;
      }

      const handleTick = () => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const calculatedTimeLeft = Math.max(0, baseTimeRef.current - elapsed);
        
        if (calculatedTimeLeft !== timeLeft) {
          setTimeLeft(calculatedTimeLeft);
        }
      };

      workerRef.current.onmessage = handleTick;
      workerRef.current.postMessage('start');
    } else if (isRunning && timeLeft === 0) {
      workerRef.current.postMessage('stop');
      handlePhaseTransition();
    } else {
      workerRef.current.postMessage('stop');
      startTimeRef.current = null;
    }

    return () => {
      if (workerRef.current) workerRef.current.postMessage('stop');
    };
  }, [isRunning, timeLeft, status]);

  // Handle countdown sounds
  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      // 5-minute multiples, 1-minute mark, and final 5 seconds countdown
      const isFiveMinMultiple = timeLeft % 300 === 0;
      const isOneMin = timeLeft === 60;
      const isCountdown = timeLeft <= 5;

      if (isFiveMinMultiple || isOneMin) {
        playDoubleTick();
      } else if (isCountdown) {
        playTick();
      }
    } else if (isRunning && timeLeft === 0 && status !== PHASES.IDLE && status !== PHASES.FINISHED) {
      playFinished();
    }
  }, [timeLeft, isRunning]);

  const handlePhaseTransition = () => {
    if (status === PHASES.WARMUP) {
      startWorkout();
    } else if (status === PHASES.WORKOUT) {
      if (currentRound < settings.rounds) {
        if (settings.rest > 0) {
          startPhase(PHASES.REST, settings.rest);
        } else {
           nextRound();
        }
      } else {
        finishSet();
      }
    } else if (status === PHASES.REST) {
      nextRound();
    } else if (status === PHASES.SET_REST) {
      nextSet();
    } else if (status === PHASES.COOLDOWN) {
      finishTotal();
    }
  };

  const startPhase = (phase, time) => {
    setStatus(phase);
    setTimeLeft(time);
    setTotalTime(time);
    startTimeRef.current = Date.now();
    baseTimeRef.current = time;
  };

  const startWorkout = () => {
    startPhase(PHASES.WORKOUT, settings.workout);
  };

  const nextRound = () => {
    setCurrentRound(r => r + 1);
    startWorkout();
  };

  const finishSet = () => {
    if (currentSet < settings.sets) {
       if (settings.setRest > 0) {
         startPhase(PHASES.SET_REST, settings.setRest);
       } else {
         nextSet();
       }
    } else {
       startCooldown();
    }
  };

  const nextSet = () => {
    setCurrentSet(s => s + 1);
    setCurrentRound(1);
    startWorkout();
  };

  const startCooldown = () => {
    if (settings.cooldown > 0) {
      startPhase(PHASES.COOLDOWN, settings.cooldown);
    } else {
      finishTotal();
    }
  };

  const finishTotal = () => {
    setIsRunning(false);
    setStatus(PHASES.FINISHED);
    playFinished();
    if (wakeLock.current) wakeLock.current.release();
  };

  const handleStart = () => {
    initAudio();
    requestWakeLock();
    
    if (status === PHASES.IDLE || status === PHASES.FINISHED) {
      setCurrentRound(1);
      setCurrentSet(1);
      if (settings.warmup > 0) {
        startPhase(PHASES.WARMUP, settings.warmup);
      } else {
        startWorkout();
      }
    }
    setIsRunning(true);
    startTimeRef.current = Date.now();
    baseTimeRef.current = (status === PHASES.IDLE || status === PHASES.FINISHED) ? (settings.warmup > 0 ? settings.warmup : settings.workout) : timeLeft;
  };

  const handleReset = () => {
    setIsRunning(false);
    setStatus(PHASES.IDLE);
    setTimeLeft(0);
    setCurrentRound(1);
    setCurrentSet(1);
    startTimeRef.current = null;
    if (wakeLock.current) wakeLock.current.release();
  };

  const updateSetting = (key, val) => {
    setSettings(prev => ({...prev, [key]: Math.max(0, val)}));
  };

  const handleSaveProfile = () => {
    if (!profileName.trim()) return;
    const newProfile = {
      id: Date.now().toString(),
      name: profileName.trim(),
      settings: { ...settings }
    };
    setProfiles([...profiles, newProfile]);
    setProfileName('');
    alert('Profile saved!');
  };

  const handleLoadProfile = (profile) => {
    setSettings(profile.settings);
  };

  const handleDeleteProfile = (id) => {
    if(window.confirm('Delete this profile?')) {
      setProfiles(profiles.filter(p => p.id !== id));
    }
  };

  const togglePip = async () => {
    if (!window.documentPictureInPicture) {
      alert('Your browser does not support Document Picture-in-Picture.');
      return;
    }

    if (isPipActive) {
      pipWindowRef.current.close();
      return;
    }

    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 400,
        height: 500,
      });

      pipWindowRef.current = pipWindow;
      setIsPipActive(true);

      // Copy styles
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          if (styleSheet.cssRules) {
            const newStyle = pipWindow.document.createElement('style');
            [...styleSheet.cssRules].forEach((rule) => {
              newStyle.appendChild(pipWindow.document.createTextNode(rule.cssText));
            });
            pipWindow.document.head.appendChild(newStyle);
          } else if (styleSheet.href) {
            const newLink = pipWindow.document.createElement('link');
            newLink.rel = 'stylesheet';
            newLink.href = styleSheet.href;
            pipWindow.document.head.appendChild(newLink);
          }
        } catch (e) {
          console.error('Error copying styles to PiP window:', e);
        }
      });

      // Move timer content
      const container = document.getElementById('timer-container');
      if (container) {
        pipWindow.document.body.appendChild(container);
        // Ensure body has background in PiP
        pipWindow.document.body.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.display = 'flex';
        pipWindow.document.body.style.alignItems = 'center';
        pipWindow.document.body.style.justifyContent = 'center';
        pipWindow.document.body.style.minHeight = '100vh';
      }

      pipWindow.addEventListener('unload', () => {
        setIsPipActive(false);
        pipWindowRef.current = null;
        // Move content back
        const appRoot = document.getElementById('pip-placeholder');
        if (appRoot && container) {
          appRoot.appendChild(container);
        }
      });
    } catch (err) {
      console.error('Failed to enter PiP:', err);
    }
  };
  
  const ProgressCircle = ({ timeLeft, totalTime, color }) => {
    const radius = 140;
    const stroke = 12;
    const normalizedRadius = radius - stroke * 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = totalTime > 0 ? circumference - (timeLeft / totalTime) * circumference : 0;

    return (
      <div className="progress-container">
        <svg
          height={radius * 2}
          width={radius * 2}
          className="progress-svg"
        >
          <circle
            stroke="rgba(255, 255, 255, 0.1)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            stroke={color}
            fill="transparent"
            strokeDasharray={circumference + ' ' + circumference}
            style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s ease' }}
            strokeWidth={stroke}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>
        <div className="progress-content">
          <div className="timer-display">
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>
    );
  };

  const renderSetting = (key, label, step = 5) => (
    <div key={key} className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <SettingControl 
        value={settings[key]} 
        onChange={(v) => updateSetting(key, v)} 
        step={step} 
        isTime={key !== 'rounds' && key !== 'sets'} 
      />
    </div>
  );

  if (status === PHASES.IDLE || status === PHASES.FINISHED) {
    return (
      <div className="container">
        <h1 style={{ textAlign: 'center', marginBottom: '20px', background: '-webkit-linear-gradient(45deg, #e94560, #0f3460)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '2.5rem' }}>Interval Timer</h1>
        
        <div className="glass-panel" style={{ marginBottom: '20px' }}>
          {renderSetting('warmup', 'Warmup Time')}
          {renderSetting('workout', 'Workout Time')}
          {renderSetting('rest', 'Rest Time')}
          {renderSetting('rounds', 'Rounds', 1)}
          {renderSetting('sets', 'Sets', 1)}
          {renderSetting('setRest', 'Set Rest')}
          {renderSetting('cooldown', 'Cooldown')}
        </div>

        <button 
          onClick={handleStart} 
          style={{ width: '100%', fontSize: '1.2rem', padding: '15px', background: 'linear-gradient(to right, #e94560, #ff6b6b)' }}
        >
          {status === PHASES.FINISHED ? 'Restart' : 'Start Workout'}
        </button>  
        
        {status === PHASES.FINISHED && (
             <div style={{textAlign: 'center', marginTop: 20, fontSize: '1.5rem', fontWeight: 'bold'}}>
               Workout Complete!
             </div>
        )}

        {/* Profile Management Section */}
        <div className="glass-panel" style={{ marginTop: '30px' }}>
          <h3 style={{marginBottom: '10px', fontSize: '1.2rem'}}>Save / Load Preset</h3>
          <div style={{display: 'flex', gap: '10px', marginBottom: '20px'}}>
            <input 
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Preset Name"
              style={{
                flex: 1, 
                padding: '10px', 
                borderRadius: '8px', 
                border: '1px solid rgba(255,255,255,0.2)', 
                background: 'rgba(0,0,0,0.3)', 
                color: 'white',
                fontFamily: 'inherit'
              }}
            />
            <button 
               onClick={handleSaveProfile}
               style={{background: '#0984e3', minWidth: '80px'}}
            >
              Save
            </button>
          </div>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto'}}>
            {profiles.length === 0 && <div style={{opacity: 0.5, textAlign: 'center', padding: '10px'}}>No saved presets</div>}
            {profiles.map(p => (
               <div key={p.id} style={{
                   display: 'flex', 
                   justifyContent: 'space-between', 
                   alignItems: 'center', 
                   background: 'rgba(255,255,255,0.05)', 
                   padding: '10px 15px', 
                   borderRadius: '8px'
               }}>
                 <span style={{fontWeight: 500}}>{p.name}</span>
                 <div style={{display: 'flex', gap: '8px'}}>
                   <button onClick={() => handleLoadProfile(p)} style={{padding: '5px 12px', fontSize: '0.9rem', background: '#00b894'}}>Load</button>
                    <button onClick={() => handleDeleteProfile(p.id)} style={{padding: '5px 12px', fontSize: '0.9rem', background: '#d63031'}}>Del</button>
                 </div>
               </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" id="pip-placeholder" style={{ justifyContent: 'center' }}>
      <div id="timer-container" style={{ width: '100%' }}>
        <div className="glass-panel" style={{ textAlign: 'center', width: '100%', padding: '40px 20px', borderTop: `5px solid ${PHASE_COLORS[status]}` }}>
          <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', color: PHASE_COLORS[status], marginBottom: '20px' }}>
            {PHASE_NAMES[status]}
          </h2>
          
          <ProgressCircle 
            timeLeft={timeLeft} 
            totalTime={totalTime} 
            color={PHASE_COLORS[status]} 
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div>
              <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>ROUND</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentRound} / {settings.rounds}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>SET</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentSet} / {settings.sets}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setIsRunning(!isRunning)} style={{ flex: 1, minWidth: '100px', backgroundColor: isRunning ? '#e74c3c' : '#2ecc71' }}>
              {isRunning ? 'Pause' : 'Resume'}
            </button>
            <button onClick={handleReset} style={{ flex: 1, minWidth: '100px', backgroundColor: '#7f8c8d' }}>
              Reset
            </button>
            {window.documentPictureInPicture && !isPipActive && (
              <button 
                onClick={togglePip} 
                style={{ flex: '1 1 100%', marginTop: '10px', backgroundColor: '#34495e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <span>Pop-out Timer</span>
                <span style={{ fontSize: '0.8rem' }}>📺</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
